// Offline checks for texts from a counselor's own iPhone. Run with:
//
//   npm run test:outbox      (runs this after scripts/test-outbox.ts)
//
// No keys and no network. Nothing is sent: no text and no email leaves this
// machine. The database is the in-memory stand-in in scripts/fakeSupabase.ts,
// Google is the invented one in server/google/fakeDrive.ts, and a request to
// any real address fails the run.
//
// What this does NOT check: the SQL. claim_phone_send_job is stood in for by
// a function below that does the same thing in one step of JavaScript, so
// "two claims at once" is proven against the stand-in, not against Postgres.
// Row level security and the grants on the three tables are not checked here.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { POST } from '../api/phone.js'
import { STUDENT_LINK_PLACEHOLDER } from '../shared/dispatch.js'
import { DRIVE_SCOPE, GMAIL_SEND_SCOPE } from '../shared/google.js'
import { outboxStatusLabel } from '../shared/outbox.js'
import {
  CLAIMS_PER_HOUR,
  HAND_SENT_NOTE,
  JOB_STATUSES,
  NOT_CONFIRMED,
  PHONE_REASON,
  TEST_BODY,
  WAKE_BODY,
  WAKE_SUBJECT,
  canSendByHand,
  jobCanMove,
  jobsCsv,
  phoneHasStopped,
  phoneStatusLabel,
  type PhoneStatus,
} from '../shared/phoneGateway.js'
import { dispatchFirm } from '../server/dispatch.js'
import { google } from '../server/google/config.js'
import { fakeGoogle } from '../server/google/fakeDrive.js'
import { encryptToken } from '../server/google/secrets.js'
import { connectPhone, phoneStatus, sendTest } from '../server/phoneGateway/counselor.js'
import { claimNext } from '../server/phoneGateway/device.js'
import { createJob } from '../server/phoneGateway/jobs.js'
import { hashKey } from '../server/phoneGateway/keys.js'
import { wakeFake } from '../server/phoneGateway/wake.js'
import { GmailTransport } from '../server/transport/gmail.js'
import { getTransport } from '../server/transport/index.js'
import { LogTransport } from '../server/transport/log.js'
import { PhoneGatewayTransport } from '../server/transport/phoneGateway.js'
import { FAKE_SUPABASE_URL, fakeSupabase } from './fakeSupabase.js'

let failed = 0
function check(name: string, pass: boolean, detail = ''): void {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

// ── 1. Job status: every move ───────────────────────────────────────────────

{
  const allowed = new Set(['pending>claimed', 'pending>expired', 'pending>cancelled', 'claimed>submitted', 'claimed>failed', 'claimed>unknown', 'unknown>submitted', 'unknown>failed'])
  let wrong = 0
  for (const from of JOB_STATUSES) for (const to of JOB_STATUSES) if (jobCanMove(from, to) !== allowed.has(`${from}>${to}`)) wrong++
  check('every allowed move passes and every other move is refused', wrong === 0, `${JOB_STATUSES.length * JOB_STATUSES.length} pairs tried`)
  check('nothing ever returns to pending', JOB_STATUSES.every((from) => !jobCanMove(from, 'pending')))
  check('a finished job goes nowhere', ['submitted', 'failed', 'expired', 'cancelled'].every((from) => JOB_STATUSES.every((to) => !jobCanMove(from, to))))
  check('an unknown status is refused, not a crash', !jobCanMove('__proto__', 'claimed') && !jobCanMove('pending', 'delivered') && !jobCanMove('', ''))
  check('three unanswered jobs in a row stop a phone', phoneHasStopped(['expired', 'unknown', 'expired']) && !phoneHasStopped(['expired', 'unknown']) && !phoneHasStopped(['submitted', 'expired', 'expired', 'expired']))
}

// ── 2. Wording ──────────────────────────────────────────────────────────────

{
  const sendAfter = new Date(Date.now() - 1000).toISOString()
  check('a text waiting for the phone says so', outboxStatusLabel({ status: 'sending', sendAfter, detail: 'phone_waiting' }) === 'Waiting for your phone')
  check('a text the phone sent says “Sent from your phone”', outboxStatusLabel({ status: 'sent', sendAfter, detail: 'phone_sent' }) === 'Sent from your phone')
  check('an unconfirmed text says “Not confirmed”', outboxStatusLabel({ status: 'sending', sendAfter, detail: 'phone_unknown' }) === 'Not confirmed')
  check('a text the phone never took says “Phone did not answer”', outboxStatusLabel({ status: 'failed', sendAfter, detail: 'phone_expired', error: PHONE_REASON.expired }) === 'Phone did not answer')
  check('a failed text keeps its plain reason', outboxStatusLabel({ status: 'failed', sendAfter, detail: 'phone_none', error: PHONE_REASON.noDevice }) === `Failed: ${PHONE_REASON.noDevice}`)
  check('messages that never went near a phone read as before', outboxStatusLabel({ status: 'sent', sendAfter }) === 'Sent' && outboxStatusLabel({ status: 'sending', sendAfter }) === 'Sending' && outboxStatusLabel({ status: 'failed', sendAfter, error: 'x' }) === 'Failed: x')
  const words = [phoneStatusLabel({ status: 'sent', detail: 'phone_sent' }), NOT_CONFIRMED, ...Object.values(PHONE_REASON)].join(' ')
  check('nothing is worded as delivered or received', !/deliver|received/i.test(words))
  check('send by hand is offered for no phone, no answer and a failure', ['phone_none', 'phone_expired', 'phone_failed'].every((detail) => canSendByHand({ channel: 'text', status: 'failed', detail })))
  check('…and not while the phone may still send it, nor for email', !canSendByHand({ channel: 'text', status: 'sending', detail: 'phone_unknown' }) && !canSendByHand({ channel: 'text', status: 'sending', detail: 'phone_waiting' }) && !canSendByHand({ channel: 'email', status: 'failed', detail: 'phone_none' }) && !canSendByHand({ channel: 'text', status: 'failed' }))
  check('the latency log has names and timings, and a cell cannot be a formula', jobsCsv([{ id: '1', to: '=HYPERLINK("x")', status: 'submitted', createdAt: '2026-11-24T10:00:00Z', claimedAt: '2026-11-24T10:00:07Z', reportedAt: '2026-11-24T10:00:10Z' }]).split('\n')[1] === `"'=HYPERLINK(""x"")",submitted,2026-11-24T10:00:00Z,7,3,`)
}

// ── 3. Routing ──────────────────────────────────────────────────────────────

const routed = (channel: 'email' | 'text' | 'line' | 'wechat', textSetting: string | undefined, setting?: string) => {
  const before = { text: process.env.TRANSPORT_TEXT, all: process.env.TRANSPORT }
  if (textSetting === undefined) delete process.env.TRANSPORT_TEXT
  else process.env.TRANSPORT_TEXT = textSetting
  if (setting === undefined) delete process.env.TRANSPORT
  else process.env.TRANSPORT = setting
  const warn = console.warn
  console.warn = () => {}
  try {
    return getTransport(channel)
  } finally {
    console.warn = warn
    if (before.text === undefined) delete process.env.TRANSPORT_TEXT
    else process.env.TRANSPORT_TEXT = before.text
    if (before.all === undefined) delete process.env.TRANSPORT
    else process.env.TRANSPORT = before.all
  }
}
delete process.env.TRANSPORT_EMAIL
check('text stays on the log transport when TRANSPORT_TEXT is unset', routed('text', undefined) instanceof LogTransport)
check('text goes to the phone when TRANSPORT_TEXT=phone', routed('text', 'phone') instanceof PhoneGatewayTransport)
check('…whatever the case or spacing', routed('text', ' Phone ') instanceof PhoneGatewayTransport)
check('a mis-set TRANSPORT_TEXT stays on the log transport', routed('text', 'phones') instanceof LogTransport && routed('text', 'iphone') instanceof LogTransport && routed('text', '') instanceof LogTransport && routed('text', 'twilio') instanceof LogTransport)
check('email, LINE and WeChat are unchanged by TRANSPORT_TEXT', routed('email', 'phone') instanceof LogTransport && routed('line', 'phone') instanceof LogTransport && routed('wechat', 'phone') instanceof LogTransport)
check('TRANSPORT alone never selects the phone', routed('text', undefined, 'phone') instanceof LogTransport)

// ── The stand-ins ───────────────────────────────────────────────────────────

process.env.VITE_SUPABASE_URL = FAKE_SUPABASE_URL
process.env.VITE_SUPABASE_ANON_KEY = 'anon'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
process.env.GOOGLE_TOKEN_KEY = 'a test key for the phone checks, long enough!'
process.env.PUBLIC_APP_URL = 'http://localhost:5173'
delete process.env.GOOGLE_FAKE
delete process.env.PHONE_WAKE_FAKE
delete process.env.TRANSPORT
delete process.env.TRANSPORT_EMAIL
delete process.env.TRANSPORT_TEXT
const driveState = join(mkdtempSync(join(tmpdir(), 'platinum-phone-')), 'google.json')
writeFileSync(driveState, '{}')
process.env.GOOGLE_FAKE_STATE = driveState

const db = fakeSupabase()
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const answer = await db.fetch(input, init)
  if (answer) return answer
  throw new Error(`An offline test tried to reach ${new URL(input instanceof Request ? input.url : String(input)).origin}`)
}) as typeof fetch

