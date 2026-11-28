// Every tool the assistant has. Reads use the counselor's own client
// (`ctx.user`), so row level security decides what comes back; a student's
// thread stays locked to that student; and what a tool returns is data for the
// model to report, never instructions for it to follow. A propose_* tool only
// ever makes a pending row for the counselor to decide: nothing here sends,
// saves a record, or writes a calendar.

import type Anthropic from '@anthropic-ai/sdk'
import { AddCollegePayload, ApplyTemplatePayload, ScheduleMeetingPayload, TaskChangePayload, slotWords, taskChangeWords } from '../../shared/agent.js'
import { classifyAttention, needsAttention } from '../../shared/attention.js'
import { CALENDAR_SCOPE } from '../../shared/calendar.js'
import { loadCaseload } from '../../shared/caseload.js'
import { PLACEHOLDERS, parseTemplateContent, planDates, planNeedsDate, type MessageContent, type TaskPlanContent } from '../../shared/templates.js'
import { inboxContents, inboxGroups } from '../../src/lib/inbox.js'
import { REPEAT_AFTER_DAYS, reminderQueue } from '../../src/lib/reminders.js'
import type { AppData } from '../../src/types.js'
import { readCalendar } from '../google/calendar.js'
import { googleAvailable, scopesOf } from '../google/connection.js'
import { channelsFor, pickSendable, transportCaps } from './channels.js'
import { prepareMeetingBrief } from './brief.js'
import { essayBrainstorm } from './essay.js'
import { insertProposal } from './proposals.js'
import { DRAFT_WORD_LIMIT, draftTooLong, signMessage } from './text.js'
import { readFailed, type AgentContext, type ToolResult } from './types.js'

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

const SOURCES = {
  type: 'array',
  items: {
    type: 'object',
    properties: { type: { type: 'string' }, id: { type: 'string' }, label: { type: 'string' } },
    required: ['type', 'label'],
  },
} as const

