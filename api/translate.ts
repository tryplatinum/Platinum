// POST /api/translate — English for one pending assistant message, on demand.
// Uses bodyEn already stored on the proposal when it is there. Otherwise one
// Claude call on the main model, then the English is saved on the proposal.

import { z } from 'zod'
import type { Json } from '../src/lib/database.types.js'
import { translateForCounselor } from '../server/agent/translate.js'
import { addressOf, rateLimited } from '../server/rateLimit.js'
import { authConfigured, identify } from '../server/supabase.js'

export const config = { maxDuration: 60 }

const Body = z.object({ proposalId: z.string().uuid() })

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const fail = (code: string, message: string, status: number) => json({ ok: false, code, message }, status)

export async function POST(request: Request): Promise<Response> {
  if (!authConfigured()) return fail('not_configured', 'The server has no Supabase settings.', 503)
  if (rateLimited(`addr:${addressOf(request)}`, 60)) return fail('rate_limited', 'Too many requests. Wait a few minutes and try again.', 429)

  const caller = await identify(request)
  if (!caller.ok) {
    return caller.reason === 'no_firm'
      ? fail('no_firm', 'Your account does not belong to a firm yet.', 403)
      : fail('unauthorized', 'Sign in again to use the assistant.', 401)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await request.text())
  } catch {
    return fail('bad_request', 'The request was not valid JSON.', 400)
  }
  const body = Body.safeParse(parsed)
  if (!body.success) return fail('bad_request', 'Invalid request: proposalId.', 400)

  const { data, error } = await caller.client.from('agent_proposals').select('id, status, payload').eq('id', body.data.proposalId).maybeSingle()
  if (error) return fail('server', 'Could not read that draft.', 500)
  if (!data || data.status !== 'pending') return fail('not_found', 'That draft is not waiting for review.', 404)

  const payload = data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload) ? (data.payload as Record<string, unknown>) : {}
  const message = typeof payload.body === 'string' ? payload.body.trim() : ''
  if (!message) return fail('bad_request', 'That draft has no message.', 400)
  const language = typeof payload.language === 'string' ? payload.language : 'en'
  const stored = typeof payload.bodyEn === 'string' ? payload.bodyEn.trim() : ''
  if (language === 'en' || stored) return json({ ok: true, bodyEn: stored || message })

  try {
    const bodyEn = await translateForCounselor(message, language)
    const next = { ...payload, bodyEn }
    const saved = await caller.client.from('agent_proposals').update({ payload: next as Json }).eq('id', data.id).eq('status', 'pending')
    if (saved.error) return fail('server', 'Could not save the English.', 500)
    return json({ ok: true, bodyEn })
  } catch (err) {
    console.error('[translate]', err instanceof Error ? err.message : err)
    return fail('upstream', 'The English could not be written. Please try again.', 502)
  }
}
