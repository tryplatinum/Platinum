// Offline checks for the outbox queue and the send path. Run with:
//
//   npm run test:outbox
//
// No keys and no network. This checks the payload rules in shared/outbox.ts
// and the allowlist / address / placeholder / expiry helpers in shared/dispatch.ts.
// It does not run the SQL in queue_message or cancel_message.
//
// It also checks email through Gmail: the subject rule, per-channel routing,
// how a message is encoded, and the dispatcher in front of GmailTransport.
// There Google is the invented one in server/google/fakeDrive.ts and the
// database is the in-memory stand-in in scripts/fakeSupabase.ts. Nothing is sent.

import { BY_HAND_CHANNELS, canDeliver, messageStatusLabel, sentByHand } from '../src/lib/delivery'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  STUDENT_LINK_PLACEHOLDER,
  STUDENT_LINK_PREVIEW,
  allowlistAllows,
  fillStudentLink,
  linkIsExpired,
  maskRecipient,
  normalizeEmail,
  normalizePhone,
  parseAllowlist,
  previewStudentLink,
  resolveAddress,
  studentLinkExpiry,
  withoutStudentLinks,
} from '../shared/dispatch.js'
import { emailSubject } from '../shared/emailSubject.js'
import { DRIVE_SCOPE, GMAIL_SEND_SCOPE } from '../shared/google.js'
import { QUEUE_CHANNELS, QUEUE_KINDS, QUEUE_LANGUAGES, UNDO_SECONDS, outboxStatusLabel, validateQueuePayload } from '../shared/outbox.js'
import { dispatchFirm } from '../server/dispatch.js'
import { google } from '../server/google/config.js'
import { forgetAccessTokens } from '../server/google/connection.js'
import { fakeGoogle } from '../server/google/fakeDrive.js'
import { encryptToken } from '../server/google/secrets.js'
import { GmailTransport, buildMessage } from '../server/transport/gmail.js'
import { getTransport } from '../server/transport/index.js'
import { LogTransport } from '../server/transport/log.js'
import { FAKE_SUPABASE_URL, fakeSupabase } from './fakeSupabase.js'

