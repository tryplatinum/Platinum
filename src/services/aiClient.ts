// Talks to the one server function, /api/ai. Only services/ai.ts uses this.
//
// The passcode the counselor types is kept in this browser's localStorage and
// sent as a header. The Anthropic API key is never in the browser: it lives in
// the server's environment.

import { AI_ENDPOINT, PASSCODE_HEADER } from '../../shared/constants'
import type { AiErrorCode, AiResponse, AiStatus, Feature, FeatureInput, FeatureOutput } from '../../shared/contract'

const PASSCODE_KEY = 'platinum-ai-passcode'
const TIMEOUT_MS = 120_000

export function getPasscode(): string {
  try {
    return localStorage.getItem(PASSCODE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setPasscode(value: string): void {
  try {
    if (value) localStorage.setItem(PASSCODE_KEY, value)
    else localStorage.removeItem(PASSCODE_KEY)
  } catch {
    // Storage unavailable (private window): AI stays on placeholders.
  }
}

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
 * preview), no API key on the server, or no passcode entered here.
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

export async function callAi<F extends Feature>(feature: F, input: FeatureInput<F>): Promise<{ draft: FeatureOutput<F>; model: string }> {
  const passcode = getPasscode()
  if (!passcode) throw new AiUnavailable('No AI passcode has been entered in this browser.')

  let res: Response
  try {
    res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [PASSCODE_HEADER]: passcode },
      body: JSON.stringify({ feature, input }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new AiFailure('upstream', 'The AI took too long to answer. Please try again.')
    }
    throw new AiUnavailable('The AI endpoint could not be reached.')
  }

  // A static host answers /api/ai with the app's HTML (or a 404/405). That means there is no endpoint.
  if (!res.headers.get('content-type')?.includes('application/json')) {
    throw new AiUnavailable('This deployment has no AI endpoint.')
  }

  const body = (await res.json()) as AiResponse<F>
  if (body.ok) return { draft: body.draft, model: body.model }
  if (body.code === 'no_key' || body.code === 'no_passcode_configured') throw new AiUnavailable(body.message)
  throw new AiFailure(body.code, body.message)
}
