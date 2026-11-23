// The AI module. THE ONLY THING SCREENS CALL FOR AI.
//
// One async function per feature. Each one:
//   1. builds the facts in our own code (lib/facts.ts, lib/derive.ts),
//   2. asks the server function /api/ai, which calls Claude,
//   3. turns the answer into a draft with review: 'pending'.
//
// If the endpoint is not there, or the server has no API key, the function
// returns a PLACEHOLDER draft instead and marks it
// `source: { kind: 'placeholder' }` so the interface can label it. If the
// endpoint is there but fails (refusal, cut-off, rate limit), the function
// throws an AiFailure with a message the screen shows.
//
// Nothing here saves or sends anything. Every result is a draft; it becomes a
// task, profile change, recap or report only when a counselor approves it in
// the store.

import type { FeatureOutput, ProfileSuggestion, ProposedTask } from '../../shared/contract'
import { MAX_TEXT_CHARS } from '../../shared/constants'
import {
  IDS,
  danielMeetingDrafts,
  genericEssayFeedback,
  genericMeetingDrafts,
  kevinEssayFeedback,
  kevinMeetingDrafts,
  sampleNoteResult,
  sophiaEssayFeedback,
} from '../data/fixtures'
import { addDays, daysBetween, formatDate, formatDateZh, todayISO } from '../lib/dates'
import { currentDraft, daysLate, fullName, isLate, isOpen, nextMeeting, ownerLabel, tasksFor } from '../lib/derive'
import { briefFacts, buildFacts, reportFacts, type BriefFacts } from '../lib/facts'
import { zhGiven, zhGreeting } from '../lib/language'
import { parentText, studentText, type ReminderKind } from '../lib/reminders'
import type {
  AiSource,
  AppData,
  Channel,
  DraftTask,
  EssayFeedback,
  ID,
  Language,
  Meeting,
  MeetingAI,
  Parent,
  ParentReport,
  ProfileChange,
  ProfilePatch,
  Recap,
  SavedBrief,
  Student,
  StudentDocument,
  Task,
} from '../types'
import { AiFailure, AiUnavailable, callAi } from './aiClient'
import { swapIds } from '../data/ids'
import { buildSeed } from '../data/seed'

export { AiFailure } from './aiClient'

// ── Shared plumbing ─────────────────────────────────────────────────────────

const PLACEHOLDER_PAUSE_MS = 700

/** Try the real endpoint; if real drafts are not available at all, use the placeholder. */
async function withPlaceholder<T>(real: () => Promise<T>, placeholder: (source: AiSource) => T): Promise<T> {
  try {
    return await real()
  } catch (error) {
    if (!(error instanceof AiUnavailable)) throw error
    await new Promise((resolve) => setTimeout(resolve, PLACEHOLDER_PAUSE_MS))
    return placeholder({ kind: 'placeholder', reason: error.message })
  }
}

const claude = (model: string): AiSource => ({ kind: 'claude', model })

