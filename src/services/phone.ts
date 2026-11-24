// The browser side of "Your phone": talks to /api/phone as the signed-in
// counselor. The device key is never kept here: it is shown once, straight
// from the answer to `connect`, and then forgotten.

import { PHONE_ENDPOINT, type PhoneStatus } from '../../shared/phoneGateway'
import { accessToken } from '../store/session'

/** A failure with a message fit to show. */
export class PhoneFailure extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}

type Reply<T> = { ok: true; data: T } | { ok: false; message: string }

async function post(token: string, body: string): Promise<Response> {
  try {
    return await fetch(PHONE_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body, signal: AbortSignal.timeout(30_000) })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new PhoneFailure('The server took too long to answer. Please try again.')
    throw new PhoneFailure('There is no connection to the server.')
  }
}

/** One counselor action of api/phone.ts. */
export async function callPhone<T = PhoneStatus>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = await accessToken()
  if (!token) throw new PhoneFailure('Sign in again to set up your phone.', 401)
  const payload = JSON.stringify({ action, ...body })
  let res = await post(token, payload)
  if (res.status === 401) {
    const fresh = await accessToken(true)
    if (fresh) res = await post(fresh, payload)
  }
  if (!res.headers.get('content-type')?.includes('application/json')) throw new PhoneFailure('Texting from your phone is not available on this deployment.', 404)
  const reply = (await res.json()) as Reply<T>
  if (!reply.ok) throw new PhoneFailure(reply.message, res.status)
  return reply.data
}

export const phoneReason = (error: unknown) => (error instanceof PhoneFailure ? error.message : 'Something went wrong. Please try again.')
