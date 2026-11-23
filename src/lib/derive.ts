// Derived facts. "Late", "next deadline", "needs attention" and friends are
// computed here from the data, and nowhere else, so every screen agrees.

import type { AppData, CollegeApp, ID, Meeting, Parent, Student, Task } from '../types'
import { daysBetween, daysFromToday, todayISO, type ISODate } from './dates'

// ── Names ───────────────────────────────────────────────────────────────────

export const fullName = (s: Student) => `${s.firstName} ${s.lastName}`

export function findStudent(data: AppData, id: ID | undefined): Student | undefined {
  return data.students.find((s) => s.id === id)
}

export function findParent(student: Student, parentId: ID | undefined): Parent | undefined {
  return student.parents.find((p) => p.id === parentId)
}

/** "Kevin", "Dad (Zhang Wei)" or "Counselor". */
export function ownerLabel(task: Pick<Task, 'owner' | 'ownerParentId'>, student: Student): string {
  if (task.owner === 'counselor') return 'Counselor'
  if (task.owner === 'student') return student.firstName
  const parent = findParent(student, task.ownerParentId)
  if (!parent) return 'Parent'
  const short = parent.relationship === 'Mother' ? 'Mom' : parent.relationship === 'Father' ? 'Dad' : 'Guardian'
  return `${short} (${parent.name})`
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

// ── Deadlines ───────────────────────────────────────────────────────────────

export interface Deadline {
  id: ID
  studentId: ID
  date: ISODate
  label: string
  kind: 'task' | 'college'
  late: boolean
}

const collegeIsPending = (c: CollegeApp) => c.status === 'considering' || c.status === 'in_progress'

/** Open tasks and unsubmitted applications, soonest first. Includes late tasks. */
export function deadlinesFor(data: AppData, studentId: ID): Deadline[] {
  const today = todayISO()
  const fromTasks: Deadline[] = tasksFor(data, studentId)
    .filter(isOpen)
    .map((t) => ({ id: t.id, studentId, date: t.dueDate, label: t.title, kind: 'task', late: isLate(t, today) }))
  const fromColleges: Deadline[] = data.colleges
    .filter((c) => c.studentId === studentId && collegeIsPending(c))
    .map((c) => ({
      id: c.id,
      studentId,
      date: c.deadline,
      label: `${c.name} ${c.plan} application`,
      kind: 'college',
      late: c.deadline < today,
    }))
  return [...fromTasks, ...fromColleges].sort((a, b) => a.date.localeCompare(b.date))
}

/** The soonest deadline that is today or later. */
export function nextDeadline(data: AppData, studentId: ID): Deadline | undefined {
  const today = todayISO()
  return deadlinesFor(data, studentId).find((d) => d.date >= today)
}

// ── Meetings ────────────────────────────────────────────────────────────────

export function meetingsFor(data: AppData, studentId: ID): Meeting[] {
  return data.meetings
    .filter((m) => m.studentId === studentId)
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
}

export function lastMeeting(data: AppData, studentId: ID): Meeting | undefined {
  return meetingsFor(data, studentId).find((m) => m.status === 'completed')
}

export function nextMeeting(data: AppData, studentId: ID): Meeting | undefined {
  return meetingsFor(data, studentId)
    .filter((m) => m.status === 'scheduled')
    .at(-1)
}

// ── Approvals ───────────────────────────────────────────────────────────────

export interface ApprovalItem {
  key: string
  studentId: ID
  label: string
  /** Route to the screen where the counselor reviews it. */
  to: string
  count: number
}

/** How many AI-drafted items in a meeting still wait for the counselor. */
export function pendingInMeeting(m: Meeting): number {
  const ai = m.ai
  const pending = <T extends { review: string }>(xs: T[]) => xs.filter((x) => x.review === 'pending').length
  return (
    (ai ? pending(ai.draftTasks) + pending(ai.parentUpdates) + pending(ai.profileChanges) : 0) +
    (m.recap?.review === 'pending' ? 1 : 0)
  )
}

/** Everything AI-drafted that is waiting for a counselor, across the firm or for one student. */
export function pendingApprovals(data: AppData, studentId?: ID): ApprovalItem[] {
  const items: ApprovalItem[] = []
  const mine = <T extends { studentId: ID }>(xs: T[]) => (studentId ? xs.filter((x) => x.studentId === studentId) : xs)

  for (const m of mine(data.meetings)) {
    const count = pendingInMeeting(m)
    if (count > 0) {
      items.push({
        key: m.id,
        studentId: m.studentId,
        label: `Meeting drafts: ${m.title}`,
        to: `/app/students/${m.studentId}/meetings/${m.id}`,
        count,
      })
    }
  }
  for (const r of mine(data.reports)) {
    if (r.status === 'draft') {
      items.push({
        key: r.id,
        studentId: r.studentId,
        label: `Parent report draft: ${r.subject}`,
        to: `/app/students/${r.studentId}?tab=reports`,
        count: 1,
      })
    }
  }
  for (const d of mine(data.documents)) {
    if (d.feedback?.review === 'pending') {
      items.push({
        key: d.id,
        studentId: d.studentId,
        label: `Essay feedback: ${d.name}`,
        to: `/app/students/${d.studentId}/documents/${d.id}`,
        count: 1,
      })
    }
  }
  return items
}

// ── Student status ──────────────────────────────────────────────────────────

export type StudentStatus = 'behind' | 'slipping' | 'on_track' | 'new'

export interface StudentSummary {
  student: Student
  status: StudentStatus
  /** Short, human reasons this student needs attention. Empty when all is well. */
  reasons: string[]
  open: number
  late: number
  done: number
  total: number
  /** Most overdue open task. */
  oldestLate?: Task
  nextDeadline?: Deadline
  lastMeeting?: Meeting
  nextMeeting?: Meeting
  pendingApprovalCount: number
}

const NEW_STUDENT_DAYS = 21
const MEETING_GAP_DAYS = 30
const COLLEGE_DEADLINE_WARNING_DAYS = 10

/**
 * The single definition of how a student is doing.
 *   new       onboarded in the last three weeks
 *   behind    3+ late tasks, or anything a week or more overdue
 *   slipping  any late task, or no meeting in a month
 *   on_track  everything else
 */
export function summarize(data: AppData, student: Student): StudentSummary {
  const today = todayISO()
  const tasks = tasksFor(data, student.id)
  const open = tasks.filter(isOpen)
  const late = open.filter((t) => isLate(t, today)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const oldestLate = late[0]
  const maxLate = oldestLate ? daysLate(oldestLate, today) : 0
  const last = lastMeeting(data, student.id)
  const next = nextMeeting(data, student.id)
  const sinceMeeting = last ? daysBetween(last.date, today) : undefined
  const isNew = daysBetween(student.onboardedOn, today) <= NEW_STUDENT_DAYS

  let status: StudentStatus = 'on_track'
  if (late.length >= 3 || maxLate >= 7) status = 'behind'
  else if (late.length >= 1 || (sinceMeeting !== undefined && sinceMeeting > MEETING_GAP_DAYS && !isNew))
    status = 'slipping'
  else if (isNew) status = 'new'

  const reasons: string[] = []
  if (late.length > 0) {
    reasons.push(
      `${late.length} late ${late.length === 1 ? 'task' : 'tasks'}, oldest ${maxLate} ${maxLate === 1 ? 'day' : 'days'} overdue`,
    )
  }
  const blockedOnParent = late.find((t) => t.owner === 'parent')
  if (blockedOnParent) {
    reasons.push(`Waiting on ${ownerLabel(blockedOnParent, student)}: ${blockedOnParent.title}`)
  }
  const soonCollege = data.colleges
    .filter((c) => c.studentId === student.id && collegeIsPending(c))
    .filter((c) => daysBetween(today, c.deadline) >= 0 && daysBetween(today, c.deadline) <= COLLEGE_DEADLINE_WARNING_DAYS)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))[0]
  if (soonCollege) {
    const n = daysFromToday(soonCollege.deadline)
    reasons.push(`${soonCollege.name} ${soonCollege.plan} due ${n === 0 ? 'today' : `in ${n} ${n === 1 ? 'day' : 'days'}`}`)
  }
  if (sinceMeeting !== undefined && sinceMeeting > MEETING_GAP_DAYS) {
    reasons.push(`No meeting in ${Math.round(sinceMeeting / 7)} weeks`)
  }
  if (isNew && status === 'new') reasons.push('Just onboarded: first plan not set yet')

  return {
    student,
    status,
    reasons,
    open: open.length,
    late: late.length,
    done: tasks.length - open.length,
    total: tasks.length,
    oldestLate,
    nextDeadline: nextDeadline(data, student.id),
    lastMeeting: last,
    nextMeeting: next,
    pendingApprovalCount: pendingApprovals(data, student.id).reduce((n, a) => n + a.count, 0),
  }
}

const STATUS_ORDER: Record<StudentStatus, number> = { behind: 0, slipping: 1, new: 2, on_track: 3 }

/** All students, the ones who most need attention first. */
export function summarizeAll(data: AppData): StudentSummary[] {
  return data.students
    .map((s) => summarize(data, s))
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        b.late - a.late ||
        a.student.firstName.localeCompare(b.student.firstName),
    )
}

export const needsAttention = (s: StudentSummary) => s.status === 'behind' || s.status === 'slipping'
