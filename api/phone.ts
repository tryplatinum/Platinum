// /api/phone: texts from a counselor's own iPhone.
//
//   POST { action, ... }
//
// Two kinds of caller, told apart by the action:
//
//   * the phone ("claim", "report"), with Authorization: Bearer <device key>.
//     The key is hashed and looked up; the server stores only the hash. A
//     hand-built Apple Shortcut depends on the exact shape of these answers,
//     so they are flat objects and "claim" always has `next`.
//   * the signed-in counselor (everything else), checked the same way as
//     /api/google: Authorization: Bearer <Supabase access token>, verified
//     with Supabase on every call.
//
// This file is only the HTTP handler. What each action does lives in
// server/phoneGateway/. Nothing here sends a text: the phone does, after it
// claims a job the dispatcher made. No answer but `connect` holds a device
// key, and nothing logs a key, a number or message text.

import { cancelInput, connectInput, numberInput, pairInput, reportInput, resolveInput } from '../shared/phoneGateway.js'
import { PhoneError } from '../server/phoneGateway/config.js'
import { cancelWaiting, connectPhone, disconnectPhone, pairWithCode, phoneStatus, resolveUnknown, saveOwnNumber, sendTest, wakeNow } from '../server/phoneGateway/counselor.js'
import { claimNext, deviceForKey, pairAgainBody, report } from '../server/phoneGateway/device.js'
import { addressOf, rateLimited } from '../server/rateLimit.js'
import { authConfigured, identify, serviceConfigured, type Caller } from '../server/supabase.js'

export const config = { maxDuration: 60 }

/** Requests per address per five minutes, counted before any key or sign-in is checked. */
const MAX_PER_ADDRESS = 240
/** Requests per counselor per five minutes. */
const MAX_PER_USER = 120
/** Requests per phone per five minutes. The Shortcut loops, so a burst is a few calls per text. */
const MAX_PER_DEVICE = 120
const MAX_BODY_BYTES = 10_000

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const fail = (message: string, status: number) => json({ ok: false, message }, status)

type SignedIn = Extract<Caller, { ok: true }>

/** The body, checked against the action's shape. A body that does not fit is refused with nothing echoed back. */
function checked<T>(shape: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }, body: unknown): T {
  const result = shape.safeParse(body)
  if (!result.success) throw new PhoneError('That request was not understood.', 400)
  return result.data
}

/** What the signed-in counselor may ask for. Each answers with the phone's status as it now is, except `connect`. */
const COUNSELOR: Record<string, (caller: SignedIn, body: unknown) => Promise<unknown>> = {
  status: (caller) => phoneStatus(caller),
  /** The one answer that holds a device key, and it holds it once. */
  connect: (caller, body) => connectPhone(caller, checked(connectInput, body)),
  number: async (caller, body) => {
    await saveOwnNumber(caller, checked(numberInput, body).phone)
    return phoneStatus(caller)
  },
  test: async (caller) => {
    await sendTest(caller)
    return phoneStatus(caller)
  },
  wake: async (caller) => {
    await wakeNow(caller)
    return phoneStatus(caller)
  },
  disconnect: async (caller) => {
    await disconnectPhone(caller)
    return phoneStatus(caller)
  },
  resolve: async (caller, body) => {
    await resolveUnknown(caller, checked(resolveInput, body))
    return phoneStatus(caller)
  },
  cancel: async (caller, body) => {
    await cancelWaiting(caller, checked(cancelInput, body).outboxId)
    return phoneStatus(caller)
  },
}

async function fromPhone(action: 'claim' | 'report', body: unknown, request: Request): Promise<Response> {
  const device = await deviceForKey(request)
  // Unknown, revoked, and expired keys get the same answer, and a Shortcut that reads `next` stops.
  if (device === 'pair_again') return json(pairAgainBody(), 401)
  if (rateLimited(`phone:${device.id}`, MAX_PER_DEVICE)) return json({ next: 'none' }, 429)
  if (action === 'claim') return json(await claimNext(device))
  const parsed = reportInput.safeParse(body)
  if (!parsed.success) return json({ ok: false }, 400)
  return (await report(device, parsed.data)) ? json({ ok: true }) : json({ ok: false }, 409)
}

export async function POST(request: Request): Promise<Response> {
  // Fail closed: without the service role nothing here can be checked or stored.
  if (!authConfigured() || !serviceConfigured()) return fail('The server has no Supabase settings, so it cannot check who is asking.', 503)
  if (rateLimited(`addr:${addressOf(request)}`, MAX_PER_ADDRESS)) return fail('Too many requests. Wait a few minutes and try again.', 429)

  const raw = await request.text()
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return fail('That request is too large.', 413)
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return fail('The request was not valid JSON.', 400)
  }
  const action = typeof body?.action === 'string' ? body.action : ''

  try {
    if (action === 'pair') {
      const parsed = pairInput.safeParse(body)
      if (!parsed.success) return fail('That request was not understood.', 400)
      return json({ ok: true, data: await pairWithCode(parsed.data.code) })
    }
    if (action === 'claim' || action === 'report') return await fromPhone(action, body, request)

    const handler = Object.hasOwn(COUNSELOR, action) ? COUNSELOR[action] : undefined
    if (!handler) return fail('Unknown action.', 400)
    const caller = await identify(request)
    if (!caller.ok) return caller.reason === 'no_firm' ? fail('Your account does not belong to a firm yet.', 403) : fail('Sign in again to set up your phone.', 401)
    if (rateLimited(`phone-user:${caller.userId}`, MAX_PER_USER)) return fail('Too many requests. Wait a few minutes and try again.', 429)
    return json({ ok: true, data: await handler(caller, body) })
  } catch (error) {
    if (error instanceof PhoneError) return fail(error.message, error.status)
    console.error('[phone]', error instanceof Error ? error.message : 'unknown')
    // The phone is always answered with a flat object it can read.
    return action === 'claim' ? json({ next: 'none' }, 500) : fail('Something went wrong. Please try again.', 500)
  }
}
