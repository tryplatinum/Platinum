// Simulated AI. NO MODEL IS CALLED.
//
// One async function per AI feature. Each waits a moment (so the interface has
// a believable "thinking" state) and returns prepared content from
// data/fixtures.ts, or a simple template built from the data.
//
// To use a real model later, replace the INSIDE of these functions and keep the
// signatures. Screens only ever call these functions and put the result in the
// store as a draft with review: 'pending'. Nothing here sends anything, and
// nothing reaches a student or parent until a counselor approves the draft.

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
import {
  daysLate,
  deadlinesFor,
  isLate,
  isOpen,
  lastMeeting,
  nextMeeting,
  ownerLabel,
  pendingApprovals,
  tasksFor,
  type Deadline,
} from '../lib/derive'
import { zhGiven, zhGreeting } from '../lib/language'
import type {
  AppData,
  DraftTask,
  EssayFeedback,
  ID,
  Meeting,
  MeetingAI,
  ParentReport,
  Recap,
  Student,
  StudentDocument,
  Task,
} from '../types'

const THINKING_MS = 900

function think<T>(result: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(result), THINKING_MS))
}

// ── 1. AI attends the meeting ───────────────────────────────────────────────

export interface MeetingDrafts {
  ai: MeetingAI
  recap: Recap
}

/** Notes, drafted tasks, parent updates, profile changes and a student recap from a meeting. */
export function draftFromMeeting(meeting: Meeting, student: Student): Promise<MeetingDrafts> {
  if (meeting.id === IDS.kevinMeeting) return think(kevinMeetingDrafts())
  if (meeting.id === IDS.danielMeeting) return think(danielMeetingDrafts())
  // TODO(real AI): send the transcript; today any other meeting gets a generic result.
  return think(genericMeetingDrafts(student.firstName))
}

// ── 2. Reading the counselor's own notes ────────────────────────────────────

export interface NotesResult {
  summary: string
  tasks: DraftTask[]
  /** True when the result is the prepared one rather than the line-by-line fallback. */
  prepared: boolean
}

/** Assignments, owners and due dates from pasted or uploaded notes. */
export function readNotes(text: string, student: Student): Promise<NotesResult> {
  if (student.id === IDS.sophia && text.includes('closing-shift')) {
    return think({ ...sampleNoteResult(), prepared: true })
  }
  // Fallback for any other text: one task per bullet line, owned by the student, due in a week.
  // TODO(real AI): infer owners and dates from the wording.
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-•*]/.test(l))
    .map((l) => l.replace(/^[-•*]\s*/, ''))
    .filter((l) => l.length > 3)
  const due = addDays(todayISO(), 7)
  return think({
    prepared: false,
    summary:
      lines.length > 0
        ? `${lines.length} bullet ${lines.length === 1 ? 'point' : 'points'} found. In this demo only the sample note is read properly: each bullet below became a task for ${student.firstName} due in a week, for you to correct.`
        : 'No bullet points found. Start each action item with a dash, or try the sample note.',
    tasks: lines.map((line, i) => ({
      id: `nt-${Date.now()}-${i}`,
      title: line.length > 110 ? `${line.slice(0, 107)}…` : line,
      category: 'planning' as const,
      owner: 'student' as const,
      dueDate: due,
      review: 'pending' as const,
    })),
  })
}

// ── 3. Pre-meeting brief ────────────────────────────────────────────────────

export interface Brief {
  meeting: Meeting
  previous?: Meeting
  /** What changed since the previous meeting. */
  changes: string[]
  overdue: { task: Task; owner: string; daysLate: number }[]
  deadlines: Deadline[]
  /** Drafts still waiting for the counselor's approval. */
  waitingOnCounselor: string[]
  agenda: { topic: string; why: string }[]
}

const BRIEF_DEADLINE_WINDOW_DAYS = 14

