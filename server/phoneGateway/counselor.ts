// What the signed-in counselor may do with their own phone: connect it, see how
// it is doing, test it, wake it, disconnect it, and answer for a text the phone
// took but never confirmed.
//
// The device key leaves the server once, in the answer to `connect`. No other
// answer holds a key or a hash.

import { normalizePhone } from '../../shared/dispatch.js'
import { DEVICE_KEY_MS, PHONE_REASON, SEEN_RECENTLY_MS, SETUP_CODE_MS, TEST_BODY, phoneStateLabel, type JobStatus, type PhoneJobLine, type PhoneState, type PhoneStatus } from '../../shared/phoneGateway.js'
import { serviceClient, serviceConfigured } from '../supabase.js'
import { PhoneError, activeDevice, gmailOf, onAllowlist, textViaPhone, type Counselor, type Device, type Job } from './config.js'
import { createJob, deviceHasStopped, moveJob, sweepJobs } from './jobs.js'
import { hashKey, newDeviceKey, newSetupCode } from './keys.js'
import { wakeDevice } from './wake.js'

const db = () => serviceClient()
const E164 = /^\+[0-9]{7,15}$/

const HIDDEN: PhoneStatus = { available: false, on: false, gmail: { connected: false, allowed: false }, noticeShown: false, jobs: [] }

async function devicesOf(who: Counselor): Promise<Device[]> {
  const { data, error } = await db().from('phone_devices').select('*').eq('counselor_id', who.userId).eq('firm_id', who.firmId).order('created_at', { ascending: false }).limit(50)
  if (error) throw new Error('could not read the phones')
  return data ?? []
}

async function stateOf(device: Device): Promise<PhoneState> {
  if (await deviceHasStopped(device.id)) return 'stopped'
  if (!device.first_seen_at) return 'waiting'
  return device.last_seen_at && Date.now() - Date.parse(device.last_seen_at) < SEEN_RECENTLY_MS ? 'connected' : 'not_seen'
}

/** The phone, how it is doing, and its last 20 jobs. Never a key, a hash or a phone number other than the counselor's own. */
export async function phoneStatus(who: Counselor): Promise<PhoneStatus> {
  if (!serviceConfigured()) return HIDDEN
  await sweepJobs()
  const [gmail, devices] = await Promise.all([gmailOf(who), devicesOf(who)])
  const device = devices.find((d) => !d.revoked_at)

  let jobs: PhoneJobLine[] = []
  if (devices.length > 0) {
    const found = await db().from('phone_send_jobs').select('id, outbox_id, status, created_at, claimed_at, reported_at, error').in('device_id', devices.map((d) => d.id)).order('created_at', { ascending: false }).limit(20)
    if (found.error) throw new Error('could not read the jobs')
    const rows = found.data ?? []
    const outboxIds = rows.map((j) => j.outbox_id).filter((id): id is string => Boolean(id))
    const names = new Map<string, string>()
    if (outboxIds.length > 0) {
      const named = await db().from('outbox').select('id, to_name').in('id', outboxIds)
      for (const row of named.data ?? []) names.set(row.id, row.to_name)
    }
    jobs = rows.map((j) => ({
      id: j.id,
      to: j.outbox_id ? (names.get(j.outbox_id) ?? 'A removed message') : 'You (test)',
      status: j.status as JobStatus,
      createdAt: j.created_at,
      claimedAt: j.claimed_at ?? undefined,
      reportedAt: j.reported_at ?? undefined,
      error: j.error ?? undefined,
    }))
  }

  const state = device ? await stateOf(device) : undefined
  return {
    available: true,
    on: textViaPhone(),
    gmail: { connected: gmail.connected, address: gmail.address, allowed: Boolean(gmail.address && onAllowlist('email', gmail.address)) },
    noticeShown: devices.some((d) => d.notice_shown_at),
    device:
      device && state
        ? {
            label: device.label,
            wakeEmail: device.wake_email,
            ownPhone: device.own_phone ?? undefined,
            firstSeenAt: device.first_seen_at ?? undefined,
            lastSeenAt: device.last_seen_at ?? undefined,
            state,
            stateLabel: phoneStateLabel(state, device.last_seen_at ?? undefined),
          }
        : undefined,
    jobs,
  }
}

