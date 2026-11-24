// GET /api/agent. One counselor's thread, read with that person's token so
// row-level security applies. Tool rows stay in the database (the next turn
// needs them) and are left out of the response. Their results become the
// reply's source chips. Proposal status is the row's current status.

import { proposalSummary, type AgentHistory, type AgentHistoryMessage, type AgentHistoryProposal, type AgentTurnSource } from '../../shared/agent.js'
import type { Json } from '../../src/lib/database.types.js'
import { AgentHttpError } from './run.js'
import { dedupeSources, sourcesFromStoredTools, textFromContent, toolNamesIn } from './sources.js'
import type { Db } from './types.js'

const RAW_LIMIT = 400
const VISIBLE_LIMIT = 50

type RawMessage = { id: string; role: string; content: Json; created_at: string }
type RawProposal = {
  id: string
  kind: string
  student_id: string
  rationale: string
  payload: Json
  status: string
  created_at: string
}

export async function loadAgentThread(user: Db, firmId: string, counselorId: string, studentId: string | null): Promise<AgentHistory> {
  let lookup = user.from('agent_threads').select('id').eq('firm_id', firmId).eq('counselor_id', counselorId)
  lookup = studentId ? lookup.eq('student_id', studentId) : lookup.is('student_id', null)
  const thread = await lookup.maybeSingle()
  if (thread.error) throw new AgentHttpError('server', thread.error.message, 500)
  if (!thread.data) return { ok: true, threadId: null, messages: [] }

  const [messages, proposals] = await Promise.all([
    user.from('agent_messages').select('id, role, content, created_at').eq('thread_id', thread.data.id).order('created_at', { ascending: false }).limit(RAW_LIMIT),
    user.from('agent_proposals').select('id, kind, student_id, rationale, payload, status, created_at').eq('thread_id', thread.data.id).order('created_at', { ascending: true }),
  ])
  if (messages.error) throw new AgentHttpError('server', messages.error.message, 500)
  if (proposals.error) throw new AgentHttpError('server', proposals.error.message, 500)

  const visible = assemble((messages.data ?? []).slice().reverse(), proposals.data ?? [])
  return { ok: true, threadId: thread.data.id, messages: visible.slice(-VISIBLE_LIMIT) }
}

function assemble(rows: RawMessage[], proposals: RawProposal[]): AgentHistoryMessage[] {
  const pending = [...proposals].sort((a, b) => a.created_at.localeCompare(b.created_at))
  let cursor = 0
  const takeUntil = (at: string): AgentHistoryProposal[] => {
    const taken: AgentHistoryProposal[] = []
    while (cursor < pending.length && pending[cursor]!.created_at <= at) {
      const row = pending[cursor]!
      cursor += 1
      if (!isKind(row.kind) || !isStatus(row.status)) continue
      taken.push({
        id: row.id,
        kind: row.kind,
        studentId: row.student_id,
        summary: proposalSummary({ kind: row.kind, rationale: row.rationale, payload: row.payload }),
        status: row.status,
      })
    }
    return taken
  }

  const out: AgentHistoryMessage[] = []
  let toolNames = new Map<string, string>()
  let sources: AgentTurnSource[] = []

  for (const row of rows) {
    if (row.role === 'tool') {
      sources.push(...sourcesFromStoredTools(row.content, toolNames))
      continue
    }
    if (row.role === 'user') {
      const text = textFromContent(row.content)
      if (text) out.push({ id: row.id, role: 'user', text, sources: [], proposals: [] })
      toolNames = new Map()
      sources = []
      continue
    }
    if (row.role !== 'assistant') continue
    toolNames = toolNamesIn(row.content)
    const text = textFromContent(row.content)
    if (!text) continue
    out.push({
      id: row.id,
      role: 'assistant',
      text,
      sources: dedupeSources(sources),
      proposals: takeUntil(row.created_at),
    })
    sources = []
  }

  // A tool round can finish after the reply text was already stored. Hang the
  // leftover records and proposals on that reply, which is what POST returns.
  const last = out[out.length - 1]
  if (last?.role === 'assistant' && (sources.length > 0 || cursor < pending.length)) {
    last.sources = dedupeSources([...last.sources, ...sources])
    last.proposals = [...last.proposals, ...takeUntil('9999')]
  }
  return out
}

function isKind(value: string): value is AgentHistoryProposal['kind'] {
  return value === 'message' || value === 'parent_update' || value === 'task' || value === 'profile_change' || value === 'meeting_times'
}

function isStatus(value: string): value is AgentHistoryProposal['status'] {
  return value === 'pending' || value === 'approved' || value === 'discarded'
}