/** What changed, what is overdue, which deadlines are close, and a suggested agenda. Built from live data. */
export function preMeetingBrief(data: AppData, meetingId: ID): Promise<Brief | undefined> {
  const meeting = data.meetings.find((m) => m.id === meetingId)
  const student = data.students.find((s) => s.id === meeting?.studentId)
  if (!meeting || !student) return think(undefined)

  const today = todayISO()
  const previous = lastMeeting(data, student.id)
  const since = previous?.date ?? addDays(today, -30)
  const tasks = tasksFor(data, student.id)

  const changes: string[] = []
  for (const t of tasks) {
    if (t.status === 'done' && t.completedOn && t.completedOn >= since) changes.push(`Completed: ${t.title}`)
  }
  for (const t of tasks) {
    if (isOpen(t) && t.createdOn >= since) changes.push(`New task for ${ownerLabel(t, student)}: ${t.title}`)
  }
  for (const d of data.documents) {
    if (d.studentId === student.id && d.addedOn >= since) changes.push(`New document: ${d.name}`)
  }
  for (const c of data.colleges) {
    if (c.studentId === student.id && (c.status === 'admitted' || c.status === 'deferred' || c.status === 'denied')) {
      changes.push(`${c.name}: ${c.status}`)
    }
  }
  for (const r of data.reports) {
    if (r.studentId === student.id && r.status === 'sent' && (r.sentOn ?? '') >= since) {
      const parent = student.parents.find((p) => p.id === r.parentId)
      changes.push(`Parent report sent to ${parent?.name ?? 'parent'}`)
    }
  }

  const overdue = tasks
    .filter((t) => isLate(t, today))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((task) => ({ task, owner: ownerLabel(task, student), daysLate: daysLate(task, today) }))

  const deadlines = deadlinesFor(data, student.id).filter(
    (d) => d.date >= today && daysBetween(today, d.date) <= BRIEF_DEADLINE_WINDOW_DAYS,
  )

  const waitingOnCounselor = pendingApprovals(data, student.id).map(
    (a) => `${a.label} (${a.count} ${a.count === 1 ? 'item' : 'items'})`,
  )

  // Suggested agenda: the most pressing things first.
  const agenda: Brief['agenda'] = []
  const nextCollege = deadlines.find((d) => d.kind === 'college')
  if (nextCollege) {
    const blocking = overdue.filter((o) => o.task.owner === 'student').length
    agenda.push({
      topic: `${nextCollege.label}: what is left`,
      why: `Due ${formatDate(nextCollege.date)}, ${daysBetween(today, nextCollege.date)} days away${blocking ? `, with ${blocking} student ${blocking === 1 ? 'task' : 'tasks'} overdue` : ''}.`,
    })
  }
  const worst = overdue.find((o) => o.task.owner === 'student')
  if (worst) {
    agenda.push({
      topic: `Unblock “${worst.task.title}”`,
      why: `${worst.daysLate} days overdue${worst.task.progressNote ? `. ${student.firstName} wrote: “${worst.task.progressNote}”` : '.'}`,
    })
  }
  const parentBlock = overdue.find((o) => o.task.owner === 'parent')
  if (parentBlock) {
    agenda.push({
      topic: `Plan around ${parentBlock.owner}: ${parentBlock.task.title}`,
      why: `${parentBlock.daysLate} days overdue. Agree who follows up and how.`,
    })
  }
  const wins = changes.filter((c) => c.startsWith('Completed')).length
  if (wins > 0) {
    agenda.push({ topic: 'Start with what got done', why: `${wins} ${wins === 1 ? 'task' : 'tasks'} completed since the last meeting.` })
  }
  if (waitingOnCounselor.length > 0) {
    agenda.push({ topic: 'Before the meeting: clear your approvals', why: 'Drafts from the last meeting are still waiting for you.' })
  }
  if (agenda.length === 0) {
    agenda.push({ topic: 'Look ahead', why: 'Nothing is overdue. Use the time to plan the next month.' })
  }

  return think({ meeting, previous, changes, overdue, deadlines, waitingOnCounselor, agenda })
}

// ── 4. Parent progress report ───────────────────────────────────────────────

export type ReportDraft = Pick<ParentReport, 'subject' | 'bodyEn' | 'bodyLocal'>

/** A progress report for one parent, in English and (if different) their own language. */
export function parentReport(data: AppData, studentId: ID, parentId: ID): Promise<ReportDraft | undefined> {
  const student = data.students.find((s) => s.id === studentId)
  const parent = student?.parents.find((p) => p.id === parentId)
  if (!student || !parent) return think(undefined)

  const today = todayISO()
  const tasks = tasksFor(data, studentId)
  const done = tasks
    .filter((t) => t.status === 'done' && t.completedOn && daysBetween(t.completedOn, today) <= 21)
    .slice(0, 3)
  const open = tasks
    .filter((t) => isOpen(t) && !isLate(t, today) && t.owner === 'student')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 3)
  const late = tasks.filter((t) => isLate(t, today) && t.owner === 'student')
  const theirs = tasks.filter((t) => isOpen(t) && t.owner === 'parent' && t.ownerParentId === parentId)
  const next = nextMeeting(data, studentId)
  const counselor = data.firm.counselorFirstName
  const titles = (ts: Task[], sep: string) => ts.map((t) => t.title).join(sep)

  // TODO(real AI): task titles stay in English inside the Chinese text; a model would translate them.
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
  return think({
    subject: `Progress report, ${formatDate(today)}`,
    bodyEn: join(english),
    bodyLocal: local ? join(local) : undefined,
  })
}

// ── 5. Essay feedback ───────────────────────────────────────────────────────

/**
 * Feedback on structure, clarity and whether the draft answers the prompt.
 * GUARDRAIL: this returns observations and questions only. It must never
 * return replacement text. Keep that true when a real model goes in.
 */
export function essayFeedback(doc: StudentDocument): Promise<EssayFeedback> {
  if (doc.id === IDS.kevinEssay) return think(kevinEssayFeedback())
  if (doc.id === IDS.sophiaEssay) return think(sophiaEssayFeedback())
  // TODO(real AI): read the linked draft; today other essays get generic feedback.
  return think(genericEssayFeedback())
}
