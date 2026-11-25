// Pre-meeting brief for the assistant tool. Reuses the same Claude feature as
// the meeting screen; facts are assembled here from live firm rows.

import type { StudentFacts } from '../../shared/contract.js'
import { fastModelName, runFeature } from '../claude.js'
import type { AgentContext, ToolResult } from './types.js'

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b) - Date.parse(a)
  return Math.round(ms / 86_400_000)
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Builds and returns a pre-meeting brief for the conversation (not a proposal). */
export async function prepareMeetingBrief(ctx: AgentContext, meetingId: string): Promise<ToolResult> {
  const { data: meeting, error } = await ctx.user.from('meetings').select('*').eq('id', meetingId).maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!meeting) return { ok: false, error: 'Meeting not found.' }
  if (ctx.studentId && meeting.student_id !== ctx.studentId) {
    return { ok: false, error: 'That meeting belongs to another student. Stay in this student’s thread.' }
  }

  const studentId = meeting.student_id as string
  const [{ data: student }, { data: parents }, { data: tasks }, { data: colleges }, { data: pastMeetings }] = await Promise.all([
    ctx.user.from('students').select('*').eq('id', studentId).maybeSingle(),
    ctx.user.from('parents').select('*').eq('student_id', studentId),
    ctx.user.from('tasks').select('*').eq('student_id', studentId),
    ctx.user.from('colleges').select('*').eq('student_id', studentId),
    ctx.user
      .from('meetings')
      .select('id, date, title, recap, status')
      .eq('student_id', studentId)
      .eq('status', 'completed')
      .order('date', { ascending: false })
      .limit(5),
  ])
  if (!student) return { ok: false, error: 'Student not found.' }

  const today = todayISO()
  const previous = (pastMeetings ?? []).find((m) => m.id !== meeting.id && m.date < meeting.date)
  const since = (previous?.date as string | undefined) ?? addDays(today, -30)
  const open = (tasks ?? []).filter((t) => t.status === 'todo' || t.status === 'in_progress')
  const tests = (student.tests as { sat?: number; act?: number; toefl?: number } | null) ?? {}
  const activities = ((student.activities as { name: string; role: string; detail?: string }[] | null) ?? []).map((a) => ({
    name: a.name,
    role: a.role,
    detail: a.detail,
  }))

  const facts: StudentFacts = {
    today,
    counselorFirstName: ctx.counselorFirstName,
    student: {
      firstName: student.first_name,
      yearLabel: `Class of ${student.grad_year}`,
      gradYear: student.grad_year,
      gpa: student.gpa ?? 0,
      sat: tests.sat,
      act: tests.act,
      toefl: tests.toefl,
      majors: (student.majors as string[] | null) ?? [],
      interests: (student.interests as string[] | null) ?? [],
      activities,
    },
    parents: (parents ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      localName: p.local_name ?? undefined,
      relationship: (['Mother', 'Father', 'Guardian'].includes(p.relationship) ? p.relationship : 'Guardian') as StudentFacts['parents'][number]['relationship'],
      language: p.language as StudentFacts['parents'][number]['language'],
      channel: p.channel as StudentFacts['parents'][number]['channel'],
    })),
    openTasks: open.map((t) => ({
      title: t.title,
      ownerType: t.owner as 'student' | 'parent' | 'counselor',
      owner: t.owner,
      ownerParentId: t.owner_parent_id ?? undefined,
      dueDate: t.due_date,
      daysLate: t.due_date < today ? Math.max(0, daysBetween(t.due_date, today)) : 0,
      status: t.status === 'in_progress' ? ('in_progress' as const) : ('todo' as const),
      progressNote: t.progress_note ?? undefined,
    })),
    recentlyDone: (tasks ?? [])
      .filter((t) => t.status === 'done' && t.completed_on && daysBetween(t.completed_on, today) <= 30)
      .map((t) => ({ title: t.title, completedOn: t.completed_on! })),
    colleges: (colleges ?? [])
      .filter((c) => c.plan && c.deadline)
      .map((c) => ({
        name: c.name,
        plan: String(c.plan),
        deadline: c.deadline!,
        status: c.status,
        daysUntilDeadline: daysBetween(today, c.deadline!),
      })),
    nextMeeting: { title: meeting.title, date: meeting.date },
    lastMeeting: previous ? { title: previous.title, date: previous.date } : undefined,
  }

  const overdue = open
    .filter((t) => t.due_date < today)
    .map((t) => `${t.title} — owner: ${t.owner}; ${daysBetween(t.due_date, today)} days late`)
  const deadlines = [
    ...open.filter((t) => t.due_date >= today && daysBetween(today, t.due_date) <= 14).map((t) => `${t.title} — due ${t.due_date}`),
    ...(colleges ?? [])
      .filter((c) => c.deadline && c.deadline >= today && daysBetween(today, c.deadline) <= 14)
      .map((c) => `${c.name} application — due ${c.deadline}`),
  ]
  const changes: string[] = []
  for (const t of tasks ?? []) {
    if (t.status === 'done' && t.completed_on && t.completed_on >= since) changes.push(`Completed: ${t.title}`)
    if ((t.status === 'todo' || t.status === 'in_progress') && t.created_on >= since) changes.push(`New task for ${t.owner}: ${t.title}`)
  }

  const lastRecap = previous?.recap as { summary?: string; nextSteps?: string[] } | null
  const lastRecapText = lastRecap?.summary
    ? [lastRecap.summary, ...(lastRecap.nextSteps ?? [])].filter(Boolean).join('\n')
    : undefined

  try {
    const { draft, model } = await runFeature(
      'preMeetingBrief',
      {
        facts,
        meeting: { title: meeting.title, date: meeting.date },
        computed: {
          changesSinceLastMeeting: changes,
          overdue,
          deadlinesNext14Days: deadlines,
          waitingOnCounselor: [],
        },
        counselorNotes: student.counselor_notes || undefined,
        lastRecap: lastRecapText,
      },
      { maxTokens: 4_000, model: fastModelName() || undefined },
    )
    return {
      ok: true,
      data: {
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        meetingDate: meeting.date,
        model,
        brief: draft,
      },
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not prepare the brief.' }
  }
}
