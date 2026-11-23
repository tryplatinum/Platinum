// The facts sent with each AI request, and the fact lines shown beside each
// draft. Everything here is computed by our own code from the data. The model
// is given these and writes around them; it never supplies them.
//
// Deliberately left out of every request: last names, email addresses, phone
// numbers and messaging handles. The model does not need them.

import type { StudentFacts } from '../../shared/contract'
import type { AppData, ID, Meeting, Student } from '../types'
import { addDays, daysBetween, formatDate, todayISO } from './dates'
import {
  classLabel,
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
} from './derive'
import { zhGiven } from './language'

const RECENT_DAYS = 21
const BRIEF_DEADLINE_WINDOW_DAYS = 14

/** One student's record, tasks and deadlines, in the shape the server expects. */
export function buildFacts(data: AppData, student: Student): StudentFacts {
  const today = todayISO()
  const tasks = tasksFor(data, student.id)
  const next = nextMeeting(data, student.id)
  const last = lastMeeting(data, student.id)
  return {
    today,
    counselorFirstName: data.firm.counselorFirstName,
    student: {
      firstName: student.firstName,
      localGivenName: student.localName ? zhGiven(student) : undefined,
      yearLabel: classLabel(student.gradYear),
      gradYear: student.gradYear,
      gpa: student.gpa,
      sat: student.tests.sat,
      act: student.tests.act,
      toefl: student.tests.toefl,
      majors: student.majors,
      interests: student.interests,
      activities: student.activities.map(({ name, role, detail }) => ({ name, role, detail })),
    },
    parents: student.parents.map(({ id, name, localName, relationship, language, channel }) => ({
      id,
      name,
      localName,
      relationship,
      language,
      channel,
    })),
    openTasks: tasks
      .filter(isOpen)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((t) => ({
        title: t.title,
        ownerType: t.owner,
        owner: ownerLabel(t, student),
        ownerParentId: t.ownerParentId,
        dueDate: t.dueDate,
        daysLate: daysLate(t, today),
        status: t.status === 'in_progress' ? ('in_progress' as const) : ('todo' as const),
        progressNote: t.progressNote,
      })),
    recentlyDone: tasks
      .filter((t) => t.status === 'done' && t.completedOn && daysBetween(t.completedOn, today) <= RECENT_DAYS)
      .map((t) => ({ title: t.title, completedOn: t.completedOn! })),
    colleges: data.colleges
      .filter((c) => c.studentId === student.id)
      .map((c) => ({ name: c.name, plan: c.plan, deadline: c.deadline, status: c.status, daysUntilDeadline: daysBetween(today, c.deadline) })),
    nextMeeting: next && { title: next.title, date: next.date },
    lastMeeting: last && { title: last.title, date: last.date },
  }
}

// ── Pre-meeting brief ───────────────────────────────────────────────────────

export interface BriefFacts {
  meeting: Meeting
  previous?: Meeting
  /** What changed since the previous meeting. */
  changes: string[]
  overdue: { id: ID; title: string; owner: string; ownerType: 'student' | 'parent' | 'counselor'; daysLate: number; progressNote?: string }[]
  deadlines: Deadline[]
  /** Drafts still waiting for the counselor's approval. */
  waitingOnCounselor: string[]
}

/** What changed, what is overdue and which deadlines are close, for one upcoming meeting. */
export function briefFacts(data: AppData, meeting: Meeting, student: Student): BriefFacts {
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
    .map((t) => ({
      id: t.id,
      title: t.title,
      owner: ownerLabel(t, student),
      ownerType: t.owner,
      daysLate: daysLate(t, today),
      progressNote: t.progressNote,
    }))

  const deadlines = deadlinesFor(data, student.id).filter(
    (d) => d.date >= today && daysBetween(today, d.date) <= BRIEF_DEADLINE_WINDOW_DAYS,
  )

  const waitingOnCounselor = pendingApprovals(data, student.id).map(
    (a) => `${a.label} (${a.count} ${a.count === 1 ? 'item' : 'items'})`,
  )

  return { meeting, previous, changes, overdue, deadlines, waitingOnCounselor }
}

// ── Parent report ───────────────────────────────────────────────────────────

/**
 * The complete list of things a progress report to this parent may say. Sent
 * to the model and shown to the counselor beside the draft, so they can check
 * the draft against it.
 */
export function reportFacts(data: AppData, student: Student, parentId: ID): string[] {
  const today = todayISO()
  const tasks = tasksFor(data, student.id)
  const facts: string[] = []

  for (const t of tasks) {
    if (t.status === 'done' && t.completedOn && daysBetween(t.completedOn, today) <= RECENT_DAYS) {
      facts.push(`Finished on ${formatDate(t.completedOn)}: ${t.title}`)
    }
  }
  for (const t of tasks.filter((x) => isOpen(x) && x.owner === 'student').sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    const late = daysLate(t, today)
    facts.push(
      late > 0
        ? `Overdue by ${late} ${late === 1 ? 'day' : 'days'} (was due ${formatDate(t.dueDate)}): ${t.title}`
        : `In progress, due ${formatDate(t.dueDate)}: ${t.title}`,
    )
  }
  for (const t of tasks.filter((x) => isOpen(x) && x.owner === 'parent' && x.ownerParentId === parentId)) {
    const late = daysLate(t, today)
    facts.push(
      `Needed from this parent, ${late > 0 ? `overdue by ${late} ${late === 1 ? 'day' : 'days'} (was due ${formatDate(t.dueDate)})` : `by ${formatDate(t.dueDate)}`}: ${t.title}`,
    )
  }
  for (const c of data.colleges.filter((x) => x.studentId === student.id).sort((a, b) => a.deadline.localeCompare(b.deadline))) {
    if (c.status === 'in_progress') facts.push(`Application in progress: ${c.name} (${c.plan}), deadline ${formatDate(c.deadline)}`)
    else if (c.status === 'submitted') facts.push(`Application submitted: ${c.name} (${c.plan})`)
    else if (c.status !== 'considering') facts.push(`Decision from ${c.name} (${c.plan}): ${c.status}`)
  }
  const next = nextMeeting(data, student.id)
  facts.push(next ? `Next meeting: ${formatDate(next.date)}` : 'No next meeting is scheduled yet')
  return facts
}
