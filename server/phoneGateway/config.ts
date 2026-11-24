// Settings for texts from a counselor's own phone, and the small checks every
// part of it shares.
//
// Off by default. Text goes to a phone only when the server value
// TRANSPORT_TEXT is exactly "phone" (case and spaces aside, as TRANSPORT_EMAIL
// is read). Unset, nothing here changes how a text is handled.

import { allowlistAllows, parseAllowlist } from '../../shared/dispatch.js'
import { GMAIL_SEND_SCOPE } from '../../shared/google.js'
import type { Database } from '../../src/lib/database.types.js'
import { googleAvailable } from '../google/connection.js'
import { serviceClient } from '../supabase.js'

export type Device = Database['public']['Tables']['phone_devices']['Row']
export type Job = Database['public']['Tables']['phone_send_jobs']['Row']

export const textViaPhone = () => (process.env.TRANSPORT_TEXT || '').trim().toLowerCase() === 'phone'

/** Read each time, so a change to SEND_ALLOWLIST is honored by the next call. */
export const onAllowlist = (channel: 'text' | 'email', address: string) => allowlistAllows(parseAllowlist(process.env.SEND_ALLOWLIST), channel, address)

/** A failure with a sentence fit to show the counselor. Never holds a key, a number or message text. */
export class PhoneError extends Error {
  status: number
  constructor(message: string, status = 409) {
    super(message)
    this.status = status
  }
}

export type Counselor = { userId: string; firmId: string }

/** The counselor's phone in use, if any. Bound to their present firm. */
export async function activeDevice(who: Counselor): Promise<Device | undefined> {
  const { data, error } = await serviceClient().from('phone_devices').select('*').eq('counselor_id', who.userId).eq('firm_id', who.firmId).is('revoked_at', null).maybeSingle()
  if (error) throw new Error('could not read the phone')
  return data ?? undefined
}

/** Whether this counselor can send from Gmail right now, and from which address. The wake email goes to that same address. */
export async function gmailOf(who: Counselor): Promise<{ connected: boolean; address?: string }> {
  if (!googleAvailable()) return { connected: false }
  const { data, error } = await serviceClient().from('google_connections').select('google_address, scopes, last_error').eq('user_id', who.userId).eq('firm_id', who.firmId).maybeSingle()
  if (error) throw new Error('could not read the Gmail connection')
  if (!data || !data.scopes.includes(GMAIL_SEND_SCOPE) || data.last_error === 'reconnect') return { connected: false, address: data?.google_address }
  return { connected: true, address: data.google_address }
}