type Row = Record<string, unknown>
const jobs = () => db.table('phone_send_jobs')
const devices = () => db.table('phone_devices')
const events = () => db.table('phone_job_events')
const outbox = () => db.table('outbox')

// What claim_phone_send_job does, in one step: the oldest waiting job of this phone that has not expired.
db.rpc('claim_phone_send_job', (args) => {
  const now = new Date().toISOString()
  const job = jobs()
    .filter((j) => j.device_id === args.device && j.status === 'pending' && String(j.expires_at) > now)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || Number(a.seq) - Number(b.seq))[0]
  if (!job) return []
  Object.assign(job, { status: 'claimed', claim_id: crypto.randomUUID(), claimed_at: now, lease_expires_at: new Date(Date.now() + 120_000).toISOString() })
  return [job]
})

/** Reads a mail the way a mail program would: just enough for a plain ASCII wake email. */
function readMail(raw: string): { headers: Record<string, string>; body: string } {
  const message = Buffer.from(raw, 'base64url').toString('utf8')
  const [head, ...rest] = message.split('\r\n\r\n')
  const headers: Record<string, string> = {}
  for (const line of head.split('\r\n')) headers[line.slice(0, line.indexOf(':')).toLowerCase()] = line.slice(line.indexOf(':') + 1).trim()
  return { headers, body: Buffer.from(rest.join('').replace(/\r\n/g, ''), 'base64').toString('utf8') }
}

/** Every email handed to "Gmail" in this run. On this path the only one there may be is the wake. */
const mails: ReturnType<typeof readMail>[] = []
google.fetch = (url, init) => {
  if (new URL(url).hostname === 'gmail.googleapis.com') mails.push(readMail((JSON.parse(String(init?.body)) as { raw: string }).raw))
  return fakeGoogle(url, init)
}