/**
 * Starts pairing. Returns a short code once. The phone exchanges it for a
 * device key. The code is stored only as a hash and is not a URL.
 */
export async function connectPhone(who: Counselor, input: { label: string; noticeShown?: boolean }): Promise<{ code: string; expiresAt: string }> {
  const gmail = await gmailOf(who)
  if (!gmail.connected || !gmail.address) throw new PhoneError('Connect Gmail first')
  if (!onAllowlist('email', gmail.address)) throw new PhoneError('That address is not on the allowed list yet')

  const now = new Date().toISOString()
  const retired = await db().from('phone_setup_codes').update({ used_at: now }).eq('counselor_id', who.userId).is('used_at', null)
  if (retired.error) throw new Error('the earlier code could not be retired')

  const code = newSetupCode()
  const expiresAt = new Date(Date.now() + SETUP_CODE_MS).toISOString()
  const { error } = await db().from('phone_setup_codes').insert({
    firm_id: who.firmId,
    counselor_id: who.userId,
    code_hash: hashKey(code),
    notice_shown: Boolean(input.noticeShown),
    label: input.label,
    expires_at: expiresAt,
  })
  if (error) throw new Error('the setup code could not be saved')
  return { code, expiresAt }
}

/**
 * Turns a setup code into a device key. The code works once. Any phone this
 * counselor already had is revoked. The key is returned once; only its hash is kept.
 */
export async function pairWithCode(code: string): Promise<{ key: string; expiresAt: string }> {
  const hash = hashKey(code.trim().toUpperCase())
  const found = await db().from('phone_setup_codes').select('*').eq('code_hash', hash).maybeSingle()
  if (found.error) throw new Error('the setup code could not be read')
  const row = found.data
  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) throw new PhoneError('That code has expired. Pair your phone again.', 400)

  const spent = await db().from('phone_setup_codes').update({ used_at: new Date().toISOString() }).eq('id', row.id).is('used_at', null).select('id').maybeSingle()
  if (spent.error || !spent.data) throw new PhoneError('That code has expired. Pair your phone again.', 400)

  const gmail = await gmailOf({ userId: row.counselor_id, firmId: row.firm_id })
  if (!gmail.connected || !gmail.address) throw new PhoneError('Connect Gmail first')
  if (!onAllowlist('email', gmail.address)) throw new PhoneError('That address is not on the allowed list yet')

  const earlier = await devicesOf({ userId: row.counselor_id, firmId: row.firm_id })
  const now = new Date().toISOString()
  const revoked = await db().from('phone_devices').update({ revoked_at: now }).eq('counselor_id', row.counselor_id).is('revoked_at', null)
  if (revoked.error) throw new Error('the earlier phone could not be disconnected')

  const key = newDeviceKey()
  const expiresAt = new Date(Date.now() + DEVICE_KEY_MS).toISOString()
  const { error } = await db()
    .from('phone_devices')
    .insert({
      firm_id: row.firm_id,
      counselor_id: row.counselor_id,
      platform: 'ios_shortcut',
      label: row.label,
      key_hash: hashKey(key),
      key_expires_at: expiresAt,
      wake_email: gmail.address,
      own_phone: earlier.find((d) => d.own_phone)?.own_phone ?? null,
      notice_shown_at: row.notice_shown ? now : (earlier.find((d) => d.notice_shown_at)?.notice_shown_at ?? null),
    })
  if (error) throw new Error('the phone could not be saved')
  return { key, expiresAt }
}

async function requireDevice(who: Counselor): Promise<Device> {
  const device = await activeDevice(who)
  if (!device) throw new PhoneError('Connect your iPhone first.')
  return device
}

function requireOn(): void {
  if (!textViaPhone()) throw new PhoneError('Texting from your phone is switched off on this server.')
}

