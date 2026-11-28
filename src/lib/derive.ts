// Derived facts. "Late", "next deadline", "waiting on", progress and every count
// are computed here from the data, and nowhere else, so every screen agrees.
// The AI is given these facts; it never produces them.

import { proposalSummary } from '../../shared/agent'
import { draftProblems } from '../../shared/templates'
import type {
  MessageDraft,
  AgentProposal,
  AppData,
  Channel,
  CollegeApp,
  DocCategory,
  EssayStatus,
  ID,
  Language,
  Meeting,
  OwnerType,
  Parent,
  ParentReport,
  PersonalNote,
  Student,
  StudentDocument,
  Task,
  WeeklyText,
} from '../types'
import { classifyAttention, MEETING_GAP_DAYS, NEW_STUDENT_DAYS } from '../../shared/attention'
import { addDays, daysBetween, daysFromToday, formatDate, parseISODate, todayISO, type ISODate } from './dates'

// ── People ──────────────────────────────────────────────────────────────────

export const fullName = (s: Student) => `${s.firstName} ${s.lastName}`.trim()

/** Students on the caseload. Archived students are left out of every list. */
export const activeStudents = (data: AppData): Student[] => data.students.filter((s) => !s.archived)

export function findStudent(data: AppData, id: ID | undefined): Student | undefined {
  return data.students.find((s) => s.id === id)
}

export function findParent(student: Student, parentId: ID | undefined): Parent | undefined {
  return student.parents.find((p) => p.id === parentId)
}

/** The family's main contact: the parent marked primary, or the first one. */
export function primaryParent(student: Student): Parent | undefined {
  return student.parents.find((p) => p.isPrimary) ?? student.parents[0]
}

const parentShort = (p: Parent) => (p.relationship === 'Mother' ? 'Mom' : p.relationship === 'Father' ? 'Dad' : 'Guardian')

/** "Kevin", "Dad (Zhang Wei)" or "You" (the counselor is the one reading). */
export function ownerLabel(task: Pick<Task, 'owner' | 'ownerParentId'>, student: Student): string {
  if (task.owner === 'counselor') return 'You'
  if (task.owner === 'student') return student.firstName
  const parent = findParent(student, task.ownerParentId)
  return parent ? `${parentShort(parent)} (${parent.name})` : 'Parent'
}

export function classLabel(gradYear: number): string {
  const now = new Date()
  // The school year that ends in `seniorYear` is the current one.
  const seniorYear = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear()
  const names = ['Senior', 'Junior', 'Sophomore', 'Freshman']
  return names[gradYear - seniorYear] ?? `Class of ${gradYear}`
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export const isOpen = (t: Task) => t.status !== 'done'

export function isLate(t: Task, today: ISODate = todayISO()): boolean {
  return isOpen(t) && t.dueDate < today
}

/** Days past due (0 if not late). */
export function daysLate(t: Task, today: ISODate = todayISO()): number {
  return isLate(t, today) ? daysBetween(t.dueDate, today) : 0
}

export function tasksFor(data: AppData, studentId: ID): Task[] {
  return data.tasks.filter((t) => t.studentId === studentId)
}

/** Open tasks first by due date (so the most overdue lead), then done tasks, newest first. */
export function sortByUrgency(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1
    if (isOpen(a)) return a.dueDate.localeCompare(b.dueDate)
    return (b.completedOn ?? b.dueDate).localeCompare(a.completedOn ?? a.dueDate)
  })
}

export interface TaskProgress {
  done: number
  total: number
  late: number
}

export function taskProgress(tasks: Task[], today: ISODate = todayISO()): TaskProgress {
  return {
    done: tasks.filter((t) => !isOpen(t)).length,
    total: tasks.length,
    late: tasks.filter((t) => isLate(t, today)).length,
  }
}

/** "3 days late", "due today", "in 5 days". */
export function dueText(date: ISODate, today: ISODate = todayISO()): string {
  const n = daysBetween(today, date)
  if (n < 0) return `${-n} ${n === -1 ? 'day' : 'days'} late`
  if (n === 0) return 'due today'
  if (n === 1) return 'due tomorrow'
  return `in ${n} days`
}

/**
 * Who the student's progress is waiting on right now: the owner of the oldest
 * late task, or if nothing is late, of the next task due.
 */
export interface WaitingOn {
  task: Task
  owner: OwnerType
  parent?: Parent
  /** "Kevin", "Dad (Zhang Wei)", "You". */
  label: string
  daysLate: number
}

export function waitingOn(data: AppData, student: Student): WaitingOn | undefined {
  const today = todayISO()
  const task = tasksFor(data, student.id)
    .filter(isOpen)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
  if (!task) return undefined
  return {
    task,
    owner: task.owner,
    parent: task.owner === 'parent' ? findParent(student, task.ownerParentId) : undefined,
    label: ownerLabel(task, student),
    daysLate: daysLate(task, today),
  }
}

/** The last time a reminder about this task went out, if ever. */
export function lastReminder(data: AppData, taskId: ID): string | undefined {
  return data.outbox.find((m) => m.taskId === taskId || m.dedupeKey?.includes(`:${taskId}:`))?.sentAt
}

// ── Deadlines ───────────────────────────────────────────────────────────────

export interface Deadline {
  id: ID
  studentId: ID
  date: ISODate
  label: string
  kind: 'task' | 'college'
  late: boolean
}

export const collegeIsPending = (c: CollegeApp) => c.status === 'considering' || c.status === 'in_progress'

/** "NYU (Tandon) ED2", but plain "UC Berkeley" when the plan is just the UC application. */
export const collegeLabel = (c: CollegeApp) => (!c.plan || c.plan === 'UC' ? c.name : `${c.name} ${c.plan}`)

export function collegesFor(data: AppData, studentId: ID): CollegeApp[] {
  // Colleges with no deadline set yet come last.
  return data.colleges.filter((c) => c.studentId === studentId).sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'))
}

