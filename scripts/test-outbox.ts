// Offline checks for the outbox queue and the send path. Run with:
//
//   npm run test:outbox
//
// No keys and no network. This checks the payload rules in shared/outbox.ts
// and the allowlist / address / placeholder / expiry helpers in shared/dispatch.ts.
// It does not run the SQL in queue_message or cancel_message.

import {
  STUDENT_LINK_PLACEHOLDER,
  STUDENT_LINK_PREVIEW,
  allowlistAllows,
  fillStudentLink,
  linkIsExpired,
  normalizeEmail,
  normalizePhone,
  parseAllowlist,
  previewStudentLink,
  resolveAddress,
} from '../shared/dispatch.js'
import { UNDO_SECONDS, outboxStatusLabel, validateQueuePayload } from '../shared/outbox.js'

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

check('a null expiry never expires', !linkIsExpired(null))
check('an undefined expiry never expires', !linkIsExpired(undefined))
check('a future expiry is still valid', !linkIsExpired(new Date(Date.now() + 60_000).toISOString()))
check('a past expiry is rejected', linkIsExpired(new Date(Date.now() - 1000).toISOString()))

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('All checks passed')
