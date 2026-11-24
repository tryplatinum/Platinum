// Everything the student link can read and change. There is no signed-in
// person on this path, so it uses the service role, which bypasses row level
// security. That makes this file the security boundary for students:
//
//   * every query is filtered by the link's firm AND student,
//   * the page is built field by field from an allow-list (no parent details,
//     no counselor notes, no drafts, no transcripts, no other students),
//   * the only write is the database function student_link_write, which
//     touches one task the student owns and records it as done by the student.

import { createHash, randomUUID } from 'node:crypto'
import type { StudentWrite } from '../shared/student.js'
import type { AppData, Attachment, CollegeApp, EssayFeedback, Meeting, Recap, StudentDocument, Task } from '../src/types.js'
import { serviceClient } from './supabase.js'

export interface Link {
  firmId: string
  studentId: string
}

/** Thrown for anything the student should simply be told did not work. */
export class StudentLinkError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

const pad = (value: number) => String(value).padStart(2, '0')
const isoDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const daysFromNow = (days: number) => isoDate(new Date(Date.now() + days * 86_400_000))

/** SHA-256 of the link token. The raw token is never written down. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** The student a token opens, or undefined when it is unknown or revoked. Lookup is by hash only. */
export async function findLink(token: string): Promise<Link | undefined> {
  const { data, error } = await serviceClient().from('student_links').select('firm_id, student_id').eq('token_hash', hashToken(token)).is('revoked_at', null).maybeSingle()
  if (error) throw new Error(`student link lookup failed: ${error.message}`)
  return data ? { firmId: data.firm_id, studentId: data.student_id } : undefined
}

/** Done tasks stay on the page this long. */
const RECENT_DAYS = 30

/**
 * The student's page, in the shape the app's store holds, so the same phone
 * view renders it. Lists a student never sees are empty.
 */
export async function studentPage(link: Link): Promise<AppData> {
  const db = serviceClient()
  const mine = <Q extends { eq: (column: string, value: string) => Q }>(query: Q) => query.eq('firm_id', link.firmId).eq('student_id', link.studentId)

  const [firm, owner, student, tasks, upcoming, recapped, colleges, essays] = await Promise.all([
    db.from('firms').select('name').eq('id', link.firmId).single(),
    db.from('firm_members').select('display_name').eq('firm_id', link.firmId).eq('role', 'owner').order('created_at').limit(1).maybeSingle(),
    db.from('students').select('id, first_name, grad_year, onboarded_on').eq('firm_id', link.firmId).eq('id', link.studentId).single(),
    mine(db.from('tasks').select('id, title, detail, category, owner, due_date, status, progress_note, completed_on, completed_by, created_on, attachments'))
      .or(`status.neq.done,completed_on.gte.${daysFromNow(-RECENT_DAYS)}`)
      .order('seq'),
    // From yesterday (UTC), so a meeting later today is included in every time zone.
    mine(db.from('meetings').select('id, title, date, time, duration_min, location')).eq('status', 'scheduled').gte('date', daysFromNow(-1)).order('date').order('time').limit(5),
    mine(db.from('meetings').select('id, title, date, time, duration_min, recap')).eq('status', 'completed').eq('recap->>review', 'approved').order('date', { ascending: false }).limit(1),
    mine(db.from('colleges').select('id, name, plan, deadline, status, fit')).order('seq'),
    mine(db.from('documents').select('id, name, category, added_on, feedback')).eq('kind', 'essay').eq('feedback->>review', 'approved').order('seq', { ascending: false }),
  ])
  for (const result of [firm, owner, student, tasks, upcoming, recapped, colleges, essays]) {
    if (result.error) throw new Error(`student page query failed: ${result.error.message}`)
  }

  const counselor = owner.data?.display_name ?? 'Your counselor'
  const s = student.data!

  const taskList: Task[] = tasks.data!.map((t) => {
    const own = t.owner === 'student'
    return {
      id: t.id,
      studentId: s.id,
      title: t.title,
      // Notes and attachments on other people's tasks are not the student's to read.
      detail: own ? (t.detail ?? undefined) : undefined,
      category: t.category as Task['category'],
      owner: t.owner as Task['owner'],
      dueDate: t.due_date,
      status: t.status as Task['status'],
      progressNote: own ? (t.progress_note ?? undefined) : undefined,
      completedOn: t.completed_on ?? undefined,
      completedBy: (t.completed_by ?? undefined) as Task['completedBy'],
      createdOn: t.created_on,
      source: 'counselor',
      attachments: own ? ((t.attachments ?? []) as unknown as Attachment[]) : [],
    }
  })

  const meetings: Meeting[] = [
    ...upcoming.data!.map((m): Meeting => ({ id: m.id, studentId: s.id, title: m.title, date: m.date, time: m.time, durationMin: m.duration_min, location: m.location ?? undefined, status: 'scheduled' })),
    ...recapped.data!.map((m): Meeting => {
      const recap = m.recap as unknown as Recap
      return {
        id: m.id,
        studentId: s.id,
        title: m.title,
        date: m.date,
        time: m.time,
        durationMin: m.duration_min,
        status: 'completed',
        recap: { summary: recap.summary, nextSteps: recap.nextSteps ?? [], review: 'approved' },
      }
    }),
  ]

  const documents: StudentDocument[] = essays.data!.map((d) => {
    const f = d.feedback as unknown as EssayFeedback
    return {
      id: d.id,
      studentId: s.id,
      name: d.name,
      kind: 'essay',
      category: d.category as StudentDocument['category'],
      addedOn: d.added_on,
      addedBy: 'counselor',
      feedback: { overall: f.overall, strengths: f.strengths ?? [], points: f.points ?? [], review: 'approved', generatedOn: f.generatedOn, source: f.source },
    }
  })

  return {
    firm: { name: firm.data!.name, weeklyTextDay: 0, counselorName: counselor, counselorFirstName: counselor.trim().split(/\s+/)[0] || 'Your counselor' },
    students: [
      {
        id: s.id,
        firstName: s.first_name,
        lastName: '',
        gradYear: s.grad_year,
        school: '',
        city: '',
        tests: { aps: [] },
        majors: [],
        interests: [],
        activities: [],
        counselorNotes: '',
        onboardedOn: s.onboarded_on,
        parents: [],
        reportSettings: { schedule: 'manual', recipientIds: [] },
      },
    ],
    tasks: taskList,
    meetings,
    colleges: colleges.data!.map(
      (c): CollegeApp => ({ id: c.id, studentId: s.id, name: c.name, plan: c.plan as CollegeApp['plan'], deadline: c.deadline, status: c.status as CollegeApp['status'], fit: c.fit as CollegeApp['fit'] }),
    ),
    documents,
    reports: [],
    outbox: [],
    reminderRules: [],
    activity: [],
    weeklyTexts: [],
    // Things to remember are the counselor's. No query in this file reads personal_notes.
    personalNotes: [],
  }
}