let sequence = 0
const draftId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++sequence}`

/**
 * Placeholder drafts for the sample caseload were written against its original
 * ids ("s-kevin"). Loading the sample gives every row a fresh id, so a sample
 * student is recognised by name, and a prepared draft is rewritten to the ids
 * that student and their parents really have.
 */
function sampleStudent(student: Student): { id: string; withRealIds: <T>(draft: T) => T } | undefined {
  const original = buildSeed().students.find((s) => s.firstName === student.firstName && s.lastName === student.lastName)
  if (!original) return undefined
  const ids = new Map([[original.id, student.id]])
  for (const parent of original.parents) {
    const real = student.parents.find((p) => p.name === parent.name)
    if (real) ids.set(parent.id, real.id)
  }
  return { id: original.id, withRealIds: (draft) => swapIds(draft, ids) }
}

function checkLength(text: string, what: string): void {
  if (text.length > MAX_TEXT_CHARS) {
    // Tell the counselor instead of silently cutting their text.
    throw new AiFailure('too_large', `${what} is too long for one request (${text.length.toLocaleString()} characters; the limit is ${MAX_TEXT_CHARS.toLocaleString()}). Split it and try again.`)
  }
}

/** Model output → our draft tasks. Owners and dates are checked against the record. */
function toDraftTasks(proposed: ProposedTask[], student: Student, data: AppData): DraftTask[] {
  const today = todayISO()
  const normalize = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  // Backstop for the prompt's "do not repeat an open task" rule. Catches exact repeats only.
  const alreadyOpen = new Set(tasksFor(data, student.id).filter(isOpen).map((t) => normalize(t.title)))
  return proposed
    .filter((p) => !alreadyOpen.has(normalize(p.title)))
    .map((p) => {
    const parent = p.owner === 'parent' ? (student.parents.find((x) => x.id === p.parentId) ?? student.parents[0]) : undefined
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(p.dueDate) && p.dueDate >= today
    return {
      id: draftId('dt'),
      title: p.title,
      detail: p.detail ?? undefined,
      category: p.category,
      // A "parent" task for a student with no parent on record goes to the counselor to sort out.
      owner: p.owner === 'parent' && !parent ? 'counselor' : p.owner,
      ownerParentId: parent?.id,
      dueDate: validDate ? p.dueDate : addDays(today, 7),
      dueDateBasis: validDate ? p.dueDateBasis : 'inferred',
      review: 'pending',
    }
  })
}

/** Model output → a profile change we know how to apply. Anything malformed is dropped. */
function toProfileChange(s: ProfileSuggestion): ProfileChange | undefined {
  let patch: ProfilePatch | undefined
  if (s.kind === 'sat' || s.kind === 'act' || s.kind === 'toefl' || s.kind === 'gpa') {
    if (typeof s.numberValue === 'number') patch = { kind: 'score', field: s.kind, value: s.numberValue }
  } else if (s.kind === 'add_activity') {
    if (s.activity) patch = { kind: 'addActivity', activity: { id: draftId('act'), name: s.activity.name, role: s.activity.role, detail: s.activity.detail ?? undefined } }
  } else if (s.kind === 'set_majors') {
    if (s.listValue?.length) patch = { kind: 'setMajors', value: s.listValue }
  } else if (s.kind === 'add_interest') {
    if (s.listValue?.[0]) patch = { kind: 'addInterest', value: s.listValue[0] }
  }
  return patch && { id: draftId('pc'), label: s.label, from: s.from, to: s.to, evidence: s.evidence, patch, review: 'pending' }
}

// ── 1. Meeting follow-through ───────────────────────────────────────────────

export interface MeetingDrafts {
  ai: MeetingAI
  /** Absent when only tasks were read from the notes. */
  recap?: Recap
}

/** Notes, proposed tasks, parent updates, profile changes and a student recap, from a meeting's notes or transcript. */
export function draftFromMeeting(data: AppData, meeting: Meeting, student: Student): Promise<MeetingDrafts> {
  return withPlaceholder(
    async () => {
      if (!meeting.transcript) throw new AiUnavailable('This meeting has no notes or transcript to read.')
      checkLength(meeting.transcript, 'The meeting transcript')
      const { draft, model } = await callAi('draftFromMeeting', {
        facts: buildFacts(data, student),
        meeting: { title: meeting.title, date: meeting.date },
        source: meeting.transcript,
      })
      return meetingDraftsFrom(draft, student, data, claude(model))
    },
    (source) => {
      const known = sampleStudent(student)
      const sample =
        known?.id === IDS.kevin ? known.withRealIds(kevinMeetingDrafts()) : known?.id === IDS.daniel ? known.withRealIds(danielMeetingDrafts()) : genericMeetingDrafts(student.firstName)
      return { ai: { ...sample.ai, source }, recap: sample.recap }
    },
  )
}

function meetingDraftsFrom(draft: FeatureOutput<'draftFromMeeting'>, student: Student, data: AppData, source: AiSource): MeetingDrafts {
  return {
    ai: {
      source,
      decided: draft.summary.decided,
      progress: draft.summary.progress,
      watch: draft.summary.watch,
      notes: draft.notes,
      notesReview: 'pending',
      draftTasks: toDraftTasks(draft.tasks, student, data),
      parentUpdates: draft.parentUpdates.flatMap((u) => {
        const parent = student.parents.find((p) => p.id === u.parentId)
        if (!parent) return []
        return [{ id: draftId('pu'), parentId: parent.id, bodyEn: u.bodyEn, bodyLocal: parent.language === 'en' ? undefined : (u.bodyLocal ?? undefined), review: 'pending' as const }]
      }),
      profileChanges: draft.profileChanges.flatMap((s) => toProfileChange(s) ?? []),
    },
    recap: { summary: draft.recap.summary, nextSteps: draft.recap.nextSteps, review: 'pending' },
  }
}

// ── 2. Reading the counselor's own notes ────────────────────────────────────

export interface NotesResult {
  summary: string
  tasks: DraftTask[]
  source: AiSource
}

/** Assignments, owners and due dates from pasted or uploaded notes. */
export function readNotes(data: AppData, text: string, student: Student): Promise<NotesResult> {
  return withPlaceholder(
    async () => {
      checkLength(text, 'These notes')
      const { draft, model } = await callAi('readNotes', { facts: buildFacts(data, student), notes: text })
      return { summary: draft.summary, tasks: toDraftTasks(draft.tasks, student, data), source: claude(model) }
    },
    (source) => {
      if (sampleStudent(student)?.id === IDS.sophia && text.includes('closing-shift')) return { ...sampleNoteResult(), source }
      // Placeholder for any other text: one task per bullet line, for the student, due in a week.
      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^[-•*]/.test(l))
        .map((l) => l.replace(/^[-•*]\s*/, ''))
        .filter((l) => l.length > 3)
      const due = addDays(todayISO(), 7)
      return {
        source,
        summary:
          lines.length > 0
            ? `Placeholder: each of the ${lines.length} bullet lines became a task for ${student.firstName}, due in a week. Owners and dates were not read from the text.`
            : 'Placeholder: no bullet lines found. Start each action item with a dash, or try the sample note.',
        tasks: lines.map((line) => ({
          id: draftId('nt'),
          title: line.length > 110 ? `${line.slice(0, 107)}…` : line,
          category: 'planning' as const,
          owner: 'student' as const,
          dueDate: due,
          dueDateBasis: 'inferred' as const,
          review: 'pending' as const,
        })),
      }
    },
  )
}

/**
 * For a meeting where the counselor only wants the assignments pulled out of
 * their notes: the same review flow as a full draft, with tasks and nothing else.
 */
export async function draftTasksOnly(data: AppData, meeting: Meeting, student: Student): Promise<MeetingDrafts> {
  const result = await readNotes(data, meeting.transcript ?? '', student)
  return {
    ai: { source: result.source, decided: [], progress: [], watch: [], notes: [result.summary], notesReview: 'pending', draftTasks: result.tasks, parentUpdates: [], profileChanges: [] },
  }
}

// ── 3. Pre-meeting brief ────────────────────────────────────────────────────

/**
 * The AI's part of a pre-meeting brief: a headline, an agenda and questions.
 * The lists it sits beside (changes, overdue, deadlines) are computed by
 * lib/facts.ts and shown by the screen; the model is given them and never
 * supplies them.
 */
export function preMeetingBrief(data: AppData, meeting: Meeting, student: Student): Promise<SavedBrief> {
  const facts = briefFacts(data, meeting, student)
  const preparedOn = todayISO()
  return withPlaceholder<SavedBrief>(
    async () => {
      const { draft, model } = await callAi('preMeetingBrief', {
        facts: buildFacts(data, student),
        meeting: { title: meeting.title, date: meeting.date },
        computed: {
          changesSinceLastMeeting: facts.changes,
          overdue: facts.overdue.map((o) => `${o.title} — owner: ${o.owner}; ${o.daysLate} days late${o.progressNote ? `; their note: "${o.progressNote}"` : ''}`),
          deadlinesNext14Days: facts.deadlines.map((d) => `${d.label} — due ${formatDate(d.date)}, in ${daysBetween(todayISO(), d.date)} days`),
          waitingOnCounselor: facts.waitingOnCounselor,
        },
        counselorNotes: student.counselorNotes || undefined,
        lastRecap: facts.previous?.recap?.review === 'approved' ? `${facts.previous.recap.summary}\n${facts.previous.recap.nextSteps.join('\n')}` : undefined,
      })
      return { headline: draft.headline, agenda: draft.agenda, questions: draft.questions, source: claude(model), preparedOn }
    },
    (source) => ({ agenda: placeholderAgenda(facts, student), questions: [], source, preparedOn }),
  )
}

type Agenda = SavedBrief['agenda']

function placeholderAgenda(facts: BriefFacts, student: Student): Agenda {
  const today = todayISO()
  const agenda: Agenda = []
  const nextCollege = facts.deadlines.find((d) => d.kind === 'college')
  if (nextCollege) {
    const blocking = facts.overdue.filter((o) => o.ownerType === 'student').length
    agenda.push({
      topic: `${nextCollege.label}: what is left`,
      why: `Due ${formatDate(nextCollege.date)}, ${daysBetween(today, nextCollege.date)} days away${blocking ? `, with ${blocking} student ${blocking === 1 ? 'task' : 'tasks'} overdue` : ''}.`,
    })
  }
  const worst = facts.overdue.find((o) => o.ownerType === 'student')
  if (worst) {
    agenda.push({
      topic: `Unblock “${worst.title}”`,
      why: `${worst.daysLate} days overdue${worst.progressNote ? `. ${student.firstName} wrote: “${worst.progressNote}”` : '.'}`,
    })
  }
  const parentBlock = facts.overdue.find((o) => o.ownerType === 'parent')
  if (parentBlock) {
    agenda.push({ topic: `Plan around ${parentBlock.owner}: ${parentBlock.title}`, why: `${parentBlock.daysLate} days overdue. Agree who follows up and how.` })
  }
  const wins = facts.changes.filter((c) => c.startsWith('Completed')).length
  if (wins > 0) agenda.push({ topic: 'Start with what got done', why: `${wins} ${wins === 1 ? 'task' : 'tasks'} completed since the last meeting.` })
  if (agenda.length === 0) agenda.push({ topic: 'Look ahead', why: 'Nothing is overdue. Use the time to plan the next month.' })
  return agenda
}

// ── 4. Parent progress report ───────────────────────────────────────────────

export type ReportDraft = Pick<ParentReport, 'subject' | 'bodyEn' | 'bodyLocal' | 'facts' | 'source'>

/** A progress report for one parent, in English and (if different) their own language. */
export async function parentReport(data: AppData, studentId: ID, parentId: ID): Promise<ReportDraft | undefined> {
  const student = data.students.find((s) => s.id === studentId)
  const parent = student?.parents.find((p) => p.id === parentId)
  if (!student || !parent) return undefined
  const facts = reportFacts(data, student, parentId)

  return withPlaceholder<ReportDraft>(
    async () => {
      const { draft, model } = await callAi('parentReport', { facts: buildFacts(data, student), parentId, reportFacts: facts })
      return {
        subject: draft.subject,
        bodyEn: draft.bodyEn,
        bodyLocal: parent.language === 'en' ? undefined : (draft.bodyLocal ?? undefined),
        facts,
        source: claude(model),
      }
    },
    (source) => ({ ...placeholderReport(data, student, parentId), facts, source }),
  )
}

/** A fill-in-the-blanks report. Task titles stay in English inside the Chinese text. */
function placeholderReport(data: AppData, student: Student, parentId: ID): Pick<ParentReport, 'subject' | 'bodyEn' | 'bodyLocal'> {
  const parent = student.parents.find((p) => p.id === parentId)!
  const today = todayISO()
  const tasks = tasksFor(data, student.id)
  const done = tasks.filter((t) => t.status === 'done' && t.completedOn && daysBetween(t.completedOn, today) <= 21).slice(0, 3)
  const open = tasks
    .filter((t) => isOpen(t) && !isLate(t, today) && t.owner === 'student')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 3)
  const late = tasks.filter((t) => isLate(t, today) && t.owner === 'student')
  const theirs = tasks.filter((t) => isOpen(t) && t.owner === 'parent' && t.ownerParentId === parentId)
  const next = nextMeeting(data, student.id)
  const counselor = data.firm.counselorFirstName
  const titles = (ts: Task[], sep: string) => ts.map((t) => t.title).join(sep)

  const english = [
    `Hello ${parent.name}, this is ${counselor}, ${student.firstName}'s counselor. Here is where ${student.firstName} stands today.`,
    done.length ? `Recently finished: ${titles(done, '; ')}.` : '',
    open.length ? `Working on now: ${open.map((t) => `${t.title} (due ${formatDate(t.dueDate)})`).join('; ')}.` : '',
    late.length
      ? `Needs attention: ${late.length} ${late.length === 1 ? 'task is' : 'tasks are'} overdue (${titles(late, '; ')}). I am following up with ${student.firstName} directly.`
      : `Nothing is overdue.`,
    theirs.length ? `Where I need your help: ${theirs.map((t) => `${t.title} (by ${formatDate(t.dueDate)})`).join('; ')}.` : '',
    next ? `Our next meeting is on ${formatDate(next.date)}.` : '',
    'Please reach out any time. Thank you.',
  ]

  let local: string[] | undefined
  if (parent.language === 'zh-Hans') {
    const name = zhGiven(student)
    local = [
      `${zhGreeting(parent)}您好，我是${name}的升学顾问 ${counselor}。跟您同步一下${name}目前的进展。`,
      done.length ? `近期已完成：${titles(done, '；')}。` : '',
      open.length ? `正在进行：${open.map((t) => `${t.title}（${formatDateZh(t.dueDate)}截止）`).join('；')}。` : '',
      late.length ? `需要留意：目前有 ${late.length} 项任务逾期（${titles(late, '；')}），我会直接跟${name}跟进。` : '目前没有逾期的任务。',
      theirs.length ? `需要您协助：${theirs.map((t) => `${t.title}（请在${formatDateZh(t.dueDate)}前完成）`).join('；')}。` : '',
      next ? `下次面谈时间是${formatDateZh(next.date)}。` : '',
      '有任何问题欢迎随时联系我。谢谢！',
    ]
  } else if (parent.language === 'zh-Hant') {
    const name = zhGiven(student)
    local = [
      `${zhGreeting(parent)}您好，我是${name}的升學顧問 ${counselor}。跟您更新一下${name}目前的進度。`,
      done.length ? `近期已完成：${titles(done, '；')}。` : '',
      open.length ? `正在進行：${open.map((t) => `${t.title}（${formatDateZh(t.dueDate)}截止）`).join('；')}。` : '',
      late.length ? `需要留意：目前有 ${late.length} 項任務逾期（${titles(late, '；')}），我會直接跟${name}跟進。` : '目前沒有逾期的任務。',
      theirs.length ? `需要您協助：${theirs.map((t) => `${t.title}（請在${formatDateZh(t.dueDate)}前完成）`).join('；')}。` : '',
      next ? `下次面談時間是${formatDateZh(next.date)}。` : '',
      '有任何問題歡迎隨時跟我聯絡。謝謝！',
    ]
  }

  const join = (parts: string[]) => parts.filter(Boolean).join('\n\n')
  return { subject: `Progress report, ${formatDate(today)}`, bodyEn: join(english), bodyLocal: local ? join(local) : undefined }
}