/** Everything printed while the phone path runs, so the end can check no key, number or text was logged. */
const printed: string[] = []
async function quietly<T>(work: () => Promise<T>): Promise<T> {
  const { log, error, warn } = console
  const keep = (...parts: unknown[]) => void printed.push(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '))
  console.log = keep
  console.error = keep
  console.warn = keep
  try {
    return await work()
  } finally {
    console.log = log
    console.error = error
    console.warn = warn
  }
}

const FIRM = '44444444-4444-4444-8444-444444444444'
const LIN = '55555555-5555-4555-8555-555555555551'
const NO_GMAIL = '55555555-5555-4555-8555-555555555552'
const NO_PHONE = '55555555-5555-4555-8555-555555555553'
const KEY = process.env.GOOGLE_TOKEN_KEY
const WAKE_ADDRESS = 'sample.counselor@example.com'
const lin = { userId: LIN, firmId: FIRM }
db.table('firm_members').push({ firm_id: FIRM, user_id: LIN, role: 'owner', display_name: 'Dana Whitfield' }, { firm_id: FIRM, user_id: NO_GMAIL, role: 'counselor', display_name: 'Priya Raman' }, { firm_id: FIRM, user_id: NO_PHONE, role: 'counselor', display_name: 'Sam Okafor' })
db.table('google_connections').push(
  { user_id: LIN, firm_id: FIRM, google_address: WAKE_ADDRESS, scopes: [DRIVE_SCOPE, GMAIL_SEND_SCOPE], refresh_token_encrypted: encryptToken('fake-refresh-token-gmail', LIN, KEY), last_error: null },
  { user_id: NO_PHONE, firm_id: FIRM, google_address: 'sam@example.com', scopes: [DRIVE_SCOPE, GMAIL_SEND_SCOPE], refresh_token_encrypted: encryptToken('fake-refresh-token-gmail', NO_PHONE, KEY), last_error: null },
)
db.users.set('token-lin', LIN)
db.users.set('token-no-gmail', NO_GMAIL)

const STUDENT = '66666666-6666-4666-8666-666666666661'
const PARENT = '66666666-6666-4666-8666-666666666662'
const STRANGER = '66666666-6666-4666-8666-666666666663'
const STUDENT_PHONE = '+15550000001'
const PARENT_PHONE = '+15551234567'
const OWN_PHONE = '+15550000009'
db.table('students').push({ id: STUDENT, firm_id: FIRM, phone: '(555) 000-0001', email: 'student@example.com' })
db.table('parents').push({ id: PARENT, firm_id: FIRM, student_id: STUDENT, phone: '+1 555 123 4567', email: 'parent@example.com' }, { id: STRANGER, firm_id: FIRM, student_id: STUDENT, phone: '+15559999999', email: 'stranger@example.com' })

const ALLOW = `${WAKE_ADDRESS}, ${PARENT_PHONE}, ${STUDENT_PHONE}, ${OWN_PHONE}`
const BODY = 'Hi Mrs. Example, a reminder that the tax form is due Friday.'

let rowNumber = 0
const queue = (row: Row = {}) => {
  const rowId = `77777777-7777-4777-8777-${String(++rowNumber).padStart(12, '0')}`
  outbox().push({ id: rowId, firm_id: FIRM, student_id: STUDENT, to_kind: 'parent', to_name: 'Ada Example', parent_id: PARENT, channel: 'text', language: 'en', kind: 'reminder_upcoming', body: BODY, body_en: null, status: 'queued', send_after: new Date(Date.now() - 1000).toISOString(), approved_by: LIN, note: null, error: null, provider_message_id: null, delivery_detail: null, ...row })
  return rowId
}
const rowOf = (rowId: string) => outbox().find((r) => r.id === rowId)!
const jobOf = (rowId: string) => jobs().find((j) => j.outbox_id === rowId)

/** Runs the dispatcher. `phone: true` is TRANSPORT_TEXT=phone; otherwise it is unset. */
async function dispatch(settings: { phone?: boolean; allowlist?: string } = {}) {
  if (settings.phone) process.env.TRANSPORT_TEXT = 'phone'
  else delete process.env.TRANSPORT_TEXT
  process.env.SEND_ALLOWLIST = settings.allowlist ?? ALLOW
  try {
    return await quietly(() => dispatchFirm(FIRM))
  } finally {
    delete process.env.TRANSPORT_TEXT
    process.env.SEND_ALLOWLIST = ALLOW
  }
}

/** Calls /api/phone the way the phone or the browser would. */
async function call(bearer: string | undefined, body: Row, settings: { phone?: boolean; allowlist?: string } = { phone: true }): Promise<{ status: number; text: string; json: Row }> {
  if (settings.phone) process.env.TRANSPORT_TEXT = 'phone'
  else delete process.env.TRANSPORT_TEXT
  process.env.SEND_ALLOWLIST = settings.allowlist ?? ALLOW
  try {
    const response = await quietly(() => POST(new Request('http://localhost:5173/api/phone', { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) })))
    const text = await response.text()
    return { status: response.status, text, json: JSON.parse(text) as Row }
  } finally {
    delete process.env.TRANSPORT_TEXT
    process.env.SEND_ALLOWLIST = ALLOW
  }
}
const dataOf = (answer: { json: Row }) => answer.json.data as PhoneStatus
/** Lets the 20 seconds between wake emails pass. */
const letWakeGapPass = () => devices().forEach((d) => (d.last_wake_at = new Date(Date.now() - 60_000).toISOString()))
const clearJobs = () => {
  jobs().length = 0
  events().length = 0
  letWakeGapPass()
}
process.env.SEND_ALLOWLIST = ALLOW

// ── 4. Off by default ───────────────────────────────────────────────────────

{
  const row = queue()
  const summary = await dispatch()
  check('with TRANSPORT_TEXT unset an approved text behaves exactly as before', rowOf(row).status === 'sent' && String(rowOf(row).provider_message_id).startsWith('log_') && rowOf(row).delivery_detail === null && summary.sent === 1 && summary.waiting === 0)
  check('…and no job, no event and no wake are made', jobs().length === 0 && events().length === 0 && mails.length === 0)
  printed.length = 0
}

// ── 5. Connecting a phone ───────────────────────────────────────────────────

const noGmail = await call('token-no-gmail', { action: 'connect', label: 'My iPhone' })
check('connecting without Gmail is refused with “Connect Gmail first”', noGmail.status === 409 && noGmail.json.message === 'Connect Gmail first' && devices().length === 0)
const notAllowed = await call('token-lin', { action: 'connect', label: 'My iPhone' }, { phone: true, allowlist: PARENT_PHONE })
check('a wake address that is not on the allowed list is refused', notAllowed.status === 409 && notAllowed.json.message === 'That address is not on the allowed list yet' && devices().length === 0)
check('a request with no sign-in is refused', (await call(undefined, { action: 'connect', label: 'x' })).status === 401 && (await call('not-a-token', { action: 'status' })).status === 401)
check('an unknown action is refused', (await call('token-lin', { action: 'send' })).status === 400)

