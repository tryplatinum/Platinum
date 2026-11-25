import type Anthropic from '@anthropic-ai/sdk'
import { classifyAttention, needsAttention } from '../../shared/attention.js'
import { channelsFor, sendableNames, transportCaps } from './channels.js'
import { prepareMeetingBrief } from './brief.js'
import { essayBrainstorm } from './essay.js'
import { insertProposal } from './proposals.js'
import { signMessage } from './text.js'
import type { AgentContext, ToolResult } from './types.js'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

function assertStudent(ctx: AgentContext, studentId: string | undefined): ToolResult | null {
  if (!studentId) return { ok: false, error: 'studentId is required.' }
  if (ctx.studentId && studentId !== ctx.studentId) {
    return { ok: false, error: 'This thread is for another student. Ask only about this student, or switch to the general thread.' }
  }
  return null
}

const scopeStudent = (ctx: AgentContext, studentId?: string): string | undefined => studentId ?? ctx.studentId ?? undefined

/** Anthropic tool definitions for the assistant loop. */
export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_student',
    description: 'Load one student’s profile and parents (language and channel).',
    input_schema: {
      type: 'object',
      properties: { studentId: { type: 'string', description: 'Student uuid. Defaults to this thread’s student.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks for a student. Filter by open, overdue, and/or owner.',
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        openOnly: { type: 'boolean' },
        overdueOnly: { type: 'boolean' },
        owner: { type: 'string', enum: ['student', 'parent', 'counselor'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_deadlines',
    description: 'Upcoming task due dates and college application deadlines for a student.',
    input_schema: {
      type: 'object',
      properties: { studentId: { type: 'string' }, withinDays: { type: 'number' } },
      additionalProperties: false,
    },
  },
  {
    name: 'search_meetings',
    description: 'Search meeting notes, transcript and recap by keyword or date.',
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        keyword: { type: 'string' },
        onOrAfter: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        onOrBefore: { type: 'string', description: 'ISO date YYYY-MM-DD' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_recent_messages',
    description: 'Recent outbox rows for a student: status, kind, date.',
    input_schema: {
      type: 'object',
      properties: { studentId: { type: 'string' }, limit: { type: 'number' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_notes_to_remember',
    description: 'Things to remember (personal_notes) the counselor approved for this student.',
    input_schema: {
      type: 'object',
      properties: { studentId: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_students_needing_attention',
    description: 'Roster view only: students who are behind or slipping (overdue, stalled, no meeting in a while).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'propose_message',
    description: 'Draft a message for Approvals. Never sends. The loaded record already has the parents, which channels can send, and the overdue tasks. Put the full draft in this call. Do not look anything up first unless a fact is missing; if it is, gather every missing fact in one round, then call this. Language must match the parent record when writing to a parent. WeChat cannot send.',
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        recipient: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['student', 'parent'] },
            parentId: { type: 'string' },
          },
          required: ['kind'],
        },
        channel: { type: 'string', enum: ['email', 'wechat', 'line', 'text'] },
        language: { type: 'string', enum: ['en', 'zh-Hans', 'zh-Hant'] },
        body: { type: 'string' },
        rationale: { type: 'string' },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            properties: { type: { type: 'string' }, id: { type: 'string' }, label: { type: 'string' } },
            required: ['type', 'label'],
          },
        },
      },
      required: ['recipient', 'channel', 'language', 'body', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_parent_update',
    description: 'Draft a parent update for Approvals. Never sends. The loaded record already has the parent, language, and which channels can send. Put the full draft in this call. Do not look anything up first unless a fact is missing.',
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        parentId: { type: 'string' },
        channel: { type: 'string', enum: ['email', 'wechat', 'line', 'text'] },
        language: { type: 'string', enum: ['en', 'zh-Hans', 'zh-Hant'] },
        body: { type: 'string' },
        bodyEn: { type: 'string' },
        rationale: { type: 'string' },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            properties: { type: { type: 'string' }, id: { type: 'string' }, label: { type: 'string' } },
            required: ['type', 'label'],
          },
        },
      },
      required: ['parentId', 'channel', 'language', 'body', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_task',
    description: 'Draft a new task for Approvals. Never writes the task list directly.',
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        title: { type: 'string' },
        owner: { type: 'string', enum: ['student', 'parent', 'counselor'] },
        ownerParentId: { type: 'string' },
        dueDate: { type: 'string' },
        detail: { type: 'string' },
        rationale: { type: 'string' },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            properties: { type: { type: 'string' }, id: { type: 'string' }, label: { type: 'string' } },
            required: ['type', 'label'],
          },
        },
      },
      required: ['title', 'owner', 'dueDate', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_profile_change',
    description: 'Draft a profile field change for Approvals. Never edits the profile directly.',
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        field: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        patch: { type: 'object' },
        rationale: { type: 'string' },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            properties: { type: { type: 'string' }, id: { type: 'string' }, label: { type: 'string' } },
            required: ['type', 'label'],
          },
        },
      },
      required: ['field', 'from', 'to', 'patch', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_meeting_times',
    description: 'Propose 2 or 3 meeting time slots with reasons. Approving records the choice only; no calendar write.',
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        slots: {
          type: 'array',
          items: {
            type: 'object',
            properties: { when: { type: 'string' }, reason: { type: 'string' } },
            required: ['when', 'reason'],
          },
        },
        rationale: { type: 'string' },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            properties: { type: { type: 'string' }, id: { type: 'string' }, label: { type: 'string' } },
            required: ['type', 'label'],
          },
        },
      },
      required: ['slots', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'prepare_meeting_brief',
    description: 'Prepare a pre-meeting brief for an upcoming meeting. Returns information only; not a proposal.',
    input_schema: {
      type: 'object',
      properties: { meetingId: { type: 'string' } },
      required: ['meetingId'],
      additionalProperties: false,
    },
  },
  {
    name: 'essay_brainstorm',
    description: 'Brainstorm essay angles for the counselor. Never writes essay text. The tool adds the student record activities, interests and majors; do not say those are missing when they come back.',
    input_schema: {
      type: 'object',
      properties: { prompt: { type: 'string' }, notes: { type: 'string' } },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
]

type SourceIn = { type: string; id?: string; label: string }

export async function runTool(ctx: AgentContext, name: string, raw: unknown): Promise<ToolResult> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  try {
    switch (name) {
      case 'get_student':
        return await getStudent(ctx, scopeStudent(ctx, input.studentId as string | undefined))
      case 'list_tasks':
        return await listTasks(ctx, scopeStudent(ctx, input.studentId as string | undefined), input)
      case 'list_deadlines':
        return await listDeadlines(ctx, scopeStudent(ctx, input.studentId as string | undefined), Number(input.withinDays) || 45)
      case 'search_meetings':
        return await searchMeetings(ctx, scopeStudent(ctx, input.studentId as string | undefined), input)
      case 'list_recent_messages':
        return await listRecentMessages(ctx, scopeStudent(ctx, input.studentId as string | undefined), Number(input.limit) || 20)
      case 'get_notes_to_remember':
        return await getNotes(ctx, scopeStudent(ctx, input.studentId as string | undefined))
      case 'list_students_needing_attention':
        return await listNeedingAttention(ctx)
      case 'propose_message':
        return await proposeMessage(ctx, input)
      case 'propose_parent_update':
        return await proposeParentUpdate(ctx, input)
      case 'propose_task':
        return await proposeTask(ctx, input)
      case 'propose_profile_change':
        return await proposeProfile(ctx, input)
      case 'propose_meeting_times':
        return await proposeTimes(ctx, input)
      case 'prepare_meeting_brief':
        return await prepareMeetingBrief(ctx, String(input.meetingId ?? ''))
      case 'essay_brainstorm': {
        const record = ctx.studentId ? await essayRecord(ctx, ctx.studentId) : undefined
        const result = await essayBrainstorm({
          prompt: String(input.prompt ?? ''),
          notes: input.notes ? String(input.notes) : undefined,
          studentFirstName: ctx.studentName?.split(' ')[0],
          activities: record?.activities,
          interests: record?.interests,
          majors: record?.majors,
        })
        if (!result.ok || !record?.activities.length) return result
        const data = result.data && typeof result.data === 'object' ? { ...result.data, activitiesOnRecord: record.activities } : result.data
        return { ok: true, data }
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Tool failed.' }
  }
}

async function getStudent(ctx: AgentContext, studentId: string | undefined): Promise<ToolResult> {
  const bad = assertStudent(ctx, studentId)
  if (bad) return bad
  const [{ data: student, error }, { data: parents }] = await Promise.all([
    ctx.user.from('students').select('*').eq('id', studentId!).maybeSingle(),
    ctx.user.from('parents').select('*').eq('student_id', studentId!),
  ])
  if (error) return { ok: false, error: error.message }
  if (!student) return { ok: false, error: 'Student not found.' }
  return {
    ok: true,
    data: {
      id: student.id,
      firstName: student.first_name,
      lastName: student.last_name,
      localName: student.local_name,
      gradYear: student.grad_year,
      school: student.school,
      city: student.city,
      email: student.email,
      phone: student.phone,
      gpa: student.gpa,
      tests: student.tests,
      majors: stringList(student.majors),
      interests: stringList(student.interests),
      activities: activityRows(student.activities),
      counselorNotes: student.counselor_notes,
      onboardedOn: student.onboarded_on,
      parents: (parents ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        localName: p.local_name,
        relationship: p.relationship,
        language: p.language,
        channel: p.channel,
        isPrimary: p.is_primary,
        note: p.note,
      })),
    },
  }
}

