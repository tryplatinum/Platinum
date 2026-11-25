// POST /api/agent — counselor-facing assistant. Authenticated; reads with the
// counselor's token (RLS); inserts messages and proposals with the service role
// after membership is checked. Every write that affects students is a pending
// proposal. Nothing is sent from here.

import { AgentRequestSchema, type AgentErrorCode } from '../shared/agent.js'
import { loadAgentThread } from '../server/agent/history.js'
import { readProgress } from '../server/agent/progress.js'
import { AgentHttpError, runAgent } from '../server/agent/run.js'
import { addressOf, rateLimited } from '../server/rateLimit.js'
import { authConfigured, identify, serviceClient, serviceConfigured } from '../server/supabase.js'

export const config = { maxDuration: 120 }

const MAX_PER_USER = 40
const MAX_PER_ADDRESS = 120
const MAX_BYTES = 20_000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const fail = (code: AgentErrorCode, message: string, status: number) => json({ ok: false, code, message }, status)

function studentQuery(request: Request): string | null | Response {
  const raw = new URL(request.url).searchParams.get('studentId')
  if (raw === null || raw === '' || raw === 'null') return null
  const parsed = AgentRequestSchema.shape.studentId.safeParse(raw)
  if (!parsed.success || parsed.data === null) return fail('bad_request', 'Invalid request: studentId.', 400)
  return parsed.data
}

/** This counselor's thread for one student, or the general thread when studentId is null. */
export async function GET(request: Request): Promise<Response> {
  if (!authConfigured()) {
    return fail('not_configured', 'The server has no Supabase settings, so it cannot run the assistant.', 503)
  }
  const caller = await identify(request)
  if (!caller.ok) {
    return caller.reason === 'no_firm'
      ? fail('no_firm', 'Your account does not belong to a firm yet.', 403)
      : fail('unauthorized', 'Sign in again to use the assistant.', 401)
  }
  const progressId = new URL(request.url).searchParams.get('progress')
  if (progressId) return json({ ok: true, step: readProgress(progressId, caller.userId) })
  const studentId = studentQuery(request)
  if (studentId instanceof Response) return studentId
  try {
    return json(await loadAgentThread(caller.client, caller.firmId, caller.userId, studentId))
  } catch (error) {
    if (error instanceof AgentHttpError) return fail(error.code as AgentErrorCode, error.message, error.status)
    console.error('[agent] history', error)
    return fail('server', 'Something went wrong in the assistant. Please try again.', 500)
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!authConfigured() || !serviceConfigured()) {
    return fail('not_configured', 'The server has no Supabase settings, so it cannot run the assistant.', 503)
  }
  if (rateLimited(`addr:${addressOf(request)}`, MAX_PER_ADDRESS)) {
    return fail('rate_limited', 'Too many requests. Wait a few minutes and try again.', 429)
  }

  const caller = await identify(request)
  if (!caller.ok) {
    return caller.reason === 'no_firm'
      ? fail('no_firm', 'Your account does not belong to a firm yet.', 403)
      : fail('unauthorized', 'Sign in again to use the assistant.', 401)
  }
  if (rateLimited(`user:${caller.userId}`, MAX_PER_USER)) {
    return fail('rate_limited', 'Too many assistant requests. Wait a few minutes and try again.', 429)
  }

  const raw = await request.text()
  if (Buffer.byteLength(raw) > MAX_BYTES) {
    return fail('bad_request', 'That message is too long.', 413)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail('bad_request', 'The request was not valid JSON.', 400)
  }
  const body = AgentRequestSchema.safeParse(parsed)
  if (!body.success) {
    const first = body.error.issues[0]
    return fail('bad_request', `Invalid request: ${first?.path.join('.') || 'body'}.`, 400)
  }

  try {
    const result = await runAgent({
      user: caller.client,
      service: serviceClient(),
      firmId: caller.firmId,
      counselorId: caller.userId,
      studentId: body.data.studentId,
      message: body.data.message.trim(),
      requestId: body.data.requestId,
    })
    return json({ ok: true, threadId: result.threadId, reply: result.reply, proposals: result.proposals, sources: result.sources, timing: result.timing })
  } catch (error) {
    if (error instanceof AgentHttpError) {
      return fail(error.code as AgentErrorCode, error.message, error.status)
    }
    console.error('[agent] unhandled', error)
    return fail('server', 'Something went wrong in the assistant. Please try again.', 500)
  }
}