let failed = 0
function check(name: string, pass: boolean, detail = ''): void {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const id = '11111111-1111-4111-8111-111111111111'
const studentId = '22222222-2222-4222-8222-222222222222'
const parentId = '33333333-3333-4333-8333-333333333333'

const valid = {
  id,
  studentId,
  toKind: 'parent' as const,
  toName: 'Ada Example',
  parentId,
  channel: 'email' as const,
  language: 'zh-Hant' as const,
  kind: 'parent_report' as const,
  body: 'Hello',
  trigger: 'approved' as const,
}

const parsed = validateQueuePayload(valid)
check('a complete payload is accepted', parsed.ok === true)
check('the undo window is 60 seconds', UNDO_SECONDS === 60)
check('a missing body is rejected', validateQueuePayload({ ...valid, body: '  ' }).ok === false)
check('a missing student is rejected', validateQueuePayload({ ...valid, studentId: 'not-an-id' }).ok === false)
check('a missing recipient name is rejected', validateQueuePayload({ ...valid, toName: '' }).ok === false)
check('a parent message without a parent id is rejected', validateQueuePayload({ ...valid, parentId: undefined }).ok === false)
check('a bad channel is rejected', validateQueuePayload({ ...valid, channel: 'fax' }).ok === false)
check('a bad language is rejected', validateQueuePayload({ ...valid, language: 'fr' }).ok === false)
check('a bad kind is rejected', validateQueuePayload({ ...valid, kind: 'newsletter' }).ok === false)
check('the payload cannot choose its own status', !('status' in (parsed.ok ? parsed.value : {})))

const sendAfter = new Date(Date.now() + 30_000).toISOString()
check('a queued message inside the window counts down', outboxStatusLabel({ status: 'queued', sendAfter }, Date.now()).startsWith('Queued, sends in '))
check('a cancelled message says Cancelled', outboxStatusLabel({ status: 'cancelled', sendAfter }) === 'Cancelled')
check('a sent message says Sent', outboxStatusLabel({ status: 'sent', sendAfter }) === 'Sent')
check('a failed message shows the error', outboxStatusLabel({ status: 'failed', sendAfter, error: 'recipient not on allowlist' }) === 'Failed: recipient not on allowlist')
check(
  'a queued message past the window is waiting to send',
  outboxStatusLabel({ status: 'queued', sendAfter: new Date(Date.now() - 1000).toISOString() }) === 'Queued, sending soon',
)

// ── Allowlist ───────────────────────────────────────────────────────────────

check('an empty allowlist allows nothing', !allowlistAllows(parseAllowlist(''), 'text', '+15551234567'))
check('an unset allowlist allows nothing', !allowlistAllows(parseAllowlist(undefined), 'email', 'a@example.com'))
check('phone normalization matches E.164', normalizePhone('(555) 123-4567') === '+15551234567')
check('phone with + is kept', normalizePhone('+44 7700 900123') === '+447700900123')
{
  const list = parseAllowlist('+1 (555) 123-4567, Ada@Example.COM')
  check('allowlist matches a formatted US phone', allowlistAllows(list, 'text', '5551234567'))
  check('allowlist matches email case-insensitively', allowlistAllows(list, 'email', 'ada@example.com'))
  check('allowlist rejects an off-list phone', !allowlistAllows(list, 'text', '+15559999999'))
  check('allowlist rejects an off-list email', !allowlistAllows(list, 'email', 'other@example.com'))
}
check('normalizeEmail lowercases', normalizeEmail('Ada@Example.COM') === 'ada@example.com')

// ── Address by channel ──────────────────────────────────────────────────────

check('text uses phone', resolveAddress('text', { phone: '+15551234567' }).ok === true)
check('email uses email', resolveAddress('email', { email: 'a@example.com' }).ok === true)
check('text without phone fails clearly', (() => {
  const r = resolveAddress('text', { email: 'a@example.com' })
  return !r.ok && r.error === 'no phone number on the recipient'
})())
check('email without address fails clearly', (() => {
  const r = resolveAddress('email', { phone: '+15551234567' })
  return !r.ok && r.error === 'no email address on the recipient'
})())
check('line is not connected', (() => {
  const r = resolveAddress('line', { phone: '+15551234567' })
  return !r.ok && r.error === 'channel not connected yet.'
})())
check('wechat is not connected', (() => {
  const r = resolveAddress('wechat', { email: 'a@example.com' })
  return !r.ok && r.error === 'channel not connected yet.'
})())

// ── Placeholder ─────────────────────────────────────────────────────────────

check('placeholder constant is {{student_link}}', STUDENT_LINK_PLACEHOLDER === '{{student_link}}')
check(
  'fillStudentLink replaces the placeholder',
  fillStudentLink(`Your tasks: ${STUDENT_LINK_PLACEHOLDER}`, 'http://localhost:5173/s/abc') === 'Your tasks: http://localhost:5173/s/abc',
)
check(
  'preview shows the counselor label',
  previewStudentLink(`Your tasks: ${STUDENT_LINK_PLACEHOLDER}`) === `Your tasks: ${STUDENT_LINK_PREVIEW}`,
)

// ── Link expiry ─────────────────────────────────────────────────────────────

check('a null expiry is rejected', linkIsExpired(null))
check('an undefined expiry is rejected', linkIsExpired(undefined))
check('a blank expiry is rejected', linkIsExpired('') && linkIsExpired('   '))
check('an unreadable expiry is rejected', linkIsExpired('not a date'))
check('a future expiry is still valid', !linkIsExpired(new Date(Date.now() + 60_000).toISOString()))
check('a past expiry is rejected', linkIsExpired(new Date(Date.now() - 1000).toISOString()))
check('a new link expires in 30 days', Math.abs(Date.parse(studentLinkExpiry()) - Date.now() - 30 * 86_400_000) < 5_000)

// ── What may reach a log ────────────────────────────────────────────────────

check('a phone is masked to its last 4 digits', maskRecipient('+1 (555) 123-4567') === '…4567')
check('an email is masked to its first letter and domain', maskRecipient('Ada.Example@example.com') === 'A…@example.com')
check('a student link is removed from text', withoutStudentLinks('failed at https://app.example/s/abc123 today') === 'failed at [student link] today')

// ── Email subject ───────────────────────────────────────────────────────────

check('an English parent report gets an English subject', emailSubject('parent_report', 'en') === 'Progress update')
check('a Simplified Chinese reminder gets a Simplified subject', emailSubject('reminder_late', 'zh-Hans') === '提醒：已逾期')
check('a Traditional Chinese recap gets a Traditional subject', emailSubject('meeting_recap', 'zh-Hant') === '會議紀要')
check('Simplified and Traditional differ where the characters do', emailSubject('weekly_text', 'zh-Hans') === '本周安排' && emailSubject('weekly_text', 'zh-Hant') === '本週安排')
check('every kind has a subject in every language', QUEUE_KINDS.every((kind) => QUEUE_LANGUAGES.every((language) => emailSubject(kind, language).length > 0 && emailSubject(kind, language).length <= 40)))
check('an unknown kind gets a plain fallback, not a crash', emailSubject('newsletter', 'zh-Hant') === '來自升學顧問的訊息' && emailSubject('__proto__', 'en') === 'A message from your counselor')
check('an unknown language falls back to English', emailSubject('parent_report', 'fr') === 'Progress update')

// ── Transport routing ───────────────────────────────────────────────────────

const routed = (channel: 'email' | 'text' | 'line' | 'wechat' | undefined, emailSetting: string | undefined, setting?: string) => {
  const before = { email: process.env.TRANSPORT_EMAIL, all: process.env.TRANSPORT }
  if (emailSetting === undefined) delete process.env.TRANSPORT_EMAIL
  else process.env.TRANSPORT_EMAIL = emailSetting
  if (setting === undefined) delete process.env.TRANSPORT
  else process.env.TRANSPORT = setting
  const warn = console.warn
  console.warn = () => {}
  try {
    return getTransport(channel)
  } finally {
    console.warn = warn
    if (before.email === undefined) delete process.env.TRANSPORT_EMAIL
    else process.env.TRANSPORT_EMAIL = before.email
    if (before.all === undefined) delete process.env.TRANSPORT
    else process.env.TRANSPORT = before.all
  }
}

// The screen asks the same rule, so it never offers to send what the dispatcher refuses.
for (const channel of QUEUE_CHANNELS) {
  check(`screen and dispatcher agree on ${channel}`, canDeliver(channel) === resolveAddress(channel, { phone: '+15551234567', email: 'a@example.com' }).ok)
}
check('by hand: wechat and line only', BY_HAND_CHANNELS.join() === 'wechat,line')
check('a send on wechat is by hand', sentByHand({ isSend: true, channel: 'wechat' }) && !sentByHand({ isSend: true, channel: 'text' }) && !sentByHand({ isSend: false, channel: 'wechat' }))
check('a by-hand row never reads as sending or failed', !/[Ss]ending|Failed|Queued/.test(messageStatusLabel({ channel: 'line', status: 'failed', sendAfter: new Date(0).toISOString(), error: 'channel not connected yet.' })))
check('a connected row reads as before', messageStatusLabel({ channel: 'email', status: 'sent', sendAfter: new Date(0).toISOString() }) === 'Sent')
check('email stays on the log transport when TRANSPORT_EMAIL is unset', routed('email', undefined) instanceof LogTransport)
check('email goes through Gmail when TRANSPORT_EMAIL=gmail', routed('email', 'gmail') instanceof GmailTransport)
check('…whatever the case or spacing', routed('email', ' Gmail ') instanceof GmailTransport)
check('a mis-set TRANSPORT_EMAIL stays on the log transport', routed('email', 'gmial') instanceof LogTransport && routed('email', 'resend') instanceof LogTransport && routed('email', '') instanceof LogTransport)
check('text is unchanged by TRANSPORT_EMAIL', routed('text', 'gmail') instanceof LogTransport)
check('LINE is unchanged by TRANSPORT_EMAIL', routed('line', 'gmail') instanceof LogTransport)
check('WeChat is unchanged by TRANSPORT_EMAIL', routed('wechat', 'gmail') instanceof LogTransport)
check('TRANSPORT alone never selects Gmail', routed('email', undefined, 'gmail') instanceof LogTransport && routed('text', undefined, 'gmail') instanceof LogTransport)
check('no channel given behaves as before', routed(undefined, 'gmail') instanceof LogTransport)

// ── The Gmail message ───────────────────────────────────────────────────────

/** Reads a message back the way a mail program would: encoded words in headers, base64 in the body. */
function readMessage(message: string): { headers: Record<string, string>; body: string; lines: string[] } {
  const [head, ...rest] = message.split('\r\n\r\n')
  const headers: Record<string, string> = {}
  for (const line of head.replace(/\r\n /g, ' ').split('\r\n')) {
    const colon = line.indexOf(':')
    headers[line.slice(0, colon).toLowerCase()] = line
      .slice(colon + 1)
      .trim()
      .replace(/=\?UTF-8\?B\?([^?]*)\?=(\s+(?==\?))?/g, (_all, word: string) => Buffer.from(word, 'base64').toString('utf8'))
  }
  return { headers, body: Buffer.from(rest.join('\r\n\r\n').replace(/\r\n/g, ''), 'base64').toString('utf8'), lines: message.split('\r\n') }
}

const hant = readMessage(buildMessage({ fromName: '林老師', fromAddress: 'counselor@example.com', to: 'parent@example.com', subject: '近期進展：陳怡安的申請文書與截止日期提醒，請您過目', body: '陳媽媽您好：\n\n怡安這週完成了個人陳述的第三稿。\n下次會議在週四下午四點。\n\n林老師' }))
check('a Traditional Chinese subject survives encoding', hant.headers.subject === '近期進展：陳怡安的申請文書與截止日期提醒，請您過目')
check('a Traditional Chinese From name survives encoding', hant.headers.from === '林老師 <counselor@example.com>')
check('a Traditional Chinese body survives encoding', hant.body === '陳媽媽您好：\r\n\r\n怡安這週完成了個人陳述的第三稿。\r\n下次會議在週四下午四點。\r\n\r\n林老師')
const hans = readMessage(buildMessage({ fromName: '张老师', fromAddress: 'counselor@example.com', to: 'parent@example.com', subject: '提醒：即将到期', body: '张先生您好，凯文的税表还没有上传，周五前请帮忙处理。😊' }))
check('Simplified Chinese survives too, with an emoji', hans.headers.subject === '提醒：即将到期' && hans.headers.from === '张老师 <counselor@example.com>' && hans.body.endsWith('周五前请帮忙处理。😊'))
check('the message says it is UTF-8 plain text', hans.headers['content-type'] === 'text/plain; charset=UTF-8' && hans.headers['content-transfer-encoding'] === 'base64' && hans.headers['mime-version'] === '1.0')
check('no line is longer than mail allows', hant.lines.every((line) => line.length <= 78))
check('no encoded word is longer than 75 characters', (buildMessage({ fromName: 'A', fromAddress: 'a@example.com', to: 'b@example.com', subject: '會議紀要'.repeat(30), body: 'x' }).match(/=\?UTF-8\?B\?[^?]*\?=/g) ?? []).every((word) => word.length <= 75))
check('a long subject is not cut inside a character', readMessage(buildMessage({ fromName: 'A', fromAddress: 'a@example.com', to: 'b@example.com', subject: '會議紀要😊'.repeat(20), body: 'x' })).headers.subject === '會議紀要😊'.repeat(20))
const injected = buildMessage({ fromName: 'Dana\r\nBcc: someone@example.com', fromAddress: 'a@example.com', to: 'b@example.com', subject: 'Hello\r\nBcc: other@example.com', body: 'x' })
check('a line break in a name or subject cannot add a header', !/^Bcc:/m.test(injected) && injected.split('\r\n\r\n')[0].split('\r\n').length === 6)
check('an English name is quoted, not encoded', buildMessage({ fromName: 'Dana "D" Whitfield', fromAddress: 'a@example.com', to: 'b@example.com', subject: 'Progress update', body: 'x' }).startsWith('From: "Dana D Whitfield" <a@example.com>\r\nTo: <b@example.com>\r\nSubject: Progress update\r\n'))

// ── GmailTransport, and the dispatcher in front of it ───────────────────────
// Google is the invented one (server/google/fakeDrive.ts); the database is the
// in-memory stand-in. A request to any real address fails the run.

process.env.VITE_SUPABASE_URL = FAKE_SUPABASE_URL
process.env.VITE_SUPABASE_ANON_KEY = 'anon'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
process.env.GOOGLE_TOKEN_KEY = 'a test key for the outbox checks, long enough'
delete process.env.GOOGLE_FAKE
delete process.env.TRANSPORT
delete process.env.TRANSPORT_EMAIL
const driveState = join(mkdtempSync(join(tmpdir(), 'platinum-outbox-')), 'google.json')
writeFileSync(driveState, '{}')
process.env.GOOGLE_FAKE_STATE = driveState

const db = fakeSupabase()
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const answer = await db.fetch(input, init)
  if (answer) return answer
  throw new Error(`An offline test tried to reach ${new URL(input instanceof Request ? input.url : String(input)).origin}`)
}) as typeof fetch