const first = await call('token-lin', { action: 'connect', label: 'Old iPhone', noticeShown: true })
const firstKey = String((first.json.data as Row).key)
check('connect returns the device key once: 32 random bytes as base64url', first.status === 200 && /^[A-Za-z0-9_-]{43}$/.test(firstKey))
check('the database holds only the SHA-256 hash of the key', devices().length === 1 && devices()[0].key_hash === hashKey(firstKey) && !JSON.stringify(devices()).includes(firstKey))
check('the wake address is the counselor’s own connected Gmail address', devices()[0].wake_email === WAKE_ADDRESS && devices()[0].platform === 'ios_shortcut')
const second = await call('token-lin', { action: 'connect', label: 'Dana’s iPhone' })
const KEY_NOW = String((second.json.data as Row).key)
check('connecting again revokes the earlier phone', devices().length === 2 && devices().filter((d) => !d.revoked_at).length === 1 && KEY_NOW !== firstKey)
check('…and the notice is not shown twice', devices().every((d) => d.notice_shown_at))
const revoked = await call(firstKey, { action: 'claim' })
check('a revoked key gets 401 and { "next": "none" }', revoked.status === 401 && revoked.text === '{"next":"none"}')
const unknownKey = await call('A'.repeat(43), { action: 'claim' })
check('an unknown key gets the same answer', unknownKey.status === 401 && unknownKey.text === '{"next":"none"}' && (await call(undefined, { action: 'claim' })).status === 401)
const DEVICE = String(devices().find((d) => !d.revoked_at)!.id)
const device = () => devices().find((d) => d.id === DEVICE)!

{
  const status = dataOf(await call('token-lin', { action: 'status' }))
  check('a new phone is “Waiting for your phone” until it first asks', status.device?.state === 'waiting' && status.device.stateLabel === 'Waiting for your phone' && status.on && status.gmail.connected && status.gmail.allowed && status.noticeShown)
  check('with TRANSPORT_TEXT unset, status says texting from the phone is off', dataOf(await call('token-lin', { action: 'status' }, { phone: false })).on === false)
}

// ── 6. One approved text: one job, one wake ─────────────────────────────────

const one = queue()
const toStudent = queue({ to_kind: 'student', to_name: 'Kai Example', parent_id: null, kind: 'weekly_text', body: `Hi Kai, your tasks: ${STUDENT_LINK_PLACEHOLDER}` })
{
  const summary = await dispatch({ phone: true })
  check('with TRANSPORT_TEXT=phone an approved text makes exactly one job', jobs().filter((j) => j.outbox_id === one).length === 1 && summary.waiting === 2 && summary.sent === 0 && summary.failed === 0)
  check('…for the phone of the counselor who approved it', jobOf(one)?.device_id === DEVICE && jobOf(one)?.status === 'pending')
  check('…with the exact recipient, as E.164, and the exact text', jobOf(one)?.to_phone === PARENT_PHONE && jobOf(one)?.body === BODY)
  const linked = String(jobOf(toStudent)?.body)
  check('…including the student link the dispatcher added', jobOf(toStudent)?.to_phone === STUDENT_PHONE && /^Hi Kai, your tasks: http:\/\/localhost:5173\/s\/[A-Za-z0-9_-]{43}$/.test(linked) && !linked.includes(STUDENT_LINK_PLACEHOLDER))
  check('the row waits for the phone: still “sending”, so the dispatcher will not pick it up again', rowOf(one).status === 'sending' && rowOf(one).delivery_detail === 'phone_waiting' && rowOf(one).provider_message_id === null)
  check('two jobs made inside 20 seconds ride on one wake email', mails.length === 1 && jobs().length === 2)
  check('the wake goes from the counselor’s own Gmail to that same address', mails[0].headers.to === `<${WAKE_ADDRESS}>` && mails[0].headers.from === `"Dana Whitfield" <${WAKE_ADDRESS}>`)
  check('its subject is “Platinum wake ” and six characters, its body is “Wake.”', WAKE_SUBJECT.test(mails[0].headers.subject) && mails[0].body === WAKE_BODY && WAKE_BODY === 'Wake.')
  check('…and it holds nothing else: no name of a recipient, no number, no text, no job id, no link', (() => {
    const all = JSON.stringify(mails[0])
    return Object.keys(mails[0].headers).sort().join() === 'content-transfer-encoding,content-type,from,mime-version,subject,to' && ![BODY, 'Ada', 'Kai', PARENT_PHONE, STUDENT_PHONE, 'http', String(jobOf(one)?.id), one].some((secret) => all.includes(secret))
  })())

  const again = await dispatch({ phone: true })
  check('dispatching again makes no job and no wake', again.processed === 0 && jobs().length === 2 && mails.length === 1)
  // Even if the row were somehow queued again, the unique outbox id allows one job only.
  rowOf(one).status = 'queued'
  letWakeGapPass()
  await dispatch({ phone: true })
  check('…and even a row queued a second time cannot produce a second job or a second wake', jobs().filter((j) => j.outbox_id === one).length === 1 && mails.length === 1 && rowOf(one).status === 'sending')
  check('each job has its event, and no event holds message text', events().length === 2 && events().every((e) => e.from_status === null && e.to_status === 'pending' && e.actor === 'dispatcher') && !JSON.stringify(events()).includes('reminder'))
}

// ── 7. The phone claims and reports ─────────────────────────────────────────

const claimOne = await call(KEY_NOW, { action: 'claim' })
check('claim answers a flat object with next, job_id, claim_id, to_phone and body', claimOne.status === 200 && Object.keys(claimOne.json).sort().join() === 'body,claim_id,job_id,next,to_phone' && claimOne.json.next === 'send' && Object.values(claimOne.json).every((v) => typeof v === 'string'))
check('…the oldest job first, with the number and text exactly as stored', claimOne.json.job_id === jobOf(one)?.id && claimOne.json.to_phone === PARENT_PHONE && claimOne.json.body === BODY)
check('the phone has now been seen', Boolean(device().first_seen_at && device().last_seen_at) && dataOf(await call('token-lin', { action: 'status' })).device?.state === 'connected')
check('the job is claimed with a two-minute lease', jobOf(one)?.status === 'claimed' && Date.parse(String(jobOf(one)?.lease_expires_at)) - Date.now() > 100_000)

