// Contracts for the counselor-facing assistant (POST /api/agent) and for the
// structured essay-brainstorm tool. Browser and server both import these.

import { z } from 'zod'

export const AGENT_PROPOSAL_KINDS = ['message', 'parent_update', 'task', 'profile_change', 'meeting_times'] as const
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

export const AgentRequestSchema = z.object({
  studentId: z.string().uuid().nullable(),
  message: z.string().min(1).max(8_000),
  /** Panel poll key. Optional so older clients still work. */
  requestId: z.string().uuid().optional(),
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

/** One line for a proposal card. Prefers the drafted title or body over the rationale. */
export function proposalSummary(proposal: { kind: string; rationale?: string; payload: unknown }): string {
  const payload =
    proposal.payload && typeof proposal.payload === 'object' && !Array.isArray(proposal.payload)
      ? (proposal.payload as Record<string, unknown>)
      : {}
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
