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
import { ACCOUNT_REQUEST, INVITE_SECRET, joinLink, maskEmail, removalWords } from '../shared/account.js'
import { POST as account } from '../api/account.js'
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
    throw { code: '23514', message: 'You are the only owner. Make someone else an owner first.' }
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

  const withOther = await call({ action: 'leave' }, 'owner-token')
  check('with another owner, an owner can leave', withOther.status === 200 && leaveCalls.length === 1)
}

// ── Nothing here sends anything ─────────────────────────────────────────────
{
  const source = readFileSync(new URL('../server/account.ts', import.meta.url), 'utf8') + readFileSync(new URL('../api/account.ts', import.meta.url), 'utf8')
  check('the account code imports no transport and no dispatcher', !/from '\.\.?\/(server\/)?(transport|dispatch)/.test(source) && !source.includes('queue_message'))
  check('no outbox row was made by any request in this run', (db.tables.get('outbox') ?? []).length === 0)
  const secrets = [1, 2, 3, 4, 5, 999].map(secretOf)
  check('nothing printed holds a secret or a hash', printed.every((line) => !secrets.some((s) => line.includes(s) || line.includes(sha(s)))))
  const bad = await call('{not json')
  check('a body that is not JSON is refused', bad.status === 400)
  const big = await call(JSON.stringify({ action: 'preview', secret: 'x'.repeat(5000) }))
  check('an oversized body is refused before it is read', big.status === 413)
}

console.log(failed === 0 ? `\nAll ${count} account checks passed.` : `\n${failed} of ${count} account checks FAILED.`)
process.exit(failed === 0 ? 0 : 1)