/** Every message handed to "Gmail" in this run. */
const gmailSends: { authorization: string | null; message: ReturnType<typeof readMessage> }[] = []
google.fetch = (url, init) => {
  if (new URL(url).hostname === 'gmail.googleapis.com') {
    const raw = (JSON.parse(String(init?.body)) as { raw: string }).raw
    gmailSends.push({ authorization: new Headers(init?.headers).get('authorization'), message: readMessage(Buffer.from(raw, 'base64url').toString('utf8')) })
  }
  return fakeGoogle(url, init)
}

const FIRM = '44444444-4444-4444-8444-444444444444'
const LIN = '55555555-5555-4555-8555-555555555551'
const NO_GMAIL = '55555555-5555-4555-8555-555555555552'
const DRIVE_ONLY = '55555555-5555-4555-8555-555555555553'
const KEY = process.env.GOOGLE_TOKEN_KEY
db.table('firm_members').push({ firm_id: FIRM, user_id: LIN, role: 'owner', display_name: '林老師' }, { firm_id: FIRM, user_id: NO_GMAIL, role: 'counselor', display_name: 'Priya Raman' }, { firm_id: FIRM, user_id: DRIVE_ONLY, role: 'counselor', display_name: 'Sam Okafor' })
db.table('google_connections').push(
  { user_id: LIN, firm_id: FIRM, google_address: 'sample.counselor@example.com', scopes: [DRIVE_SCOPE, GMAIL_SEND_SCOPE], refresh_token_encrypted: encryptToken('fake-refresh-token-gmail', LIN, KEY), last_error: null },
  { user_id: DRIVE_ONLY, firm_id: FIRM, google_address: 'sam@example.com', scopes: [DRIVE_SCOPE], refresh_token_encrypted: encryptToken('fake-refresh-token', DRIVE_ONLY, KEY), last_error: null },
)

