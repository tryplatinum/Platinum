// The wake email: one short message from the counselor's own Gmail to that
// same address, which an automation on their iPhone reacts to by asking
// /api/phone for work.
//
// It is the one send that does not go through the dispatcher, so it is held
// tightly:
//   * it goes only to the device's saved wake address, and only when that
//     address is on SEND_ALLOWLIST;
//   * its subject is "Platinum wake " and six random characters, its body is
//     "Wake." and nothing else: no name, no number, no message text, no job id,
//     no link;
//   * at most one per phone per 20 seconds. Jobs made inside that time ride on
//     the same wake, because the Shortcut keeps asking until there is no work.
//
// The email carries no authority. A forged or repeated wake only makes the
// phone call "claim", which hands out already-approved jobs once each.
//
// PHONE_WAKE_FAKE=1 records wakes instead of sending them, for local work
// only. It is refused in a build and on Vercel.

import { randomBytes } from 'node:crypto'
import { WAKE_BODY, WAKE_GAP_MS, WAKE_SUBJECT_PREFIX } from '../../shared/phoneGateway.js'
import { serviceClient } from '../supabase.js'
import { GmailTransport } from '../transport/gmail.js'
import { onAllowlist, type Device } from './config.js'

export type WakeEmail = { to: string; subject: string; body: string; senderUserId: string }
export type WakeOutcome = 'sent' | 'recent' | 'not_allowed' | 'failed'

/** True when wakes are recorded instead of sent. Throws anywhere but `npm run dev`. */
export function wakeFake(): boolean {
  if ((process.env.PHONE_WAKE_FAKE ?? '').trim() !== '1') return false
  if (process.env.VERCEL || process.env.NODE_ENV === 'production' || process.env.PLATINUM_DEV_SERVER !== '1') {
    throw new Error('PHONE_WAKE_FAKE=1 is only for `npm run dev`. Remove it from this environment.')
  }
  return true
}

export const wake = {
  /** Wakes recorded in fake mode: which phone and when. Never an address. */
  recorded: [] as { deviceId: string; at: string }[],
  /** Sends one wake email with the existing Gmail send function. Tests replace this. */
  async deliver(email: WakeEmail): Promise<void> {
    await new GmailTransport().send({ channel: 'email', to: email.to, subject: email.subject, body: email.body, language: 'en', senderUserId: email.senderUserId })
  },
}

const SUBJECT_LETTERS = 'abcdefghijklmnopqrstuvwxyz0123456789'
const randomTail = () => Array.from(randomBytes(6), (byte) => SUBJECT_LETTERS[byte % SUBJECT_LETTERS.length]).join('')

/** Wakes one phone, from the counselor's own Gmail. Never throws: a wake that fails leaves the job to expire. */
export async function wakeDevice(device: Pick<Device, 'id' | 'wake_email'>, counselor: { userId: string }): Promise<WakeOutcome> {
  if (!onAllowlist('email', device.wake_email)) return 'not_allowed'
  // The gap is kept in the database, in one statement, so two calls at once send one wake.
  const cutoff = new Date(Date.now() - WAKE_GAP_MS).toISOString()
  const gate = await serviceClient().from('phone_devices').update({ last_wake_at: new Date().toISOString() }).eq('id', device.id).or(`last_wake_at.is.null,last_wake_at.lt.${cutoff}`).select('id').maybeSingle()
  if (gate.error) return 'failed'
  if (!gate.data) return 'recent'
  try {
    if (wakeFake()) wake.recorded.push({ deviceId: device.id, at: new Date().toISOString() })
    else await wake.deliver({ to: device.wake_email, subject: `${WAKE_SUBJECT_PREFIX}${randomTail()}`, body: WAKE_BODY, senderUserId: counselor.userId })
    return 'sent'
  } catch (error) {
    // The Gmail transport's messages are short plain sentences with no token and no address.
    console.error('[phone] wake not sent:', error instanceof Error ? error.message : 'unknown')
    return 'failed'
  }
}