const wrongClaim = await call(KEY_NOW, { action: 'report', job_id: claimOne.json.job_id, claim_id: crypto.randomUUID(), result: 'submitted' })
check('a report with the wrong claim id is refused', wrongClaim.status === 409 && wrongClaim.json.ok === false && jobOf(one)?.status === 'claimed' && rowOf(one).status === 'sending')
check('a report that is not understood is refused', (await call(KEY_NOW, { action: 'report', job_id: claimOne.json.job_id, claim_id: claimOne.json.claim_id, result: 'delivered' })).status === 400 && jobOf(one)?.status === 'claimed')
const reported = await call(KEY_NOW, { action: 'report', job_id: claimOne.json.job_id, claim_id: claimOne.json.claim_id, result: 'submitted' })
check('a report with the right claim id is accepted with { "ok": true }', reported.status === 200 && reported.text === '{"ok":true}' && jobOf(one)?.status === 'submitted' && Boolean(jobOf(one)?.reported_at))
check('the message becomes “Sent from your phone”', rowOf(one).status === 'sent' && rowOf(one).delivery_detail === 'phone_sent' && rowOf(one).provider_message_id === `phone_${String(jobOf(one)?.id)}`)
{
  const before = { events: events().length, activity: db.table('activity').length, reportedAt: jobOf(one)?.reported_at }
  const repeat = await call(KEY_NOW, { action: 'report', job_id: claimOne.json.job_id, claim_id: claimOne.json.claim_id, result: 'submitted' })
  check('the same report twice changes nothing', repeat.status === 200 && repeat.json.ok === true && events().length === before.events && db.table('activity').length === before.activity && jobOf(one)?.reported_at === before.reportedAt)
  const flip = await call(KEY_NOW, { action: 'report', job_id: claimOne.json.job_id, claim_id: claimOne.json.claim_id, result: 'failed', error: 'changed my mind' })
  check('a finished job cannot be reported the other way', flip.status === 409 && jobOf(one)?.status === 'submitted' && rowOf(one).status === 'sent')
}

// Two calls at once for the one job that is left.
{
  const [a, b] = await Promise.all([call(KEY_NOW, { action: 'claim' }), call(KEY_NOW, { action: 'claim' })])
  const got = [a, b].filter((answer) => answer.json.next === 'send')
  check('two claims at once for one job: exactly one gets it (against the stand-in, not Postgres)', got.length === 1 && got[0].json.job_id === jobOf(toStudent)?.id && [a, b].filter((answer) => answer.text === '{"next":"none"}').length === 1)
  const failedReport = await call(KEY_NOW, { action: 'report', job_id: got[0].json.job_id, claim_id: got[0].json.claim_id, result: 'failed', error: 'Messages said\nNot Delivered <b>' })
  check('a failure the phone reports fails the message with a plain, one-line reason', failedReport.json.ok === true && rowOf(toStudent).status === 'failed' && rowOf(toStudent).delivery_detail === 'phone_failed' && rowOf(toStudent).error === 'Your phone could not send it: Messages said Not Delivered <b>')
  check('…and it can then be sent by hand', canSendByHand({ channel: 'text', status: 'failed', detail: String(rowOf(toStudent).delivery_detail) }))
  const none = await call(KEY_NOW, { action: 'claim' })
  check('with no work, claim answers { "next": "none" }', none.status === 200 && none.text === '{"next":"none"}')
}

// ── 8. The allowlist, before and after the job exists ───────────────────────

{
  clearJobs()
  const stranger = queue({ parent_id: STRANGER, to_name: 'Stranger' })
  await dispatch({ phone: true })
  check('an off-allowlist recipient never produces a job', rowOf(stranger).status === 'failed' && rowOf(stranger).error === 'recipient not on allowlist' && jobs().length === 0 && mails.length === 1)

  const removed = queue()
  const stays = queue({ to_kind: 'student', to_name: 'Kai Example', parent_id: null })
  await dispatch({ phone: true })
  check('(two jobs are waiting)', jobs().length === 2 && jobs().every((j) => j.status === 'pending'))
  // The parent is taken off the list after the job exists.
  const claim = await call(KEY_NOW, { action: 'claim' }, { phone: true, allowlist: `${WAKE_ADDRESS}, ${STUDENT_PHONE}` })
  check('a recipient removed from the allowlist after the job exists is failed at claim, not handed over', jobOf(removed)?.status === 'failed' && rowOf(removed).status === 'failed' && rowOf(removed).error === 'recipient not on allowlist' && claim.json.to_phone !== PARENT_PHONE)
  check('…and the phone is given the next job instead', claim.json.next === 'send' && claim.json.job_id === jobOf(stays)?.id)
  await call(KEY_NOW, { action: 'report', job_id: claim.json.job_id, claim_id: claim.json.claim_id, result: 'submitted' })

  const cancelled = queue()
  letWakeGapPass()
  await dispatch({ phone: true })
  rowOf(cancelled).status = 'cancelled'
  const after = await call(KEY_NOW, { action: 'claim' })
  check('a message cancelled after the job exists is not handed over either', after.text === '{"next":"none"}' && jobOf(cancelled)?.status === 'failed' && rowOf(cancelled).status === 'cancelled')
}

// ── 9. No answer from the phone ─────────────────────────────────────────────