const gmail = new GmailTransport()
const reasonOf = async (work: () => Promise<unknown>) => {
  try {
    await work()
    return 'sent'
  } catch (error) {
    return error instanceof Error ? error.message : 'unknown'
  }
}
const mail = { channel: 'email' as const, to: 'allowed@example.com', body: '您好', language: 'zh-Hant' as const, subject: '近期進展' }

const sentOne = await gmail.send({ ...mail, senderUserId: LIN })
check('Gmail sends as the approving counselor and returns Google’s message id', sentOne.providerMessageId.startsWith('fake-gmail-') && gmailSends.length === 1)
check('…from their display name and connected address', gmailSends[0].message.headers.from === '林老師 <sample.counselor@example.com>')
check('…to the recipient, with the subject and body given', gmailSends[0].message.headers.to === '<allowed@example.com>' && gmailSends[0].message.headers.subject === '近期進展' && gmailSends[0].message.body === '您好')
check('a message with no counselor fails plainly', (await reasonOf(() => gmail.send(mail))) === 'No counselor on this message')
check('a counselor who has not connected Google fails plainly', (await reasonOf(() => gmail.send({ ...mail, senderUserId: NO_GMAIL }))) === 'Gmail not connected for Priya Raman')
check('a counselor connected for Drive only fails the same way', (await reasonOf(() => gmail.send({ ...mail, senderUserId: DRIVE_ONLY }))) === 'Gmail not connected for Sam Okafor')
check('Gmail refuses anything that is not email', (await reasonOf(() => gmail.send({ ...mail, channel: 'text', to: '+15551234567', senderUserId: LIN }))) === 'Gmail sends email only')
check('an address that is not an email address is refused', (await reasonOf(() => gmail.send({ ...mail, to: 'a@example.com\r\nBcc: b@example.com', senderUserId: LIN }))) === 'not a valid email address')
check('a counselor who has left the firm sends nothing', await (async () => {
  const members = db.table('firm_members')
  const gone = members.splice(members.findIndex((m) => m.user_id === LIN), 1)[0]
  const reason = await reasonOf(() => gmail.send({ ...mail, senderUserId: LIN }))
  members.push(gone)
  return reason === 'No counselor on this message'
})())
check('a connection made in another firm is not used', await (async () => {
  const row = db.table('google_connections').find((c) => c.user_id === LIN)!
  row.firm_id = '99999999-9999-4999-8999-999999999999'
  const reason = await reasonOf(() => gmail.send({ ...mail, senderUserId: LIN }))
  row.firm_id = FIRM
  return reason === 'Gmail not connected for 林老師'
})())
check('none of those reached Gmail', gmailSends.length === 1)

