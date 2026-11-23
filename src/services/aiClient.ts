// Talks to the AI server function, /api/ai. Only services/ai.ts uses this.
//
// Each request carries the signed-in person's Supabase access token, which the
// server verifies. The Anthropic API key is never in the browser: it lives in
// the server's environment.

import { AI_ENDPOINT } from '../../shared/constants'
import type { AiErrorCode, AiResponse, AiStatus, Feature, FeatureInput, FeatureOutput } from '../../shared/contract'
import { accessToken } from '../store/session'

const TIMEOUT_MS = 120_000

/** A failure from a reachable, configured endpoint. Screens show `message` to the counselor. */
export class AiFailure extends Error {
  code: AiErrorCode
  constructor(code: AiErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * Thrown when real drafts are not available at all: no endpoint (static
 * preview), or a server with no API key or no Supabase settings.
 * services/ai.ts catches this and falls back to a labelled placeholder.
 */
export class AiUnavailable extends Error {}

export async function fetchStatus(): Promise<AiStatus | undefined> {
  try {
    const res = await fetch(AI_ENDPOINT, { headers: { accept: 'application/json' } })
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return undefined
    const body = (await res.json()) as AiStatus
    return body.ok ? body : undefined
  } catch {
    return undefined
  }
}

async function post(token: string, body: string): Promise<Response> {
  try {
    return await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new AiFailure('upstream', 'The AI took too long to answer. Please try again.')
    }
    throw new AiUnavailable('The AI endpoint could not be reached.')
  }
}

export async function callAi<F extends Feature>(feature: F, input: FeatureInput<F>): Promise<{ draft: FeatureOutput<F>; model: string }> {
  const token = await accessToken()
  if (!token) throw new AiFailure('unauthorized', 'Sign in again to use AI drafts.')

  const payload = JSON.stringify({ feature, input })
  let res = await post(token, payload)
  // The token may have expired since the page loaded: get a fresh one and try once more.
  if (res.status === 401) {
    const fresh = await accessToken(true)
    if (fresh) res = await post(fresh, payload)
  }

  // A static host answers /api/ai with the app's HTML (or a 404/405). That means there is no endpoint.
  if (!res.headers.get('content-type')?.includes('application/json')) {
    throw new AiUnavailable('This deployment has no AI endpoint.')
  }

  const body = (await res.json()) as AiResponse<F>
  if (body.ok) return { draft: body.draft, model: body.model }
  if (body.code === 'no_key' || body.code === 'not_configured') throw new AiUnavailable(body.message)
  throw new AiFailure(body.code, body.message)
}
