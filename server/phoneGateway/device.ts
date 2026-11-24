// What the phone may do: ask for the next job, and report how it went. The
// phone proves itself with its device key, of which the server keeps only a
// hash. Send-only: the phone uploads nothing but job results.
//
// A job is handed out once. A job whose outcome is not confirmed is never
// handed out again.

import { CLAIMS_PER_DAY, CLAIMS_PER_HOUR, PHONE_REASON, type ClaimAnswer } from '../../shared/phoneGateway.js'
import { serviceClient } from '../supabase.js'
import { onAllowlist, type Device, type Job } from './config.js'
import { moveJob, noteClaimed, sweepJobs } from './jobs.js'
import { hashKey, looksLikeKey, sameHash } from './keys.js'

const db = () => serviceClient()

/** The phone this request's key belongs to. Undefined for no key, an unknown key or a revoked one. */
export async function deviceForKey(request: Request): Promise<Device | undefined> {
  const key = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!key || !looksLikeKey(key)) return undefined
  const hash = hashKey(key)
  const { data, error } = await db().from('phone_devices').select('*').eq('key_hash', hash).maybeSingle()
  if (error || !data) return undefined
  if (!sameHash(data.key_hash, hash) || data.revoked_at) return undefined
  return data
}

async function claimsSince(deviceId: string, since: number, atMost: number): Promise<number> {
  const { data, error } = await db().from('phone_send_jobs').select('id').eq('device_id', deviceId).gte('claimed_at', new Date(since).toISOString()).limit(atMost)
  if (error) throw new Error('could not count this phone’s claims')
  return (data ?? []).length
}

/** Why a claimed job must not be handed over after all, or undefined when it may be. */
async function refusal(job: Job): Promise<string | undefined> {
  // The recipient may have been taken off the list since the job was made.
  if (!onAllowlist('text', job.to_phone)) return PHONE_REASON.offList
  if (job.outbox_id) {
    const { data, error } = await db().from('outbox').select('status').eq('id', job.outbox_id).maybeSingle()
    if (error) return 'The message could not be checked.'
    if (!data || data.status !== 'sending') return PHONE_REASON.cancelled
  }
  return undefined
}

/** The next job for this phone, or "none". Always a flat object with `next`. */
export async function claimNext(device: Device): Promise<ClaimAnswer> {
  await sweepJobs()
  const now = new Date().toISOString()
  await db().from('phone_devices').update({ last_seen_at: now, ...(device.first_seen_at ? {} : { first_seen_at: now }) }).eq('id', device.id)

  // A handful of tries: a job that fails its checks is marked failed and the next one is tried.
  for (let tries = 0; tries < 5; tries++) {
    // Over the cap, the job stays pending. It is not lost; it expires if the hour does not turn first.
    if ((await claimsSince(device.id, Date.now() - 3_600_000, CLAIMS_PER_HOUR)) >= CLAIMS_PER_HOUR) return { next: 'none' }
    if ((await claimsSince(device.id, Date.now() - 86_400_000, CLAIMS_PER_DAY)) >= CLAIMS_PER_DAY) return { next: 'none' }

    const claimed = await db().rpc('claim_phone_send_job', { device: device.id })
    if (claimed.error) throw new Error('the next job could not be claimed')
    const job = (claimed.data ?? [])[0] as Job | undefined
    if (!job || !job.claim_id) return { next: 'none' }
    await noteClaimed(job, device.id)

    const why = await refusal(job)
    if (why) {
      await moveJob(job, 'failed', { actor: 'dispatcher' }, { error: why })
      continue
    }
    return { next: 'send', job_id: job.id, claim_id: job.claim_id, to_phone: job.to_phone, body: job.body }
  }
  return { next: 'none' }
}

/** One line, bounded, with nothing that could be mistaken for markup. The phone's own words about why it failed. */
const tidy = (text: string | undefined) => (text ?? '').replace(/[\p{Cc}]+/gu, ' ').trim().slice(0, 160)

/**
 * The phone says how a job went. Refused unless the claim id is the one this
 * job was handed out with. The same report twice changes nothing. A report for
 * a job that had been given up on (unknown) is accepted, and noted as late.
 */
export async function report(device: Device, input: { job_id: string; claim_id: string; result: 'submitted' | 'failed'; error?: string }): Promise<boolean> {
  const { data: job, error } = await db().from('phone_send_jobs').select('*').eq('id', input.job_id).eq('device_id', device.id).maybeSingle()
  if (error || !job || !job.claim_id || job.claim_id !== input.claim_id) return false
  if (job.status === input.result) return true
  if (job.status !== 'claimed' && job.status !== 'unknown') return false
  const late = job.status === 'unknown'
  const reason = input.result === 'failed' ? `Your phone could not send it${tidy(input.error) ? `: ${tidy(input.error)}` : '.'}` : null
  const moved = await moveJob(job, input.result, { actor: 'device', actorId: device.id, late }, { reported_at: new Date().toISOString(), error: reason })
  if (moved) return true
  // Someone else settled it in the same moment (a second copy of this report, or the counselor's answer).
  const again = await db().from('phone_send_jobs').select('status').eq('id', job.id).maybeSingle()
  return again.data?.status === input.result
}
