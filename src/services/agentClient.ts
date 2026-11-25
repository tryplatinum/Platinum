// The browser's view of the assistant. The panel calls this and nothing else.
// The default is POST/GET /api/agent. Set VITE_AGENT_MOCK=true to use the canned
// client for offline UI work. The assistant proposes. This client never approves.

import { AGENT_ENDPOINT } from '../../shared/constants'
import type { AgentHistory, AgentResponse } from '../../shared/agent'
import { accessToken } from '../store/session'
import { mockAgentClient } from './agentClient.mock'

export type { AgentHistory, AgentHistoryMessage, AgentHistoryProposal, AgentProposalKind, AgentProposalOut, AgentProposalStatus, AgentResponse, AgentTurnSource } from '../../shared/agent'

/** The server answered. The panel shows `message` inline. Retry is for 5xx only. */
export class AgentRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AgentRequestError'
    this.status = status
  }
}

/** The request never got a response. The panel shows this with Retry. */
export class AgentNetworkError extends Error {
  constructor(message = 'The assistant could not be reached.') {
    super(message)
    this.name = 'AgentNetworkError'
  }
}

export interface AgentClient {
  /** Send one counselor message. `studentId` null is the general thread. `requestId` lets the panel poll progress. */
  send(studentId: string | null, message: string, requestId?: string): Promise<AgentResponse>
  /** The saved thread for this page. Empty when this counselor has not written here yet. */
  loadThread(studentId: string | null): Promise<AgentHistory>
  /** The step label for a request still running, or null. */
  progress(requestId: string): Promise<string | null>
}

const TIMEOUT_MS = 120_000

async function withToken(run: (token: string) => Promise<Response>): Promise<Response> {
  const token = await accessToken()
  if (!token) throw new AgentRequestError(401, 'Sign in again to use the assistant.')
  let response: Response
  try {
    response = await run(token)
  } catch {
    throw new AgentNetworkError()
  }
  if (response.status !== 401) return response
  const fresh = await accessToken(true)
  if (!fresh) throw new AgentRequestError(401, 'Sign in again to use the assistant.')
  try {
    return await run(fresh)
  } catch {
    throw new AgentNetworkError()
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function messageOf(status: number, body: unknown): string {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' && body.message.trim()) return body.message
  if (status === 429) return 'Daily assistant limit reached.'
  if (status === 401) return 'Sign in again to use the assistant.'
  return 'Something went wrong in the assistant. Please try again.'
}

function asOk<T extends { ok: true }>(status: number, body: unknown): T {
  if (body && typeof body === 'object' && 'ok' in body && body.ok === true) return body as T
  throw new AgentRequestError(status, messageOf(status, body))
}

const realAgentClient: AgentClient = {
  async send(studentId, message, requestId) {
    const response = await withToken((token) =>
      fetch(AGENT_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ studentId, message, requestId }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    )
    return asOk<AgentResponse>(response.status, await readJson(response))
  },

  async progress(requestId) {
    const response = await withToken((token) =>
      fetch(`${AGENT_ENDPOINT}?progress=${encodeURIComponent(requestId)}`, {
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    )
    const body = asOk<{ ok: true; step: string | null }>(response.status, await readJson(response))
    return body.step
  },

  async loadThread(studentId) {
    const query = `studentId=${encodeURIComponent(studentId ?? 'null')}`
    const response = await withToken((token) =>
      fetch(`${AGENT_ENDPOINT}?${query}`, {
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    )
    return asOk<AgentHistory>(response.status, await readJson(response))
  },
}

/** `VITE_AGENT_MOCK=true` keeps the canned client for offline UI work. */
const agentClient: AgentClient = import.meta.env.VITE_AGENT_MOCK === 'true' ? mockAgentClient : realAgentClient

export default agentClient
export { agentClient }
