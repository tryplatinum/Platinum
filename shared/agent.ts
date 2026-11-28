// Contracts for the counselor-facing assistant (POST /api/agent) and for the
// structured essay-brainstorm tool. Browser and server both import these.

import { z } from 'zod'

/**
 * What the assistant can propose. `meeting_times` is no longer made (a
 * `schedule_meeting` proposal replaced it) but older rows of that kind are
 * still read and shown.
 */
export const AGENT_PROPOSAL_KINDS = ['message', 'parent_update', 'task', 'profile_change', 'meeting_times', 'schedule_meeting', 'apply_template', 'task_change', 'add_college'] as const
export type AgentProposalKind = (typeof AGENT_PROPOSAL_KINDS)[number]

export const AGENT_PROPOSAL_STATUSES = ['pending', 'approved', 'discarded'] as const
export type AgentProposalStatus = (typeof AGENT_PROPOSAL_STATUSES)[number]

const shortLine = z.string().max(140)

/** Essay brainstorming only — never a free-form draft of the essay itself. */
export const EssayBrainstormSchema = z.object({
  questions_to_ask: z.array(shortLine).max(5),
  angles_to_explore: z.array(shortLine).max(5),
  gaps_in_story: z.array(shortLine).max(5),
  materials_to_gather: z.array(shortLine).max(5),
})
export type EssayBrainstorm = z.infer<typeof EssayBrainstormSchema>

/** The places in the app the assistant can be told the counselor is. Nothing else is accepted from the browser. */
export const AGENT_ROUTES = ['today', 'inbox', 'students', 'student', 'meetings', 'messages', 'documents', 'templates', 'settings', 'firm'] as const
export type AgentRoute = (typeof AGENT_ROUTES)[number]

/**
 * Where the counselor is when they ask. `route` is one of a fixed list.
 * `itemKind` and `itemId` name what is open (on the Inbox, the row in `?item=`).
 * The server looks the item up as the counselor and drops it if it is not
 * theirs to see: no text from the browser reaches the prompt.
 */
export const AgentPageSchema = z.object({
  route: z.enum(AGENT_ROUTES),
  itemKind: z.string().regex(/^[a-z_]{1,24}$/).optional(),
  itemId: z.string().max(200).optional(),
})
export type AgentPage = z.infer<typeof AgentPageSchema>

/** The route for an address in the app, or undefined when the assistant is not told where it is. */
export function agentRouteFor(pathname: string): AgentRoute | undefined {
  if (pathname === '/app' || pathname === '/app/') return 'inbox'
  const [, , area, id] = pathname.split('/')
  if (area === 'students') return id ? 'student' : 'students'
  return (AGENT_ROUTES as readonly string[]).includes(area ?? '') ? (area as AgentRoute) : undefined
}

/**
 * What an Inbox row's key (`?item=` in the address) names, as a kind from a
 * fixed list and the id of one record. Undefined for a key that names nothing
 * the server can look up.
 */
export function agentItemFor(key: string): Pick<AgentPage, 'itemKind' | 'itemId'> | undefined {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const [head, ...rest] = key.split(':')
  const named: Record<string, string> = { agent: 'proposal', report: 'report', essay: 'essay', draft: 'message_draft', file: 'file', list: 'college_list', weekly: 'weekly_text', 'weekly-parent': 'weekly_text' }
  if (named[head] && uuid.test(rest[0] ?? '')) return { itemKind: named[head], itemId: rest[0] }
  // "reminder:<rule>:<task id>:<recipient>": the task is the record.
  if (head === 'reminder' && uuid.test(rest[1] ?? '')) return { itemKind: 'reminder', itemId: rest[1] }
  // "<meeting id>:notes", "<meeting id>:task:<draft>": a draft from a meeting.
  if (uuid.test(head) && rest.length > 0) return { itemKind: 'meeting_draft', itemId: head }
  return undefined
}

export const AgentRequestSchema = z.object({
  studentId: z.string().uuid().nullable(),
  message: z.string().min(1).max(8_000),
  /** Panel poll key. Optional so older clients still work. */
  requestId: z.string().uuid().optional(),
  page: AgentPageSchema.optional(),
})
export type AgentRequest = z.infer<typeof AgentRequestSchema>

export const AgentProposalSourceSchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  label: z.string(),
})
export type AgentProposalSource = z.infer<typeof AgentProposalSourceSchema>

/**
 * A record a tool actually returned on this turn. The model does not write this
 * list. `label` is the chip, already worded, such as "Meeting · Nov 18".
 */
export const AgentTurnSourceSchema = z.object({
  kind: z.string().min(1).max(40),
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(160),
})
export type AgentTurnSource = z.infer<typeof AgentTurnSourceSchema>

