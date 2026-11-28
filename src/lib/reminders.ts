// Reminders. The queue of reminders that are due is derived from tasks and the
// counselor's rules; nothing is stored until one "goes out" (see the store's
// sendReminder, which writes to the on-screen log).
//
// Reminders are fixed templates, not AI output. A counselor chooses per rule
// whether they go out automatically or wait for approval.
//
// NOTE: Chinese templates need a native-speaker review.

import { STUDENT_LINK_PLACEHOLDER, STUDENT_LINK_PREVIEW } from '../../shared/dispatch'
import type { AppData, ID, Language, OutboxMessage, Parent, ReminderMode, ReminderRule, ReminderSkip, Student, Task } from '../types'
import { daysBetween, formatDate, formatDateLong, formatDateZh, formatTime, todayISO, type ISODate } from './dates'
import { activeStudents, daysLate, fullName, isLate, isOpen, primaryParent, type WeeklyTextItems } from './derive'
import { zhGiven, zhGreeting } from './language'

/** True when a skip still keeps this dedupe key out of the queue. */
export function skipIsActive(skip: Pick<ReminderSkip, 'until'>, today: ISODate = todayISO()): boolean {
  if (!skip.until) return true
  return daysBetween(today, skip.until) > 0
}

/** Active skips keyed by dedupe_key. */
export function activeSkipKeys(skips: ReminderSkip[], today: ISODate = todayISO()): Set<string> {
  return new Set(skips.filter((s) => skipIsActive(s, today)).map((s) => s.dedupeKey))
}

export interface ReminderDraft {
  /** Identifies this reminder (rule + task + recipient) so it is not sent twice. */
  key: string
  ruleId: ReminderRule['id']
  mode: ReminderMode
  studentId: ID
  taskId: ID
  taskTitle: string
  message: Omit<OutboxMessage, 'id' | 'sentAt' | 'status' | 'sendAfter' | 'approvedBy' | 'approvedAt' | 'providerMessageId' | 'error' | 'trigger'>
}

/**
 * What each mode is called on screen. The stored value 'automatic' is unchanged, but nothing
 * here sends by itself: such a reminder is queued for the next daily send, which a person starts.
 */
export const REMINDER_MODE_LABEL = { automatic: 'Next daily send', needs_approval: 'Ask me first', off: 'Off' } as const

/** A reminder that went out this recently is not queued again. */
export const REPEAT_AFTER_DAYS = 3

export type ReminderKind = 'upcoming' | 'late' | 'escalation'
type Kind = ReminderKind

/** The fixed wording for a reminder to a parent. Also the placeholder when the AI is unavailable. */
export function parentText(kind: Kind, lang: Language, p: Parent, s: Student, t: Task, late: number): string {
  const title = t.title
  if (lang === 'zh-Hans') {
    const hi = `${zhGreeting(p)}您好，`
    const name = zhGiven(s)
    if (kind === 'upcoming') return `${hi}提醒您：${name}的升学事项「${title}」将于${formatDateZh(t.dueDate)}到期，麻烦您留意一下。谢谢！`
    if (kind === 'late') return `${hi}「${title}」原定${formatDateZh(t.dueDate)}完成，目前已逾期${late}天。这一项需要您这边协助，方便的话请尽快处理，有困难可以随时告诉我。`
    return `${hi}跟您说一下：${name}的「${title}」已经逾期${late}天了。我这边会直接跟进，也麻烦您在家提醒一下。谢谢！`
  }
  if (lang === 'zh-Hant') {
    const hi = `${zhGreeting(p)}您好，`
    const name = zhGiven(s)
    if (kind === 'upcoming') return `${hi}提醒您：${name}的升學事項「${title}」將於${formatDateZh(t.dueDate)}到期，再麻煩您留意。謝謝！`
    if (kind === 'late') return `${hi}「${title}」原訂${formatDateZh(t.dueDate)}完成，目前已逾期${late}天。這一項需要您這邊協助，方便的話請盡快處理，有任何困難歡迎隨時告訴我。`
    return `${hi}跟您說一聲：${name}的「${title}」已經逾期${late}天了。我這邊會直接跟進，也麻煩您在家提醒一下。謝謝！`
  }
  const days = `${late} ${late === 1 ? 'day' : 'days'}`
  if (kind === 'upcoming') return `Hello ${p.name}, a reminder: “${title}” for ${s.firstName} is due ${formatDate(t.dueDate)}. Thank you!`
  if (kind === 'late') return `Hello ${p.name}, “${title}” was due ${formatDate(t.dueDate)} and is now ${days} late. This one needs your help. Please take care of it when you can, and tell me if anything is in the way.`
  return `Hello ${p.name}, a heads-up: ${s.firstName}’s task “${title}” is ${days} overdue. I am following up directly, and a nudge at home would help. Thank you!`
}

