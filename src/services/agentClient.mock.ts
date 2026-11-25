// Canned assistant, used when VITE_AGENT_MOCK=true. The real client is the default.
// Each thread walks five replies, in order, then repeats:
//   1. a reply with source chips
//   2. a reply with two proposals
//   3. a 429
//   4. a network failure
//   5. a long reply
// Words in the message force one of those, and do not advance the walk:
//   "429" or "daily limit" → the limit, every time
//   "network" or "offline" → the network error once per exact text;
//     sending that same text again (Retry) returns the long reply.
//   "proposal" → the two proposals
//   "long reply" or "in detail" → the long reply

import type { AgentHistoryMessage, AgentHistoryProposal, AgentProposalOut, AgentResponse, AgentTurnSource } from '../../shared/agent'
import { AgentNetworkError, AgentRequestError, type AgentClient } from './agentClient'

type Phase = 'source' | 'proposals' | 'limit' | 'network' | 'long'

const ORDER: readonly Phase[] = ['source', 'proposals', 'limit', 'network', 'long']
const NIL_STUDENT = '00000000-0000-4000-8000-000000000001'

type StoredThread = {
  threadId: string
  step: number
  messages: AgentHistoryMessage[]
  /** Exact texts that have already produced one network error. The next send succeeds. */
  networkSeen: Set<string>
}

const threads = new Map<string, StoredThread>()

const keyOf = (studentId: string | null) => studentId ?? ''

function bucket(studentId: string | null): StoredThread {
  const key = keyOf(studentId)
  const existing = threads.get(key)
  if (existing) return existing
  const created: StoredThread = { threadId: crypto.randomUUID(), step: 0, messages: [], networkSeen: new Set() }
  threads.set(key, created)
  return created
}

function wait(): Promise<void> {
  const ms = 600 + Math.floor(Math.random() * 601)
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function forcedPhase(message: string): Phase | undefined {
  const text = message.toLowerCase()
  if (text.includes('429') || text.includes('daily limit')) return 'limit'
  if (text.includes('network') || text.includes('offline')) return 'network'
  if (text.includes('proposal')) return 'proposals'
  if (text.includes('long reply') || text.includes('in detail')) return 'long'
  return undefined
}

function source(kind: string, label: string): AgentTurnSource {
  return { kind, id: crypto.randomUUID(), label }
}

function proposal(kind: AgentProposalOut['kind'], studentId: string | null, summary: string, payload: Record<string, unknown>): AgentProposalOut {
  return {
    id: crypto.randomUUID(),
    kind,
    studentId: studentId ?? NIL_STUDENT,
    rationale: summary,
    sources: [],
    payload,
  }
}

function sourceReply(threadId: string, studentId: string | null): AgentResponse {
  const who = studentId ? 'This student' : 'One student on the caseload'
  return {
    ok: true,
    threadId,
    reply: `${who} still has the activities list open, and the recommendation request has not gone out.\n\nBoth were named at the last meeting.`,
    proposals: [],
    sources: [source('meeting', 'Meeting · Nov 18'), source('task', 'Task · Activities list')],
  }
}

function proposalsReply(threadId: string, studentId: string | null): AgentResponse {
  const parent = 'Tell the family the activities list is still open and the recommendation request is next.'
  const task = 'Ask the student to send the recommendation request by Friday.'
  return {
    ok: true,
    threadId,
    reply: 'Two drafts are ready in Approvals. They wait there until you approve them.',
    proposals: [
      proposal('parent_update', studentId, parent, { body: parent }),
      proposal('task', studentId, task, { title: task }),
    ],
    sources: [],
  }
}

function longReply(threadId: string, studentId: string | null): AgentResponse {
  const who = studentId ? 'this student' : 'the caseload'
  return {
    ok: true,
    threadId,
    reply: [
      `Here is a longer look at ${who}, still only notes for you to check.`,
      'Two things are late: the activities list, and the request for a counselor recommendation. Both were named in the last meeting. The activities list has stayed open since then, and the recommendation request has not been sent.',
      'The next meeting is already on the calendar. A useful brief would cover what moved, what is still late, and the one question for the family: who is writing the recommendation.',
      'Nothing here is sent. Ask for a parent update or a task and the drafts will wait in Approvals for you to edit and approve.',
    ].join('\n\n'),
    proposals: [],
    sources: [source('meeting', 'Meeting · Nov 18')],
  }
}

function replyFor(phase: Exclude<Phase, 'limit' | 'network'>, threadId: string, studentId: string | null): AgentResponse {
  if (phase === 'source') return sourceReply(threadId, studentId)
  if (phase === 'proposals') return proposalsReply(threadId, studentId)
  return longReply(threadId, studentId)
}

function asHistory(response: AgentResponse): { sources: AgentTurnSource[]; proposals: AgentHistoryProposal[] } {
  return {
    sources: response.sources,
    proposals: response.proposals.map((item) => ({
      id: item.id,
      kind: item.kind,
      studentId: item.studentId,
      summary: item.rationale,
      status: 'pending' as const,
    })),
  }
}

function remember(thread: StoredThread, message: string, response?: AgentResponse) {
  const last = thread.messages[thread.messages.length - 1]
  const sameUser = last?.role === 'user' && last.text === message
  if (!sameUser) thread.messages.push({ id: crypto.randomUUID(), role: 'user', text: message, sources: [], proposals: [] })
  if (!response) return
  const turn = asHistory(response)
  thread.messages.push({ id: crypto.randomUUID(), role: 'assistant', text: response.reply, sources: turn.sources, proposals: turn.proposals })
}

export const mockAgentClient: AgentClient = {
  async loadThread(studentId) {
    const thread = threads.get(keyOf(studentId))
    if (!thread) return { ok: true, threadId: null, messages: [] }
    return {
      ok: true,
      threadId: thread.threadId,
      messages: thread.messages.map((message) => ({ ...message, proposals: message.proposals.map((item) => ({ ...item })) })),
    }
  },

  async send(studentId, message) {
    const text = message.trim()
    const thread = bucket(studentId)
    const forced = forcedPhase(text)
    let phase: Phase
    if (forced) phase = forced
    else {
      phase = ORDER[thread.step % ORDER.length] ?? 'source'
      thread.step += 1
    }

    await wait()

    if (phase === 'limit') {
      remember(thread, text)
      throw new AgentRequestError(429, 'Daily assistant limit reached.')
    }
    if (phase === 'network') {
      if (!thread.networkSeen.has(text)) {
        thread.networkSeen.add(text)
        remember(thread, text)
        throw new AgentNetworkError()
      }
      phase = 'long'
    }

    const response = replyFor(phase, thread.threadId, studentId)
    remember(thread, text, response)
    return response
  },
}

export default mockAgentClient