// The dispatcher, with rows as queue_message leaves them.
const STUDENT = '66666666-6666-4666-8666-666666666661'
const ALLOWED_PARENT = '66666666-6666-4666-8666-666666666662'
const OTHER_PARENT = '66666666-6666-4666-8666-666666666663'
db.table('students').push({ id: STUDENT, firm_id: FIRM, phone: '+1 555 000 0001', email: 'student@example.com' })
db.table('parents').push({ id: ALLOWED_PARENT, firm_id: FIRM, student_id: STUDENT, phone: '+15551234567', email: 'Allowed@example.com' }, { id: OTHER_PARENT, firm_id: FIRM, student_id: STUDENT, phone: '+15559999999', email: 'stranger@example.com' })
let rowNumber = 0
const queue = (row: Record<string, unknown>) => {
  const rowId = `77777777-7777-4777-8777-${String(++rowNumber).padStart(12, '0')}`
  db.table('outbox').push({ id: rowId, firm_id: FIRM, student_id: STUDENT, to_kind: 'parent', to_name: '陳媽媽', parent_id: ALLOWED_PARENT, channel: 'email', language: 'zh-Hant', kind: 'parent_report', body: '陳媽媽您好，怡安本週進度良好。', body_en: null, status: 'queued', send_after: new Date(Date.now() - 1000).toISOString(), approved_by: LIN, error: null, provider_message_id: null, ...row })
  return rowId
}
const rowOf = (rowId: string) => db.table('outbox').find((r) => r.id === rowId)!
/** Runs the dispatcher with the log transport's printing kept out of the test output. */
async function dispatch(settings: { email?: string; allowlist: string }) {
  if (settings.email === undefined) delete process.env.TRANSPORT_EMAIL
  else process.env.TRANSPORT_EMAIL = settings.email
  process.env.SEND_ALLOWLIST = settings.allowlist
  const { log, error } = console
  console.log = () => {}
  console.error = () => {}
  try {
    return await dispatchFirm(FIRM)
  } finally {
    console.log = log
    console.error = error
    delete process.env.TRANSPORT_EMAIL
    delete process.env.SEND_ALLOWLIST
  }
}
const ALLOW = 'allowed@example.com, +15551234567'