/** Open tasks and unsubmitted applications, soonest first. Includes late tasks. UC campuses count as one application. */
export function deadlinesFor(data: AppData, studentId: ID): Deadline[] {
  const today = todayISO()
  const fromTasks: Deadline[] = tasksFor(data, studentId)
    .filter(isOpen)
    .map((t) => ({ id: t.id, studentId, date: t.dueDate, label: t.title, kind: 'task', late: isLate(t, today) }))
  const fromColleges: Deadline[] = []
  for (const c of collegesFor(data, studentId).filter(collegeIsPending)) {
    // A college with no deadline set yet has nothing to count down to.
    if (!c.deadline) continue
    const label = c.plan === 'UC' ? 'UC application' : `${collegeLabel(c)} application`
    if (!fromColleges.some((d) => d.label === label && d.date === c.deadline)) {
      fromColleges.push({ id: c.id, studentId, date: c.deadline, label, kind: 'college', late: c.deadline < today })
    }
  }
  return [...fromTasks, ...fromColleges].sort((a, b) => a.date.localeCompare(b.date))
}

const APPLICATION_HORIZON_DAYS = 30

/**
 * The one deadline to show for a student: the next application deadline when
 * it is within a month, otherwise the next task due. Late tasks are shown
 * under "Waiting on", not here.
 */
export function nextDeadline(data: AppData, studentId: ID): Deadline | undefined {
  const today = todayISO()
  const upcoming = deadlinesFor(data, studentId).filter((d) => d.date >= today)
  const application = upcoming.find((d) => d.kind === 'college' && daysBetween(today, d.date) <= APPLICATION_HORIZON_DAYS)
  return application ?? upcoming.find((d) => d.kind === 'task') ?? upcoming[0]
}

/** The next application deadline, for the student-facing view. */
export function nextApplicationDeadline(data: AppData, studentId: ID): Deadline | undefined {
  const today = todayISO()
  return deadlinesFor(data, studentId).find((d) => d.kind === 'college' && d.date >= today)
}

// ── Meetings ────────────────────────────────────────────────────────────────

/** All of a student's meetings, newest first. */
export function meetingsFor(data: AppData, studentId: ID): Meeting[] {
  return data.meetings
    .filter((m) => m.studentId === studentId)
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
}

export interface MeetingBuckets {
  /** The next scheduled meeting. */
  upcoming?: Meeting
  /** Scheduled meetings after the next one. */
  later: Meeting[]
  /** The most recent completed meeting. */
  recent?: Meeting
  /** Completed meetings before the most recent, newest first. */
  past: Meeting[]
}

export function meetingBuckets(data: AppData, studentId: ID): MeetingBuckets {
  const all = meetingsFor(data, studentId)
  const scheduled = all.filter((m) => m.status === 'scheduled').reverse()
  const completed = all.filter((m) => m.status === 'completed')
  return { upcoming: scheduled[0], later: scheduled.slice(1), recent: completed[0], past: completed.slice(1) }
}

export const lastMeeting = (data: AppData, studentId: ID) => meetingBuckets(data, studentId).recent
export const nextMeeting = (data: AppData, studentId: ID) => meetingBuckets(data, studentId).upcoming

/** The real tasks that came out of a meeting, with their current state. */
export function tasksFromMeeting(data: AppData, meetingId: ID): Task[] {
  return sortByUrgency(data.tasks.filter((t) => t.meetingId === meetingId))
}

/** One line describing a completed meeting, for lists. */
export function meetingOneLine(m: Meeting): string {
  return m.ai?.decided[0] ?? m.recap?.summary.split(/(?<=[.!?])\s/)[0] ?? 'No notes recorded.'
}

// ── Approvals ───────────────────────────────────────────────────────────────

const countPending = <T extends { review: string }>(xs: T[]) => xs.filter((x) => x.review === 'pending').length

/** The reviewable sections of a meeting's drafts, in screen order. */
export interface ReviewSection {
  key: 'notes' | 'tasks' | 'parents' | 'recap' | 'profile' | 'remember'
  label: string
  /** Items still waiting for the counselor. 0 means the section is settled. */
  pending: number
  total: number
}

export function reviewSections(m: Meeting): ReviewSection[] {
  const ai = m.ai
  const sections: ReviewSection[] = []
  if (ai) {
    sections.push({ key: 'notes', label: 'Meeting notes', pending: ai.notesReview === 'pending' ? 1 : 0, total: 1 })
    if (ai.draftTasks.length) sections.push({ key: 'tasks', label: 'Tasks from this meeting', pending: countPending(ai.draftTasks), total: ai.draftTasks.length })
    if (ai.parentUpdates.length) sections.push({ key: 'parents', label: 'Parent update', pending: countPending(ai.parentUpdates), total: ai.parentUpdates.length })
  }
  if (m.recap) sections.push({ key: 'recap', label: 'Recap for the student', pending: m.recap.review === 'pending' ? 1 : 0, total: 1 })
  if (ai?.personalNotes?.length) sections.push({ key: 'remember', label: 'Things to remember', pending: countPending(ai.personalNotes), total: ai.personalNotes.length })
  if (ai?.profileChanges.length) sections.push({ key: 'profile', label: 'Profile changes', pending: countPending(ai.profileChanges), total: ai.profileChanges.length })
  return sections
}

/** How many AI-drafted items in a meeting still wait for the counselor. */
export const pendingInMeeting = (m: Meeting): number => reviewSections(m).reduce((n, s) => n + s.pending, 0)

/** One draft or pending send waiting for the counselor in the Inbox. */
export type ApprovalKind =
  | 'notes'
  | 'task'
  | 'parent_update'
  | 'recap'
  | 'profile'
  | 'remember'
  | 'report'
  | 'essay'
  | 'weekly_text'
  | 'weekly_parent'
  | 'reminder'
  | 'agent_message'
  | 'agent_parent_update'
  | 'agent_task'
  | 'agent_profile_change'
  | 'agent_meeting_times'
  | 'agent_schedule_meeting'
  | 'agent_apply_template'
  | 'agent_task_change'
  | 'agent_add_college'
  | 'template_message'

