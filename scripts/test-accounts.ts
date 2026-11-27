// Offline checks for /api/account and the server code behind it. No keys, no
// network: Supabase is the in-memory stand-in in scripts/fakeSupabase.ts,
// Google is the invented one, and any request to a real address fails the run.
//
//   npm run test:accounts       (also part of npm run test:notes)
//
// What is NOT checked here: what the database enforces (that is
// scripts/test-accounts-db.ts, in PGlite) and row level security against the
// real project (scripts/test-isolation.ts). The database functions are
// stand-ins here, so these checks are about the server: who it lets ask, what
// it sends to the database, and what it gives back.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ACCOUNT_REQUEST, GUARDIAN_CONSENT, INVITE_SECRET, STUDENT_AGE, joinLink, maskEmail, removalWords } from '../shared/account.js'
import { STUDENT_TOKEN_HEADER } from '../shared/constants.js'
import { POST as account } from '../api/account.js'
import { GET as agentGet, POST as agentPost } from '../api/agent.js'
import { POST as aiPost } from '../api/ai.js'
import { POST as collegesPost } from '../api/colleges.js'
import { POST as dispatchPost } from '../api/dispatch.js'
import { POST as documentsPost } from '../api/documents.js'
import { POST as googlePost } from '../api/google.js'
import { POST as phonePost } from '../api/phone.js'
import { GET as studentGet, POST as studentPost } from '../api/student.js'
import { POST as translatePost } from '../api/translate.js'
import { DEAD_INVITATION } from '../server/account.js'
import { google } from '../server/google/config.js'
import { fakeGoogle } from '../server/google/fakeDrive.js'
import { encryptToken } from '../server/google/secrets.js'
import { FAKE_SUPABASE_URL, fakeSupabase } from './fakeSupabase.js'

let failed = 0
let count = 0
function check(name: string, pass: boolean, detail = ''): void {
  count++
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

process.env.VITE_SUPABASE_URL = FAKE_SUPABASE_URL
process.env.VITE_SUPABASE_ANON_KEY = 'anon'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
process.env.GOOGLE_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64')
delete process.env.GOOGLE_FAKE

const db = fakeSupabase()
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const answer = await db.fetch(input, init)
  if (answer) return answer
  throw new Error(`An offline test tried to reach ${new URL(input instanceof Request ? input.url : String(input)).origin}`)
}) as typeof fetch
const googleCalls: string[] = []
google.fetch = (url, init) => {
  googleCalls.push(new URL(url).pathname)
  return fakeGoogle(url, init)
}
// Nothing an account request does may print a secret or a hash.
const printed: string[] = []
for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const real = console[method].bind(console)
  console[method] = (...args: unknown[]) => {
    printed.push(args.map(String).join(' '))
    if (method === 'log') real(...args)
  }
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const FIRM = '11111111-1111-4111-8111-111111111111'
const OTHER_FIRM = '99999999-9999-4999-8999-999999999999'
const OWNER = '22222222-2222-4222-8222-222222222222'
const COUNSELOR = '33333333-3333-4333-8333-333333333333'
const NEWCOMER = '44444444-4444-4444-8444-444444444444'
const SECOND_OWNER = '55555555-5555-4555-8555-555555555555'
const STUDENT = '66666666-6666-4666-8666-666666666666'

db.table('firms').push({ id: FIRM, name: 'Northgate College Counseling' }, { id: OTHER_FIRM, name: 'Elsewhere Advising' })
db.table('firm_members').push(
  { id: 'm1', firm_id: FIRM, user_id: OWNER, role: 'owner', display_name: 'Avery Stone', created_at: '2026-09-01T00:00:00.000Z' },
  { id: 'm2', firm_id: FIRM, user_id: COUNSELOR, role: 'counselor', display_name: 'Dana Whitlock', created_at: '2026-10-01T00:00:00.000Z' },
)
db.table('students').push({ id: STUDENT, firm_id: FIRM, first_name: 'Emily', last_name: 'Chen', grad_year: 2027, archived: false })
for (const [token, id, email, confirmed] of [
  ['owner-token', OWNER, 'avery@northgate.example', true],
  ['counselor-token', COUNSELOR, 'dana@northgate.example', true],
  ['newcomer-token', NEWCOMER, 'lee@northgate.example', true],
] as const) {
  db.users.set(token, id)
  db.people.set(id, { email, confirmed })
}

