// A text waiting for a counselor's phone. Every change of a job's status goes
// through moveJob, which refuses a move the rules do not list, changes the row
// only if it is still in the status the caller saw, writes the event, updates
// the outbox row and adds the activity line.
//
// Nothing here sends anything, and nothing logs a number or message text.

import { PHONE_REASON, STOP_AFTER, jobCanMove, jobIsFinal, phoneHasStopped, type JobStatus } from '../../shared/phoneGateway.js'
import { serviceClient } from '../supabase.js'
import type { Job } from './config.js'

type Actor = 'dispatcher' | 'device' | 'counselor' | 'sweep'
export type By = { actor: Actor; actorId?: string; late?: boolean }

const db = () => serviceClient()
const kindLabel = (kind: string) => kind.replace(/_/g, ' ')

export async function recordEvent(jobId: string, from: string | null, to: string, by: By): Promise<void> {
  const { error } = await db().from('phone_job_events').insert({ job_id: jobId, from_status: from, to_status: to, actor: by.actor, actor_id: by.actorId ?? null, late: by.late ?? false })
  if (error) console.error('[phone] event not written:', error.message)
}

/** What a job's new status means for the message it came from: the outbox row and one activity line. */
async function tellOutbox(job: Job, to: JobStatus, by: By): Promise<void> {
  if (!job.outbox_id) return
  const found = await db().from('outbox').select('id, firm_id, student_id, to_name, kind').eq('id', job.outbox_id).maybeSingle()
  if (found.error || !found.data) return
  const row = found.data
  const what = `${kindLabel(row.kind)} to ${row.to_name}`
  let patch: { status?: string; delivery_detail?: string | null; provider_message_id?: string; error?: string | null; sent_at?: string } | undefined
  let line: string
  switch (to) {
    case 'claimed':
      line = `Your phone took a ${what}.`
      break
    case 'submitted':
      // "Sent from your phone", never "delivered": the phone only says it handed the text to Messages.
      patch = { status: 'sent', delivery_detail: 'phone_sent', provider_message_id: `phone_${job.id}`, error: null, sent_at: new Date().toISOString() }
      line = by.late ? `Your phone confirmed, late, that it sent a ${what}.` : by.actor === 'counselor' ? `You confirmed your phone sent a ${what}.` : `Sent a ${what} from your phone.`
      break
    case 'failed':
      patch = { status: 'failed', delivery_detail: 'phone_failed', error: job.error ?? 'Your phone could not send it.' }
      line = `Failed to send a ${what}: ${job.error ?? 'your phone could not send it.'}`
      break
    case 'unknown':
      patch = { delivery_detail: 'phone_unknown' }
      line = `Your phone took a ${what} but did not confirm it.`
      break
    case 'expired':
      patch = { status: 'failed', delivery_detail: 'phone_expired', error: PHONE_REASON.expired }
      line = `Your phone did not answer for a ${what}.`
      break
    case 'cancelled':
      patch = { status: 'cancelled', delivery_detail: null }
      line = `Cancelled a ${what} before your phone took it.`
      break
    default:
      return
  }
  if (patch) {
    // Only while the row is still held for the phone: a row cancelled or settled another way is left alone.
    const { error } = await db().from('outbox').update(patch).eq('id', row.id).eq('status', 'sending')
    if (error) console.error('[phone] outbox not updated:', error.message)
  }
  const { error } = await db().from('activity').insert({ firm_id: row.firm_id, student_id: row.student_id, actor: 'system', text: line })
  if (error) console.error('[phone] activity not written:', error.message)
}

/**
 * Moves a job to a new status, or returns undefined when the rules refuse the
 * move or someone else changed the job first. A claim that is not reported in
 * time returns to pending. A finished job drops its text in the same update.
 */
export async function moveJob(job: Job, to: JobStatus, by: By, fields: Partial<Pick<Job, 'error' | 'reported_at' | 'claim_id' | 'claimed_at' | 'lease_expires_at' | 'body'>> = {}): Promise<Job | undefined> {
  if (!jobCanMove(job.status, to)) return undefined
  // The phone already has the text from the claim response. A finished row does not keep it.
  const patch = jobIsFinal(to) ? { ...fields, body: null } : fields
  const { data, error } = await db().from('phone_send_jobs').update({ status: to, ...patch }).eq('id', job.id).eq('status', job.status).select('*').maybeSingle()
  if (error) throw new Error('the phone job could not be updated')
  if (!data) return undefined
  await recordEvent(data.id, job.status, to, by)
  await tellOutbox(data, to, by)
  return data
}

/** After the database has handed a job to a phone (claim_phone_send_job): the event and the activity line. */
export async function noteClaimed(job: Job, deviceId: string): Promise<void> {
  const by: By = { actor: 'device', actorId: deviceId }
  await recordEvent(job.id, 'pending', 'claimed', by)
  await tellOutbox(job, 'claimed', by)
}

/**
 * Makes the job for one outbox row. The outbox id is unique in the table, so a
 * second call for the same row makes nothing and says so.
 */
export async function createJob(input: { outboxId: string | null; deviceId: string; toPhone: string; body: string }, by: By): Promise<{ job: Job } | { conflict: true }> {
  const { data, error } = await db().from('phone_send_jobs').insert({ outbox_id: input.outboxId, device_id: input.deviceId, to_phone: input.toPhone, body: input.body }).select('*').maybeSingle()
  if (error?.code === '23505') return { conflict: true }
  if (error || !data) throw new Error('the phone job could not be made')
  await recordEvent(data.id, null, 'pending', by)
  return { job: data }
}

/**
 * Gives up on jobs nobody answered: a waiting job past its ten minutes becomes
 * expired. A job a phone took and did not report on within ten minutes goes
 * back to the queue. The text stays, so the next claim can hand it out again.
 *
 * Runs whenever a phone asks for work, whenever a counselor looks at their
 * phone's status, and whenever the dispatcher runs. Returns how many jobs it moved.
 */
export async function sweepJobs(): Promise<number> {
  const now = new Date().toISOString()
  let moved = 0
  const waiting = await db().from('phone_send_jobs').select('*').eq('status', 'pending').lt('expires_at', now).limit(50)
  if (waiting.error) throw new Error('could not read the waiting jobs')
  for (const job of waiting.data ?? []) if (await moveJob(job, 'expired', { actor: 'sweep' })) moved++
  const taken = await db().from('phone_send_jobs').select('*').eq('status', 'claimed').lt('lease_expires_at', now).limit(50)
  if (taken.error) throw new Error('could not read the claimed jobs')
  for (const job of taken.data ?? []) {
    if (await moveJob(job, 'pending', { actor: 'sweep' }, { claim_id: null, claimed_at: null, lease_expires_at: null })) moved++
  }
  return moved
}

/** True when the phone's last few finished jobs all went unanswered. No new job is made for it until a test succeeds. */
export async function deviceHasStopped(deviceId: string): Promise<boolean> {
  const { data, error } = await db().from('phone_send_jobs').select('status').eq('device_id', deviceId).in('status', ['submitted', 'failed', 'expired', 'unknown']).order('created_at', { ascending: false }).limit(STOP_AFTER)
  if (error) throw new Error('could not read the jobs of this phone')
  return phoneHasStopped((data ?? []).map((j) => j.status))
}
