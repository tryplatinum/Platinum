// Offline checks for the outbox queue. Run with:
//
//   npm run test:outbox
//
// No keys and no network. This checks the payload rules in shared/outbox.ts
// It does not run the SQL in queue_message or cancel_message.

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
check(
  'a queued message past the window is not delivered yet',
  outboxStatusLabel({ status: 'queued', sendAfter: new Date(Date.now() - 1000).toISOString() }) === 'Not delivered yet (delivery arrives in M1)',
)

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('All checks passed')
