// POST /api/ai with { feature, input } returns that feature's draft from
// Claude. Deploys as a Vercel function next to the static site; in local dev
// the Vite server mounts it (vite.config.ts).
//
// Who may call it: a signed-in member of a firm. The request must carry
//   Authorization: Bearer <Supabase access token>
// which is verified with Supabase on every call. On top of that there is a cap
// on request size and a rate limit per person (in memory: see server/rateLimit.ts).
//
// Nothing is stored here. The request carries the facts, the response carries
// the draft, and neither is logged. This function never writes to the database.

import { FEATURES, INPUTS, MAX_REQUEST_BYTES, type AiErrorCode, type AiStatus, type Feature } from '../shared/contract.js'
import { AiError, modelName, runFeature } from '../server/claude.js'
import { addressOf, rateLimited } from '../server/rateLimit.js'
import { authConfigured, identify } from '../server/supabase.js'

/** Vercel: allow time for a long draft. */
export const config = { maxDuration: 120 }

/** AI requests per person per five minutes. */
const MAX_PER_USER = 30
/** Requests per address per five minutes, counted before sign-in is checked. */
const MAX_PER_ADDRESS = 120

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const fail = (code: AiErrorCode, message: string, status: number) => json({ ok: false, code, message }, status)

/** Tells the browser whether real drafts are available. Reveals no secrets. */
export function GET(): Response {
  const status: AiStatus = {
    ok: true,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasAuth: authConfigured(),
    model: modelName(),
  }
  return json(status)
}

export async function POST(request: Request): Promise<Response> {
  // Fail closed: if sign-ins cannot be checked, the endpoint does nothing.
  if (!authConfigured()) return fail('not_configured', 'The server has no Supabase settings, so it cannot check who is asking.', 503)
  if (rateLimited(`addr:${addressOf(request)}`, MAX_PER_ADDRESS)) return fail('rate_limited', 'Too many requests. Wait a few minutes and try again.', 429)

  const caller = await identify(request)
  if (!caller.ok) {
    return caller.reason === 'no_firm'
      ? fail('no_firm', 'Your account does not belong to a firm yet.', 403)
      : fail('unauthorized', 'Sign in again to use AI drafts.', 401)
  }
  if (rateLimited(`user:${caller.userId}`, MAX_PER_USER)) return fail('rate_limited', 'Too many AI requests. Wait a few minutes and try again.', 429)

  if (!process.env.ANTHROPIC_API_KEY) return fail('no_key', 'ANTHROPIC_API_KEY is not set on the server.', 503)

  const raw = await request.text()
  if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) return fail('too_large', 'That is too much text for one request. Shorten the notes and try again.', 413)

  let body: { feature?: unknown; input?: unknown }
  try {
    body = JSON.parse(raw)
  } catch {
    return fail('bad_request', 'The request was not valid JSON.', 400)
  }
  if (typeof body.feature !== 'string' || !FEATURES.includes(body.feature as Feature)) {
    return fail('bad_request', 'Unknown AI feature.', 400)
  }
  const feature = body.feature as Feature
  const input = INPUTS[feature].safeParse(body.input)
  if (!input.success) {
    const first = input.error.issues[0]
    return fail('bad_request', `The request for ${feature} is missing or has an invalid field: ${first?.path.join('.') || 'input'}.`, 400)
  }

  try {
    // The cast is safe: `input.data` was just validated against this feature's schema.
    const result = await runFeature(feature, input.data as never)
    return json({ ok: true, feature, draft: result.draft, model: result.model })
  } catch (error) {
    if (error instanceof AiError) return fail(error.code, error.message, error.status)
    console.error('[ai] unhandled', error)
    return fail('server', 'Something went wrong while drafting. Please try again.', 500)
  }
}