{
  clearJobs()
  const late = queue()
  await dispatch({ phone: true })
  jobOf(late)!.expires_at = new Date(Date.now() - 1000).toISOString()
  const answer = await call(KEY_NOW, { action: 'claim' })
  check('a job nobody took in ten minutes expires and is never handed out', answer.text === '{"next":"none"}' && jobOf(late)?.status === 'expired')
  check('…the message says “Phone did not answer” and can be sent by hand', rowOf(late).status === 'failed' && rowOf(late).delivery_detail === 'phone_expired' && rowOf(late).error === PHONE_REASON.expired && canSendByHand({ channel: 'text', status: 'failed', detail: 'phone_expired' }))
  check('…and the sweep is the actor on record', events().some((e) => e.job_id === jobOf(late)?.id && e.from_status === 'pending' && e.to_status === 'expired' && e.actor === 'sweep'))

  clearJobs()
  const silent = queue()
  await dispatch({ phone: true })
  const claim = await call(KEY_NOW, { action: 'claim' })
  jobOf(silent)!.lease_expires_at = new Date(Date.now() - 1000).toISOString()
  await call('token-lin', { action: 'status' })
  check('a job the phone took and did not report on in two minutes becomes unknown', claim.json.next === 'send' && jobOf(silent)?.status === 'unknown')
  check('…the message is “Not confirmed”, and still held so nothing sends it again', rowOf(silent).status === 'sending' && rowOf(silent).delivery_detail === 'phone_unknown' && !canSendByHand({ channel: 'text', status: 'sending', detail: 'phone_unknown' }))
  const never = [await call(KEY_NOW, { action: 'claim' }), await call(KEY_NOW, { action: 'claim' })]
  check('an unknown job is never returned by claim again', never.every((a) => a.text === '{"next":"none"}') && jobOf(silent)?.status === 'unknown' && (await dispatch({ phone: true })).processed === 0)
  const lateReport = await call(KEY_NOW, { action: 'report', job_id: claim.json.job_id, claim_id: claim.json.claim_id, result: 'submitted' })
  check('a late report resolves it, and is recorded as late', lateReport.json.ok === true && jobOf(silent)?.status === 'submitted' && rowOf(silent).status === 'sent' && rowOf(silent).delivery_detail === 'phone_sent' && events().some((e) => e.job_id === jobOf(silent)?.id && e.from_status === 'unknown' && e.late === true))

  // The counselor answers instead.
  clearJobs()
  const askNo = queue()
  const askYes = queue()
  await dispatch({ phone: true })
  for (let i = 0; i < 2; i++) await call(KEY_NOW, { action: 'claim' })
  jobs().forEach((j) => (j.lease_expires_at = new Date(Date.now() - 1000).toISOString()))
  await call('token-lin', { action: 'status' })
  const no = await call('token-lin', { action: 'resolve', outboxId: askNo, sent: false })
  check('“It was not sent” fails the message with “Counselor confirmed it was not sent”', no.status === 200 && jobOf(askNo)?.status === 'failed' && rowOf(askNo).status === 'failed' && rowOf(askNo).error === 'Counselor confirmed it was not sent' && canSendByHand({ channel: 'text', status: 'failed', detail: String(rowOf(askNo).delivery_detail) }))
  const yes = await call('token-lin', { action: 'resolve', jobId: jobOf(askYes)?.id, sent: true })
  check('“It was sent” marks it sent from the phone', yes.status === 200 && jobOf(askYes)?.status === 'submitted' && rowOf(askYes).status === 'sent' && events().some((e) => e.job_id === jobOf(askYes)?.id && e.actor === 'counselor' && e.actor_id === LIN))
  check('an answer can be given once', (await call('token-lin', { action: 'resolve', outboxId: askNo, sent: true })).status === 409 && jobOf(askNo)?.status === 'failed')
  check('a colleague cannot answer for someone else’s phone', (await call('token-no-gmail', { action: 'resolve', outboxId: askYes, sent: false })).status === 404)
}

// ── 9b. The dispatcher sweeps too, and the switch is a switch ───────────────

{
  clearJobs()
  const stale = queue()
  const silent = queue()
  await dispatch({ phone: true })
  await call(KEY_NOW, { action: 'claim' })
  jobOf(stale)!.lease_expires_at = new Date(Date.now() - 1000).toISOString()
  jobOf(silent)!.expires_at = new Date(Date.now() - 1000).toISOString()
  // No phone asks and nobody opens a page: only the dispatcher runs.
  const run = await dispatch({ phone: true })
  check('a dispatcher run gives up on a job nobody took, with no page open and no phone asking', jobOf(silent)?.status === 'expired' && rowOf(silent).status === 'failed' && rowOf(silent).delivery_detail === 'phone_expired')
  check('…and marks a job the phone took and never reported on as not confirmed', jobOf(stale)?.status === 'unknown' && rowOf(stale).delivery_detail === 'phone_unknown' && rowOf(stale).status === 'sending')
  check('…and says how many it swept, so the browser reloads', run.swept === 2 && run.processed === 0)
  check('the sweep runs with TRANSPORT_TEXT unset too, and sends nothing', await (async () => {
    const late = queue()
    await dispatch({ phone: true })
    jobOf(late)!.expires_at = new Date(Date.now() - 1000).toISOString()
    const mailsBefore = mails.length
    const off = await dispatch()
    return off.swept === 1 && jobOf(late)?.status === 'expired' && mails.length === mailsBefore
  })())
  check('a failing sweep never stops the dispatcher', await (async () => {
    const real = db.fetch
    db.fetch = async (input, init) => (String(input instanceof Request ? input.url : input).includes('/phone_send_jobs') ? new Response(JSON.stringify({ code: '42P01', message: 'relation does not exist' }), { status: 404, headers: { 'content-type': 'application/json' } }) : real(input, init))
    const email = queue({ channel: 'email' })
    const summary = await dispatch()
    db.fetch = real
    // The email is still dealt with (it fails at the allowlist: that parent's address is not on it).
    return summary.swept === 0 && summary.processed === 1 && rowOf(email).status === 'failed' && rowOf(email).error === 'recipient not on allowlist'
  })())

  // Switched off while a job waits: the phone is given nothing.
  clearJobs()
  const held = queue()
  await dispatch({ phone: true })
  const off = await call(KEY_NOW, { action: 'claim' }, { phone: false })
  check('with TRANSPORT_TEXT unset a phone is handed nothing, even a job made while it was on', off.status === 200 && off.text === '{"next":"none"}' && jobOf(held)?.status === 'pending')
  check('…and switched back on, it is', (await call(KEY_NOW, { action: 'claim' })).json.job_id === jobOf(held)?.id)
  jobOf(held)!.status = 'submitted'
  rowOf(held).status = 'sent'
}

// ── 10. Cancel while it waits ───────────────────────────────────────────────

{
  clearJobs()
  const waiting = queue()
  const taken = queue()
  await dispatch({ phone: true })
  const cancel = await call('token-lin', { action: 'cancel', outboxId: waiting })
  check('a text waiting for the phone can be cancelled', cancel.status === 200 && jobOf(waiting)?.status === 'cancelled' && rowOf(waiting).status === 'cancelled')
  const claim = await call(KEY_NOW, { action: 'claim' })
  check('…and the phone is never given it', claim.json.job_id === jobOf(taken)?.id)
  const tooLate = await call('token-lin', { action: 'cancel', outboxId: taken })
  check('once the phone has taken a text it cannot be cancelled', tooLate.status === 409 && jobOf(taken)?.status === 'claimed' && rowOf(taken).status === 'sending')
  await call(KEY_NOW, { action: 'report', job_id: claim.json.job_id, claim_id: claim.json.claim_id, result: 'submitted' })
}

// ── 11. Caps ────────────────────────────────────────────────────────────────