// ── 5. Essay feedback ───────────────────────────────────────────────────────

/**
 * Margin notes on structure, clarity and whether the draft answers the prompt.
 * GUARDRAIL: the result has observations, questions and locations, and no
 * field for replacement text (see OUTPUTS.essayFeedback in shared/contract.ts).
 */
export function essayFeedback(doc: StudentDocument, student: Student): Promise<EssayFeedback> {
  const draft = currentDraft(doc)
  return withPlaceholder<EssayFeedback>(
    async () => {
      if (!draft?.text.trim()) throw new AiFailure('bad_request', 'Paste the text of the draft first. The AI reads only what is saved here.')
      checkLength(draft.text, 'This draft')
      const { draft: notes, model } = await callAi('essayFeedback', {
        studentFirstName: student.firstName,
        prompt: doc.essayPrompt?.trim() || 'No prompt was provided.',
        essay: draft.text,
      })
      return {
        draftN: draft.n,
        overall: notes.overall,
        strengths: notes.strengths,
        points: notes.notes,
        review: 'pending',
        generatedOn: todayISO(),
        source: claude(model),
      }
    },
    (source) => {
      const known = sampleStudent(student)?.id
      const sample = known === IDS.kevin ? kevinEssayFeedback() : known === IDS.sophia ? sophiaEssayFeedback() : genericEssayFeedback()
      return { ...sample, draftN: draft?.n, source }
    },
  )
}