/** The fixed wording for a reminder to a student. */
export function studentText(kind: 'upcoming' | 'late', s: Student, t: Task, late: number): string {
  if (kind === 'upcoming') {
    const n = daysBetween(todayISO(), t.dueDate)
    const when = n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`
    return `Hi ${s.firstName}, a reminder that “${t.title}” is due ${when} (${formatDate(t.dueDate)}). Reply here if you are stuck.`
  }
  return `Hi ${s.firstName}, “${t.title}” was due ${formatDate(t.dueDate)} and is now ${late} ${late === 1 ? 'day' : 'days'} late. Can you send what you have today?`
}

/** Every reminder that should go out now, given the tasks and the rules. */
export function reminderQueue(data: AppData): ReminderDraft[] {
  const today = todayISO()
  const rule = (id: ReminderRule['id']) => data.reminderRules.find((r) => r.id === id)!
  const recentlySent = new Set(
    data.outbox
      .filter((o) => o.status !== 'cancelled' && o.dedupeKey && daysBetween(o.sentAt.slice(0, 10), today) < REPEAT_AFTER_DAYS)
      .map((o) => o.dedupeKey),
  )
  // A reminder about the task sent by hand (the "Remind" button, or one the assistant drafted)
  // carries no rule key. It still counts: the same person is not reminded of the same task twice
  // inside the repeat window.
  const about = (taskId: ID, parentId: ID | undefined) => `${taskId}:${parentId ?? 'student'}`
  const recentlyReminded = new Set(
    data.outbox
      .filter((o) => o.status !== 'cancelled' && o.taskId && daysBetween(o.sentAt.slice(0, 10), today) < REPEAT_AFTER_DAYS)
      .map((o) => about(o.taskId!, o.toKind === 'parent' ? o.parentId : undefined)),
  )
  const skipped = activeSkipKeys(data.reminderSkips ?? [], today)
  const queue: ReminderDraft[] = []
  const escalated = new Set<ID>()
  const students = activeStudents(data)

  const add = (r: ReminderRule, s: Student, t: Task, message: ReminderDraft['message']) => {
    const key = `${r.id}:${t.id}:${message.parentId ?? 'student'}`
    if (r.mode === 'off' || recentlySent.has(key) || recentlyReminded.has(about(t.id, message.parentId)) || skipped.has(key)) return
    queue.push({ key, ruleId: r.id, mode: r.mode, studentId: s.id, taskId: t.id, taskTitle: t.title, message: { ...message, dedupeKey: key } })
  }

  const toParent = (kind: Kind, p: Parent, s: Student, t: Task, late: number): ReminderDraft['message'] => ({
    studentId: s.id,
    toKind: 'parent',
    toName: p.name,
    parentId: p.id,
    taskId: t.id,
    channel: p.channel,
    language: p.language,
    kind: kind === 'upcoming' ? 'reminder_upcoming' : 'reminder_late',
    body: parentText(kind, p.language, p, s, t, late),
    bodyEn: p.language === 'en' ? undefined : parentText(kind, 'en', p, s, t, late),
  })

  const open = data.tasks.filter(isOpen).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  for (const t of open) {
    const s = students.find((x) => x.id === t.studentId)
    if (!s) continue
    const late = daysLate(t, today)
    const until = daysBetween(today, t.dueDate)

    if (t.owner === 'student') {
      const toStudent = (kind: 'upcoming' | 'late'): ReminderDraft['message'] => ({
        studentId: s.id,
        toKind: 'student',
        toName: fullName(s),
        taskId: t.id,
        channel: s.preferredChannel ?? 'text',
        language: 'en',
        kind: kind === 'upcoming' ? 'reminder_upcoming' : 'reminder_late',
        body: studentText(kind, s, t, late),
      })
      if (isLate(t, today)) add(rule('student_late'), s, t, toStudent('late'))
      else if (until <= rule('student_upcoming').days) add(rule('student_upcoming'), s, t, toStudent('upcoming'))

      // One escalation per student, for their most overdue task, to the primary parent.
      const esc = rule('parent_escalation')
      const primary = primaryParent(s)
      if (primary && late >= esc.days && !escalated.has(s.id)) {
        escalated.add(s.id)
        add(esc, s, t, toParent('escalation', primary, s, t, late))
      }
    }

    if (t.owner === 'parent') {
      const p = s.parents.find((x) => x.id === t.ownerParentId)
      if (!p) continue
      if (isLate(t, today)) add(rule('parent_late'), s, t, toParent('late', p, s, t, late))
      else if (until <= rule('parent_upcoming').days) add(rule('parent_upcoming'), s, t, toParent('upcoming', p, s, t, late))
    }
  }
  return queue
}

// ── The weekly text ─────────────────────────────────────────────────────────
// One short text per student per week. The facts below are computed here and
// must appear in the text unchanged, whether the AI words it or the fixed
// template does.

/** A text message this long still arrives as one conversation bubble on most phones. */
export const WEEKLY_TEXT_MAX = 480
const WEEKLY_TEXT_MAX_ITEMS = 4

/** A student's address is this site, "/s#" and a 43-character token. */
const STUDENT_TOKEN_LENGTH = 43
const studentUrlLength = () => (typeof window === 'undefined' ? 0 : `${window.location.origin}/s#`.length + STUDENT_TOKEN_LENGTH)

/** How much longer a text gets when the placeholders in it become the student's real address. 0 without one. */
export const linkRoom = (text: string): number =>
  (text.split(STUDENT_LINK_PLACEHOLDER).length - 1) * Math.max(0, studentUrlLength() - STUDENT_LINK_PLACEHOLDER.length)

export interface WeeklyTextFacts {
  firstName: string
  counselorFirstName: string
  /** "Tue, Nov 26 at 4:00 PM" */
  meeting?: string
  /**
   * Late tasks first, most overdue first. `late` reads "3 days late". `id` is a
   * short handle ("t1") the AI returns to say which task it put first;
   * `category` and `status` are there to help it judge, and are not written out.
   */
  late: { id: string; title: string; due: string; late: string; category: string; status: string }[]
  /** Then tasks due in the next 7 days. */
  due: { id: string; title: string; due: string; category: string; status: string }[]
  /** The next application deadlines, for judging what is most urgent. Never written into the text. */
  deadlines: { label: string; due: string; inDays: number }[]
  /** Tasks left out of the two lists, written as "and N more". 0 when none. */
  more: number
  /** The student's own no-login link to their tasks. */
  link?: string
}

/**
 * The facts for one student's text. At most four tasks are named (late ones
 * first); the rest become "and N more". Fewer are named when four would push
 * the fixed template past the length limit. `reserve` holds back that many
 * characters: pass WEEKLY_NOTE_ROOM when a personal line is on offer, so a
 * student with a long list still gets one, with a task moved into "and N more".
 */
export function weeklyTextFacts(student: Student, counselorFirstName: string, items: WeeklyTextItems, link?: string, today: ISODate = todayISO(), reserve = 0): WeeklyTextFacts {
  const all = [...items.late, ...items.due]
  /** "t1", "t2"… in the order the code ranks them: most overdue first, then soonest due. */
  const handle = (t: Task) => `t${all.indexOf(t) + 1}`
  const build = (count: number): WeeklyTextFacts => {
    const shown = new Set(all.slice(0, count).map((t) => t.id))
    return {
      firstName: student.firstName,
      counselorFirstName,
      meeting: items.meeting && `${formatDateLong(items.meeting.date)} at ${formatTime(items.meeting.time)}`,
      late: items.late.filter((t) => shown.has(t.id)).map((t) => {
        const n = daysLate(t, today)
        return { id: handle(t), title: t.title, due: formatDate(t.dueDate), late: `${n} ${n === 1 ? 'day' : 'days'} late`, category: t.category, status: t.status }
      }),
      due: items.due.filter((t) => shown.has(t.id)).map((t) => ({ id: handle(t), title: t.title, due: formatDate(t.dueDate), category: t.category, status: t.status })),
      deadlines: (items.deadlines ?? []).map((x) => ({ label: x.label, due: formatDate(x.date), inDays: daysBetween(today, x.date) })),
      more: all.length - shown.size,
      link,
    }
  }
  for (let count = Math.min(WEEKLY_TEXT_MAX_ITEMS, all.length); count > 0; count--) {
    const facts = build(count)
    const text = weeklyTextTemplate(facts)
    if (text.length + linkRoom(text) + reserve <= WEEKLY_TEXT_MAX) return facts
  }
  return build(0)
}

/** The fixed wording. Used when the AI is unavailable or its draft dropped a fact. */
export function weeklyTextTemplate(f: WeeklyTextFacts): string {
  const parts = [`Hi ${f.firstName}, here is your week.`]
  if (f.meeting) parts.push(`We meet ${f.meeting}.`)
  if (f.late.length) parts.push(`Late: ${f.late.map((t) => `“${t.title}” (was due ${t.due}, ${t.late})`).join('; ')}.`)
  if (f.due.length) parts.push(`Due soon: ${f.due.map((t) => `“${t.title}” (${t.due})`).join('; ')}.`)
  if (f.more) parts.push(`And ${f.more} more.`)
  if (f.link) parts.push(`Your tasks: ${f.link}`)
  return parts.join(' ')
}

/** Roughly what one personal line ("How did the golf tournament go on Saturday?") adds to a text. */
export const WEEKLY_NOTE_ROOM = 90

/**
 * Whether a text with these facts has room left for a personal line. When the
 * meeting, tasks and link already fill the text, no "thing to remember" is
 * offered, so the facts are never crowded out.
 */
export const weeklyTextHasRoomForNote = (f: WeeklyTextFacts): boolean => weeklyTextTemplate(f).length + linkRoom(f.link ?? '') + WEEKLY_NOTE_ROOM <= WEEKLY_TEXT_MAX

/** Every string that must appear in the text exactly as computed. */
export function weeklyTextRequired(f: WeeklyTextFacts): string[] {
  return [
    ...(f.meeting ? [f.meeting] : []),
    ...f.late.flatMap((t) => [t.title, t.due, t.late]),
    ...f.due.flatMap((t) => [t.title, t.due]),
    ...(f.more ? [`and ${f.more} more`] : []),
    ...(f.link ? [f.link] : []),
  ]
}

/** The required strings that `text` does not contain. "and N more" may start a sentence, so its case is ignored. */
export function weeklyTextMissing(text: string, f: WeeklyTextFacts): string[] {
  const lower = text.toLowerCase()
  return weeklyTextRequired(f).filter((fact) => (fact.startsWith('and ') ? !lower.includes(fact) : !text.includes(fact)))
}

/** Every task named in the text, in the code's own order. */
export const weeklyTextTasks = (f: WeeklyTextFacts): { id: string; title: string }[] => [...f.late, ...f.due]

/**
 * The task a text really leads with: the one whose title comes first. Used to
 * check the AI's claim about which task it put first against the text itself.
 */
export function weeklyTextFirstTask(text: string, f: WeeklyTextFacts): { id: string; title: string } | undefined {
  return weeklyTextTasks(f)
    .map((t) => ({ t, at: text.indexOf(t.title) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)[0]?.t
}

/** The facts as lines for the counselor to read beside the draft. */
export function weeklyTextFactLines(f: WeeklyTextFacts): string[] {
  const linkLine = !f.link
    ? 'No link in this text'
    : f.link === STUDENT_LINK_PLACEHOLDER
      ? `Link: ${STUDENT_LINK_PREVIEW}`
      : `Link: ${f.link}`
  return [
    f.meeting ? `Next meeting: ${f.meeting}` : 'No meeting in the next 7 days',
    ...f.late.map((t) => `Late: ${t.title} (was due ${t.due}, ${t.late})`),
    ...f.due.map((t) => `Due: ${t.title} (${t.due})`),
    ...(f.more ? [`and ${f.more} more`] : []),
    ...f.deadlines.map((x) => `Application deadline (not in the text; used to judge what comes first): ${x.label}, ${x.due}`),
    linkLine,
  ]
}
