// POST /api/colleges with { action, ... }: the college directory, for signed-in
// members of a firm. This file is only the HTTP handler: who is asking, how
// often, and which action. What each action does lives in server/collegeTools.ts.
//
// Who may call it: the same check as /api/ai. The request must carry
//   Authorization: Bearer <Supabase access token>
// which is verified with Supabase on every call. Everything is then done as
// that person, so row level security applies. The service role is never used here.

import { bandCollegesForStudent, CollegeToolError, draftCollegeList, getCollege, searchColleges, type CollegeToolErrorCode } from '../server/collegeTools.js'
import { addressOf, rateLimited } from '../server/rateLimit.js'
import { authConfigured, identify, type Caller } from '../server/supabase.js'

/** Room for a list draft, which calls the model. */
export const config = { maxDuration: 120 }

/** Requests per person per five minutes. Type-ahead search makes many small ones. */
const MAX_PER_USER = 300
/** Requests per address per five minutes, counted before sign-in is checked. */
const MAX_PER_ADDRESS = 600
const MAX_BODY_BYTES = 20_000
/** List drafts per person per five minutes. */
const MAX_DRAFTS_PER_USER = 10

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const fail = (code: string, message: string, status: number) => json({ ok: false, code, message }, status)

type SignedIn = Extract<Caller, { ok: true }>

/** One function per action. Each gets the verified caller and the request body. */
const ACTIONS: Record<string, (caller: SignedIn, body: Record<string, unknown>) => Promise<unknown>> = {
  /** { action: 'search', filters } → { colleges, total } */
  search: (caller, body) => searchColleges(caller.client, (body.filters ?? {}) as Parameters<typeof searchColleges>[1]),
  /** { action: 'get', college: unitid or name } → { found, college } or { found: false, candidates } */
  get: (caller, body) => getCollege(caller.client, body.college as number | string),
  /** { action: 'band', studentId, unitids } → [{ unitid, name, fit, basis, reason }]: bands by the rules, no model. */
  band: (caller, body) => bandCollegesForStudent(caller.client, body.studentId as string, body.unitids as number[]),
  /** { action: 'draft', studentId, preferences } → { draftId, items, byModel }. Saves a draft; never writes to the college list. */
  draft: (caller, body) => {
    // Each draft is one or two model calls, so it is counted apart from the type-ahead searches.
    if (rateLimited(`list-draft:${caller.userId}`, MAX_DRAFTS_PER_USER)) throw new CollegeToolError('rate_limited', 'Too many list drafts. Wait a few minutes and try again.')
    return draftCollegeList(caller.client, body.studentId as string, body.preferences, { userId: caller.userId })
  },
}

const STATUS: Record<CollegeToolErrorCode, number> = { bad_input: 400, not_found: 404, not_built: 501, database: 502, rate_limited: 429 }

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
    if (error instanceof CollegeToolError) return fail(error.code === 'bad_input' ? 'bad_request' : error.code, error.message, STATUS[error.code])
    console.error('[colleges]', error instanceof Error ? error.message : error)
    return fail('server', 'Something went wrong. Please try again.', 500)
  }
}
