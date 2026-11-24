import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentProposalKind, AgentProposalSource } from '../../shared/agent.js'
import type { Database, Json } from '../../src/lib/database.types.js'

export type Db = SupabaseClient<Database>

export interface AgentContext {
  firmId: string
  counselorId: string
  counselorName: string
  counselorFirstName: string
  /** Null = general / roster thread. */
  studentId: string | null
  studentName?: string
  studentGradYear?: number
  threadId: string
  /** Counselor's own client — RLS applies. */
  user: Db
  /** Service role — inserts messages and proposals after membership is known. */
  service: Db
  /** Proposals created in this request. */
  createdProposals: CreatedProposal[]
}

export interface CreatedProposal {
  id: string
  kind: AgentProposalKind
  studentId: string
  rationale: string
  sources: AgentProposalSource[]
  payload: Json
}

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string }