async function listTasks(ctx: AgentContext, studentId: string | undefined, input: Record<string, unknown>): Promise<ToolResult> {
  const bad = assertStudent(ctx, studentId)
  if (bad) return bad
  const today = todayISO()
  let q = ctx.user.from('tasks').select('*').eq('student_id', studentId!)
  if (input.owner) q = q.eq('owner', String(input.owner))
  const { data, error } = await q.order('due_date')
  if (error) return { ok: false, error: error.message }
  let rows = data ?? []
  if (input.openOnly) rows = rows.filter((t) => t.status === 'todo' || t.status === 'in_progress')
  if (input.overdueOnly) rows = rows.filter((t) => (t.status === 'todo' || t.status === 'in_progress') && t.due_date < today)
  return {
    ok: true,
    data: rows.map((t) => ({
      id: t.id,
      title: t.title,
      detail: t.detail,
      category: t.category,
      owner: t.owner,
      ownerParentId: t.owner_parent_id,
      dueDate: t.due_date,
      status: t.status,
      daysLate: t.due_date < today && (t.status === 'todo' || t.status === 'in_progress') ? daysBetween(t.due_date, today) : 0,
      progressNote: t.progress_note,
    })),
  }
}

async function listDeadlines(ctx: AgentContext, studentId: string | undefined, withinDays: number): Promise<ToolResult> {
  const bad = assertStudent(ctx, studentId)
  if (bad) return bad
  const today = todayISO()
  const [{ data: tasks }, { data: colleges }] = await Promise.all([
    ctx.user.from('tasks').select('id, title, due_date, owner, status').eq('student_id', studentId!),
    ctx.user.from('colleges').select('id, name, deadline, status, plan').eq('student_id', studentId!),
  ])
  const horizon = (() => {
    const d = new Date(`${today}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + withinDays)
    return d.toISOString().slice(0, 10)
  })()
  const items = [
    ...(tasks ?? [])
      .filter((t) => (t.status === 'todo' || t.status === 'in_progress') && t.due_date >= today && t.due_date <= horizon)
      .map((t) => ({ kind: 'task' as const, id: t.id, label: t.title, date: t.due_date, owner: t.owner })),
    ...(colleges ?? [])
      .filter((c) => c.deadline && c.deadline >= today && c.deadline <= horizon)
      .map((c) => ({ kind: 'college' as const, id: c.id, label: `${c.name} application`, date: c.deadline!, status: c.status })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  return { ok: true, data: items }
}

async function searchMeetings(ctx: AgentContext, studentId: string | undefined, input: Record<string, unknown>): Promise<ToolResult> {
  const bad = assertStudent(ctx, studentId)
  if (bad) return bad
  let q = ctx.user.from('meetings').select('id, title, date, time, status, transcript, ai, recap, agenda').eq('student_id', studentId!)
  if (typeof input.onOrAfter === 'string') q = q.gte('date', input.onOrAfter)
  if (typeof input.onOrBefore === 'string') q = q.lte('date', input.onOrBefore)
  const { data, error } = await q.order('date', { ascending: false }).limit(40)
  if (error) return { ok: false, error: error.message }
  const keyword = typeof input.keyword === 'string' ? input.keyword.trim().toLowerCase() : ''
  const rows = (data ?? [])
    .map((m) => {
      const ai = m.ai as { notes?: string[]; decided?: string[]; progress?: string[]; watch?: string[] } | null
      const recap = m.recap as { summary?: string; nextSteps?: string[] } | null
      const blob = [
        m.title,
        m.transcript ?? '',
        ...(ai?.notes ?? []),
        ...(ai?.decided ?? []),
        ...(ai?.progress ?? []),
        ...(ai?.watch ?? []),
        recap?.summary ?? '',
        ...(recap?.nextSteps ?? []),
      ]
        .join('\n')
        .toLowerCase()
      return { meeting: m, ai, recap, blob }
    })
    .filter((row) => !keyword || row.blob.includes(keyword))
    .slice(0, 15)
    .map(({ meeting: m, ai, recap }) => ({
      id: m.id,
      title: m.title,
      date: m.date,
      status: m.status,
      transcriptExcerpt: (m.transcript ?? '').slice(0, 800) || undefined,
      notes: ai?.notes?.slice(0, 12),
      decided: ai?.decided,
      progress: ai?.progress,
      watch: ai?.watch,
      recap,
    }))
  return { ok: true, data: rows }
}

async function listRecentMessages(ctx: AgentContext, studentId: string | undefined, limit: number): Promise<ToolResult> {
  const bad = assertStudent(ctx, studentId)
  if (bad) return bad
  const { data, error } = await ctx.user
    .from('outbox')
    .select('id, kind, status, to_name, channel, language, sent_at, send_after, error, body')
    .eq('student_id', studentId!)
    .order('sent_at', { ascending: false })
    .limit(Math.min(50, Math.max(1, limit)))
  if (error) return { ok: false, error: error.message }
  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      toName: r.to_name,
      channel: r.channel,
      language: r.language,
      sentAt: r.sent_at,
      sendAfter: r.send_after,
      error: r.error,
      bodyPreview: String(r.body).slice(0, 160),
    })),
  }
}

async function getNotes(ctx: AgentContext, studentId: string | undefined): Promise<ToolResult> {
  const bad = assertStudent(ctx, studentId)
  if (bad) return bad
  const { data, error } = await ctx.user
    .from('personal_notes')
    .select('id, text, event_date, event_date_approx, uses, source, created_at')
    .eq('student_id', studentId!)
    .order('created_at', { ascending: true })
  if (error) return { ok: false, error: error.message }
  return {
    ok: true,
    data: (data ?? []).map((n) => ({
      id: n.id,
      text: n.text,
      eventDate: n.event_date,
      eventDateApprox: n.event_date_approx,
      uses: n.uses,
      source: n.source,
      createdAt: n.created_at,
    })),
  }
}

async function listNeedingAttention(ctx: AgentContext): Promise<ToolResult> {
  if (ctx.studentId) {
    return { ok: false, error: 'list_students_needing_attention is only for the general (roster) thread.' }
  }
  const today = todayISO()
  const [{ data: students }, { data: tasks }, { data: meetings }] = await Promise.all([
    ctx.user.from('students').select('id, first_name, last_name, grad_year, onboarded_on, archived').eq('firm_id', ctx.firmId),
    ctx.user.from('tasks').select('student_id, due_date, status'),
    ctx.user.from('meetings').select('student_id, date, status').eq('status', 'completed'),
  ])
  const active = (students ?? []).filter((s) => !s.archived)
  const byStudentTasks = new Map<string, { late: number; maxLate: number }>()
  for (const t of tasks ?? []) {
    if (t.status !== 'todo' && t.status !== 'in_progress') continue
    if (t.due_date >= today) continue
    const cur = byStudentTasks.get(t.student_id) ?? { late: 0, maxLate: 0 }
    const late = daysBetween(t.due_date, today)
    cur.late += 1
    cur.maxLate = Math.max(cur.maxLate, late)
    byStudentTasks.set(t.student_id, cur)
  }
  const lastMeeting = new Map<string, string>()
  for (const m of meetings ?? []) {
    const prev = lastMeeting.get(m.student_id)
    if (!prev || m.date > prev) lastMeeting.set(m.student_id, m.date)
  }
  const rows = active
    .map((s) => {
      const t = byStudentTasks.get(s.id) ?? { late: 0, maxLate: 0 }
      const last = lastMeeting.get(s.id)
      const status = classifyAttention({
        lateCount: t.late,
        maxDaysLate: t.maxLate,
        daysSinceMeeting: last ? daysBetween(last, today) : undefined,
        daysSinceOnboarded: daysBetween(s.onboarded_on, today),
      })
      return {
        id: s.id,
        name: `${s.first_name} ${s.last_name}`,
        gradYear: s.grad_year,
        status,
        lateTasks: t.late,
        maxDaysLate: t.maxLate,
        lastMeeting: last,
        daysSinceMeeting: last ? daysBetween(last, today) : null,
      }
    })
    .filter((r) => needsAttention(r.status))
    .sort((a, b) => (a.status === 'behind' && b.status !== 'behind' ? -1 : b.status === 'behind' && a.status !== 'behind' ? 1 : b.lateTasks - a.lateTasks))
  return { ok: true, data: rows }
}

async function resolveStudentId(ctx: AgentContext, input: Record<string, unknown>): Promise<string | ToolResult> {
  const id = scopeStudent(ctx, input.studentId as string | undefined)
  const bad = assertStudent(ctx, id)
  if (bad) return bad
  if (!id) return { ok: false, error: 'studentId is required in the general thread.' }
  return id
}

function sourcesOf(input: Record<string, unknown>): SourceIn[] {
  return Array.isArray(input.sources) ? (input.sources as SourceIn[]) : []
}

async function proposeMessage(ctx: AgentContext, input: Record<string, unknown>): Promise<ToolResult> {
  const studentId = await resolveStudentId(ctx, input)
  if (typeof studentId !== 'string') return studentId
  const recipient = input.recipient as { kind?: string; parentId?: string } | undefined
  if (!recipient?.kind) return { ok: false, error: 'recipient.kind is required.' }
  if (recipient.kind === 'parent' && !recipient.parentId) return { ok: false, error: 'parentId is required for a parent recipient.' }

  let language = String(input.language)
  let toName: string
  let person: { email: string | null; phone: string | null; lineId: string | null }
  if (recipient.kind === 'parent' && recipient.parentId) {
    const { data: parent } = await ctx.user.from('parents').select('*').eq('id', recipient.parentId).maybeSingle()
    if (!parent || parent.student_id !== studentId) return { ok: false, error: 'Parent not found for this student.' }
    language = parent.language
    toName = parent.name
    person = { email: parent.email, phone: parent.phone, lineId: parent.line_id }
  } else {
    const { data: student } = await ctx.user.from('students').select('email, phone').eq('id', studentId).maybeSingle()
    person = { email: student?.email ?? null, phone: student?.phone ?? null, lineId: null }
    toName = ctx.studentName ?? 'Student'
  }

  const channel = String(input.channel ?? '')
  const refused = await refuseUnsendable(ctx, person, channel)
  if (refused) return refused

  const { confirmation } = await insertProposal(ctx, {
    kind: 'message',
    studentId,
    rationale: String(input.rationale ?? ''),
    sources: sourcesOf(input),
    payload: {
      recipientKind: recipient.kind,
      parentId: recipient.parentId,
      toName,
      channel,
      language,
      body: signMessage(String(input.body ?? ''), ctx.counselorName, ctx.firmName),
      outboxKind: 'reminder_upcoming',
    },
  })
  return { ok: true, data: { confirmation, language, channel, toName } }
}

async function proposeParentUpdate(ctx: AgentContext, input: Record<string, unknown>): Promise<ToolResult> {
  const studentId = await resolveStudentId(ctx, input)
  if (typeof studentId !== 'string') return studentId
  const parentId = String(input.parentId ?? '')
  const { data: parent } = await ctx.user.from('parents').select('*').eq('id', parentId).maybeSingle()
  if (!parent || parent.student_id !== studentId) return { ok: false, error: 'Parent not found for this student.' }
  const channel = String(input.channel ?? parent.channel)
  const refused = await refuseUnsendable(ctx, { email: parent.email, phone: parent.phone, lineId: parent.line_id }, channel)
  if (refused) return refused
  const { confirmation } = await insertProposal(ctx, {
    kind: 'parent_update',
    studentId,
    rationale: String(input.rationale ?? ''),
    sources: sourcesOf(input),
    payload: {
      parentId,
      toName: parent.name,
      channel,
      language: parent.language,
      body: signMessage(String(input.body ?? ''), ctx.counselorName, ctx.firmName),
      bodyEn: input.bodyEn ? String(input.bodyEn) : undefined,
    },
  })
  return { ok: true, data: { confirmation } }
}

async function proposeTask(ctx: AgentContext, input: Record<string, unknown>): Promise<ToolResult> {
  const studentId = await resolveStudentId(ctx, input)
  if (typeof studentId !== 'string') return studentId
  const { confirmation } = await insertProposal(ctx, {
    kind: 'task',
    studentId,
    rationale: String(input.rationale ?? ''),
    sources: sourcesOf(input),
    payload: {
      title: String(input.title ?? ''),
      owner: String(input.owner ?? 'student'),
      ownerParentId: input.ownerParentId ? String(input.ownerParentId) : undefined,
      dueDate: String(input.dueDate ?? ''),
      detail: input.detail ? String(input.detail) : undefined,
      category: 'planning',
    },
  })
  return { ok: true, data: { confirmation } }
}

async function proposeProfile(ctx: AgentContext, input: Record<string, unknown>): Promise<ToolResult> {
  const studentId = await resolveStudentId(ctx, input)
  if (typeof studentId !== 'string') return studentId
  const { confirmation } = await insertProposal(ctx, {
    kind: 'profile_change',
    studentId,
    rationale: String(input.rationale ?? ''),
    sources: sourcesOf(input),
    payload: {
      field: String(input.field ?? ''),
      from: String(input.from ?? ''),
      to: String(input.to ?? ''),
      patch: input.patch,
    },
  })
  return { ok: true, data: { confirmation } }
}

async function proposeTimes(ctx: AgentContext, input: Record<string, unknown>): Promise<ToolResult> {
  const studentId = await resolveStudentId(ctx, input)
  if (typeof studentId !== 'string') return studentId
  const slots = Array.isArray(input.slots) ? input.slots : []
  if (slots.length < 2 || slots.length > 3) return { ok: false, error: 'Provide 2 or 3 meeting time slots.' }
  const { confirmation } = await insertProposal(ctx, {
    kind: 'meeting_times',
    studentId,
    rationale: String(input.rationale ?? ''),
    sources: sourcesOf(input),
    payload: { slots },
  })
  return { ok: true, data: { confirmation } }
}

async function refuseUnsendable(
  ctx: AgentContext,
  person: { email: string | null; phone: string | null; lineId: string | null },
  channel: string,
): Promise<ToolResult | undefined> {
  const states = channelsFor(person, await transportCaps(ctx.firmId, ctx.counselorId))
  const state = states.find((item) => item.channel === channel)
  if (state?.sendable) return undefined
  const can = sendableNames(states)
  return {
    ok: false,
    error: `${channel || 'That channel'} cannot send (${state?.why ?? 'unknown channel'}). Sendable channels: ${can.join(', ') || 'none'}. If none are sendable, tell the counselor and do not propose. Do not use WeChat.`,
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function activityRows(value: unknown): { name: string; role?: string; detail?: string }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as { name?: unknown; role?: unknown; detail?: unknown }
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (!name) return []
    return [{ name, role: typeof row.role === 'string' ? row.role : undefined, detail: typeof row.detail === 'string' ? row.detail : undefined }]
  })
}

async function essayRecord(ctx: AgentContext, studentId: string): Promise<{ activities: string[]; interests: string[]; majors: string[] } | undefined> {
  const { data } = await ctx.user.from('students').select('activities, interests, majors').eq('id', studentId).maybeSingle()
  if (!data) return undefined
  return {
    activities: activityRows(data.activities).map((row) => (row.role ? `${row.name} (${row.role})` : row.name)),
    interests: stringList(data.interests),
    majors: stringList(data.majors),
  }
}
