// POST /api/dispatch — send this firm's due queued messages.
//
// Who may call it: a signed-in firm member (identify()). The service role does
// the status updates. Nothing outside this path calls a transport.

import { dispatchFirm } from '../server/dispatch.js'
import { authConfigured, identify, serviceConfigured } from '../server/supabase.js'

export const config = { maxDuration: 60 }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export async function POST(request: Request): Promise<Response> {
  if (!authConfigured()) {
    return json({ ok: false, message: 'The server has no Supabase settings, so it cannot check who is asking.' }, 503)
  }
  if (!serviceConfigured()) {
    return json({ ok: false, message: 'The server cannot send messages yet.' }, 503)
  }

  const caller = await identify(request)
  if (!caller.ok) {
    return caller.reason === 'no_firm'
      ? json({ ok: false, message: 'Your account does not belong to a firm yet.' }, 403)
      : json({ ok: false, message: 'Sign in again to send messages.' }, 401)
  }

  try {
    const summary = await dispatchFirm(caller.firmId)
    return json({ ok: true, ...summary })
  } catch (error) {
    console.error('[dispatch]', error instanceof Error ? error.message : 'unknown')
    return json({ ok: false, code: 'server', message: 'Something went wrong. Try again.' }, 500)
  }
}