export const APPROVAL_TYPE_LABEL: Record<ApprovalKind, string> = {
  notes: 'Meeting notes',
  task: 'Task',
  parent_update: 'Parent update',
  recap: 'Recap for student',
  profile: 'Profile change',
  remember: 'Note to self',
  report: 'Parent report',
  essay: 'Essay feedback',
  weekly_text: 'Weekly text',
  weekly_parent: 'Weekly text to parent',
  reminder: 'Reminder',
  agent_message: 'Message',
  agent_parent_update: 'Parent update',
  agent_task: 'Task',
  agent_profile_change: 'Profile change',
  agent_meeting_times: 'Meeting times',
  agent_schedule_meeting: 'Meeting',
  agent_apply_template: 'Template',
  agent_task_change: 'Task change',
  agent_add_college: 'College',
  template_message: 'Message',
}

export const MEETING_APPROVAL_KINDS: ApprovalKind[] = ['notes', 'task', 'parent_update', 'recap', 'profile', 'remember']

export type ApprovalItem = {
  key: string
  kind: ApprovalKind
  studentId: ID
  /** Groups with the same key share one header (student + source). */
  sourceKey: string
  sourceLabel: string
  sourceLine: string
  preview: string
  /** True when approving queues an outbound message. */
  isSend: boolean
  toName?: string
  channel?: Channel
  language?: Language
  /** Due date for urgency sorting (ISO date). */
  sortDue?: string
  /** Recency for sorting (ISO timestamp or date). */
  sortAt: string
  meetingId?: ID
  draftId?: ID
  reportId?: ID
  docId?: ID
  weeklyTextId?: ID
  /** Reminder queue key when kind is reminder. */
  reminderKey?: string
  /** Pending assistant proposal. */
  proposalId?: ID
  rationale?: string
  sourcesLine?: string
  /** A draft made from a message template. */
  messageDraftId?: ID
  /** Why it cannot be approved as it stands (a blank still in the text). The card says so and offers no approval. */
  problem?: string
  /** Something to check before approving, which does not block it. */
  caution?: string
  /** Its group is every draft with the same source, whichever student each is for, under this name. */
  groupName?: string
}

/** A drafted parent report as an approval. Also used by the student's Parent reports tab. */
export function reportApproval(data: AppData, r: ParentReport): ApprovalItem {
  const parent = findStudent(data, r.studentId)?.parents.find((p) => p.id === r.parentId)
  return {
    key: `report:${r.id}`,
    kind: 'report',
    studentId: r.studentId,
    sourceKey: `report:${r.id}`,
    sourceLabel: 'Report',
    sourceLine: r.source ? 'Drafted as a parent report' : 'Parent report draft',
    preview: r.bodyLocal ?? r.bodyEn,
    isSend: true,
    toName: parent?.name,
    channel: r.channel,
    language: r.language,
    sortAt: r.createdOn,
    reportId: r.id,
  }
}

/** Essay feedback as an approval. Also used by the student's Essays tab. */
export function essayApproval(data: AppData, d: StudentDocument): ApprovalItem {
  return {
    key: `essay:${d.id}`,
    kind: 'essay',
    studentId: d.studentId,
    sourceKey: `essay:${d.id}`,
    sourceLabel: 'Essay feedback',
    sourceLine: `Feedback on “${d.name}”`,
    preview: d.feedback?.overall ?? '',
    isSend: true,
    toName: findStudent(data, d.studentId)?.firstName,
    channel: 'text',
    language: 'en',
    sortAt: d.feedback?.generatedOn ?? d.addedOn,
    docId: d.id,
  }
}

const PROPOSAL_KIND = {
  message: 'agent_message',
  parent_update: 'agent_parent_update',
  task: 'agent_task',
  profile_change: 'agent_profile_change',
  meeting_times: 'agent_meeting_times',
  schedule_meeting: 'agent_schedule_meeting',
  apply_template: 'agent_apply_template',
  task_change: 'agent_task_change',
  add_college: 'agent_add_college',
} as const

/** The proposal kinds whose card is drawn from the payload itself, in src/components/ApprovalCard.tsx. */
const DRAWN_ON_THE_CARD = ['schedule_meeting', 'apply_template', 'task_change', 'add_college']

/** An assistant proposal as an approval. The assistant panel and the Inbox both build their card from this. */
export function proposalApproval(p: AgentProposal): ApprovalItem {
  const payload = p.payload
  const preview = DRAWN_ON_THE_CARD.includes(p.kind)
    ? proposalSummary(p)
    : typeof payload.body === 'string'
      ? payload.body
      : typeof payload.title === 'string'
        ? payload.title
        : Array.isArray(payload.slots)
          ? (payload.slots as { when?: string }[]).map((s) => s.when).filter(Boolean).join(' · ')
          : typeof payload.to === 'string'
            ? `${payload.field ?? 'Field'}: ${payload.from ?? ''} → ${payload.to}`
            : p.rationale || p.kind
  return {
    key: `agent:${p.id}`,
    kind: PROPOSAL_KIND[p.kind],
    studentId: p.studentId,
    sourceKey: `agent:${p.threadId}`,
    sourceLabel: 'From the assistant',
    sourceLine: p.rationale || 'Drafted by the assistant',
    preview: String(preview),
    isSend: p.kind === 'message' || p.kind === 'parent_update',
    toName: typeof payload.toName === 'string' ? payload.toName : undefined,
    channel: typeof payload.channel === 'string' ? (payload.channel as Channel) : undefined,
    language: typeof payload.language === 'string' ? (payload.language as Language) : undefined,
    sortDue: typeof payload.dueDate === 'string' ? payload.dueDate : undefined,
    sortAt: p.createdAt,
    proposalId: p.id,
    rationale: p.rationale,
    sourcesLine: p.sources.map((s) => s.label).filter(Boolean).join(' · ') || undefined,
  }
}