/** Anthropic tool definitions for the assistant loop. */
export const AGENT_TOOLS = [
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
    name: 'find_students',
    description: 'General thread only. Find students by name: matches first, last and local name. With no query, lists every active student. Returns id, name, class year and status. Always use this to turn a name into an id before any other tool; if two students match, ask the counselor which one.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'list_pending_review',
    description: 'What is waiting in the Inbox for the counselor to decide, for one student or the whole firm: assistant proposals, meeting drafts, report drafts, template message drafts, weekly text drafts, reminders set to "Ask me first", and files to file or check. The same list the Inbox shows.',
    input_schema: { type: 'object', properties: { studentId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'list_meetings',
    description: 'Meetings in a date range across the caseload (or for one student): status and whether notes are logged. In the general thread also lists active students with no meeting scheduled.',
    input_schema: {
      type: 'object',
      properties: { studentId: { type: 'string' }, from: { type: 'string', description: 'YYYY-MM-DD. Today when left out.' }, to: { type: 'string', description: 'YYYY-MM-DD. 14 days after `from` when left out.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_reminders_due',
    description: 'The reminder queue as the Messages screen works it out: each reminder due now with its rule, its mode (queued for the next daily send, or waiting for approval), the task and who it goes to; and which tasks already had a reminder go out in the last few days.',
    input_schema: { type: 'object', properties: { studentId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'list_files',
    description: 'A student’s stored files: title, folder, who added it, and the date; and the tasks that expect a document and have none. Titles and folders only. File contents are never returned.',
    input_schema: { type: 'object', properties: { studentId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'list_college_list',
    description: 'A student’s college list: each college with its plan, deadline, status and band, and its directory id when it has one.',
    input_schema: { type: 'object', properties: { studentId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'list_essays',
    description: 'A student’s essays: prompt, word limit, status, how many drafts are saved, and whether feedback is waiting for approval. Never the essay text.',
    input_schema: { type: 'object', properties: { studentId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'list_templates',
    description: 'The firm’s active templates by kind (task plan, message, handout), with what each needs filled in: the blanks in a message, or whether a plan counts back from a date.',
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['task_plan', 'message', 'handout'] } }, additionalProperties: false },
  },
  {
    name: 'list_calendar',
    description: 'The counselor’s own Google Calendar events in a date range, for finding a free time. Only when Calendar is connected: when it is not, the result says so, and you say so rather than guess.',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string', description: 'YYYY-MM-DD. Today when left out.' }, to: { type: 'string', description: 'YYYY-MM-DD. 7 days after `from` when left out.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'propose_message',
    description: `Draft a message for the Inbox. Never sends. Put the full message only in body. Keep body to ${DRAFT_WORD_LIMIT.text} words or fewer for a text, LINE or WeChat message, and ${DRAFT_WORD_LIMIT.email} or fewer for email (in Chinese, about twice that many characters); the server refuses a longer one. Do not write the message, a translation, or a summary in your reply. Channel is optional; omit it and the server picks a channel that can send. Call this once. If the record says no sendable channel, do not call this.`,
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
        taskId: { type: 'string', description: 'The task this message is about, when it is about one. The server refuses a second draft to the same person about the same task while one is waiting.' },
        rationale: { type: 'string' },
        sources: SOURCES,
      },
      required: ['recipient', 'language', 'body', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_parent_update',
    description: `Draft a parent update for the Inbox. Never sends. Put the full message only in body. Keep body to ${DRAFT_WORD_LIMIT.text} words or fewer for a text, LINE or WeChat message, and ${DRAFT_WORD_LIMIT.email} or fewer for email (in Chinese, about twice that many characters); the server refuses a longer one. Do not write a translation. Channel is optional; omit it and the server picks a channel that can send.`,
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        parentId: { type: 'string' },
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
      required: ['parentId', 'language', 'body', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_task',
    description: 'Draft a new task for the Inbox. Never writes the task list directly.',
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
    description: 'Draft a profile field change for the Inbox. Never edits the profile directly.',
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
    name: 'propose_schedule_meeting',
    description: 'Propose a meeting for the Inbox, with one to three times for the counselor to choose from. Never writes the calendar: approving the card schedules the one they pick. Use list_calendar and list_meetings first so the times are free. Dates are YYYY-MM-DD and times are 24-hour HH:MM in the counselor’s own clock.',
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        title: { type: 'string' },
        durationMin: { type: 'number', description: 'Length in minutes. 45 when left out.' },
        location: { type: 'string' },
        slots: {
          type: 'array',
          items: {
            type: 'object',
            properties: { date: { type: 'string' }, time: { type: 'string' }, reason: { type: 'string' } },
            required: ['date', 'time'],
          },
        },
        rationale: { type: 'string' },
        sources: SOURCES,
      },
      required: ['title', 'slots', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_apply_template',
    description: 'Propose using one of the firm’s templates on a student. templateId comes from list_templates. A task plan’s dates are worked out by the server and shown on the card; give `date` when the plan counts back from one. A message template makes a draft the counselor still approves. Never sends.',
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        templateId: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD. The date a plan counts back from, or the due date a message mentions.' },
        rationale: { type: 'string' },
        sources: SOURCES,
      },
      required: ['templateId', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_task_change',
    description: 'Propose a change to one existing task: a new title, owner or due date, or marking it done. taskId comes from list_tasks. Never edits the task directly.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        title: { type: 'string' },
        owner: { type: 'string', enum: ['student', 'parent', 'counselor'] },
        ownerParentId: { type: 'string' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
        markDone: { type: 'boolean' },
        rationale: { type: 'string' },
        sources: SOURCES,
      },
      required: ['taskId', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_add_college',
    description: 'Propose adding a college to a student’s list, by its id in the shared directory (unitid). The name and every figure come from the directory; never type a college’s figures yourself. Plan and deadline are optional.',
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        unitid: { type: 'number' },
        plan: { type: 'string', enum: ['ED', 'ED2', 'EA', 'REA', 'RD', 'Rolling', 'UC'] },
        deadline: { type: 'string', description: 'YYYY-MM-DD' },
        rationale: { type: 'string' },
        sources: SOURCES,
      },
      required: ['unitid', 'rationale'],
      additionalProperties: false,
    },
  },
  {
    name: 'prepare_meeting_brief',
    description: 'Prepare a pre-meeting brief. Call this alone, with the meeting id from the record. The tool result is the reply. Not a proposal.',
    input_schema: {
      type: 'object',
      properties: { meetingId: { type: 'string' } },
      required: ['meetingId'],
      additionalProperties: false,
    },
  },
  {
    name: 'essay_brainstorm',
    description: 'Brainstorm essay angles. Call this alone. The tool result is the reply. Never writes essay text. The tool adds activities, interests and majors from the record.',
    input_schema: {
      type: 'object',
      properties: { prompt: { type: 'string' }, notes: { type: 'string' } },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
] as unknown as Anthropic.Tool[]

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
      case 'find_students':
        return await findStudents(ctx, typeof input.query === 'string' ? input.query : '')
      case 'list_pending_review':
        return await listPendingReview(ctx, input.studentId as string | undefined)
      case 'list_meetings':
        return await listMeetings(ctx, input)
      case 'list_reminders_due':
        return await listRemindersDue(ctx, input.studentId as string | undefined)
      case 'list_files':
        return await listFiles(ctx, scopeStudent(ctx, input.studentId as string | undefined))
      case 'list_college_list':
        return await listCollegeList(ctx, scopeStudent(ctx, input.studentId as string | undefined))
      case 'list_essays':
        return await listEssays(ctx, scopeStudent(ctx, input.studentId as string | undefined))
      case 'list_templates':
        return await listTemplates(ctx, typeof input.kind === 'string' ? input.kind : undefined)
      case 'list_calendar':
        return await listCalendar(ctx, input)
      case 'propose_schedule_meeting':
        return await proposeScheduleMeeting(ctx, input)
      case 'propose_apply_template':
        return await proposeApplyTemplate(ctx, input)
      case 'propose_task_change':
        return await proposeTaskChange(ctx, input)
      case 'propose_add_college':
        return await proposeAddCollege(ctx, input)
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
  if (error) return readFailed('get_student', error)
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
  if (error) return readFailed('list_tasks', error)
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
  if (error) return readFailed('search_meetings', error)
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
  if (error) return readFailed('list_recent_messages', error)
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
  if (error) return readFailed('get_notes_to_remember', error)
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

interface RosterRow {
  id: string
  name: string
  localName: string | null
  gradYear: number
  status: ReturnType<typeof classifyAttention>
  lateTasks: number
  maxDaysLate: number
  lastMeeting: string | undefined
  daysSinceMeeting: number | null
}

/** Every active student of the firm with the same status the Students screen shows. */
async function roster(ctx: AgentContext): Promise<RosterRow[] | ToolResult> {
  const today = todayISO()
  const [students, tasks, meetings] = await Promise.all([
    ctx.user.from('students').select('id, first_name, last_name, local_name, grad_year, onboarded_on, archived').eq('firm_id', ctx.firmId),
    ctx.user.from('tasks').select('student_id, due_date, status').eq('firm_id', ctx.firmId),
    ctx.user.from('meetings').select('student_id, date, status').eq('firm_id', ctx.firmId).eq('status', 'completed'),
  ])
  if (students.error) return readFailed('roster', students.error)
  const active = (students.data ?? []).filter((s) => !s.archived)
  const byStudentTasks = new Map<string, { late: number; maxLate: number }>()
  for (const t of tasks.data ?? []) {
    if (t.status !== 'todo' && t.status !== 'in_progress') continue
    if (t.due_date >= today) continue
    const cur = byStudentTasks.get(t.student_id) ?? { late: 0, maxLate: 0 }
    const late = daysBetween(t.due_date, today)
    cur.late += 1
    cur.maxLate = Math.max(cur.maxLate, late)
    byStudentTasks.set(t.student_id, cur)
  }
  const lastMeeting = new Map<string, string>()
  for (const m of meetings.data ?? []) {
    const prev = lastMeeting.get(m.student_id)
    if (!prev || m.date > prev) lastMeeting.set(m.student_id, m.date)
  }
  return active.map((s) => {
    const t = byStudentTasks.get(s.id) ?? { late: 0, maxLate: 0 }
    const last = lastMeeting.get(s.id)
    return {
      id: s.id,
      name: `${s.first_name} ${s.last_name}`,
      localName: s.local_name,
      gradYear: s.grad_year,
      status: classifyAttention({
        lateCount: t.late,
        maxDaysLate: t.maxLate,
        daysSinceMeeting: last ? daysBetween(last, today) : undefined,
        daysSinceOnboarded: daysBetween(s.onboarded_on, today),
      }),
      lateTasks: t.late,
      maxDaysLate: t.maxLate,
      lastMeeting: last,
      daysSinceMeeting: last ? daysBetween(last, today) : null,
    }
  })
}

async function listNeedingAttention(ctx: AgentContext): Promise<ToolResult> {
  if (ctx.studentId) {
    return { ok: false, error: 'list_students_needing_attention is only for the general (roster) thread.' }
  }
  const rows = await roster(ctx)
  if (!Array.isArray(rows)) return rows
  return {
    ok: true,
    data: rows
      .filter((r) => needsAttention(r.status))
      .sort((a, b) => (a.status === 'behind' && b.status !== 'behind' ? -1 : b.status === 'behind' && a.status !== 'behind' ? 1 : b.lateTasks - a.lateTasks))
      .map(({ localName: _local, ...row }) => row),
  }
}

async function resolveStudentId(ctx: AgentContext, input: Record<string, unknown>): Promise<string | ToolResult> {
  // A student thread can only draft for that student. A wrong id must not burn another round.
  const id = ctx.studentId ?? scopeStudent(ctx, input.studentId as string | undefined)
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
  let preferred: string | undefined
  if (recipient.kind === 'parent' && recipient.parentId) {
    const { data: parent } = await ctx.user.from('parents').select('*').eq('id', recipient.parentId).maybeSingle()
    if (!parent || parent.student_id !== studentId) return { ok: false, error: 'Parent not found for this student.' }
    language = parent.language
    toName = parent.name
    preferred = parent.channel
    person = { email: parent.email, phone: parent.phone, lineId: parent.line_id }
  } else {
    const { data: student } = await ctx.user.from('students').select('email, phone').eq('id', studentId).maybeSingle()
    person = { email: student?.email ?? null, phone: student?.phone ?? null, lineId: null }
    toName = ctx.studentName ?? 'Student'
  }

  // A draft that is already waiting is said first: it is true whatever channel is connected.
  const taskId = typeof input.taskId === 'string' && UUID.test(input.taskId) ? input.taskId : undefined
  const waiting = await alreadyWaiting(ctx, studentId, toName, taskId)
  if (waiting) return { ok: false, error: waiting }

  const picked = await resolveChannel(ctx, person, input.channel ? String(input.channel) : undefined, preferred)
  if ('error' in picked) return { ok: false, error: picked.error }
  const channel = picked.channel
  const tooLong = draftTooLong(String(input.body ?? ''), channel)
  if (tooLong) return { ok: false, error: tooLong }

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
      ...(taskId ? { taskId } : {}),
    },
  })
  return {
    ok: true,
    data: {
      confirmation,
      language,
      channel,
      toName,
      reply: `Reply in one or two sentences: a ${language} ${channel} to ${toName}. End with "You can approve it below." Do not repeat the message or translate it.`,
    },
  }
}

async function proposeParentUpdate(ctx: AgentContext, input: Record<string, unknown>): Promise<ToolResult> {
  const studentId = await resolveStudentId(ctx, input)
  if (typeof studentId !== 'string') return studentId
  const parentId = String(input.parentId ?? '')
  const { data: parent } = await ctx.user.from('parents').select('*').eq('id', parentId).maybeSingle()
  if (!parent || parent.student_id !== studentId) return { ok: false, error: 'Parent not found for this student.' }
  const picked = await resolveChannel(
    ctx,
    { email: parent.email, phone: parent.phone, lineId: parent.line_id },
    input.channel ? String(input.channel) : undefined,
    parent.channel,
  )
  if ('error' in picked) return { ok: false, error: picked.error }
  const channel = picked.channel
  const tooLong = draftTooLong(String(input.body ?? ''), channel)
  if (tooLong) return { ok: false, error: tooLong }
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
    },
  })
  return {
    ok: true,
    data: {
      confirmation,
      language: parent.language,
      channel,
      toName: parent.name,
      reply: `Reply in one or two sentences: a ${parent.language} ${channel} to ${parent.name}. End with "You can approve it below." Do not repeat the message or translate it.`,
    },
  }
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

async function resolveChannel(
  ctx: AgentContext,
  person: { email: string | null; phone: string | null; lineId: string | null },
  requested: string | undefined,
  preferred: string | undefined,
): Promise<{ channel: string } | { error: string }> {
  const states = channelsFor(person, await transportCaps(ctx.firmId, ctx.counselorId))
  return pickSendable(states, preferred, requested)
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

// ── Reads for the areas of the app ──────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const clipLine = (text: string, max = 140) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/**
 * The firm's caseload in the shape the screens hold, read with the counselor's
 * own client and at most once a request. The Inbox and the reminder queue are
 * then worked out by the same functions the screens use (src/lib/inbox.ts,
 * src/lib/reminders.ts), not by a second copy here.
 */
function caseload(ctx: AgentContext): Promise<AppData> {
  ctx.caseload ??= loadCaseload(ctx.user, ctx.firmId, ctx.counselorId)
  return ctx.caseload
}

/**
 * The student a read may be about. In a student's thread it is always that
 * student, and asking for another is refused. In the general thread it is the
 * one asked for, or none (the whole firm).
 */
function lockedTo(ctx: AgentContext, asked: string | undefined): { studentId?: string } | ToolResult {
  if (ctx.studentId) {
    if (asked && asked !== ctx.studentId) return { ok: false, error: 'This thread is for another student. Ask only about this student, or switch to the general thread.' }
    return { studentId: ctx.studentId }
  }
  if (asked && !UUID.test(asked)) return { ok: false, error: 'studentId is not an id. Use find_students to get it from a name.' }
  return { studentId: asked }
}

async function findStudents(ctx: AgentContext, query: string): Promise<ToolResult> {
  if (ctx.studentId) return { ok: false, error: 'find_students is only for the general (roster) thread. This thread is about one student.' }
  const rows = await roster(ctx)
  if (!Array.isArray(rows)) return rows
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matched = rows.filter((r) => {
    const names = `${r.name} ${r.localName ?? ''}`.toLowerCase()
    return words.every((word) => names.includes(word))
  })
  return {
    ok: true,
    data: {
      matches: matched.slice(0, 50).map((r) => ({ id: r.id, name: r.name, localName: r.localName ?? undefined, gradYear: r.gradYear, status: r.status })),
      total: matched.length,
      note: matched.length === 0 ? 'No active student matches. Ask the counselor for the name.' : matched.length > 1 && words.length > 0 ? 'More than one student matches. Ask the counselor which one before going on.' : undefined,
    },
  }
}

/** One thing waiting in the Inbox, as a short row. `taskId` and `to` let a second draft about the same thing be noticed. */
interface PendingRow {
  key: string
  kind: string
  studentId?: string
  student?: string
  to?: string
  channel?: string
  taskId?: string
  line: string
}

function pendingRows(data: AppData, studentId?: string): PendingRow[] {
  const groups = inboxGroups(data, inboxContents(data, studentId))
  const name = new Map(data.students.map((s) => [s.id, `${s.firstName} ${s.lastName}`.trim()]))
  return groups.flatMap((group) =>
    group.rows.map((row): PendingRow => {
      const item = row.item
      const proposal = item?.proposalId ? data.agentProposals.find((p) => p.id === item.proposalId) : undefined
      // A reminder's key is "reminder:<rule>:<task>:<recipient>"; a proposal about a task carries the task's id.
      const taskId = item?.reminderKey ? item.reminderKey.split(':')[1] : typeof proposal?.payload.taskId === 'string' ? proposal.payload.taskId : undefined
      return { key: row.key, kind: row.pill, studentId: row.studentId, student: row.studentId ? name.get(row.studentId) : undefined, to: item?.toName, channel: item?.channel, taskId, line: clipLine(row.line) }
    }),
  )
}

async function listPendingReview(ctx: AgentContext, asked: string | undefined): Promise<ToolResult> {
  const scope = lockedTo(ctx, asked)
  if ('ok' in scope) return scope
  const rows = pendingRows(await caseload(ctx), scope.studentId)
  return { ok: true, data: { waiting: rows.slice(0, 80), total: rows.length } }
}

/**
 * The sentence to give instead of a second draft, when one to the same person
 * about the same task is already waiting. Only asked when the draft names its
 * task, so an ordinary draft does not pay for reading the whole Inbox.
 */
async function alreadyWaiting(ctx: AgentContext, studentId: string, toName: string, taskId: string | undefined): Promise<string | undefined> {
  if (!taskId) return undefined
  const same = pendingRows(await caseload(ctx), studentId).find((row) => row.taskId === taskId && row.to === toName)
  return same ? `A ${same.kind.toLowerCase()} to ${toName} about this task is already waiting in the Inbox (“${same.line}”). Do not draft another. Tell the counselor it is there.` : undefined
}

async function listMeetings(ctx: AgentContext, input: Record<string, unknown>): Promise<ToolResult> {
  const scope = lockedTo(ctx, input.studentId as string | undefined)
  if ('ok' in scope) return scope
  const today = todayISO()
  const from = typeof input.from === 'string' && ISO_DATE.test(input.from) ? input.from : today
  const to = typeof input.to === 'string' && ISO_DATE.test(input.to) ? input.to : addDays(from, 14)
  let q = ctx.user.from('meetings').select('id, student_id, title, date, time, duration_min, location, status, transcript, ai').eq('firm_id', ctx.firmId).gte('date', from).lte('date', to)
  if (scope.studentId) q = q.eq('student_id', scope.studentId)
  const [meetings, students, scheduled] = await Promise.all([
    q.order('date').limit(200),
    ctx.user.from('students').select('id, first_name, last_name, archived').eq('firm_id', ctx.firmId),
    ctx.user.from('meetings').select('student_id').eq('firm_id', ctx.firmId).eq('status', 'scheduled').gte('date', today),
  ])
  if (meetings.error) return readFailed('list_meetings', meetings.error)
  const active = (students.data ?? []).filter((s) => !s.archived)
  const name = new Map(active.map((s) => [s.id, `${s.first_name} ${s.last_name}`.trim()]))
  const hasOne = new Set((scheduled.data ?? []).map((m) => m.student_id))
  return {
    ok: true,
    data: {
      from,
      to,
      meetings: (meetings.data ?? [])
        .filter((m) => name.has(m.student_id))
        .map((m) => ({
          id: m.id,
          studentId: m.student_id,
          student: name.get(m.student_id),
          title: m.title,
          date: m.date,
          time: m.time,
          durationMin: m.duration_min,
          location: m.location ?? undefined,
          status: m.status,
          // Whether there is anything to work from, not what it says.
          notesLogged: Boolean(m.transcript?.trim()) || (Array.isArray((m.ai as { notes?: unknown[] } | null)?.notes) && ((m.ai as { notes: unknown[] }).notes.length > 0)),
        })),
      // Only the general thread looks across the caseload.
      studentsWithNoMeetingScheduled: ctx.studentId ? undefined : active.filter((s) => !hasOne.has(s.id) && (!scope.studentId || s.id === scope.studentId)).map((s) => ({ id: s.id, name: name.get(s.id) })),
    },
  }
}

const RULE_WORDS: Record<string, string> = {
  student_upcoming: 'to the student, before a task is due',
  student_late: 'to the student, a task is late',
  parent_upcoming: 'to a parent, before their own task is due',
  parent_late: 'to a parent, their own task is late',
  parent_escalation: 'to the primary parent, the student has fallen behind',
}

async function listRemindersDue(ctx: AgentContext, asked: string | undefined): Promise<ToolResult> {
  const scope = lockedTo(ctx, asked)
  if ('ok' in scope) return scope
  const data = await caseload(ctx)
  const mine = (studentId: string) => !scope.studentId || studentId === scope.studentId
  const name = new Map(data.students.map((s) => [s.id, `${s.firstName} ${s.lastName}`.trim()]))
  const today = todayISO()
  const due = reminderQueue(data)
    .filter((r) => mine(r.studentId))
    .map((r) => ({
      key: r.key,
      taskId: r.taskId,
      task: r.taskTitle,
      studentId: r.studentId,
      student: name.get(r.studentId),
      rule: RULE_WORDS[r.ruleId] ?? r.ruleId,
      // Nothing sends by itself: "automatic" means it goes with the next daily send, which a person starts.
      mode: r.mode === 'automatic' ? 'queued for the next daily send, which a person starts' : 'waiting for approval in the Inbox',
      to: r.message.toName,
      channel: r.message.channel,
    }))
  // The queue leaves out a reminder that went out in the last few days. These are those.
  const alreadySent = data.outbox
    .filter((m) => mine(m.studentId) && m.status !== 'cancelled' && m.taskId && daysBetween(m.sentAt.slice(0, 10), today) < REPEAT_AFTER_DAYS)
    .map((m) => ({ id: m.id, taskId: m.taskId, task: data.tasks.find((t) => t.id === m.taskId)?.title, studentId: m.studentId, student: name.get(m.studentId), to: m.toName, channel: m.channel, status: m.status, on: m.sentAt.slice(0, 10) }))
  return { ok: true, data: { due: due.slice(0, 80), alreadySent: alreadySent.slice(0, 40), repeatAfterDays: REPEAT_AFTER_DAYS } }
}

async function listFiles(ctx: AgentContext, studentId: string | undefined): Promise<ToolResult> {
  const bad = assertStudent(ctx, studentId)
  if (bad) return bad
  // Titles, folders and dates only. No column that holds a file's contents, its extracted text, or what a model said about it.
  const [files, folders, tasks, linked] = await Promise.all([
    ctx.user.from('documents').select('id, name, title, type_id, uploaded_by_kind, added_by, added_on, file_status, task_id').eq('firm_id', ctx.firmId).eq('student_id', studentId!).not('storage_path', 'is', null).order('added_on', { ascending: false }).limit(200),
    ctx.user.from('document_types').select('id, name').eq('firm_id', ctx.firmId),
    ctx.user.from('tasks').select('id, title, due_date, owner, status, expects_document, attachments').eq('firm_id', ctx.firmId).eq('student_id', studentId!),
    ctx.user.from('documents').select('task_id').eq('firm_id', ctx.firmId).eq('student_id', studentId!).not('task_id', 'is', null),
  ])
  if (files.error) return readFailed('list_files', files.error)
  const folder = new Map((folders.data ?? []).map((f) => [f.id, f.name]))
  const received = new Set((linked.data ?? []).map((d) => d.task_id))
  return {
    ok: true,
    data: {
      files: (files.data ?? []).map((d) => ({
        id: d.id,
        title: d.title ?? d.name,
        folder: d.type_id ? (folder.get(d.type_id) ?? 'A folder') : 'Not filed yet',
        addedBy: d.uploaded_by_kind === 'student_link' ? 'the student' : d.added_by,
        addedOn: d.added_on,
        waiting: d.file_status === 'filed' ? undefined : 'not filed yet',
      })),
      tasksMissingADocument: (tasks.data ?? [])
        .filter((t) => t.expects_document && (t.status === 'todo' || t.status === 'in_progress') && !received.has(t.id) && !(Array.isArray(t.attachments) && t.attachments.length > 0))
        .map((t) => ({ id: t.id, title: t.title, dueDate: t.due_date, owner: t.owner, expects: t.expects_document })),
    },
  }
}

async function listCollegeList(ctx: AgentContext, studentId: string | undefined): Promise<ToolResult> {
  const bad = assertStudent(ctx, studentId)
  if (bad) return bad
  const { data, error } = await ctx.user.from('colleges').select('id, name, plan, deadline, status, fit, directory_unitid').eq('firm_id', ctx.firmId).eq('student_id', studentId!).order('deadline')
  if (error) return readFailed('list_college_list', error)
  return { ok: true, data: (data ?? []).map((c) => ({ id: c.id, name: c.name, plan: c.plan ?? undefined, deadline: c.deadline ?? undefined, status: c.status, band: c.fit, unitid: c.directory_unitid ?? undefined })) }
}

async function listEssays(ctx: AgentContext, studentId: string | undefined): Promise<ToolResult> {
  const bad = assertStudent(ctx, studentId)
  if (bad) return bad
  // `drafts` holds the student's own writing. Only how many there are is read from it, and none of it is returned.
  const { data, error } = await ctx.user.from('documents').select('id, name, target, topic, essay_prompt, word_limit, status, drafts, feedback').eq('firm_id', ctx.firmId).eq('student_id', studentId!).eq('kind', 'essay').order('added_on', { ascending: false })
  if (error) return readFailed('list_essays', error)
  return {
    ok: true,
    data: (data ?? []).map((d) => {
      const review = (d.feedback as { review?: string } | null)?.review
      return {
        id: d.id,
        name: d.name,
        for: d.target ?? undefined,
        prompt: d.essay_prompt ? clipLine(d.essay_prompt, 300) : undefined,
        wordLimit: d.word_limit ?? undefined,
        status: d.status ?? undefined,
        draftsSaved: Array.isArray(d.drafts) ? d.drafts.length : 0,
        feedback: review === 'pending' ? 'waiting for the counselor’s approval' : review === 'approved' ? 'approved and shown to the student' : 'none yet',
      }
    }),
  }
}

async function listTemplates(ctx: AgentContext, kind: string | undefined): Promise<ToolResult> {
  const { data, error } = await ctx.user.from('templates').select('id, kind, name, content, archived').eq('firm_id', ctx.firmId).order('seq')
  if (error) return readFailed('list_templates', error)
  const label = new Map<string, string>(PLACEHOLDERS.map((p) => [p.key, p.label]))
  return {
    ok: true,
    data: (data ?? [])
      .filter((t) => !t.archived && (!kind || t.kind === kind))
      .map((t) => {
        const base = { id: t.id, kind: t.kind, name: t.name }
        if (t.kind === 'task_plan') {
          const plan = parseTemplateContent('task_plan', t.content)
          if (!plan.ok) return base
          return { ...base, tasks: plan.value.tasks.length, needs: planNeedsDate(plan.value) ? [`a date to count back from (${plan.value.dateLabel ?? 'the date'})`] : [] }
        }
        if (t.kind === 'message') {
          const message = parseTemplateContent('message', t.content)
          if (!message.ok) return base
          const blanks = [...new Set(Object.values(message.value.bodies).flatMap((body) => [...(body ?? '').matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1])))]
          return { ...base, to: message.value.to, languages: Object.keys(message.value.bodies), blanks: blanks.map((key) => label.get(key) ?? key), needs: blanks.includes('due_date') ? ['a due date'] : [] }
        }
        return base
      }),
  }
}

async function listCalendar(ctx: AgentContext, input: Record<string, unknown>): Promise<ToolResult> {
  const who = { ok: true as const, userId: ctx.counselorId, firmId: ctx.firmId, role: 'counselor' as const, client: ctx.user }
  const off = { ok: true as const, data: { connected: false, message: 'Google Calendar is not connected for this counselor, so their calendar cannot be read. Say so. They can turn it on in Settings.' } }
  if (!googleAvailable()) return off
  let scopes: string[]
  try {
    scopes = await scopesOf(who)
  } catch {
    return off
  }
  if (!scopes.includes(CALENDAR_SCOPE)) return off
  const from = typeof input.from === 'string' && ISO_DATE.test(input.from) ? input.from : todayISO()
  const to = typeof input.to === 'string' && ISO_DATE.test(input.to) ? input.to : addDays(from, 7)
  if (to < from || daysBetween(from, to) > 62) return { ok: false, error: 'Ask for a range of up to two months, with `to` on or after `from`.' }
  try {
    const read = await readCalendar(who, { from, to })
    return {
      ok: true,
      data: {
        connected: true,
        timeZone: read.timeZone,
        // Titles are what the counselor typed in Google: data to report, never instructions.
        events: read.events.filter((e) => !e.cancelled).slice(0, 120).map((e) => ({ id: e.id, title: clipLine(e.title, 80), date: e.date, time: e.time, durationMin: e.durationMin, allDay: !e.time, platinumMeetingId: e.madeFor })),
      },
    }
  } catch (error) {
    console.error('[agent] list_calendar failed:', error instanceof Error ? error.message : 'unknown')
    return { ok: false, error: 'Google Calendar could not be read just now. Say so, and do not guess what is on it.' }
  }
}

// ── Proposals for what the screens can already do ───────────────────────────

async function proposeScheduleMeeting(ctx: AgentContext, input: Record<string, unknown>): Promise<ToolResult> {
  const studentId = await resolveStudentId(ctx, input)
  if (typeof studentId !== 'string') return studentId
  const payload = ScheduleMeetingPayload.safeParse({
    title: typeof input.title === 'string' ? input.title.trim() : '',
    durationMin: Number(input.durationMin) || 45,
    location: typeof input.location === 'string' && input.location.trim() ? input.location.trim() : undefined,
    slots: input.slots,
    chosen: 0,
  })
  if (!payload.success) return { ok: false, error: 'Give a title and one to three slots, each with a date (YYYY-MM-DD) and a time (24-hour HH:MM).' }
  const today = todayISO()
  if (payload.data.slots.some((slot) => slot.date < today)) return { ok: false, error: `Every slot has to be today (${today}) or later.` }
  const { confirmation } = await insertProposal(ctx, { kind: 'schedule_meeting', studentId, rationale: String(input.rationale ?? ''), sources: sourcesOf(input), payload: payload.data })
  const n = payload.data.slots.length
  return {
    ok: true,
    data: {
      confirmation,
      slots: payload.data.slots.map(slotWords),
      say: n === 1 ? `I proposed “${payload.data.title}” for ${slotWords(payload.data.slots[0])}. Nothing is scheduled until you approve it below.` : `I proposed ${n} times for “${payload.data.title}”. Pick one and approve it below. Nothing is scheduled until you do.`,
    },
  }
}

async function proposeApplyTemplate(ctx: AgentContext, input: Record<string, unknown>): Promise<ToolResult> {
  const studentId = await resolveStudentId(ctx, input)
  if (typeof studentId !== 'string') return studentId
  const templateId = String(input.templateId ?? '')
  if (!UUID.test(templateId)) return { ok: false, error: 'templateId is not an id. Use list_templates to get it.' }
  const { data: template, error } = await ctx.user.from('templates').select('id, kind, name, content, archived').eq('id', templateId).eq('firm_id', ctx.firmId).maybeSingle()
  if (error) return readFailed('propose_apply_template', error)
  if (!template || template.archived) return { ok: false, error: 'That template was not found among the firm’s active templates.' }
  const date = typeof input.date === 'string' && ISO_DATE.test(input.date) ? input.date : undefined
  const common = { templateId: template.id, templateName: template.name }
  let payload: ApplyTemplatePayload
  let say: string
  if (template.kind === 'task_plan') {
    const plan = parseTemplateContent('task_plan', template.content)
    if (!plan.ok) return { ok: false, error: 'That template could not be read.' }
    const content: TaskPlanContent = plan.value
    if (planNeedsDate(content) && !date) return { ok: false, error: `This plan counts back from a date (${content.dateLabel ?? 'the date'}). Ask the counselor for it, then call again with \`date\`.` }
    // The dates are worked out here, by the same code the "From a template" window uses. The model types none of them.
    const tasks = planDates(content, todayISO(), date).flatMap((t) => (t.dueDate ? [{ title: t.title, owner: t.owner, dueDate: t.dueDate, detail: t.note }] : []))
    const checked = ApplyTemplatePayload.safeParse({ templateKind: 'task_plan', ...common, anchor: date, tasks })
    if (!checked.success) return { ok: false, error: 'That plan has no tasks that can be dated.' }
    payload = checked.data
    say = `I proposed the “${template.name}” plan: ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}, with the dates on the card below. Nothing is added until you approve it.`
  } else if (template.kind === 'message') {
    const message = parseTemplateContent('message', template.content)
    if (!message.ok) return { ok: false, error: 'That template could not be read.' }
    const content: MessageContent = message.value
    payload = { templateKind: 'message', ...common, to: content.to, dueDate: date }
    say = `I proposed the “${template.name}” message for the ${content.to}. Approving the card below puts its draft in the Inbox for you to read; nothing is sent by this.`
  } else {
    return { ok: false, error: 'Only a task plan or a message template can be proposed. A handout is given from the Templates screen.' }
  }
  const { confirmation } = await insertProposal(ctx, { kind: 'apply_template', studentId, rationale: String(input.rationale ?? ''), sources: sourcesOf(input), payload })
  return { ok: true, data: { confirmation, say } }
}

async function proposeTaskChange(ctx: AgentContext, input: Record<string, unknown>): Promise<ToolResult> {
  const taskId = String(input.taskId ?? '')
  if (!UUID.test(taskId)) return { ok: false, error: 'taskId is not an id. Use list_tasks to get it.' }
  const { data: task, error } = await ctx.user.from('tasks').select('id, student_id, title, owner, due_date, status').eq('id', taskId).eq('firm_id', ctx.firmId).maybeSingle()
  if (error) return readFailed('propose_task_change', error)
  if (!task) return { ok: false, error: 'That task was not found.' }
  // A student's thread can only change that student's tasks.
  const bad = assertStudent(ctx, task.student_id)
  if (bad) return bad
  const payload = TaskChangePayload.safeParse({
    taskId: task.id,
    before: { title: task.title, owner: task.owner, dueDate: task.due_date, status: task.status },
    patch: {
      title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : undefined,
      owner: typeof input.owner === 'string' ? input.owner : undefined,
      ownerParentId: typeof input.ownerParentId === 'string' ? input.ownerParentId : undefined,
      dueDate: typeof input.dueDate === 'string' ? input.dueDate : undefined,
    },
    markDone: input.markDone === true,
  })
  if (!payload.success) return { ok: false, error: 'A task change is a new title, an owner (student, parent or counselor), a due date (YYYY-MM-DD), or markDone.' }
  const words = taskChangeWords(payload.data)
  if (words.length === 0) return { ok: false, error: 'That would change nothing: the task already has that title, owner and due date.' }
  if (payload.data.patch.owner === 'parent' && !payload.data.patch.ownerParentId) return { ok: false, error: 'Giving a task to a parent needs ownerParentId: that parent’s id from the record.' }
  const { confirmation } = await insertProposal(ctx, { kind: 'task_change', studentId: task.student_id, rationale: String(input.rationale ?? ''), sources: sourcesOf(input), payload: payload.data })
  return { ok: true, data: { confirmation, say: `I proposed a change to “${task.title}”: ${words.join('; ')}. The card below shows before and after; nothing changes until you approve it.` } }
}

async function proposeAddCollege(ctx: AgentContext, input: Record<string, unknown>): Promise<ToolResult> {
  const studentId = await resolveStudentId(ctx, input)
  if (typeof studentId !== 'string') return studentId
  const unitid = Number(input.unitid)
  if (!Number.isInteger(unitid) || unitid <= 0) return { ok: false, error: 'unitid is the college’s id in the directory: a whole number.' }
  const [college, listed] = await Promise.all([
    ctx.user.from('college_directory').select('unitid, name').eq('unitid', unitid).maybeSingle(),
    ctx.user.from('colleges').select('id').eq('firm_id', ctx.firmId).eq('student_id', studentId).eq('directory_unitid', unitid).limit(1),
  ])
  if (college.error) return readFailed('propose_add_college', college.error)
  if (!college.data) return { ok: false, error: 'No college with that id is in the directory. Do not add one from memory.' }
  if ((listed.data ?? []).length > 0) return { ok: false, error: `${college.data.name} is already on this student’s list.` }
  // The name is the directory's. Nothing about the college is taken from the model.
  const payload = AddCollegePayload.safeParse({ unitid, name: college.data.name, plan: typeof input.plan === 'string' ? input.plan : undefined, deadline: typeof input.deadline === 'string' ? input.deadline : undefined })
  if (!payload.success) return { ok: false, error: 'The plan is one of ED, ED2, EA, REA, RD, Rolling or UC, and the deadline is a date (YYYY-MM-DD).' }
  const { confirmation } = await insertProposal(ctx, { kind: 'add_college', studentId, rationale: String(input.rationale ?? ''), sources: sourcesOf(input), payload: payload.data })
  return { ok: true, data: { confirmation, say: `I proposed adding ${college.data.name} to the college list. You can approve it below; its figures come from the directory.` } }
}
