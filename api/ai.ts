// The only server code in Platinum v0: POST /api/ai with { feature, input }
// returns that feature's draft from Claude. Deploys as a Vercel function next
// to the static site; in local dev the Vite server mounts it (vite.config.ts).
//
// There are no accounts yet, so this endpoint protects itself as a STOPGAP:
//   1. a shared passcode (PLATINUM_PASSCODE) sent in a header,
//   2. a cap on request size,
//   3. a simple per-address rate limit.
// Replace all three with real sign-in when accounts exist.
//
// Nothing is stored here. The request carries the facts, the response carries
// the draft, and neither is logged.

import { timingSafeEqual } from 'node:crypto'
import { FEATURES, INPUTS, MAX_REQUEST_BYTES, PASSCODE_HEADER, type AiErrorCode, type AiStatus, type Feature } from '../shared/contract.js'
import { AiError, modelName, runFeature } from '../server/claude.js'

/** Vercel: allow time for a long draft. */
export const config = { maxDuration: 120 }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const fail = (code: AiErrorCode, message: string, status: number) => json({ ok: false, code, message }, status)

// ── Rate limit ──────────────────────────────────────────────────────────────
// In memory, per server instance. Serverless instances do not share memory, so
// this slows abuse down; it does not stop a determined caller.
const WINDOW_MS = 5 * 60_000
const MAX_PER_WINDOW = 30
const hits = new Map<string, number[]>()

function rateLimited(key: string): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent)
    return true
  }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5_000) hits.clear()
  return false
}

function passcodeMatches(given: string | null, expected: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// ── Handlers ────────────────────────────────────────────────────────────────

/** Tells the browser whether real drafts are available. Reveals no secrets. */
export function GET(): Response {
  const status: AiStatus = {
    ok: true,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasPasscode: Boolean(process.env.PLATINUM_PASSCODE),
    model: modelName(),
  }
  return json(status)
}

export async function POST(request: Request): Promise<Response> {
  const passcode = process.env.PLATINUM_PASSCODE
  // Fail closed: without a passcode configured, the endpoint does nothing.
  if (!passcode) return fail('no_passcode_configured', 'PLATINUM_PASSCODE is not set on the server.', 503)

  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  if (rateLimited(address)) return fail('rate_limited', 'Too many AI requests. Wait a few minutes and try again.', 429)

  if (!passcodeMatches(request.headers.get(PASSCODE_HEADER), passcode)) {
    return fail('bad_passcode', 'The AI passcode is missing or wrong.', 401)
  }
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
