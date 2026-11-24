// Checks claim_phone_send_job against the REAL database function. Run with:
//
//   npm run test:phone:db
//
// Like test:isolation, this creates rows in the linked Supabase project, so do
// not run it unless the task says so. It needs VITE_SUPABASE_URL,
// VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local.
//
// What it makes, and removes again at the end: one phone_devices row that is
// already revoked (so no phone can ever use it, and it does not collide with a
// counselor's real phone), with a random key hash nobody holds the key for,
// and a few jobs for it to an invented number. Nothing is sent: a job only
// leaves the server when a phone with the key claims it, and there is none.

import { createHash, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/lib/database.types.js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
if (!url || !serviceKey || !anonKey) {
  console.error('Missing Supabase settings in .env.local.')
  process.exit(1)
}
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const db = createClient<Database>(url, serviceKey, options)
const anon = createClient<Database>(url, anonKey, options)

let failed = 0
function check(name: string, pass: boolean, detail = ''): void {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

/** An invented number: 555-01xx is reserved for fiction. */
const NUMBER = '+12025550143'

const member = await db.from('firm_members').select('firm_id, user_id').limit(1).maybeSingle()
if (member.error || !member.data) {
  console.error('No firm member to attach the test phone to.')
  process.exit(1)
}

const made = await db
  .from('phone_devices')
  .insert({
    firm_id: member.data.firm_id,
    counselor_id: member.data.user_id,
    label: 'claim test (safe to delete)',
    key_hash: createHash('sha256').update(randomBytes(32)).digest('hex'),
    wake_email: 'nobody@example.com',
    revoked_at: new Date().toISOString(),
  })
  .select('id')
  .single()
if (made.error) {
  console.error('The test phone could not be made:', made.error.message)
  process.exit(1)
}
const device = made.data.id

const addJob = async (fields: { expires_at?: string } = {}) => {
  const { data, error } = await db.from('phone_send_jobs').insert({ device_id: device, to_phone: NUMBER, body: 'claim test', ...fields }).select('id').single()
  if (error) throw new Error(error.message)
  return data.id
}
const claimMany = async (calls: number) => {
  const answers = await Promise.all(Array.from({ length: calls }, () => db.rpc('claim_phone_send_job', { device })))
  return { errors: answers.filter((a) => a.error).length, rows: answers.flatMap((a) => a.data ?? []) }
}

try {
  // ── One job, many claims at once ──
  let exact = 0
  const ROUNDS = 5
  for (let round = 0; round < ROUNDS; round++) {
    const job = await addJob()
    const { errors, rows } = await claimMany(12)
    if (errors === 0 && rows.length === 1 && rows[0].id === job) exact++
  }
  check(`twelve claims at once for one job: exactly one gets it, in each of ${ROUNDS} rounds`, exact === ROUNDS, `${exact} of ${ROUNDS}`)

  // ── Two at once, as the brief words it ──
  const pair = await addJob()
  const two = await claimMany(2)
  check('two claims at once for one job: exactly one gets it', two.errors === 0 && two.rows.length === 1 && two.rows[0].id === pair)
  const row = two.rows[0]
  check('the claimed job has status claimed, a claim id and a two-minute lease', row?.status === 'claimed' && Boolean(row.claim_id) && Boolean(row.claimed_at) && Math.abs(Date.parse(String(row.lease_expires_at)) - Date.parse(String(row.claimed_at)) - 120_000) < 1000)

  // ── Several jobs, more claims than jobs ──
  const three = [await addJob(), await addJob(), await addJob()]
  const many = await claimMany(12)
  const ids = many.rows.map((r) => r.id)
  check('three jobs and twelve claims at once: each job is handed out exactly once', many.errors === 0 && ids.length === 3 && new Set(ids).size === 3 && three.every((id) => ids.includes(id)))
  check('…each with its own claim id', new Set(many.rows.map((r) => r.claim_id)).size === 3)

  // ── Oldest first, one at a time ──
  const older = await addJob()
  await new Promise((resolve) => setTimeout(resolve, 50))
  const newer = await addJob()
  const firstOut = await db.rpc('claim_phone_send_job', { device })
  const secondOut = await db.rpc('claim_phone_send_job', { device })
  check('the oldest waiting job is handed out first', firstOut.data?.[0]?.id === older && secondOut.data?.[0]?.id === newer)

  // ── What is never handed out ──
  const expired = await addJob({ expires_at: new Date(Date.now() - 1000).toISOString() })
  const none = await claimMany(4)
  check('a job past its ten minutes is never handed out', none.errors === 0 && none.rows.length === 0)
  const still = await db.from('phone_send_jobs').select('status').eq('id', expired).single()
  check('…and stays pending for the sweep to expire', still.data?.status === 'pending')
  const again = await db.rpc('claim_phone_send_job', { device })
  check('a claimed job is never handed out a second time', (again.data ?? []).length === 0)
  const other = await db.rpc('claim_phone_send_job', { device: crypto.randomUUID() })
  check('another phone gets nothing of this one’s', !other.error && (other.data ?? []).length === 0)

  // ── Signed-out and signed-in people cannot reach any of it ──
  const anonCall = await anon.rpc('claim_phone_send_job', { device })
  check('the function cannot be called without the service role', Boolean(anonCall.error))
  const anonJobs = await anon.from('phone_send_jobs').select('id').limit(1)
  const anonDevices = await anon.from('phone_devices').select('id').limit(1)
  const anonEvents = await anon.from('phone_job_events').select('id').limit(1)
  check('the three tables cannot be read without the service role', [anonJobs, anonDevices, anonEvents].every((answer) => Boolean(answer.error) || (answer.data ?? []).length === 0), [anonJobs, anonDevices, anonEvents].map((a) => a.error?.code ?? 'no error, no rows').join(', '))

  // ── The rules the table itself holds ──
  const sameHash = await db.from('phone_devices').select('key_hash').eq('id', device).single()
  const duplicate = await db.from('phone_devices').insert({ firm_id: member.data.firm_id, counselor_id: member.data.user_id, label: 'duplicate', key_hash: sameHash.data?.key_hash ?? '', wake_email: 'nobody@example.com', revoked_at: new Date().toISOString() })
  check('two phones cannot share a key hash', duplicate.error?.code === '23505')
  const badNumber = await db.from('phone_send_jobs').insert({ device_id: device, to_phone: '555-0143', body: 'x' })
  check('a job’s number must be E.164', badNumber.error?.code === '23514')
  const badStatus = await db.from('phone_send_jobs').update({ status: 'delivered' }).eq('id', expired)
  check('a job cannot take a status that is not on the list', badStatus.error?.code === '23514')
} finally {
  // Jobs and events go with the phone.
  const gone = await db.from('phone_devices').delete().eq('id', device)
  const left = await db.from('phone_send_jobs').select('id').eq('device_id', device)
  check('the test rows were removed', !gone.error && (left.data ?? []).length === 0)
}

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('All checks against the real database passed')