{
  clearJobs()
  for (let i = 0; i < CLAIMS_PER_HOUR + 1; i++) await createJob({ outboxId: null, deviceId: DEVICE, toPhone: OWN_PHONE, body: TEST_BODY }, { actor: 'counselor', actorId: LIN })
  let handed = 0
  process.env.TRANSPORT_TEXT = 'phone'
  for (let i = 0; i < CLAIMS_PER_HOUR; i++) if ((await quietly(() => claimNext(device() as never))).next === 'send') handed++
  delete process.env.TRANSPORT_TEXT
  const over = await call(KEY_NOW, { action: 'claim' })
  check('the 21st claim in an hour returns “none”', handed === CLAIMS_PER_HOUR && over.status === 200 && over.text === '{"next":"none"}')
  check('…and that job stays pending', jobs().filter((j) => j.status === 'pending').length === 1 && jobs().filter((j) => j.status === 'claimed').length === CLAIMS_PER_HOUR)
  // An hour later the phone may claim again.
  jobs().forEach((j) => j.claimed_at && (j.claimed_at = new Date(Date.now() - 2 * 3_600_000).toISOString()))
  check('an hour later it is handed out', (await call(KEY_NOW, { action: 'claim' })).json.next === 'send')
}

// ── 12. Wake emails ─────────────────────────────────────────────────────────

{
  clearJobs()
  const before = mails.length
  const a = queue()
  await dispatch({ phone: true })
  const b = queue()
  await dispatch({ phone: true })
  check('two jobs inside 20 seconds send one wake', jobOf(a)?.status === 'pending' && jobOf(b)?.status === 'pending' && mails.length === before + 1)
  letWakeGapPass()
  const c = queue()
  await dispatch({ phone: true })
  check('after 20 seconds a new job sends a new wake, with a new subject', Boolean(jobOf(c)) && mails.length === before + 2 && mails[before].headers.subject !== mails[before + 1].headers.subject)
  check('every email this path ever sent is a wake to the counselor’s own address', mails.every((m) => WAKE_SUBJECT.test(m.headers.subject) && m.body === 'Wake.' && m.headers.to === `<${WAKE_ADDRESS}>`))

  const tooSoon = await call('token-lin', { action: 'wake' })
  check('“Wake my phone” inside the 20 seconds sends nothing', tooSoon.status === 429 && mails.length === before + 2)
  letWakeGapPass()
  const woke = await call('token-lin', { action: 'wake' })
  check('“Wake my phone” sends the wake email only: no job', woke.status === 200 && mails.length === before + 3 && jobs().length === 3)
  letWakeGapPass()
  const off = await call('token-lin', { action: 'wake' }, { phone: false })
  check('with TRANSPORT_TEXT unset, wake and test send nothing', off.status === 409 && (await call('token-lin', { action: 'test' }, { phone: false })).status === 409 && mails.length === before + 3 && jobs().length === 3)
  const offList = await call('token-lin', { action: 'wake' }, { phone: true, allowlist: PARENT_PHONE })
  check('a wake address taken off the allowed list gets no wake', offList.status === 409 && mails.length === before + 3)

  process.env.PHONE_WAKE_FAKE = '1'
  let refused = false
  try {
    wakeFake()
  } catch {
    refused = true
  }
  delete process.env.PHONE_WAKE_FAKE
  check('PHONE_WAKE_FAKE=1 is refused outside `npm run dev`', refused && wakeFake() === false)
}

// ── 13. Straight to “send by hand” ──────────────────────────────────────────

{
  clearJobs()
  const before = mails.length
  const noDevice = queue({ approved_by: NO_PHONE })
  const noGmailRow = queue({ approved_by: NO_GMAIL })
  const noApprover = queue({ approved_by: null })
  // Priya has a phone on record but no Gmail to wake it with.
  devices().push({ id: '88888888-8888-4888-8888-888888888881', firm_id: FIRM, counselor_id: NO_GMAIL, platform: 'ios_shortcut', label: 'Priya’s iPhone', key_hash: hashKey('x'.repeat(43)), wake_email: 'priya@example.com', own_phone: null, notice_shown_at: null, last_wake_at: null, first_seen_at: null, last_seen_at: null, revoked_at: null, created_at: new Date().toISOString() })
  const summary = await dispatch({ phone: true })
  check('no phone connected: “No phone is connected. Send this one by hand.”', rowOf(noDevice).status === 'failed' && rowOf(noDevice).error === 'No phone is connected. Send this one by hand.' && rowOf(noDevice).delivery_detail === 'phone_none')
  check('no Gmail connected: the wake sentence, and no job', rowOf(noGmailRow).status === 'failed' && rowOf(noGmailRow).error === 'Connect Gmail in settings so Platinum can wake your phone, or send this one by hand.' && rowOf(noGmailRow).delivery_detail === 'phone_none')
  check('a text nobody approved fails plainly', rowOf(noApprover).status === 'failed' && rowOf(noApprover).error === 'No counselor on this message')
  check('none of those made a job or a wake, and each can be sent by hand', summary.failed === 3 && jobs().length === 0 && mails.length === before && [noDevice, noGmailRow, noApprover].every((id) => canSendByHand({ channel: 'text', status: String(rowOf(id).status), detail: String(rowOf(id).delivery_detail) })))

  // Three jobs in a row with no answer.
  const ignored = [queue(), queue(), queue()]
  await dispatch({ phone: true })
  jobs().forEach((j) => (j.expires_at = new Date(Date.now() - 1000).toISOString()))
  const status = dataOf(await call('token-lin', { action: 'status' }))
  check('three jobs in a row with no answer put the phone in the Stopped state', ignored.every((id) => jobOf(id)?.status === 'expired') && status.device?.state === 'stopped' && status.device.stateLabel === 'Stopped')
  const stopped = queue()
  letWakeGapPass()
  const wakesBefore = mails.length
  await dispatch({ phone: true })
  check('a Stopped phone gets no new job: the text goes straight to send by hand', rowOf(stopped).status === 'failed' && rowOf(stopped).error === PHONE_REASON.stopped && rowOf(stopped).delivery_detail === 'phone_none' && !jobOf(stopped) && mails.length === wakesBefore)

  // …until a test succeeds.
  const noNumber = await call('token-lin', { action: 'test' })
  check('a test with no number saved says so', noNumber.status === 409 && noNumber.json.message === 'Save your own phone number first.')
  check('a number that is not a number is refused', (await call('token-lin', { action: 'number', phone: 'call me' })).status === 400)
  const saved = dataOf(await call('token-lin', { action: 'number', phone: '(555) 000-0009' }))
  check('the counselor’s own number is saved as E.164', saved.device?.ownPhone === OWN_PHONE && device().own_phone === OWN_PHONE)
  const notListed = await call('token-lin', { action: 'test' }, { phone: true, allowlist: `${WAKE_ADDRESS}, ${PARENT_PHONE}` })
  check('a test to a number that is not on the allowed list says so', notListed.status === 409 && notListed.json.message === 'Your own number is not on the allowed list yet.' && jobs().length === 3)
  const test = await call('token-lin', { action: 'test' })
  const testJob = jobs().find((j) => j.outbox_id === null)
  check('“Send a test to my own number” makes one job to that number with the fixed text, and a wake', test.status === 200 && testJob?.to_phone === OWN_PHONE && testJob.body === TEST_BODY && testJob.status === 'pending' && mails.length === wakesBefore + 1)
  check('…and shows it in the recent jobs as “You (test)”, with no number', dataOf(test).jobs[0].to === 'You (test)' && !test.text.includes(PARENT_PHONE) && !test.text.includes(STUDENT_PHONE))
  const claim = await call(KEY_NOW, { action: 'claim' })
  await call(KEY_NOW, { action: 'report', job_id: claim.json.job_id, claim_id: claim.json.claim_id, result: 'submitted' })
  const working = queue()
  letWakeGapPass()
  await dispatch({ phone: true })
  check('after a test succeeds the phone is given jobs again', claim.json.body === TEST_BODY && testJob?.status === 'submitted' && jobOf(working)?.status === 'pending' && rowOf(working).delivery_detail === 'phone_waiting')
  const lines = dataOf(await call('token-lin', { action: 'status' })).jobs
  check('the recent jobs show the recipient’s name, the status and the timings', lines.length === 5 && lines[0].to === 'Ada Example' && lines[0].status === 'pending' && Boolean(lines[1].claimedAt && lines[1].reportedAt))
}

