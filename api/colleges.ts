// POST /api/colleges with { action, ... }: the college directory, for signed-in
// members of a firm. This file is only the HTTP handler: who is asking, how
// often, and which action. What each action does lives in server/collegeTools.ts.
//
// Who may call it: the same check as /api/ai. The request must carry
//   Authorization: Bearer <Supabase access token>
// which is verified with Supabase on every call. Everything is then done as
// that person, so row level security applies. The service role is never used here.

import { addressOf, rateLimited } from '../server/rateLimit.js'
import { authConfigured, identify, type Caller } from '../server/supabase.js'

/** Room for a list draft, which calls the model. */
export const config = { maxDuration: 120 }

/** Requests per person per five minutes. Type-ahead search makes many small ones. */
const MAX_PER_USER = 300
/** Requests per address per five minutes, counted before sign-in is checked. */
const MAX_PER_ADDRESS = 600
const MAX_BODY_BYTES = 20_000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const fail = (code: string, message: string, status: number) => json({ ok: false, code, message }, status)

type SignedIn = Extract<Caller, { ok: true }>

/** One function per action. Each gets the verified caller and the request body. */
const ACTIONS: Record<string, (caller: SignedIn, body: Record<string, unknown>) => Promise<unknown>> = {}

export async function POST(request: Request): Promise<Response> {
  // Fail closed: if sign-ins cannot be checked, the endpoint does nothing.
  if (!authConfigured()) return fail('not_configured', 'The server has no Supabase settings, so it cannot check who is asking.', 503)
  if (rateLimited(`addr:${addressOf(request)}`, MAX_PER_ADDRESS)) return fail('rate_limited', 'Too many requests. Wait a few minutes and try again.', 429)

  const caller = await identify(request)
  if (!caller.ok) {
    return caller.reason === 'no_firm' ? fail('no_firm', 'Your account does not belong to a firm yet.', 403) : fail('unauthorized', 'Sign in again to look up colleges.', 401)
  }
  if (rateLimited(`colleges:${caller.userId}`, MAX_PER_USER)) return fail('rate_limited', 'Too many requests. Wait a few minutes and try again.', 429)

  const raw = await request.text()
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return fail('too_large', 'That request is too large.', 413)
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return fail('bad_request', 'The request was not valid JSON.', 400)
  }
  const action = typeof body?.action === 'string' ? ACTIONS[body.action] : undefined
  if (!action) return fail('bad_request', 'Unknown action.', 400)

  try {
    return json({ ok: true, data: await action(caller, body) })
  } catch (error) {
    console.error('[colleges]', error instanceof Error ? error.message : error)
    return fail('server', 'Something went wrong. Please try again.', 500)
  }
}