const viaLog = queue({})
await dispatch({ allowlist: ALLOW })
check('with TRANSPORT_EMAIL unset the dispatcher keeps email on the log transport', rowOf(viaLog).status === 'sent' && String(rowOf(viaLog).provider_message_id).startsWith('log_') && gmailSends.length === 1)

const good = queue({})
const offList = queue({ parent_id: OTHER_PARENT, to_name: 'Stranger' })
const noApprover = queue({ approved_by: null })
const notConnected = queue({ approved_by: NO_GMAIL })
const text = queue({ channel: 'text' })
const line = queue({ channel: 'line' })
const summary = await dispatch({ email: 'gmail', allowlist: ALLOW })
check('with TRANSPORT_EMAIL=gmail an allowlisted email goes out through Gmail', rowOf(good).status === 'sent' && String(rowOf(good).provider_message_id).startsWith('fake-gmail-') && gmailSends.length === 2)
check('…as the row’s approved_by, with a subject from its kind and language', gmailSends[1].message.headers.from === '林老師 <sample.counselor@example.com>' && gmailSends[1].message.headers.subject === '近期進展' && gmailSends[1].message.headers.to === '<Allowed@example.com>')
check('…carrying the body the dispatcher passed', gmailSends[1].message.body === '陳媽媽您好，怡安本週進度良好。')
check('an off-allowlist recipient fails at the allowlist', rowOf(offList).status === 'failed' && rowOf(offList).error === 'recipient not on allowlist')
check('…and never reaches GmailTransport', !gmailSends.some((s) => s.message.headers.to.includes('stranger')) && gmailSends.length === 2)
check('a row with no approved_by fails with “No counselor on this message”', rowOf(noApprover).status === 'failed' && rowOf(noApprover).error === 'No counselor on this message')
check('a counselor without Gmail fails with their name', rowOf(notConnected).status === 'failed' && rowOf(notConnected).error === 'Gmail not connected for Priya Raman')
check('text still goes through the log transport', rowOf(text).status === 'sent' && String(rowOf(text).provider_message_id).startsWith('log_'))
check('LINE still fails as not connected', rowOf(line).status === 'failed' && rowOf(line).error === 'channel not connected yet.')
check('the dispatcher’s count matches', summary.processed === 6 && summary.sent === 2 && summary.failed === 4)
check('with an empty allowlist nothing reaches Gmail', await (async () => {
  const blocked = queue({})
  await dispatch({ email: 'gmail', allowlist: '' })
  return rowOf(blocked).status === 'failed' && rowOf(blocked).error === 'recipient not on allowlist' && gmailSends.length === 2
})())