// ── 14. A text already sent by hand ─────────────────────────────────────────

{
  const jobsBefore = jobs().length
  const mailsBefore = mails.length
  const byHand = queue({ to_kind: 'student', to_name: 'Kai Example', parent_id: null, kind: 'weekly_text', note: HAND_SENT_NOTE })
  letWakeGapPass()
  await dispatch({ phone: true })
  check('a text the counselor already sent from their own phone is only recorded: no job, no wake', rowOf(byHand).status === 'sent' && String(rowOf(byHand).provider_message_id).startsWith('hand_') && rowOf(byHand).delivery_detail === null && jobs().length === jobsBefore && mails.length === mailsBefore)
  check('the note is the one the weekly text flow writes', HAND_SENT_NOTE === 'Sent from your own phone')
}

// ── 15. The transport on its own ────────────────────────────────────────────

{
  const phone = new PhoneGatewayTransport()
  const reasonOf = async (work: () => Promise<unknown>) => {
    try {
      await quietly(work)
      return 'sent'
    } catch (error) {
      return error instanceof Error ? error.message : 'unknown'
    }
  }
  const text = { channel: 'text' as const, to: PARENT_PHONE, body: BODY, language: 'en' as const, senderUserId: LIN, outboxId: crypto.randomUUID() }
  check('the phone transport refuses anything that is not a text', (await reasonOf(() => phone.send({ ...text, channel: 'email', to: 'a@example.com' }))) === 'The phone sends texts only' && (await reasonOf(() => phone.send({ ...text, channel: 'line' }))) === 'The phone sends texts only')
  check('…and a text with no outbox row', (await reasonOf(() => phone.send({ ...text, outboxId: undefined }))) === 'The phone needs the message it is sending')
  check('…and something that is not a phone number', (await reasonOf(() => phone.send({ ...text, to: 'not a number' }))) === 'not a valid phone number')
  check('Gmail was only ever asked to send wake emails', new GmailTransport() instanceof GmailTransport && mails.every((m) => m.body === 'Wake.'))
}

// ── 16. Disconnect, and what never leaves the server ────────────────────────

{
  const hash = String(device().key_hash)
  const answers = [
    await call('token-lin', { action: 'status' }),
    await call('token-lin', { action: 'number', phone: OWN_PHONE }),
    await call('token-lin', { action: 'cancel', outboxId: crypto.randomUUID() }),
    await call('token-lin', { action: 'resolve', outboxId: crypto.randomUUID(), sent: true }),
    await call(KEY_NOW, { action: 'claim' }),
    await call(KEY_NOW, { action: 'report', job_id: crypto.randomUUID(), claim_id: crypto.randomUUID(), result: 'submitted' }),
    await call('token-lin', { action: 'disconnect' }),
    await call('token-lin', { action: 'status' }),
  ]
  check('no answer from any action but connect holds a key or its hash', answers.every((a) => !a.text.includes(KEY_NOW) && !a.text.includes(firstKey) && !a.text.includes(hash) && !/key_hash|"key"/.test(a.text)))
  check('disconnect revokes the phone', Boolean(device().revoked_at) && dataOf(answers[7]).device === undefined && (await call(KEY_NOW, { action: 'claim' })).status === 401)
  const orphan = queue()
  letWakeGapPass()
  await dispatch({ phone: true })
  check('…and the next text goes straight to send by hand', rowOf(orphan).error === PHONE_REASON.noDevice && !jobOf(orphan))

  const log = printed.join('\n')
  check('nothing printed holds a device key, a hash, a phone number or message text', ![KEY_NOW, firstKey, hash, PARENT_PHONE, STUDENT_PHONE, OWN_PHONE, '+1555', BODY, TEST_BODY].some((secret) => log.includes(secret)))
  check('no failure reason holds a key or a number', outbox().every((r) => ![KEY_NOW, hash, PARENT_PHONE, STUDENT_PHONE].some((secret) => String(r.error ?? '').includes(secret))))
  check('no event row holds a number or message text', ![PARENT_PHONE, STUDENT_PHONE, OWN_PHONE, '+1', 'reminder that', TEST_BODY].some((secret) => JSON.stringify(events()).includes(secret)))
  // phoneStatus with nothing configured hides the section instead of failing.
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  check('without the service role the section is hidden and the endpoint answers 503', (await phoneStatus(lin)).available === false && (await call('token-lin', { action: 'status' })).status === 503)
  process.env.SUPABASE_SERVICE_ROLE_KEY = service
  check('connect and test are plain functions the endpoint is the only caller of', typeof connectPhone === 'function' && typeof sendTest === 'function')
}

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('All phone checks passed')