/** A draft a message template made, as an approval. A blank still in its text blocks it. */
export function messageDraftApproval(data: AppData, d: MessageDraft): ApprovalItem {
  const template = data.templates?.find((t) => t.id === d.templateId)
  const name = template?.name ?? 'a template'
  const language = d.language === 'en' ? undefined : ({ 'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese' } as const)[d.language]
  return {
    key: `draft:${d.id}`,
    kind: 'template_message',
    studentId: d.studentId,
    sourceKey: `template:${d.batchId}`,
    sourceLabel: `From the “${name}” template`,
    sourceLine: `${d.subject ? `Subject: ${d.subject} · ` : ''}From the “${name}” template`,
    preview: d.body,
    isSend: true,
    toName: d.toName,
    channel: d.channel,
    language: d.language,
    sortAt: d.createdAt,
    messageDraftId: d.id,
    problem: draftProblems(d.body, d.toKind === 'student')[0],
    caution: d.untranslated && language ? `This template has no ${language} version, so this is the English text. Translate it, or check that English is right for ${d.toName}, before you approve.` : undefined,
    groupName: `“${name}” template`,
  }
}

/** A meeting's drafts that still wait for the counselor, as approvals. The meeting review and the Inbox build their cards from this. */
export function meetingApprovals(data: AppData, m: Meeting): ApprovalItem[] {
  const items: ApprovalItem[] = []
  const sourceKey = `meeting:${m.id}`
  const sourceLabel = `From meeting on ${formatDate(m.date)}`
  const sourceLine = `Drafted from meeting notes, ${formatDate(m.date)}`
  const sortAt = `${m.date}T${m.time || '00:00'}`
  const ai = m.ai
  if (ai?.notesReview === 'pending') {
    const preview = [...ai.decided, ...ai.progress, ...ai.watch].slice(0, 2).join(' · ') || ai.notes[0] || m.title
    items.push({ key: `${m.id}:notes`, kind: 'notes', studentId: m.studentId, sourceKey, sourceLabel, sourceLine, preview, isSend: false, sortAt, meetingId: m.id })
  }
  for (const t of ai?.draftTasks ?? []) {
    if (t.review !== 'pending') continue
    items.push({
      key: `${m.id}:task:${t.id}`,
      kind: 'task',
      studentId: m.studentId,
      sourceKey,
      sourceLabel,
      sourceLine,
      preview: t.detail ? `${t.title} — ${t.detail}` : t.title,
      isSend: false,
      sortDue: t.dueDate,
      sortAt,
      meetingId: m.id,
      draftId: t.id,
    })
  }
  for (const u of ai?.parentUpdates ?? []) {
    if (u.review !== 'pending') continue
    const parent = findStudent(data, m.studentId)?.parents.find((p) => p.id === u.parentId)
    items.push({
      key: `${m.id}:parent:${u.id}`,
      kind: 'parent_update',
      studentId: m.studentId,
      sourceKey,
      sourceLabel,
      sourceLine,
      preview: u.bodyLocal ?? u.bodyEn,
      isSend: true,
      toName: parent?.name,
      channel: parent?.channel,
      language: parent?.language,
      sortAt,
      meetingId: m.id,
      draftId: u.id,
    })
  }
  if (m.recap?.review === 'pending') {
    items.push({
      key: `${m.id}:recap`,
      kind: 'recap',
      studentId: m.studentId,
      sourceKey,
      sourceLabel,
      sourceLine,
      preview: m.recap.summary,
      isSend: true,
      toName: findStudent(data, m.studentId)?.firstName,
      channel: 'text',
      language: 'en',
      sortAt,
      meetingId: m.id,
    })
  }
  for (const c of ai?.profileChanges ?? []) {
    if (c.review !== 'pending') continue
    items.push({
      key: `${m.id}:profile:${c.id}`,
      kind: 'profile',
      studentId: m.studentId,
      sourceKey,
      sourceLabel,
      sourceLine,
      preview: `${c.label}: ${c.from} → ${c.to}`,
      isSend: false,
      sortAt,
      meetingId: m.id,
      draftId: c.id,
    })
  }
  for (const n of ai?.personalNotes ?? []) {
    if (n.review !== 'pending') continue
    items.push({
      key: `${m.id}:remember:${n.id}`,
      kind: 'remember',
      studentId: m.studentId,
      sourceKey,
      sourceLabel,
      sourceLine,
      preview: n.text,
      isSend: false,
      sortAt,
      meetingId: m.id,
      draftId: n.id,
    })
  }
  return items
}

/** Everything waiting for a counselor, as one row per draft or pending send. Reminders are merged in by allPendingApprovals (see reminderApprovals). */
export function pendingApprovals(data: AppData, studentId?: ID): ApprovalItem[] {
  const active = new Set(activeStudents(data).map((s) => s.id))
  const mine = (id: ID) => active.has(id) && (!studentId || id === studentId)
  const items: ApprovalItem[] = []

  for (const m of data.meetings) {
    if (mine(m.studentId) && pendingInMeeting(m) > 0) items.push(...meetingApprovals(data, m))
  }

  for (const r of data.reports) {
    if (mine(r.studentId) && r.status === 'draft') items.push(reportApproval(data, r))
  }

  for (const d of data.documents) {
    if (mine(d.studentId) && d.feedback?.review === 'pending') items.push(essayApproval(data, d))
  }

  for (const w of data.weeklyTexts) {
    if (!mine(w.studentId) || w.status !== 'draft' || !w.body.trim()) continue
    const student = findStudent(data, w.studentId)
    items.push({
      key: `weekly:${w.id}`,
      kind: 'weekly_text',
      studentId: w.studentId,
      sourceKey: `weekly:${w.studentId}:${w.weekStart}`,
      sourceLabel: 'Weekly text',
      sourceLine: `Weekly text for the week of ${formatDate(w.weekStart)}`,
      preview: w.body,
      isSend: true,
      toName: student?.firstName,
      channel: 'text',
      language: 'en',
      sortAt: w.weekStart,
      weeklyTextId: w.id,
    })
    const copy = w.parentCopy
    if (copy && copy.status === 'draft' && copy.body.trim()) {
      const parent = student?.parents.find((p) => p.id === copy.parentId)
      items.push({
        key: `weekly-parent:${w.id}`,
        kind: 'weekly_parent',
        studentId: w.studentId,
        sourceKey: `weekly:${w.studentId}:${w.weekStart}`,
        sourceLabel: 'Weekly text',
        sourceLine: `Parent copy for the week of ${formatDate(w.weekStart)}`,
        preview: copy.body,
        isSend: true,
        toName: parent?.name,
        channel: copy.channel,
        language: copy.language,
        sortAt: w.weekStart,
        weeklyTextId: w.id,
      })
    }
  }

  for (const p of data.agentProposals ?? []) {
    if (p.status === 'pending' && mine(p.studentId)) items.push(proposalApproval(p))
  }

  for (const d of data.messageDrafts ?? []) {
    if (d.status === 'draft' && mine(d.studentId)) items.push(messageDraftApproval(data, d))
  }

  return items
}