// ── 6. Reminder about one task ──────────────────────────────────────────────

export type ReminderRecipient = { kind: 'student' } | { kind: 'parent'; parent: Parent }

export interface ReminderMessage {
  toKind: 'student' | 'parent'
  toName: string
  parentId?: ID
  channel: Channel
  language: Language
  kind: 'reminder_upcoming' | 'reminder_late'
  /** What the recipient reads, in their language. */
  body: string
  /** English, when body is in another language. */
  bodyEn?: string
  source: AiSource
  /** Set when a fixed fact (title, due date, days late) is not in the draft as given. Shown to the counselor. */
  warnings: string[]
}

/**
 * A reminder about one task, drafted for one person in their language and for
 * their preferred channel. The title, due date and days late are passed in as
 * facts and checked on the way back.
 */
export function reminderDraft(data: AppData, student: Student, task: Task, to: ReminderRecipient): Promise<ReminderMessage> {
  const late = daysLate(task)
  const escalation = to.kind === 'parent' && task.owner !== 'parent'
  const purpose: ReminderKind = escalation ? 'escalation' : late > 0 ? 'late' : 'upcoming'
  const channel: Channel = to.kind === 'parent' ? to.parent.channel : (student.preferredChannel ?? 'text')
  const language: Language = to.kind === 'parent' ? to.parent.language : 'en'
  const dueDate = formatDate(task.dueDate)
  const dueDateZh = formatDateZh(task.dueDate)
  const base = {
    toKind: to.kind,
    toName: to.kind === 'parent' ? to.parent.name : fullName(student),
    parentId: to.kind === 'parent' ? to.parent.id : undefined,
    channel,
    language,
    kind: late > 0 ? ('reminder_late' as const) : ('reminder_upcoming' as const),
  }

  return withPlaceholder<ReminderMessage>(
    async () => {
      const { draft, model } = await callAi('reminderDraft', {
        facts: buildFacts(data, student),
        recipient: { kind: to.kind, parentId: to.kind === 'parent' ? to.parent.id : undefined },
        channel,
        language,
        purpose,
        task: { title: task.title, owner: ownerLabel(task, student) === 'You' ? 'Counselor' : ownerLabel(task, student), dueDate, dueDateZh, daysLate: late },
      })
      const local = language === 'en' ? undefined : (draft.bodyLocal ?? undefined)
      // The fixed facts must survive the model. Tell the counselor if one did not.
      const warnings: string[] = []
      for (const [text, label, date] of [[draft.bodyEn, 'English', dueDate], ...(local ? [[local, 'translated', dueDateZh]] : [])] as [string, string, string][]) {
        if (!text.includes(task.title)) warnings.push(`The ${label} text does not quote the task title exactly: “${task.title}”.`)
        if (!text.replace(/\s/g, '').includes(date.replace(/\s/g, ''))) warnings.push(`The ${label} text does not give the due date as ${date}.`)
        if (late > 0 && !new RegExp(`(^|\\D)${late}(\\D|$)`).test(text)) warnings.push(`The ${label} text does not say it is ${late} days late.`)
      }
      return { ...base, body: local ?? draft.bodyEn, bodyEn: local ? draft.bodyEn : undefined, source: claude(model), warnings }
    },
    (source) => {
      // The fixed wording from lib/reminders.ts.
      if (to.kind === 'student') return { ...base, body: studentText(late > 0 ? 'late' : 'upcoming', student, task, late), source, warnings: [] }
      const en = parentText(purpose, 'en', to.parent, student, task, late)
      return language === 'en'
        ? { ...base, body: en, source, warnings: [] }
        : { ...base, body: parentText(purpose, language, to.parent, student, task, late), bodyEn: en, source, warnings: [] }
    },
  )
}