/** The category an attached link is filed under. Mirrors attachToTask in src/store/store.ts. */
function categoryFor(task: { expects_document: string | null; category: string }): string {
  if (task.expects_document) return task.expects_document
  return task.category === 'financial' || task.category === 'testing' || task.category === 'recommendation' ? task.category : 'application'
}

/** One of the three writes, checked against the link's student. Mirrors the store's actions for actor 'student'. */
export async function studentWrite(link: Link, write: StudentWrite): Promise<void> {
  const db = serviceClient()
  const [task, student] = await Promise.all([
    db
      .from('tasks')
      .select('id, title, status, category, completed_on, completed_by, expects_document, attachments')
      .eq('id', write.taskId)
      .eq('firm_id', link.firmId)
      .eq('student_id', link.studentId)
      .eq('owner', 'student')
      .maybeSingle(),
    db.from('students').select('first_name').eq('firm_id', link.firmId).eq('id', link.studentId).single(),
  ])
  if (task.error || student.error) throw new Error(`student write lookup failed: ${(task.error ?? student.error)!.message}`)
  if (!task.data) throw new StudentLinkError('That task is not on your list any more. Refresh the page.', 404)

  const t = task.data
  const who = student.data.first_name
  // The student's own calendar date, as long as it is plausible.
  const today = [daysFromNow(-1), daysFromNow(0), daysFromNow(1)].includes(write.today) ? write.today : daysFromNow(0)

  let patch: Record<string, unknown>
  let activity: string
  let document: Record<string, unknown> | null = null

  if (write.action === 'progress') {
    const status = write.status ?? t.status
    const done = status === 'done'
    patch = { status, completed_on: done ? (t.completed_on ?? today) : null, completed_by: done ? (t.completed_by ?? 'student') : null }
    if (write.progressNote !== undefined) patch.progress_note = write.progressNote
    activity = `${who} updated “${t.title}”`
    if (status !== t.status) {
      activity = done ? `${who} marked “${t.title}” done` : status === 'in_progress' ? `${who} started “${t.title}”` : `${who} reopened “${t.title}”`
    } else if (write.progressNote) {
      activity += `: ${write.progressNote}`
    }
  } else {
    const attachments = [...((t.attachments ?? []) as unknown as Attachment[]), { id: randomUUID(), kind: 'link', name: write.name, url: write.url, addedOn: today, addedBy: 'student' } satisfies Attachment]
    patch = { status: t.status === 'todo' ? 'in_progress' : t.status, attachments }
    activity = `${who} linked “${write.name}” on “${t.title}”`
    document = { name: write.name, url: write.url, category: categoryFor(t) }
  }

  const { error } = await db.rpc('student_link_write', {
    p_firm: link.firmId,
    p_student: link.studentId,
    p_task: t.id,
    p_patch: patch as never,
    p_activity: activity,
    p_document: document as never,
  })
  if (error) throw new Error(`student write failed: ${error.message}`)
}