/** Turn the reminder queue into approval rows (kept here-free of a cycle with reminders.ts). */
export function reminderApprovals(data: AppData, drafts: { key: string; mode: string; studentId: ID; taskId: ID; taskTitle: string; message: { body: string; toName: string; channel: Channel; language: Language } }[], studentId?: ID): ApprovalItem[] {
  const active = new Set(activeStudents(data).map((s) => s.id))
  return drafts
    .filter((r) => r.mode === 'needs_approval' && active.has(r.studentId) && (!studentId || r.studentId === studentId))
    .map((r) => ({
      key: `reminder:${r.key}`,
      kind: 'reminder' as const,
      studentId: r.studentId,
      sourceKey: `reminder:${r.studentId}`,
      sourceLabel: 'Reminder',
      sourceLine: `Reminder about “${r.taskTitle}”`,
      preview: r.message.body,
      isSend: true,
      toName: r.message.toName,
      channel: r.message.channel,
      language: r.message.language,
      sortDue: data.tasks.find((t) => t.id === r.taskId)?.dueDate,
      sortAt: todayISO(),
      reminderKey: r.key,
    }))
}

export function allPendingApprovals(data: AppData, reminderDrafts: Parameters<typeof reminderApprovals>[1], studentId?: ID): ApprovalItem[] {
  return [...pendingApprovals(data, studentId), ...reminderApprovals(data, reminderDrafts, studentId)]
}

export const pendingApprovalCount = (data: AppData, studentId?: ID) => pendingApprovals(data, studentId).length

/** Groups for the Inbox: by student, then by source. Urgent / soon due first, then newest. */
export function approvalGroups(items: ApprovalItem[]): { studentId: ID; sourceKey: string; sourceLabel: string; groupName?: string; items: ApprovalItem[] }[] {
  const map = new Map<string, ApprovalItem[]>()
  for (const item of items) {
    // Drafts made together from one template are one group, whichever student each is for.
    const key = item.groupName ? item.sourceKey : `${item.studentId}::${item.sourceKey}`
    const list = map.get(key) ?? []
    list.push(item)
    map.set(key, list)
  }
  const groups = [...map.entries()].map(([, groupItems]) => ({
    studentId: groupItems[0]!.studentId,
    sourceKey: groupItems[0]!.sourceKey,
    sourceLabel: groupItems[0]!.sourceLabel,
    groupName: groupItems[0]!.groupName,
    items: groupItems,
  }))
  const today = todayISO()
  const urgency = (g: (typeof groups)[0]) => {
    const dues = g.items.map((i) => i.sortDue).filter(Boolean) as string[]
    if (dues.length === 0) return Number.POSITIVE_INFINITY
    return Math.min(...dues.map((d) => daysBetween(today, d)))
  }
  const newest = (g: (typeof groups)[0]) => Math.max(...g.items.map((i) => Date.parse(i.sortAt) || 0))
  return groups.sort((a, b) => {
    const ua = urgency(a)
    const ub = urgency(b)
    if (ua !== ub) return ua - ub
    return newest(b) - newest(a)
  })
}

// ── Documents ───────────────────────────────────────────────────────────────

export const DOC_CATEGORIES: { value: DocCategory; label: string }[] = [
  { value: 'academic', label: 'Academic records' },
  { value: 'testing', label: 'Test scores' },
  { value: 'application', label: 'Application materials' },
  { value: 'recommendation', label: 'Recommendations' },
  { value: 'financial', label: 'Financial aid' },
  { value: 'other', label: 'Other' },
]

/** A student's files and links, without essays (those live in the Essays tab). */
export function documentsFor(data: AppData, studentId: ID): StudentDocument[] {
  return data.documents.filter((d) => d.studentId === studentId && d.kind !== 'essay').sort((a, b) => b.addedOn.localeCompare(a.addedOn))
}

export function documentsByCategory(docs: StudentDocument[]): { category: DocCategory; label: string; docs: StudentDocument[] }[] {
  return DOC_CATEGORIES.map((c) => ({ category: c.value, label: c.label, docs: docs.filter((d) => d.category === c.value) }))
}

/** "PDF", "DOC", "LINK": a short type tag from the name or link. */
export function fileType(doc: Pick<StudentDocument, 'name' | 'url'>): string {
  const ext = doc.name.match(/\.([a-z0-9]{2,4})$/i)?.[1]?.toUpperCase()
  if (ext) return ext === 'DOCX' ? 'DOC' : ext
  return doc.url ? 'LINK' : 'FILE'
}

/** Tasks that asked for a document and have nothing attached yet. */
export function missingRequestedDocuments(data: AppData, studentId: ID): Task[] {
  const received = new Set(data.documents.filter((d) => d.studentId === studentId && d.taskId).map((d) => d.taskId))
  return sortByUrgency(tasksFor(data, studentId).filter((t) => t.expectsDocument && isOpen(t) && !received.has(t.id) && t.attachments.length === 0))
}

// ── Essays ──────────────────────────────────────────────────────────────────

export const ESSAY_STATUS: Record<EssayStatus, { label: string; tone: 'neutral' | 'accent' | 'bad' | 'warn' | 'good' }> = {
  not_started: { label: 'Not started', tone: 'neutral' },
  drafting: { label: 'Drafting', tone: 'neutral' },
  waiting_on_student: { label: 'Waiting on student', tone: 'bad' },
  needs_feedback: { label: 'Needs your feedback', tone: 'accent' },
  revising: { label: 'Revising', tone: 'warn' },
  final: { label: 'Final', tone: 'good' },
  submitted: { label: 'Submitted', tone: 'good' },
}

export function wordCount(text: string | undefined): number {
  return text?.trim() ? text.trim().split(/\s+/).length : 0
}

