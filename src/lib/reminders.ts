// Reminders. The queue of reminders that are due is derived from tasks and the
// counselor's rules; nothing is stored until one "goes out" (see the store's
// sendReminder, which writes to the on-screen log).
//
// Reminders are fixed templates, not AI output. A counselor chooses per rule
// whether they go out automatically or wait for approval.
//
// NOTE: Chinese templates need a native-speaker review.

import type { AppData, ID, Language, OutboxMessage, Parent, ReminderMode, ReminderRule, Student, Task } from '../types'
import { daysBetween, formatDate, formatDateZh, todayISO } from './dates'
import { activeStudents, daysLate, fullName, isLate, isOpen, primaryParent } from './derive'
import { zhGiven, zhGreeting } from './language'

export interface ReminderDraft {
  /** Identifies this reminder (rule + task + recipient) so it is not sent twice. */
  key: string
  ruleId: ReminderRule['id']
  mode: ReminderMode
  studentId: ID
  taskId: ID
  taskTitle: string
  message: Omit<OutboxMessage, 'id' | 'sentAt' | 'trigger'>
}

/** A reminder that went out this recently is not queued again. */
const REPEAT_AFTER_DAYS = 3

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
      .filter((o) => o.dedupeKey && daysBetween(o.sentAt.slice(0, 10), today) < REPEAT_AFTER_DAYS)
      .map((o) => o.dedupeKey),
  )
  const queue: ReminderDraft[] = []
  const escalated = new Set<ID>()
  const students = activeStudents(data)

  const add = (r: ReminderRule, s: Student, t: Task, message: ReminderDraft['message']) => {
    const key = `${r.id}:${t.id}:${message.parentId ?? 'student'}`
    if (r.mode === 'off' || recentlySent.has(key)) return
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