/** Saves the counselor's own number, which the test text goes to. An empty value removes it. */
export async function saveOwnNumber(who: Counselor, raw: string): Promise<void> {
  const device = await requireDevice(who)
  const phone = raw.trim() === '' ? null : (normalizePhone(raw) ?? '')
  if (phone !== null && !E164.test(phone)) throw new PhoneError('That does not look like a phone number.', 400)
  const { error } = await db().from('phone_devices').update({ own_phone: phone }).eq('id', device.id)
  if (error) throw new Error('the number could not be saved')
}

/** Sends the wake email only. */
export async function wakeNow(who: Counselor): Promise<void> {
  requireOn()
  const device = await requireDevice(who)
  if (!(await gmailOf(who)).connected) throw new PhoneError(PHONE_REASON.noGmail)
  const outcome = await wakeDevice(device, who)
  if (outcome === 'not_allowed') throw new PhoneError('That address is not on the allowed list yet')
  if (outcome === 'recent') throw new PhoneError('A wake email went out a moment ago. Wait 20 seconds and try again.', 429)
  if (outcome === 'failed') throw new PhoneError('The wake email could not be sent. Check the Gmail connection in settings.')
}

/**
 * A text to the counselor's own number, to try the phone end to end: a job, a
 * wake, the phone's claim and its report. It has no outbox row (the outbox
 * holds only messages to a student or a parent), so it is made here, with the
 * same checks: the number must be on the allowed list, and the text is fixed.
 */
export async function sendTest(who: Counselor): Promise<void> {
  requireOn()
  const device = await requireDevice(who)
  if (!device.own_phone) throw new PhoneError('Save your own phone number first.')
  if (!onAllowlist('text', device.own_phone)) throw new PhoneError('Your own number is not on the allowed list yet.')
  if (!(await gmailOf(who)).connected) throw new PhoneError(PHONE_REASON.noGmail)
  if (!onAllowlist('email', device.wake_email)) throw new PhoneError('That address is not on the allowed list yet')
  const made = await createJob({ outboxId: null, deviceId: device.id, toPhone: device.own_phone, body: TEST_BODY }, { actor: 'counselor', actorId: who.userId })
  if ('conflict' in made) throw new Error('the test could not be made')
  await wakeDevice(device, who)
}

export async function disconnectPhone(who: Counselor): Promise<void> {
  const { error } = await db().from('phone_devices').update({ revoked_at: new Date().toISOString() }).eq('counselor_id', who.userId).eq('firm_id', who.firmId).is('revoked_at', null)
  if (error) throw new Error('the phone could not be disconnected')
}

/** A job of one of this counselor's own phones, by its id or by the outbox row it came from. */
async function ownJob(who: Counselor, by: { jobId?: string; outboxId?: string }): Promise<Job> {
  const query = db().from('phone_send_jobs').select('*')
  const { data, error } = await (by.jobId ? query.eq('id', by.jobId) : query.eq('outbox_id', by.outboxId ?? '')).maybeSingle()
  if (error) throw new Error('could not read the job')
  const mine = data ? (await devicesOf(who)).some((d) => d.id === data.device_id) : false
  if (!data || !mine) throw new PhoneError('That text was not found.', 404)
  return data
}

/** The counselor's answer for a text the phone took but never confirmed. */
export async function resolveUnknown(who: Counselor, input: { jobId?: string; outboxId?: string; sent: boolean }): Promise<void> {
  const job = await ownJob(who, input)
  const by = { actor: 'counselor' as const, actorId: who.userId }
  const moved =
    job.status === 'unknown'
      ? input.sent
        ? await moveJob(job, 'submitted', by, { reported_at: new Date().toISOString() })
        : await moveJob(job, 'failed', by, { reported_at: new Date().toISOString(), error: PHONE_REASON.notSent })
      : undefined
  if (!moved) throw new PhoneError('That text is no longer waiting for an answer.')
}

/** Cancels a text that is waiting for the phone. Works only until the phone takes it. */
export async function cancelWaiting(who: Counselor, outboxId: string): Promise<void> {
  const job = await ownJob(who, { outboxId })
  const moved = job.status === 'pending' ? await moveJob(job, 'cancelled', { actor: 'counselor', actorId: who.userId }) : undefined
  if (!moved) throw new PhoneError('Your phone has already taken this text, so it cannot be cancelled.')
}