export const currentDraft = (doc: StudentDocument) => doc.drafts?.at(-1)

export function essaysFor(data: AppData, studentId: ID): StudentDocument[] {
  return data.documents.filter((d) => d.studentId === studentId && d.kind === 'essay')
}

export interface EssayGroup {
  key: string
  title: string
  /** "Due Nov 30", from the matching college on the list, when there is one. */
  deadline?: ISODate
  essays: StudentDocument[]
}

/** College essays grouped by school or system, soonest deadline first, then summer programs. */
export function essayGroups(data: AppData, studentId: ID): { college: EssayGroup[]; summer: EssayGroup[]; counts: { all: number; college: number; summer: number; needsFeedback: number } } {
  const essays = essaysFor(data, studentId)
  const colleges = collegesFor(data, studentId)
  const build = (group: 'college' | 'summer'): EssayGroup[] => {
    const byTarget = new Map<string, StudentDocument[]>()
    for (const e of essays.filter((x) => (x.essayGroup ?? 'college') === group)) {
      const key = e.target?.trim() || 'Other'
      byTarget.set(key, [...(byTarget.get(key) ?? []), e])
    }
    return [...byTarget.entries()]
      .map(([title, list]) => ({
        key: `${group}:${title}`,
        title,
        // A target such as "University of California" matches list entries "UC Berkeley" via the UC plan.
        deadline: colleges.find((c) => collegeIsPending(c) && (c.name.toLowerCase().includes(title.toLowerCase()) || (title === 'University of California' && c.plan === 'UC')))?.deadline,
        essays: list,
      }))
      .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.title.localeCompare(b.title))
  }
  return {
    college: build('college'),
    summer: build('summer'),
    counts: {
      all: essays.length,
      college: essays.filter((e) => (e.essayGroup ?? 'college') === 'college').length,
      summer: essays.filter((e) => e.essayGroup === 'summer').length,
      needsFeedback: essays.filter((e) => e.status === 'needs_feedback').length,
    },
  }
}

// ── Student status ──────────────────────────────────────────────────────────

export type StudentStatus = 'behind' | 'slipping' | 'on_track' | 'new'

export interface StudentSummary {
  student: Student
  status: StudentStatus
  /** Short, human reasons this student needs attention. Empty when all is well. */
  reasons: string[]
  progress: TaskProgress
  open: number
  nextDeadline?: Deadline
  waitingOn?: WaitingOn
  lastMeeting?: Meeting
  nextMeeting?: Meeting
  pendingApprovalCount: number
}

const COLLEGE_DEADLINE_WARNING_DAYS = 10

/**
 * The single definition of how a student is doing.
 *   new       onboarded in the last three weeks
 *   behind    3+ late tasks, or anything a week or more overdue
 *   slipping  any late task, or no meeting in a month
 *   on_track  everything else
 *
 * Status thresholds live in shared/attention.ts (also used by the assistant).
 */
export function summarize(data: AppData, student: Student): StudentSummary {
  const today = todayISO()
  const tasks = tasksFor(data, student.id)
  const progress = taskProgress(tasks, today)
  const late = tasks.filter((t) => isLate(t, today)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const maxLate = late[0] ? daysLate(late[0], today) : 0
  const { recent, upcoming } = meetingBuckets(data, student.id)
  const sinceMeeting = recent ? daysBetween(recent.date, today) : undefined
  const isNew = daysBetween(student.onboardedOn, today) <= NEW_STUDENT_DAYS

  const status: StudentStatus = classifyAttention({
    lateCount: late.length,
    maxDaysLate: maxLate,
    daysSinceMeeting: sinceMeeting,
    daysSinceOnboarded: daysBetween(student.onboardedOn, today),
  })

  const reasons: string[] = []
  if (late.length > 0) reasons.push(`${late.length} late ${late.length === 1 ? 'task' : 'tasks'}, oldest ${maxLate} ${maxLate === 1 ? 'day' : 'days'} overdue`)
  const blockedOnParent = late.find((t) => t.owner === 'parent')
  if (blockedOnParent) reasons.push(`Waiting on ${ownerLabel(blockedOnParent, student)}: ${blockedOnParent.title}`)
  const soonCollege = collegesFor(data, student.id).find(
    (c) => collegeIsPending(c) && c.deadline !== undefined && daysBetween(today, c.deadline) >= 0 && daysBetween(today, c.deadline) <= COLLEGE_DEADLINE_WARNING_DAYS,
  )
  if (soonCollege?.deadline) {
    const n = daysFromToday(soonCollege.deadline)
    reasons.push(`${collegeLabel(soonCollege)} application due ${n === 0 ? 'today' : `in ${n} ${n === 1 ? 'day' : 'days'}`}`)
  }
  if (sinceMeeting !== undefined && sinceMeeting > MEETING_GAP_DAYS) reasons.push(`No meeting in ${Math.round(sinceMeeting / 7)} weeks`)
  if (isNew && status === 'new') reasons.push('Just onboarded: first plan not set yet')

  return {
    student,
    status,
    reasons,
    progress,
    open: progress.total - progress.done,
    nextDeadline: nextDeadline(data, student.id),
    waitingOn: waitingOn(data, student),
    lastMeeting: recent,
    nextMeeting: upcoming,
    pendingApprovalCount: pendingApprovalCount(data, student.id),
  }
}

const STATUS_ORDER: Record<StudentStatus, number> = { behind: 0, slipping: 1, new: 2, on_track: 3 }

/** Active students, most urgent first: by status, then by nearest deadline. */
export function summarizeAll(data: AppData): StudentSummary[] {
  return activeStudents(data)
    .map((s) => summarize(data, s))
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        (a.nextDeadline?.date ?? '9999').localeCompare(b.nextDeadline?.date ?? '9999') ||
        a.student.firstName.localeCompare(b.student.firstName),
    )
}

/** "Behind · 3 late", "On track", for the line above a progress bar. */
export function statusText(s: Pick<StudentSummary, 'status' | 'progress'>): string {
  const label = { behind: 'Behind', slipping: 'Slipping', on_track: 'On track', new: 'Just onboarded' }[s.status]
  return s.progress.late > 0 ? `${label} · ${s.progress.late} late` : label
}

