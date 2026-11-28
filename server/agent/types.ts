import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentProposalKind, AgentProposalSource } from '../../shared/agent.js'
import type { Database, Json } from '../../src/lib/database.types.js'
import type { AppData } from '../../src/types.js'

export type Db = SupabaseClient<Database>

export interface AgentContext {
  firmId: string
  counselorId: string
  counselorName: string
  counselorFirstName: string
  firmName: string
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
  /** The firm's caseload as the counselor can read it, loaded at most once a request (server/agent/tools.ts). */
  caseload?: Promise<AppData>
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

/** A database read in a tool failed. The model gets a plain sentence; the real error is logged here only. */
export function readFailed(tool: string, error: { message?: string }): ToolResult {
  console.error(`[agent] ${tool} read failed:`, error.message ?? 'unknown')
  return { ok: false, error: 'Could not read that from the record.' }
}