export const AgentProposalOutSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(AGENT_PROPOSAL_KINDS),
  studentId: z.string().uuid(),
  rationale: z.string(),
  sources: z.array(AgentProposalSourceSchema),
  payload: z.unknown(),
})
export type AgentProposalOut = z.infer<typeof AgentProposalOutSchema>

/** Per-request timing. No student content. */
export const AgentTimingSchema = z.object({
  rounds: z.number(),
  models: z.array(z.object({ ms: z.number(), inputTokens: z.number(), outputTokens: z.number() })),
  tools: z.array(z.object({ name: z.string(), ms: z.number() })),
})
export type AgentTiming = z.infer<typeof AgentTimingSchema>

export const AgentResponseSchema = z.object({
  ok: z.literal(true),
  threadId: z.string().uuid(),
  reply: z.string(),
  proposals: z.array(AgentProposalOutSchema),
  sources: z.array(AgentTurnSourceSchema),
  timing: AgentTimingSchema.optional(),
})
export type AgentResponse = z.infer<typeof AgentResponseSchema>

/** One proposal as the panel shows it, with the status stored on the row. */
export const AgentHistoryProposalSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(AGENT_PROPOSAL_KINDS),
  studentId: z.string().uuid(),
  summary: z.string(),
  status: z.enum(AGENT_PROPOSAL_STATUSES),
})
export type AgentHistoryProposal = z.infer<typeof AgentHistoryProposalSchema>

/** A user or assistant turn. Tool rows are not included. */
export const AgentHistoryMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  sources: z.array(AgentTurnSourceSchema),
  proposals: z.array(AgentHistoryProposalSchema),
})
export type AgentHistoryMessage = z.infer<typeof AgentHistoryMessageSchema>

/** GET /api/agent — this counselor's thread for one student, or the general thread. */
export const AgentHistorySchema = z.object({
  ok: z.literal(true),
  threadId: z.string().uuid().nullable(),
  messages: z.array(AgentHistoryMessageSchema),
})
export type AgentHistory = z.infer<typeof AgentHistorySchema>

// ── What each newer kind of proposal carries ────────────────────────────────
// The server writes these, the card shows them, and approving one calls the
// store action the screen already uses. Each is checked again in the browser
// before anything is done with it.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const clock = z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/)

/** A meeting to put on the calendar. The counselor picks one of the slots on the card before approving. */
export const ScheduleMeetingPayload = z.object({
  title: z.string().min(1).max(120),
  durationMin: z.number().int().min(15).max(240),
  location: z.string().max(200).optional(),
  slots: z.array(z.object({ date: isoDate, time: clock, reason: z.string().max(200).optional() })).min(1).max(3),
  /** Which slot is chosen. The first, until the counselor picks another. */
  chosen: z.number().int().min(0).max(2).default(0),
})
export type ScheduleMeetingPayload = z.infer<typeof ScheduleMeetingPayload>

/** A template to use on this student. A task plan carries its dated tasks, worked out by code, so the card shows them first. */
export const ApplyTemplatePayload = z.discriminatedUnion('templateKind', [
  z.object({
    templateKind: z.literal('task_plan'),
    templateId: z.string().uuid(),
    templateName: z.string().max(120),
    /** The date a "days before" task counts back from, when the plan has one. */
    anchor: isoDate.optional(),
    tasks: z.array(z.object({ title: z.string().min(1).max(300), owner: z.enum(['student', 'parent', 'counselor']), dueDate: isoDate, detail: z.string().max(2000).optional() })).min(1).max(40),
  }),
  z.object({
    templateKind: z.literal('message'),
    templateId: z.string().uuid(),
    templateName: z.string().max(120),
    to: z.enum(['student', 'parent']),
    /** The due date the message mentions, when its text has that blank. */
    dueDate: isoDate.optional(),
  }),
])
export type ApplyTemplatePayload = z.infer<typeof ApplyTemplatePayload>

/** A change to one existing task. `before` is what the record held when it was proposed; the card shows both. */
export const TaskChangePayload = z.object({
  taskId: z.string().uuid(),
  before: z.object({ title: z.string(), owner: z.enum(['student', 'parent', 'counselor']), dueDate: isoDate, status: z.enum(['todo', 'in_progress', 'done']) }),
  patch: z.object({ title: z.string().min(1).max(300).optional(), owner: z.enum(['student', 'parent', 'counselor']).optional(), ownerParentId: z.string().uuid().optional(), dueDate: isoDate.optional() }),
  markDone: z.boolean().default(false),
})
export type TaskChangePayload = z.infer<typeof TaskChangePayload>