// ── Weekly texts ────────────────────────────────────────────────────────────

/** How far ahead a weekly text looks, in days. */
export const WEEKLY_TEXT_LOOKAHEAD_DAYS = 7

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * The first day of the current weekly-text week: the firm's chosen weekday, on
 * or before today. A week runs from that day until the day before the next
 * one, so each student is texted (or skipped) at most once per week.
 */
export function weeklyTextWeek(day: number, today: ISODate = todayISO()): ISODate {
  return addDays(today, -((parseISODate(today).getDay() - day + 7) % 7))
}

/** What a student's weekly text is about. */
export interface WeeklyTextItems {
  /** The student's next meeting, if it is within the lookahead. */
  meeting?: Meeting
  /** The student's own late tasks, most overdue first. */
  late: Task[]
  /** The student's own open tasks due within the lookahead, soonest first. */
  due: Task[]
  /**
   * The student's next application deadlines, soonest first, at most three.
   * Not written into the text: they are what the AI weighs when it picks which
   * task to put first.
   */
  deadlines?: Deadline[]
}

/** The meeting and tasks a weekly text would mention, or undefined when there is nothing to say. */
export function weeklyTextItems(data: AppData, studentId: ID, today: ISODate = todayISO()): WeeklyTextItems | undefined {
  const horizon = addDays(today, WEEKLY_TEXT_LOOKAHEAD_DAYS)
  const mine = tasksFor(data, studentId)
    .filter((t) => isOpen(t) && t.owner === 'student')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const late = mine.filter((t) => isLate(t, today))
  const due = mine.filter((t) => !isLate(t, today) && t.dueDate <= horizon)
  const meeting = meetingsFor(data, studentId)
    .filter((m) => m.status === 'scheduled' && m.date >= today && m.date <= horizon)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0]
  const deadlines = deadlinesFor(data, studentId)
    .filter((x) => x.kind === 'college' && x.date >= today)
    .slice(0, 3)
  return meeting || late.length || due.length ? { meeting, late, due, deadlines } : undefined
}

export interface WeeklyTextRow {
  student: Student
  weekStart: ISODate
  items: WeeklyTextItems
  /** This week's draft, if one has been prepared. */
  draft?: WeeklyText
}

/**
 * The weekly texts still to send this week: every included student with a late
 * task, a task due soon or a meeting coming up, whose text for this week has
 * not been sent or skipped.
 */
export function weeklyTextRows(data: AppData, today: ISODate = todayISO()): WeeklyTextRow[] {
  const weekStart = weeklyTextWeek(data.firm.weeklyTextDay, today)
  return activeStudents(data).flatMap((student) => {
    if (student.weeklyText === false) return []
    const record = data.weeklyTexts.find((w) => w.studentId === student.id && w.weekStart === weekStart)
    if (record && record.status !== 'draft') return []
    const items = weeklyTextItems(data, student.id, today)
    return items ? [{ student, weekStart, items, draft: record }] : []
  })
}

/** This week's texts that were sent or skipped, latest first. */
export function weeklyTextsDone(data: AppData, today: ISODate = todayISO()): WeeklyText[] {
  const weekStart = weeklyTextWeek(data.firm.weeklyTextDay, today)
  return data.weeklyTexts.filter((w) => w.weekStart === weekStart && w.status !== 'draft').reverse()
}

// ── Things to remember ──────────────────────────────────────────────────────
// Small personal details a student mentioned in passing (a golf tournament, a
// school play), saved once a counselor approves them. This section decides the
// life of a note: when it is live, when a draft may mention it, and when it is
// spent. Who may receive one is decided in lib/facts.ts (texts to the student
// only, never a parent).
//
//   * A note with a date is kept until a week after the event, however far off
//     the event is. It is offered to drafts from 14 days before: first to wish
//     the student well ("ahead"), then, once it has happened, to ask how it
//     went ("after").
//   * A note with no date belongs to the meeting cycle it came from. It is
//     dropped when the next meeting with that student is logged, or after 30
//     days, whichever comes first.
//   * A note is mentioned once per moment: once ahead, once after, or once if
//     it has no date. After that it is not offered again, so the student never
//     hears the same thing twice.

/** A dated note may be mentioned from this many days before the event… */
export const NOTE_DAYS_AHEAD = 14
/** …and asked about until this many days after it. Then it is finished. */
export const NOTE_DAYS_AFTER = 7
/** A note with no date goes stale after this many days, even if no meeting has happened since. */
export const NOTE_STALE_DAYS = 30
/** How many notes one draft is offered. It may use at most one. */
export const NOTES_PER_DRAFT = 3

/**
 * Where a note stands today.
 *   later     its event is more than 14 days off: kept, not mentioned yet
 *   ahead     its event is within 14 days: "good luck Saturday"
 *   after     its event was in the last 7 days: "how did it go?"
 *   undated   no date, still within the meeting cycle it came from
 *   finished  the event is more than a week past, or a newer meeting (or 30 days) has overtaken an undated note
 */
export type NoteStage = 'later' | 'ahead' | 'after' | 'undated' | 'finished'

/** The day a note was learned: the day of the meeting it came from, or the day it was typed in. */
function noteLearnedOn(data: AppData, note: PersonalNote): ISODate {
  const meeting = note.meetingId ? data.meetings.find((m) => m.id === note.meetingId) : undefined
  return meeting?.date ?? note.createdAt.slice(0, 10)
}

export function noteStage(data: AppData, note: PersonalNote, today: ISODate = todayISO()): NoteStage {
  if (note.eventDate) {
    const until = daysBetween(today, note.eventDate)
    if (until > NOTE_DAYS_AHEAD) return 'later'
    if (until >= 0) return 'ahead'
    // An estimated date ("sometime next month") is too loose to ask "how did it go?" on.
    return until >= -NOTE_DAYS_AFTER && !note.eventDateApprox ? 'after' : 'finished'
  }
  const learned = noteLearnedOn(data, note)
  const newerMeeting = data.meetings.some((m) => m.studentId === note.studentId && m.status === 'completed' && m.id !== note.meetingId && m.date > learned)
  return newerMeeting || daysBetween(learned, today) > NOTE_STALE_DAYS ? 'finished' : 'undated'
}