// Consent expired (every 7 days while the Google project is in testing).
writeFileSync(driveState, JSON.stringify({ expired: true }))
forgetAccessTokens()
const expired = queue({})
await dispatch({ email: 'gmail', allowlist: ALLOW })
check('when the grant has expired the row fails with “Reconnect Gmail for <name>”', rowOf(expired).status === 'failed' && rowOf(expired).error === 'Reconnect Gmail for 林老師')
check('…the connection records it, so Settings shows “Reconnect Gmail”', db.table('google_connections').find((c) => c.user_id === LIN)?.last_error === 'reconnect')
check('…and nothing was sent', gmailSends.length === 2)
const after = queue({})
writeFileSync(driveState, '{}')
await dispatch({ email: 'gmail', allowlist: ALLOW })
check('…and it keeps failing that way until they reconnect', rowOf(after).error === 'Reconnect Gmail for 林老師' && gmailSends.length === 2)
check('no failure reason holds a token or Google’s raw answer', db.table('outbox').every((r) => !/token|invalid_grant|Bearer|\{/.test(String(r.error ?? ''))))
check('every message handed to Gmail carried a bearer token in the header only', gmailSends.every((s) => s.authorization === 'Bearer fake-access-token' && !JSON.stringify(s.message).includes('fake-access-token')))

// ── Nothing a logger sees holds a body or a student link ────────────────────
// Every console method is captured while texts with {{student_link}} go out
// through the log transport, and while one fails after its link was made.

{
  const BODY = 'Hi Mia, your checklist is here: '
  const lines: string[] = []
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const
  const saved = methods.map((m) => console[m])
  for (const m of methods) {
    console[m] = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    }
  }
  process.env.PUBLIC_APP_URL = 'https://app.example'
  process.env.SEND_ALLOWLIST = '+1 555 000 0001'
  delete process.env.TRANSPORT_TEXT
  const linked = queue({ to_kind: 'student', to_name: 'Mia', parent_id: null, channel: 'text', language: 'en', kind: 'weekly_text', body: `${BODY}${STUDENT_LINK_PLACEHOLDER}` })
  const realLog = new LogTransport()
  const failing = queue({ to_kind: 'student', to_name: 'Mia', parent_id: null, channel: 'email', language: 'en', kind: 'weekly_text', body: `${BODY}${STUDENT_LINK_PLACEHOLDER}` })
  process.env.SEND_ALLOWLIST = '+1 555 000 0001, student@example.com'
  // The email transport throws an error that quotes the filled-in link.
  const original = LogTransport.prototype.send
  LogTransport.prototype.send = async function (input) {
    if (input.channel === 'email') throw new Error(`provider refused ${input.body.slice(BODY.length)}`)
    return original.call(this, input)
  }
  try {
    await dispatchFirm(FIRM)
    LogTransport.prototype.send = original
    await realLog.send({ channel: 'email', to: 'student@example.com', body: `${BODY}https://app.example/s/direct`, language: 'en', outboxId: 'x' })
  } finally {
    LogTransport.prototype.send = original
    methods.forEach((m, i) => (console[m] = saved[i]))
    delete process.env.PUBLIC_APP_URL
    delete process.env.SEND_ALLOWLIST
  }
  check('the linked text was sent through the log transport', rowOf(linked).status === 'sent' && String(rowOf(linked).provider_message_id).startsWith('log_'))
  check('…and a link row was made for it', db.table('student_links').some((l) => l.student_id === STUDENT && typeof l.expires_at === 'string'))
  check('the failing email failed', rowOf(failing).status === 'failed')
  check('something was logged', lines.length > 0, `${lines.length} lines`)
  check('no logged line contains /s/', lines.every((l) => !l.includes('/s/')), lines.find((l) => l.includes('/s/')))
  check('no logged line contains the body', lines.every((l) => !l.includes(BODY.trim())))
  check('the log transport names the channel, a masked recipient and the body length', lines.some((l) => l.includes('[transport:log]') && l.includes('…0001') && l.includes('bodyLength') && !l.includes('555 000 0001')))
  check('the stored failure reason holds no link either', !String(rowOf(failing).error).includes('/s/'))
}

// ── Reminder skips ──────────────────────────────────────────────────────────

{
  const { activeSkipKeys, skipIsActive } = await import('../src/lib/reminders.js')
  const { addDays, todayISO } = await import('../src/lib/dates.js')
  const today = todayISO()
  check('a skip with no until stays active', skipIsActive({ until: undefined }, today))
  check('a skip until tomorrow is active today', skipIsActive({ until: addDays(today, 1) }, today))
  check('a skip until today has ended', !skipIsActive({ until: today }, today))
  check('a skip until yesterday has ended', !skipIsActive({ until: addDays(today, -1) }, today))
  const keys = activeSkipKeys(
    [
      { id: '1', dedupeKey: 'keep', skippedAt: today, until: addDays(today, 1) },
      { id: '2', dedupeKey: 'gone', skippedAt: today, until: today },
      { id: '3', dedupeKey: 'forever', skippedAt: today },
    ],
    today,
  )
  check('activeSkipKeys keeps future and permanent skips', keys.has('keep') && keys.has('forever') && !keys.has('gone'))
}

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('All checks passed')