/** A college from the directory, by its id. The name comes from the directory; no figure is typed by a model. */
export const AddCollegePayload = z.object({
  unitid: z.number().int().positive(),
  name: z.string().min(1).max(200),
  plan: z.enum(['ED', 'ED2', 'EA', 'REA', 'RD', 'Rolling', 'UC']).optional(),
  deadline: isoDate.optional(),
})
export type AddCollegePayload = z.infer<typeof AddCollegePayload>

const OWNER_WORD = { student: 'the student', parent: 'a parent', counselor: 'the counselor' } as const

/** What a task change does, in words: one phrase per thing that changes. */
export function taskChangeWords(change: TaskChangePayload): string[] {
  const { before, patch } = change
  return [
    patch.title && patch.title !== before.title ? `title: “${before.title}” → “${patch.title}”` : '',
    patch.dueDate && patch.dueDate !== before.dueDate ? `due: ${dayWords(before.dueDate)} → ${dayWords(patch.dueDate)}` : '',
    patch.owner && patch.owner !== before.owner ? `owner: ${OWNER_WORD[before.owner]} → ${OWNER_WORD[patch.owner]}` : '',
    change.markDone && before.status !== 'done' ? 'mark it done' : '',
  ].filter(Boolean)
}

/** A date as a person would say it: "Tue, Dec 1". */
export function dayWords(date: string): string {
  const day = new Date(`${date}T12:00:00Z`)
  return Number.isNaN(day.getTime()) ? date : day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** A slot as a counselor reads it: "Tue, Dec 1 at 4:00 PM". No time zone: a meeting's time is the counselor's own clock. */
export function slotWords(slot: { date: string; time: string }): string {
  const when = dayWords(slot.date)
  const [h, m] = slot.time.split(':').map(Number)
  return `${when} at ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** One line for a proposal card. Prefers the drafted title or body over the rationale. */
export function proposalSummary(proposal: { kind: string; rationale?: string; payload: unknown }): string {
  const payload =
    proposal.payload && typeof proposal.payload === 'object' && !Array.isArray(proposal.payload)
      ? (proposal.payload as Record<string, unknown>)
      : {}
  if (proposal.kind === 'schedule_meeting') {
    const meeting = ScheduleMeetingPayload.safeParse(payload)
    if (meeting.success) return clip(`${meeting.data.title}: ${meeting.data.slots.map(slotWords).join(' · ')}`)
  }
  if (proposal.kind === 'apply_template') {
    const use = ApplyTemplatePayload.safeParse(payload)
    if (use.success) return clip(use.data.templateKind === 'task_plan' ? `“${use.data.templateName}”: ${use.data.tasks.length} ${use.data.tasks.length === 1 ? 'task' : 'tasks'}` : `“${use.data.templateName}”: a message draft to the ${use.data.to}`)
  }
  if (proposal.kind === 'task_change') {
    const change = TaskChangePayload.safeParse(payload)
    if (change.success) return clip(`${change.data.before.title}: ${taskChangeWords(change.data).join('; ') || 'no change'}`)
  }
  if (proposal.kind === 'add_college') {
    const college = AddCollegePayload.safeParse(payload)
    if (college.success) return clip([college.data.name, college.data.plan, college.data.deadline && `deadline ${dayWords(college.data.deadline)}`].filter(Boolean).join(' · '))
  }
  if (typeof payload.title === 'string' && payload.title.trim()) return clip(payload.title)
  if (typeof payload.body === 'string' && payload.body.trim()) {
    const lines = payload.body.split('\n').map((line) => line.trim()).filter(Boolean)
    const opening = lines[0] ?? ''
    // The sign-off is the short lines after the message, so the card shows the name.
    const closing = lines.slice(1).filter((line) => line.length <= 40)
    const shown = closing.length > 0 ? `${opening} — ${closing.join(', ')}` : opening
    return clip(shown)
  }
  if (typeof payload.to === 'string') {
    const field = typeof payload.field === 'string' && payload.field.trim() ? payload.field.trim() : 'Profile'
    return clip(`${field} → ${payload.to}`)
  }
  if (Array.isArray(payload.slots)) {
    const when = payload.slots
      .map((slot) => (slot && typeof slot === 'object' && 'when' in slot ? String((slot as { when?: unknown }).when ?? '') : ''))
      .filter(Boolean)
    if (when.length) return clip(when.join(' · '))
  }
  const rationale = proposal.rationale?.trim()
  if (rationale) return clip(rationale)
  return proposal.kind
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 140 ? `${line.slice(0, 137)}…` : line
}

export type AgentErrorCode =
  | 'not_configured'
  | 'unauthorized'
  | 'no_firm'
  | 'no_key'
  | 'bad_request'
  | 'not_found'
  | 'rate_limited'
  | 'round_limit'
  | 'server'
  | 'upstream'

export interface AgentErrorBody {
  ok: false
  code: AgentErrorCode
  message: string
}