let from = 0
/** One request. Each comes from its own address unless one is given, so the per-address limits do not mix checks. */
async function call(body: unknown, token?: string, address = `10.0.${Math.floor(from / 250)}.${from++ % 250}`): Promise<{ status: number; body: { ok: boolean; code?: string; message?: string; data?: unknown }; text: string }> {
  const response = await account(
    new Request('http://localhost/api/account', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': address, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
  const text = await response.text()
  return { status: response.status, body: JSON.parse(text) as { ok: boolean }, text }
}

const secretOf = (n: number) => String(n).padStart(43, 'A')
const invitation = (n: number, over: Record<string, unknown> = {}) => {
  const row = { id: `inv-${n}`, firm_id: FIRM, kind: 'counselor', email: 'lee@northgate.example', student_id: null, token_hash: sha(secretOf(n)), created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), accepted_at: null, revoked_at: null, ...over }
  db.table('invitations').push(row)
  return secretOf(n)
}

// ── The small rules ─────────────────────────────────────────────────────────
{
  check('an address is masked to its first character and its domain', maskEmail('jordan@example.com') === 'j•••@example.com' && maskEmail('nope') === '•••')
  check('the invitation link carries the secret in the fragment', joinLink('https://app.example', secretOf(1)) === `https://app.example/join#${secretOf(1)}`)
  check('a removal says only what will happen', removalWords({ google: true, phone: false, queued: 1 }) === 'Their Google connection is disconnected and 1 queued message is cancelled.' && removalWords({ google: false, phone: false, queued: 0 }) === 'They have no Google connection, no phone and no queued messages.', removalWords({ google: true, phone: true, queued: 3 }))
  check('no request names a firm or the person asking', ['firmId', 'firm_id', 'actor', 'by'].every((key) => !JSON.stringify(ACCOUNT_REQUEST).includes(`"${key}"`)))
  const parsed = ACCOUNT_REQUEST.safeParse({ action: 'invite_counselor', email: '  Lee@Northgate.Example ' })
  check('an invited address is trimmed and put in lower case', parsed.success && parsed.data.action === 'invite_counselor' && parsed.data.email === 'lee@northgate.example')
}

// ── Preview: one answer for every invitation that does not work ─────────────
{
  const live = invitation(1)
  const expired = invitation(2, { expires_at: new Date(Date.now() - 60_000).toISOString() })
  const revoked = invitation(3, { revoked_at: new Date().toISOString() })
  const used = invitation(4, { accepted_at: new Date().toISOString(), accepted_by: NEWCOMER })
  const noExpiry = invitation(5, { expires_at: 'not a date' })
  const answers = await Promise.all([secretOf(999), expired, revoked, used, noExpiry].map((secret) => call({ action: 'preview', secret })))
  check('unknown, expired, revoked and used get the same status', answers.every((a) => a.status === 404), answers.map((a) => a.status).join())
  check('and word for word the same answer', answers.every((a) => a.text === answers[0].text) && answers[0].body.message === DEAD_INVITATION && answers[0].body.code === 'dead_invitation')
  const malformed = await call({ action: 'preview', secret: 'short' })
  check('a secret of the wrong shape gets that answer too', malformed.status === 404 && malformed.text === answers[0].text)

  const good = await call({ action: 'preview', secret: live })
  const data = good.body.data as { kind: string; firmName: string; email: string; studentFirstName?: string }
  check('a live invitation shows the firm, the kind and the address masked', good.status === 200 && data.firmName === 'Northgate College Counseling' && data.kind === 'counselor' && data.email === 'l•••@northgate.example', good.text)
  check('the preview holds no full address, id or hash', !good.text.includes('lee@') && !good.text.includes(sha(live)) && !good.text.includes(FIRM) && !good.text.includes('inv-1'))
  check('preview needs no sign-in', good.status === 200)

  let limited = 0
  for (let i = 0; i < 40; i++) if ((await call({ action: 'preview', secret: secretOf(999) }, undefined, '203.0.113.9')).status === 429) limited++
  check('previews are rate limited by address', limited === 10, String(limited))
}

// ── Accept ──────────────────────────────────────────────────────────────────
{
  const calls: Record<string, unknown>[] = []
  db.rpc('accept_counselor_invitation', (args) => {
    calls.push(args)
    return { kind: 'counselor', firm_id: FIRM }
  })
  const secret = secretOf(1)
  const anonymous = await call({ action: 'accept', secret, displayName: 'Lee Moreno' })
  check('accepting needs a sign-in', anonymous.status === 401 && calls.length === 0)
  const forged = await call({ action: 'accept', secret, displayName: 'Lee Moreno' }, 'not-a-token')
  check('a token Supabase does not know is refused', forged.status === 401 && calls.length === 0)

  const wrong = await call({ action: 'accept', secret, displayName: 'Dana Whitlock' }, 'counselor-token')
  check('a person signed in with another address is told so, and nothing is accepted', wrong.status === 403 && wrong.body.code === 'wrong_email' && calls.length === 0, wrong.text)
  db.people.set(NEWCOMER, { email: 'lee@northgate.example', confirmed: false })
  const unconfirmed = await call({ action: 'accept', secret, displayName: 'Lee Moreno' }, 'newcomer-token')
  check('an unconfirmed address is told to confirm first', unconfirmed.status === 403 && unconfirmed.body.code === 'confirm_email' && calls.length === 0, unconfirmed.text)
  db.people.set(NEWCOMER, { email: 'Lee@Northgate.example', confirmed: true })
  const nameless = await call({ action: 'accept', secret }, 'newcomer-token')
  check('a counselor has to give their name', nameless.status === 400 && calls.length === 0)
  const dead = await call({ action: 'accept', secret: secretOf(2), displayName: 'Lee Moreno' }, 'newcomer-token')
  check('a dead invitation gets the one answer here too', dead.status === 404 && dead.body.message === DEAD_INVITATION && calls.length === 0)

  const good = await call({ action: 'accept', secret, displayName: ' Lee Moreno ', userId: OWNER, firmId: OTHER_FIRM, role: 'owner' }, 'newcomer-token')
  check('the invited person is accepted', good.status === 200 && (good.body.data as { kind: string }).kind === 'counselor', good.text)
  check('the database is given the hash, never the secret', calls.length === 1 && calls[0].hash === sha(secret) && !JSON.stringify(calls[0]).includes(secret))
  check('who is accepting comes from the verified sign-in, not from the body', calls[0].person === NEWCOMER && calls[0].display_name === 'Lee Moreno' && Object.keys(calls[0]).sort().join() === 'display_name,hash,person')

  db.rpc('accept_counselor_invitation', () => {
    throw { code: 'PI001', message: 'This invitation does not work.' }
  })
  const lost = await call({ action: 'accept', secret, displayName: 'Lee Moreno' }, 'newcomer-token')
  check('losing the race for an invitation is the same answer as a dead link', lost.status === 404 && lost.body.message === DEAD_INVITATION)
  db.rpc('accept_counselor_invitation', () => {
    throw { code: 'PI004', message: 'This account already belongs to a firm.' }
  })
  const member = await call({ action: 'accept', secret, displayName: 'Lee Moreno' }, 'newcomer-token')
  check('a person who already belongs to a firm is told so', member.status === 409 && member.body.code === 'already_member')
}

// ── Inviting ────────────────────────────────────────────────────────────────
{
  const calls: Record<string, unknown>[] = []
  db.rpc('invite_counselor', (args) => {
    calls.push(args)
    return { id: 'inv-new', email: args.email, expires_at: '2026-12-04T00:00:00.000Z' }
  })
  const byCounselor = await call({ action: 'invite_counselor', email: 'new@northgate.example' }, 'counselor-token')
  check('a counselor cannot invite a counselor, and the database is not even asked', byCounselor.status === 403 && calls.length === 0)
  const byNobody = await call({ action: 'invite_counselor', email: 'new@northgate.example' })
  check('nor can someone who is not signed in', byNobody.status === 401 && calls.length === 0)
  const byOutsider = await call({ action: 'invite_counselor', email: 'new@northgate.example' }, 'newcomer-token')
  check('nor someone signed in who belongs to no firm', byOutsider.status === 403 && byOutsider.body.code === 'no_firm' && calls.length === 0)

  const made = await call({ action: 'invite_counselor', email: ' New@Northgate.example' }, 'owner-token')
  const data = made.body.data as { secret: string; email: string; expiresAt: string }
  check('an owner gets a secret of 32 random bytes, once', made.status === 200 && INVITE_SECRET.safeParse(data.secret).success && Buffer.from(data.secret, 'base64url').length === 32, made.text)
  check('only its hash goes to the database', calls.length === 1 && calls[0].token_hash === sha(data.secret) && calls[0].email === 'new@northgate.example' && !JSON.stringify(calls[0]).includes(data.secret))
  check('the answer does not hold the hash', !made.text.includes(sha(data.secret)))
  const other = await call({ action: 'invite_counselor', email: 'new@northgate.example' }, 'owner-token')
  check('every invitation has its own secret', (other.body.data as { secret: string }).secret !== data.secret)

  db.rpc('invite_counselor', () => {
    throw { code: 'PI005', message: 'That address already has an invitation waiting. Make a new link for it instead.' }
  })
  const pending = await call({ action: 'invite_counselor', email: 'new@northgate.example' }, 'owner-token')
  check('an address with an invitation waiting is refused with a reason the screen can act on', pending.status === 409 && pending.body.code === 'pending_exists', pending.text)

  db.rpc('revoke_invitation', () => {
    throw { code: 'PI009', message: 'That invitation is no longer waiting.' }
  })
  const late = await call({ action: 'revoke_invitation', invitationId: '00000000-0000-4000-8000-000000000001' }, 'owner-token')
  check('an owner acting on an invitation that was just used is told so in their own terms, not the invitee’s', late.status === 404 && late.body.message === 'That invitation is no longer waiting.', late.text)

  const replaced: Record<string, unknown>[] = []
  db.rpc('invite_counselor', (args) => {
    replaced.push(args)
    return { id: 'inv-newer', email: args.email, expires_at: '2026-12-04T00:00:00.000Z' }
  })
  const fresh = await call({ action: 'new_link', invitationId: '00000000-0000-4000-8000-000000000001' }, 'owner-token')
  check('“New link” for an invitation that is not this firm’s is not found', fresh.status === 404 && replaced.length === 0)
  db.table('invitations').push({ id: '00000000-0000-4000-8000-000000000002', firm_id: FIRM, kind: 'counselor', email: 'kept@northgate.example', student_id: null, token_hash: sha('x'), accepted_at: null, revoked_at: null, created_at: new Date().toISOString(), expires_at: new Date().toISOString() })
  const again = await call({ action: 'new_link', invitationId: '00000000-0000-4000-8000-000000000002' }, 'owner-token')
  check('“New link” keeps the address and names the invitation it replaces', again.status === 200 && replaced.length === 1 && replaced[0].email === 'kept@northgate.example' && replaced[0].replace === '00000000-0000-4000-8000-000000000002')
}

// ── The firm page ───────────────────────────────────────────────────────────
{
  const byCounselor = await call({ action: 'firm' }, 'counselor-token')
  check('a counselor is not given the firm page’s data', byCounselor.status === 403 && !byCounselor.text.includes('@'), byCounselor.text)
  const page = await call({ action: 'firm' }, 'owner-token')
  const data = page.body.data as { members: { name: string; email: string; role: string; you: boolean }[]; invitations: { email: string; expired: boolean }[] }
  check('an owner sees every member with their address, role and a “you” mark', page.status === 200 && data.members.length === 2 && data.members[0].email === 'avery@northgate.example' && data.members[0].you && data.members[1].email === 'dana@northgate.example' && !data.members[1].you && data.members[1].role === 'counselor', page.text)
  check('waiting invitations are listed; used and revoked ones are not', data.invitations.every((i) => !['inv-3', 'inv-4'].includes((i as unknown as { id: string }).id)) && data.invitations.length >= 2)
  check('one that ran out is marked, so the screen can offer a new link', data.invitations.some((i) => i.expired) && data.invitations.some((i) => !i.expired))
  check('no hash is in the answer', !page.text.includes('token_hash') && !/[0-9a-f]{64}/.test(page.text))
}

// ── Roles and removal ───────────────────────────────────────────────────────
{
  const roleCalls: Record<string, unknown>[] = []
  db.rpc('set_member_role', (args) => {
    roleCalls.push(args)
    return null
  })
  await call({ action: 'set_role', userId: COUNSELOR, role: 'owner' }, 'owner-token')
  check('changing a role is the database’s decision: the server passes it on', roleCalls.length === 1 && roleCalls[0].member === COUNSELOR && roleCalls[0].new_role === 'owner')
  db.rpc('set_member_role', () => {
    throw { code: 'PI010', message: 'You are the only owner. Make someone else an owner first.' }
  })
  const last = await call({ action: 'set_role', userId: OWNER, role: 'counselor' }, 'owner-token')
  check('the last owner stepping down is refused with the database’s own words', last.status === 409 && last.body.code === 'last_owner' && last.body.message === 'You are the only owner. Make someone else an owner first.')

  const leaveCalls: unknown[] = []
  db.rpc('leave_firm', () => {
    leaveCalls.push(1)
    return { google: false, phone: false, cancelled: 0 }
  })
  const before = googleCalls.length
  const lastLeave = await call({ action: 'leave' }, 'owner-token')
  check('the last owner cannot leave, and nothing is disconnected first', lastLeave.status === 409 && lastLeave.body.code === 'last_owner' && leaveCalls.length === 0 && googleCalls.length === before)

  const removeCalls: Record<string, unknown>[] = []
  db.rpc('remove_member', (args) => {
    removeCalls.push(args)
    return { google: true, phone: true, cancelled: 2 }
  })
  db.rpc('member_removal_summary', () => ({ google: true, phone: true, queued: 2 }))
  const byCounselor = await call({ action: 'remove_member', userId: OWNER }, 'counselor-token')
  check('a counselor cannot remove a member', byCounselor.status === 403 && removeCalls.length === 0)
  const stranger = await call({ action: 'remove_member', userId: NEWCOMER }, 'owner-token')
  check('someone who is not a member of the firm cannot be “removed”', stranger.status === 403 && removeCalls.length === 0 && googleCalls.length === before)
  const self = await call({ action: 'remove_member', userId: OWNER }, 'owner-token')
  check('an owner does not remove themselves', self.status === 400 && removeCalls.length === 0)
  db.table('firm_members').push({ id: 'm3', firm_id: FIRM, user_id: SECOND_OWNER, role: 'owner', display_name: 'Jo Reyes', created_at: '2026-10-02T00:00:00.000Z' })
  db.people.set(SECOND_OWNER, { email: 'jo@northgate.example', confirmed: true })
  const anOwner = await call({ action: 'remove_member', userId: SECOND_OWNER }, 'owner-token')
  check('an owner cannot be removed', anOwner.status === 403 && removeCalls.length === 0 && googleCalls.length === before)

  const summary = await call({ action: 'removal_summary', userId: COUNSELOR }, 'owner-token')
  check('the confirmation is told what removal will do', summary.status === 200 && JSON.stringify(summary.body.data) === JSON.stringify({ google: true, phone: true, queued: 2 }))

  db.table('google_connections').push({ user_id: COUNSELOR, firm_id: FIRM, google_address: 'dana@gmail.example', scopes: [], refresh_token_encrypted: encryptToken('fake-refresh-token-dana', COUNSELOR, process.env.GOOGLE_TOKEN_KEY!), connected_at: new Date().toISOString(), last_error: null })
  const removed = await call({ action: 'remove_member', userId: COUNSELOR }, 'owner-token')
  check('removing a counselor: the grant is revoked at Google', removed.status === 200 && googleCalls.slice(before).filter((p) => p === '/revoke').length === 1, googleCalls.slice(before).join())
  check('and the database is asked to do the rest in one go: membership, Google row, phone, queued messages, one activity line', removeCalls.length === 1 && removeCalls[0].member === COUNSELOR && JSON.stringify(removed.body.data) === JSON.stringify({ google: true, phone: true, cancelled: 2 }))
  check('the server itself wrote no activity line and no outbox row', (db.tables.get('activity') ?? []).length === 0 && (db.tables.get('outbox') ?? []).length === 0)
  // What removal did to the membership is the database function’s work; here it is a stand-in, so the row is still in the table.

  const withOther = await call({ action: 'leave' }, 'owner-token')
  check('with another owner, an owner can leave', withOther.status === 200 && leaveCalls.length === 1)
}

// ── Student sign-ins: inviting ──────────────────────────────────────────────

const YOUNG = '77777777-7777-4777-8777-777777777777'
const EMILY_USER = '88888888-8888-4888-8888-888888888888'
const LINK_TOKEN = 'L'.repeat(43)
{
  db.table('students').push({ id: YOUNG, firm_id: FIRM, first_name: 'Theo', last_name: 'Park', grad_year: new Date().getFullYear() + 8, archived: false })
  const calls: Record<string, unknown>[] = []
  db.rpc('invite_student', (args) => {
    calls.push(args)
    return { id: 'inv-student', email: args.email, expires_at: '2026-12-04T00:00:00.000Z' }
  })
  const noTick = await call({ action: 'invite_student', studentId: STUDENT, email: 'emily.chen@students.example' }, 'counselor-token')
  const falseTick = await call({ action: 'invite_student', studentId: STUDENT, email: 'emily.chen@students.example', guardianKnows: false }, 'counselor-token')
  check('a student invitation without the parent or guardian tick is refused', noTick.status === 400 && falseTick.status === 400 && calls.length === 0)
  const young = await call({ action: 'invite_student', studentId: YOUNG, email: 'theo@students.example', guardianKnows: true }, 'counselor-token')
  check('a student below 9th grade is refused, and the answer says to use the student link', young.status === 403 && young.body.code === 'too_young' && /student link/.test(young.body.message ?? '') && calls.length === 0, young.text)
  const foreign = await call({ action: 'invite_student', studentId: '00000000-0000-4000-8000-00000000000f', email: 'x@students.example', guardianKnows: true }, 'counselor-token')
  check('a student who is not in the caller’s firm is not found', foreign.status === 403 && calls.length === 0)
  const made = await call({ action: 'invite_student', studentId: STUDENT, email: ' Emily.Chen@students.example', guardianKnows: true }, 'counselor-token')
  const data = made.body.data as { secret: string }
  check('a counselor, not only an owner, invites a student', made.status === 200 && INVITE_SECRET.safeParse(data.secret).success, made.text)
  check('the tick is sent to the database with this screen’s wording version, and only the hash of the secret', calls.length === 1 && calls[0].consent_version === GUARDIAN_CONSENT.version && calls[0].token_hash === sha(data.secret) && calls[0].student === STUDENT && calls[0].email === 'emily.chen@students.example')
  check('the wording a counselor ticks names the student', GUARDIAN_CONSENT.text('Emily') === 'A parent or guardian of Emily knows about this account and agrees to it.' && STUDENT_AGE.text === 'I am 13 or older')
  db.rpc('invite_student', () => {
    throw { code: 'PI007', message: 'Emily already has a sign-in.' }
  })
  const has = await call({ action: 'invite_student', studentId: STUDENT, email: 'emily.chen@students.example', guardianKnows: true }, 'owner-token')
  check('a student who already has a sign-in is refused with a reason the screen can act on', has.status === 409 && has.body.code === 'has_signin')
}

// ── Student sign-ins: joining ───────────────────────────────────────────────
{
  const secret = invitation(20, { kind: 'student', email: 'emily.chen@students.example', student_id: STUDENT })
  const preview = await call({ action: 'preview', secret })
  const shown = preview.body.data as { kind: string; studentFirstName?: string; email: string }
  check('a student invitation’s preview names the student by first name only', preview.status === 200 && shown.kind === 'student' && shown.studentFirstName === 'Emily' && !preview.text.includes('Chen') && shown.email === 'e•••@students.example', preview.text)

  db.users.set('emily-token', EMILY_USER)
  db.people.set(EMILY_USER, { email: 'emily.chen@students.example', confirmed: true })
  const calls: Record<string, unknown>[] = []
  db.rpc('accept_student_invitation', (args) => {
    calls.push(args)
    db.table('student_accounts').push({ user_id: args.person, firm_id: FIRM, student_id: STUDENT, invitation_id: 'inv-20', created_at: new Date().toISOString(), disabled_at: null, disabled_by: null })
    return { kind: 'student', firm_id: FIRM, student_id: STUDENT }
  })
  const noAge = await call({ action: 'accept', secret }, 'emily-token')
  check('a student cannot join without the “13 or older” tick', noAge.status === 400 && noAge.body.code === 'consent_missing' && calls.length === 0, noAge.text)
  const joined = await call({ action: 'accept', secret, ageConfirmed: true, studentId: YOUNG }, 'emily-token')
  check('with it, the student gets their sign-in', joined.status === 200 && (joined.body.data as { kind: string }).kind === 'student')
  check('the database is given the hash, the verified person and this screen’s wording version, and nothing from the body', calls.length === 1 && calls[0].hash === sha(secret) && calls[0].person === EMILY_USER && calls[0].age_version === STUDENT_AGE.version && Object.keys(calls[0]).sort().join() === 'age_version,hash,person')
}

// ── /api/student: one page, two ways in ─────────────────────────────────────
{
  db.table('student_links').push({ id: 'link-1', firm_id: FIRM, student_id: STUDENT, token_hash: sha(LINK_TOKEN), revoked_at: null, expires_at: new Date(Date.now() + 86_400_000).toISOString() })
  const day = new Date().toISOString().slice(0, 10)
  db.table('tasks').push(
    { id: '00000000-0000-4000-8000-0000000000a1', firm_id: FIRM, student_id: STUDENT, title: 'Revise the personal statement', detail: 'Second pass', category: 'essay', owner: 'student', due_date: day, status: 'todo', progress_note: null, completed_on: null, completed_by: null, created_on: day, attachments: [], expects_document: null },
    { id: '00000000-0000-4000-8000-0000000000a2', firm_id: FIRM, student_id: STUDENT, title: 'Pay the deposit', detail: 'PRIVATE-PARENT-DETAIL', category: 'financial', owner: 'parent', due_date: day, status: 'todo', progress_note: 'PRIVATE-PARENT-NOTE', completed_on: null, completed_by: null, created_on: day, attachments: [], expects_document: null },
    { id: '00000000-0000-4000-8000-0000000000a3', firm_id: FIRM, student_id: YOUNG, title: 'ANOTHER-STUDENTS-TASK', category: 'essay', owner: 'student', due_date: day, status: 'todo', created_on: day, attachments: [] },
  )
  db.table('parents').push({ id: 'p1', firm_id: FIRM, student_id: STUDENT, name: 'PRIVATE-PARENT-NAME', email: 'private-parent@example.com', phone: '+15555550123' })
  Object.assign(db.table('students').find((s) => s.id === STUDENT)!, { counselor_notes: 'PRIVATE-COUNSELOR-NOTE', onboarded_on: day, email: 'private-student-email@example.com' })
  db.table('colleges').push({ id: 'c1', firm_id: FIRM, student_id: STUDENT, name: 'Alder University', plan: 'RD', deadline: day, status: 'considering', fit: 'Target', note: 'PRIVATE-COLLEGE-NOTE' })

  const get = (headers: Record<string, string>, address = `10.9.0.${from++ % 250}`) => studentGet(new Request('http://localhost/api/student', { headers: { 'x-forwarded-for': address, ...headers } }))
  const byLink = await get({ [STUDENT_TOKEN_HEADER]: LINK_TOKEN })
  const byAccount = await get({ authorization: 'Bearer emily-token' })
  const linkText = await byLink.text()
  const accountText = await byAccount.text()
  check('a link and a sign-in of the same student get the same page, byte for byte', byLink.status === 200 && byAccount.status === 200 && linkText === accountText, `${byLink.status} ${byAccount.status}`)
  const page = JSON.parse(accountText) as { data: { students: { firstName: string; lastName: string }[]; tasks: { title: string; detail?: string; progressNote?: string }[]; firm: { name: string } } }
  check('the page is that student’s: first name, their tasks, the firm’s name', page.data.students.length === 1 && page.data.students[0].firstName === 'Emily' && page.data.students[0].lastName === '' && page.data.tasks.length === 2 && page.data.firm.name === 'Northgate College Counseling')
  check('no parent’s details, counselor notes, another student, or a college note is in it', ['PRIVATE-PARENT-NAME', 'private-parent@example.com', '+15555550123', 'PRIVATE-COUNSELOR-NOTE', 'private-student-email', 'ANOTHER-STUDENTS-TASK', 'PRIVATE-COLLEGE-NOTE', 'PRIVATE-PARENT-DETAIL', 'PRIVATE-PARENT-NOTE', 'Chen'].every((mark) => !accountText.includes(mark)))
  check('it lists no stored file and no way to download one', !/storage_path|signedUrl|signed_url|download/i.test(accountText))

  const writes: Record<string, unknown>[] = []
  db.rpc('student_link_write', (args) => {
    writes.push(args)
    return null
  })
  const post = (body: unknown, headers: Record<string, string>) => studentPost(new Request('http://localhost/api/student', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.1.${from++ % 250}`, ...headers }, body: JSON.stringify(body) }))
  const done = await post({ action: 'progress', taskId: '00000000-0000-4000-8000-0000000000a1', status: 'done', today: day, studentId: YOUNG, firmId: OTHER_FIRM }, { authorization: 'Bearer emily-token' })
  check('a signed-in student can do what the link can: mark their own task done', done.status === 200 && writes.length === 1 && writes[0].p_firm === FIRM && writes[0].p_student === STUDENT, String(done.status))
  const notMine = await post({ action: 'progress', taskId: '00000000-0000-4000-8000-0000000000a2', status: 'done', today: day }, { authorization: 'Bearer emily-token' })
  const others = await post({ action: 'progress', taskId: '00000000-0000-4000-8000-0000000000a3', status: 'done', today: day }, { authorization: 'Bearer emily-token' })
  check('and nothing more: not a parent’s task, not another student’s', notMine.status === 404 && others.status === 404 && writes.length === 1)
  const unknownAction = await post({ action: 'list_files' }, { authorization: 'Bearer emily-token' })
  check('there is no action that lists or downloads files', unknownAction.status === 400)

  const counselorHere = await get({ authorization: 'Bearer counselor-token' })
  const counselorBody = JSON.parse(await counselorHere.text()) as { code?: string; data?: unknown }
  check('a counselor’s sign-in gets no student page', counselorHere.status === 403 && counselorBody.code === 'not_a_student' && counselorBody.data === undefined)
  const forged = await get({ authorization: 'Bearer nobody' })
  check('a token Supabase does not know gets a 401 an app can act on', forged.status === 401 && (JSON.parse(await forged.text()) as { code?: string }).code === 'unauthorized')
  const badLink = await get({ [STUDENT_TOKEN_HEADER]: 'X'.repeat(43) })
  const badLinkBody = JSON.parse(await badLink.text()) as Record<string, unknown>
  check('the link path is unchanged: an unknown link is the same 404, with no code', badLink.status === 404 && !('code' in badLinkBody) && badLinkBody.message === 'This link does not work. Ask your counselor for a new one.')
  const both = await get({ [STUDENT_TOKEN_HEADER]: 'X'.repeat(43), authorization: 'Bearer emily-token' })
  check('when a link token is sent it is the whole credential, as before', both.status === 404)

  let limited = 0
  for (let i = 0; i < 70; i++) if ((await get({ authorization: 'Bearer emily-token' })).status === 429) limited++
  check('a sign-in’s requests are limited by user id, whatever address they come from', limited > 0 && limited < 70, String(limited))
}

// ── Turning a sign-in off ───────────────────────────────────────────────────
{
  // A second student with a sign-in, so the rate limit above does not hide these answers.
  const MAYA = '00000000-0000-4000-8000-0000000000b1'
  const MAYA_USER = '00000000-0000-4000-8000-0000000000b2'
  db.table('students').push({ id: MAYA, firm_id: FIRM, first_name: 'Maya', last_name: 'Ruiz', grad_year: new Date().getFullYear() + 2, archived: false, onboarded_on: '2026-09-01' })
  db.table('student_accounts').push({ user_id: MAYA_USER, firm_id: FIRM, student_id: MAYA, invitation_id: null, created_at: new Date().toISOString(), disabled_at: null, disabled_by: null })
  db.users.set('maya-token', MAYA_USER)
  db.people.set(MAYA_USER, { email: 'maya.ruiz@students.example', confirmed: true })
  const get = () => studentGet(new Request('http://localhost/api/student', { headers: { 'x-forwarded-for': `10.9.2.${from++ % 250}`, authorization: 'Bearer maya-token' } }))
  const account = () => db.table('student_accounts').find((a) => a.user_id === MAYA_USER)!
  check('a sign-in that is on opens the page', (await get()).status === 200)

  const calls: Record<string, unknown>[] = []
  db.rpc('set_student_account_disabled', (args) => {
    calls.push(args)
    account().disabled_at = args.disabled ? new Date().toISOString() : null
    return null
  })
  const off = await call({ action: 'set_student_signin', studentId: MAYA, on: false }, 'counselor-token')
  check('any member turns it off', off.status === 200 && calls.length === 1 && calls[0].student === MAYA && calls[0].disabled === true && (off.body.data as { state: string }).state === 'off', off.text)
  const refusedNow = await get()
  const body = JSON.parse(await refusedNow.text()) as { code?: string; data?: unknown; message?: string }
  check('the very next request is refused, with a reason an app can show', refusedNow.status === 403 && body.code === 'signin_off' && body.data === undefined, JSON.stringify(body))
  const on = await call({ action: 'set_student_signin', studentId: MAYA, on: true }, 'owner-token')
  check('and on again', on.status === 200 && (on.body.data as { state: string }).state === 'on' && (await get()).status === 200)
  db.table('students').find((s) => s.id === MAYA)!.archived = true
  const archived = await get()
  check('a sign-in whose student is archived is refused the same way', archived.status === 403 && (JSON.parse(await archived.text()) as { code?: string }).code === 'signin_off')
  db.table('students').find((s) => s.id === MAYA)!.archived = false

  const states = await call({ action: 'firm' }, 'owner-token')
  const list = (states.body.data as { students: { name: string; state: string; tooYoung: boolean; email?: string; expired?: boolean }[] }).students
  const by = (name: string) => list.find((s) => s.name === name)
  check('the owner sees every active student and the state of their sign-in', by('Emily Chen')?.state === 'on' && by('Emily Chen')?.email === 'emily.chen@students.example' && by('Maya Ruiz')?.state === 'on' && by('Theo Park')?.state === 'none' && by('Theo Park')?.tooYoung === true && by('Emily Chen')?.tooYoung === false, JSON.stringify(list))
  db.table('invitations').push({ id: 'inv-theo', firm_id: FIRM, kind: 'student', email: 'theo@students.example', student_id: YOUNG, token_hash: sha('theo'), accepted_at: null, revoked_at: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86_400_000).toISOString() })
  const one = await call({ action: 'student_signin', studentId: YOUNG }, 'counselor-token')
  const invited = one.body.data as { state: string; email?: string; invitationId?: string; expired?: boolean }
  check('a counselor sees one student’s sign-in: invited, to which address, until when', one.status === 200 && invited.state === 'invited' && invited.email === 'theo@students.example' && invited.invitationId === 'inv-theo' && invited.expired === false)
  check('no answer about sign-ins holds a hash', !states.text.includes('token_hash') && !one.text.includes('token_hash') && !/[0-9a-f]{64}/.test(states.text + one.text))
}

// ── Every counselor route refuses a student ─────────────────────────────────
{
  const asStudent = (url: string, body?: unknown) =>
    new Request(`http://localhost${url}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer maya-token', 'content-type': 'application/json', 'x-forwarded-for': `10.9.3.${from++ % 250}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  process.env.ANTHROPIC_API_KEY = 'not-a-real-key'
  const routes: [string, () => Response | Promise<Response>][] = [
    ['POST /api/ai', () => aiPost(asStudent('/api/ai', { feature: 'readNotes', input: {} }))],
    ['POST /api/agent', () => agentPost(asStudent('/api/agent', { message: 'What is overdue?' }))],
    ['GET /api/agent', () => agentGet(asStudent('/api/agent?studentId=' + STUDENT))],
    ['POST /api/translate', () => translatePost(asStudent('/api/translate', { proposalId: STUDENT }))],
    ['POST /api/dispatch', () => dispatchPost(asStudent('/api/dispatch', {}))],
    ['POST /api/documents', () => documentsPost(asStudent('/api/documents', { action: 'open', documentId: STUDENT }))],
    ['POST /api/colleges', () => collegesPost(asStudent('/api/colleges', { action: 'search', query: 'alder' }))],
    ['POST /api/google', () => googlePost(asStudent('/api/google', { action: 'status' }))],
    ['POST /api/phone (status)', () => phonePost(asStudent('/api/phone', { action: 'status' }))],
    ['POST /api/phone (claim)', () => phonePost(asStudent('/api/phone', { action: 'claim' }))],
    ...(['firm', 'leave'] as const).map((action): [string, () => Promise<Response>] => [`POST /api/account (${action})`, () => account(asStudent('/api/account', { action }))]),
    ['POST /api/account (invite_student)', () => account(asStudent('/api/account', { action: 'invite_student', studentId: STUDENT, email: 'x@students.example', guardianKnows: true }))],
    ['POST /api/account (invite_counselor)', () => account(asStudent('/api/account', { action: 'invite_counselor', email: 'x@northgate.example' }))],
    ['POST /api/account (set_student_signin)', () => account(asStudent('/api/account', { action: 'set_student_signin', studentId: STUDENT, on: true }))],
    ['POST /api/account (remove_member)', () => account(asStudent('/api/account', { action: 'remove_member', userId: COUNSELOR }))],
  ]
  delete process.env.ANTHROPIC_API_KEY
  const let_in: string[] = []
  for (const [name, run] of routes) {
    const response = await run()
    const text = await response.text()
    if (![401, 403].includes(response.status) || /"data"/.test(text)) let_in.push(`${name}: ${response.status}`)
  }
  check(`every counselor route refuses a student sign-in (${routes.length} requests across 9 routes)`, let_in.length === 0, let_in.join('; '))
  const control = await account(new Request('http://localhost/api/account', { method: 'POST', headers: { authorization: 'Bearer owner-token', 'content-type': 'application/json', 'x-forwarded-for': '10.9.4.1' }, body: JSON.stringify({ action: 'firm' }) }))
  check('the same request from an owner is served, so the refusals above are about who is asking', control.status === 200)
}

// ── A student deletes their own sign-in ─────────────────────────────────────
{
  const MAYA = '00000000-0000-4000-8000-0000000000b1'
  const MAYA_USER = '00000000-0000-4000-8000-0000000000b2'
  const byMember = await call({ action: 'delete_my_signin' }, 'counselor-token')
  check('a member of a firm cannot delete their sign-in this way, and nothing is deleted', byMember.status === 403 && db.people.has(COUNSELOR) && db.table('firm_members').some((m) => m.user_id === COUNSELOR))
  const nobody = await call({ action: 'delete_my_signin' })
  check('nor does someone who is not signed in', nobody.status === 401)
  const mine = await call({ action: 'delete_my_signin', userId: EMILY_USER, studentId: STUDENT }, 'maya-token')
  check('a student deletes their own sign-in: the auth user and the account row go', mine.status === 200 && !db.people.has(MAYA_USER) && !db.table('student_accounts').some((a) => a.user_id === MAYA_USER), mine.text)
  check('whose sign-in is deleted comes from the verified sign-in, not the body', db.people.has(EMILY_USER) && db.table('student_accounts').some((a) => a.user_id === EMILY_USER))
  check('the firm’s record of the student stays', db.table('students').some((s) => s.id === MAYA) && db.table('activity').some((a) => a.student_id === MAYA && a.text === 'Maya deleted their sign-in.'))
  const leftover = await call({ action: 'delete_my_signin' }, 'newcomer-token')
  check('someone who belongs to nothing can delete the sign-in that is left over', leftover.status === 200 && !db.people.has(NEWCOMER))
  const after = await studentGet(new Request('http://localhost/api/student', { headers: { 'x-forwarded-for': '10.9.5.1', authorization: 'Bearer maya-token' } }))
  check('their old token opens nothing afterwards', after.status === 401)
}

// ── Nothing here sends anything ─────────────────────────────────────────────
{
  const source = readFileSync(new URL('../server/account.ts', import.meta.url), 'utf8') + readFileSync(new URL('../api/account.ts', import.meta.url), 'utf8')
  check('the account code imports no transport and no dispatcher', !/from '\.\.?\/(server\/)?(transport|dispatch)/.test(source) && !source.includes('queue_message'))
  check('no outbox row was made by any request in this run', (db.tables.get('outbox') ?? []).length === 0)
  const secrets = [1, 2, 3, 4, 5, 20, 999].map(secretOf)
  check('nothing printed holds a secret or a hash', printed.every((line) => !secrets.some((s) => line.includes(s) || line.includes(sha(s)))))
  const bad = await call('{not json')
  check('a body that is not JSON is refused', bad.status === 400)
  const big = await call(JSON.stringify({ action: 'preview', secret: 'x'.repeat(5000) }))
  check('an oversized body is refused before it is read', big.status === 413)
}

console.log(failed === 0 ? `\nAll ${count} account checks passed.` : `\n${failed} of ${count} account checks FAILED.`)
process.exit(failed === 0 ? 0 : 1)
