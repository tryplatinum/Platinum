// Contracts for the counselor-facing assistant (POST /api/agent) and for the
// structured essay-brainstorm tool. Browser and server both import these.

import { z } from 'zod'

export const AGENT_PROPOSAL_KINDS = ['message', 'parent_update', 'task', 'profile_change', 'meeting_times'] as const
export type AgentProposalKind = (typeof AGENT_PROPOSAL_KINDS)[number]

export const AGENT_PROPOSAL_STATUSES = ['pending', 'approved', 'discarded'] as const
export type AgentProposalStatus = (typeof AGENT_PROPOSAL_STATUSES)[number]

const shortLine = z.string().max(200)

/** Essay brainstorming only — never a free-form draft of the essay itself. */
export const EssayBrainstormSchema = z.object({
  questions_to_ask: z.array(shortLine).max(8),
  angles_to_explore: z.array(shortLine).max(8),
  gaps_in_story: z.array(shortLine).max(8),
  materials_to_gather: z.array(shortLine).max(8),
})
export type EssayBrainstorm = z.infer<typeof EssayBrainstormSchema>

export const AgentRequestSchema = z.object({
  studentId: z.string().uuid().nullable(),
  message: z.string().min(1).max(8_000),
})
export type AgentRequest = z.infer<typeof AgentRequestSchema>

export const AgentProposalSourceSchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  label: z.string(),
})
export type AgentProposalSource = z.infer<typeof AgentProposalSourceSchema>

export const AgentProposalOutSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(AGENT_PROPOSAL_KINDS),
  studentId: z.string().uuid(),
  rationale: z.string(),
  sources: z.array(AgentProposalSourceSchema),
  payload: z.unknown(),
})
export type AgentProposalOut = z.infer<typeof AgentProposalOutSchema>

export const AgentResponseSchema = z.object({
  ok: z.literal(true),
  threadId: z.string().uuid(),
  reply: z.string(),
  proposals: z.array(AgentProposalOutSchema),
})
export type AgentResponse = z.infer<typeof AgentResponseSchema>

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