/** Whether the note has already been mentioned at this stage. Each stage gets one mention. */
export const noteSpent = (note: PersonalNote, stage: NoteStage): boolean => note.uses.some((u) => u.stage === stage)

/** A student's saved notes, newest first. */
export function personalNotesFor(data: AppData, studentId: ID): PersonalNote[] {
  // Stored oldest first; reversing keeps the latest of several saved at the same moment on top.
  return data.personalNotes.filter((n) => n.studentId === studentId).reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** A student's notes that are still live (anything but finished), newest first, and the finished ones. */
export function personalNotesByLife(data: AppData, studentId: ID, today: ISODate = todayISO()): { live: PersonalNote[]; finished: PersonalNote[] } {
  const notes = personalNotesFor(data, studentId)
  return { live: notes.filter((n) => noteStage(data, n, today) !== 'finished'), finished: notes.filter((n) => noteStage(data, n, today) === 'finished') }
}

export interface NoteToMention {
  note: PersonalNote
  stage: 'ahead' | 'after' | 'undated'
}

/**
 * The notes a draft to this student may mention today, best first, at most
 * three. A note qualifies when it is at a stage that can be mentioned and has
 * not been mentioned at that stage before.
 *   1. events that just happened (ask how it went), most recent first;
 *   2. events in the next 14 days, soonest first;
 *   3. undated notes from the current meeting cycle, newest first.
 */
export function notesWorthMentioning(data: AppData, studentId: ID, today: ISODate = todayISO()): NoteToMention[] {
  const open = personalNotesFor(data, studentId).flatMap((note): NoteToMention[] => {
    const stage = noteStage(data, note, today)
    return (stage === 'ahead' || stage === 'after' || stage === 'undated') && !noteSpent(note, stage) ? [{ note, stage }] : []
  })
  const until = (n: NoteToMention) => daysBetween(today, n.note.eventDate!)
  const after = open.filter((n) => n.stage === 'after').sort((a, b) => until(b) - until(a))
  const ahead = open.filter((n) => n.stage === 'ahead').sort((a, b) => until(a) - until(b))
  const undated = open.filter((n) => n.stage === 'undated')
  return [...after, ...ahead, ...undated].slice(0, NOTES_PER_DRAFT)
}

/** "in 5 days", "tomorrow", "3 days ago": where an event sits relative to today. */
export function eventWhen(date: ISODate, today: ISODate = todayISO()): string {
  const n = daysBetween(today, date)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  return n > 0 ? `in ${n} days` : `${-n} days ago`
}

/** One line on where a note stands, for the counselor: "Coming up Sat, Nov 28, in 5 days · not mentioned yet". */
export function noteStatusLine(data: AppData, note: PersonalNote, today: ISODate = todayISO()): string {
  const stage = noteStage(data, note, today)
  const mentioned = (s: NoteStage) => note.uses.find((u) => u.stage === s)
  const day = (at: string) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const said = note.uses.length ? ` · mentioned ${note.uses.map((u) => day(u.at)).join(' and ')}` : ''
  if (stage === 'later') return `Kept for later: nearer the day it will be offered to a text${said}`
  if (stage === 'ahead') return mentioned('ahead') ? `Wished well on ${day(mentioned('ahead')!.at)}. Next: asking how it went, after the day` : 'Coming up: a text may wish them well'
  if (stage === 'after') return mentioned('after') ? `Asked about on ${day(mentioned('after')!.at)}. Not used again` : `It has happened: a text may ask how it went${said}`
  if (stage === 'undated') return mentioned('undated') ? `Mentioned on ${day(mentioned('undated')!.at)}. Not used again` : 'A text may mention it once, until the next meeting'
  return note.eventDate ? `Over${said}` : `From an earlier meeting cycle${said}`
}

// ── Parent copy ─────────────────────────────────────────────────────────────

/** A student who has not reacted for this long to the last message sent to them counts as not responding. */
export const NOT_RESPONDING_DAYS = 5

const hasLateTask = (data: AppData, studentId: ID, today: ISODate) => tasksFor(data, studentId).some((t) => t.owner === 'student' && isLate(t, today))

/**
 * True when the student has a late task of their own and has done nothing in
 * the app for 5 or more days since the last message to them. A student nobody
 * has messaged is not "not responding".
 *
 * Student activity is anything recorded with actor 'student': a task marked
 * started or done, a progress note, a link attached.
 */
export function isNotResponding(data: AppData, student: Student, today: ISODate = todayISO()): boolean {
  if (!hasLateTask(data, student.id, today)) return false
  // The log is newest first.
  const last = data.outbox.find((m) => m.studentId === student.id && m.toKind === 'student')
  if (!last || daysBetween(last.sentAt.slice(0, 10), today) < NOT_RESPONDING_DAYS) return false
  return !data.activity.some((e) => e.studentId === student.id && e.actor === 'student' && e.at > last.sentAt)
}

/** "Slipping", for the parent copy setting: a late task of the student's own, or not responding. */
export function isSlipping(data: AppData, student: Student, today: ISODate = todayISO()): boolean {
  return hasLateTask(data, student.id, today) || isNotResponding(data, student, today)
}

export interface ParentCopyChoice {
  /** Whether "Also tell parent" is offered at all: not when the setting is 'never' or there is no parent. */
  offered: boolean
  /** Whether it starts ticked. */
  ticked: boolean
  parent?: Parent
}

/** How "Also tell parent" starts for a message to this student, from their setting and how they are doing. */
export function parentCopyChoice(data: AppData, student: Student, today: ISODate = todayISO()): ParentCopyChoice {
  const setting = student.parentCopy ?? 'when_slipping'
  const parent = primaryParent(student)
  if (setting === 'never' || !parent) return { offered: false, ticked: false }
  return { offered: true, ticked: setting === 'always' || isSlipping(data, student, today), parent }
}

/** The task a parent copy of a weekly text is about: the most overdue, or failing that the next due. */
export const parentCopyTask = (items: WeeklyTextItems): Task | undefined => items.late[0] ?? items.due[0]
