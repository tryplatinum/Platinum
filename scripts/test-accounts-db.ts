// What the database itself enforces about roles, invitations and student
// sign-ins. Offline: the whole migration chain runs in PGlite (Postgres in
// WebAssembly) with stand-ins for Supabase's auth and storage schemas, and each
// check is a statement run as a signed-in person, or as the service role.
//
//   npm run test:accounts:db      (also run by npm run test:notes)
//
// PGlite is a devDependency. Without it this script fails: it never reports
// "skipped" as a pass. See scripts/pgliteChain.ts.
//
// One connection, so "two requests at once" cannot be raced here. What is
// checked is that the second of two accepts is refused, and that the function
// takes the row lock that makes the same true of two at once. The race itself
// is in scripts/test-isolation.ts, against a real database.

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { gradeFor, maySignIn } from '../shared/account'
import { asService, asUser, chain, refusal, type Db } from './pgliteChain'

let failed = 0
let count = 0
function check(name: string, pass: boolean, detail = ''): void {
  count++
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const made = await chain()
const { db, applied } = made
check(`the whole migration chain runs clean (${applied.length} files, through ${applied.at(-1)})`, applied.length > 0)

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex')
const secret = () => randomBytes(32).toString('base64url')
const one = async <T>(tx: Db, sql: string, params: unknown[] = []) => (await tx.query<T>(sql, params)).rows[0]

/** A sign-in. Confirmed unless said otherwise. */
async function person(email: string, confirmed = true): Promise<string> {
  const id = randomUUID()
  await db.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)', [id, email, confirmed ? new Date().toISOString() : null])
  return id
}

const rpc = (userId: string, sql: string, params: unknown[] = []) => asUser(db, userId, (tx) => tx.query(sql, params))
const refused = (userId: string, sql: string, params: unknown[] = []) => refusal(() => rpc(userId, sql, params))
const service = (sql: string, params: unknown[] = []) => asService(db, (tx) => tx.query(sql, params))
const serviceRefused = (sql: string, params: unknown[] = []) => refusal(() => service(sql, params))

// ── Two firms ───────────────────────────────────────────────────────────────

const owner = await person('avery@northgate.example')
const counselor = await person('dana@northgate.example')
const otherOwner = await person('rowan@elsewhere.example')
const firm = (await asUser(db, owner, (tx) => one<{ id: string }>(tx, `select public.create_firm('Northgate College Counseling', 'Avery Stone') as id`))).id
const otherFirm = (await asUser(db, otherOwner, (tx) => one<{ id: string }>(tx, `select public.create_firm('Elsewhere Advising', 'Rowan Hale') as id`))).id

const student = randomUUID()
const youngStudent = randomUUID()
const otherStudent = randomUUID()
await service(`insert into public.students (id, firm_id, first_name, last_name, grad_year) values ($1, $2, 'Emily', 'Chen', 2027), ($3, $2, 'Theo', 'Park', 2033), ($4, $5, 'Nia', 'Okafor', 2027)`, [student, firm, youngStudent, otherStudent, otherFirm])

// ── Nobody writes firm_members directly ─────────────────────────────────────
{
  const stranger = await person('stranger@nowhere.example')
  const insert = await refused(owner, `insert into public.firm_members (firm_id, user_id, role, display_name) values ($1, $2, 'counselor', 'Planted')`, [firm, stranger])
  check('an owner cannot insert a firm_members row for any user id', insert?.code === '42501', insert?.message)
  const update = await refused(owner, `update public.firm_members set role = 'counselor' where firm_id = $1`, [firm])
  check('an owner cannot update a firm_members row directly', update?.code === '42501', update?.message)
  const remove = await refused(owner, `delete from public.firm_members where firm_id = $1`, [firm])
  check('an owner cannot delete a firm_members row directly', remove?.code === '42501', remove?.message)
  const read = await rpc(owner, `select user_id from public.firm_members where firm_id = $1`, [firm])
  check('a member can still read their firm’s members', read.rows.length === 1)
}

// ── Who can invite ──────────────────────────────────────────────────────────

const firstSecret = secret()
{
  const invited = await rpc(owner, `select public.invite_counselor('Dana@Northgate.example ', $1) as made`, [hash(firstSecret)])
  const row = (invited.rows[0] as { made: { email: string; expires_at: string } }).made
  check('an owner invites a counselor, and the address is kept in lower case', row.email === 'dana@northgate.example', row.email)
  const days = (Date.parse(row.expires_at) - Date.now()) / 86_400_000
  check('an invitation expires in 7 days', days > 6.99 && days < 7.01, String(days))

  const again = await refused(owner, `select public.invite_counselor('dana@northgate.example', $1)`, [hash(secret())])
  check('a second invitation for an address that has one waiting is refused', again?.code === 'PI005', again?.message)

  const hidden = await refused(owner, `select token_hash from public.invitations`)
  check('a member cannot read the hash column', hidden?.code === '42501', hidden?.message)
  const visible = await rpc(owner, `select id, kind, email, expires_at from public.invitations where firm_id = $1`, [firm])
  check('a member reads their firm’s invitations', visible.rows.length === 1)
  const foreign = await rpc(otherOwner, `select id from public.invitations`)
  check('a member of another firm reads none of them', foreign.rows.length === 0)
  for (const [what, sql] of [
    ['insert', `insert into public.invitations (firm_id, kind, email, token_hash) values ('${firm}', 'counselor', 'x@y.example', '${hash(secret())}')`],
    ['update', `update public.invitations set revoked_at = null`],
    ['delete', `delete from public.invitations`],
  ] as const) {
    const direct = await refused(owner, sql)
    check(`nobody can ${what} an invitation directly`, direct?.code === '42501', direct?.message)
  }
}

// ── Accepting ───────────────────────────────────────────────────────────────

const accept = (secretValue: string, who: string, name = 'Dana Whitlock') => serviceRefused(`select public.accept_counselor_invitation($1, $2, $3)`, [hash(secretValue), who, name])
{
  const direct = await refused(counselor, `select public.accept_counselor_invitation($1, $2, 'Dana')`, [hash(firstSecret), counselor])
  check('a signed-in person cannot call the accept function themselves', direct?.code === '42501', direct?.message)

  const wrong = await person('someone.else@northgate.example')
  const mismatch = await accept(firstSecret, wrong)
  check('a person with another address is refused', mismatch?.code === 'PI003', mismatch?.message)

  await db.query(`update auth.users set email_confirmed_at = null where id = $1`, [counselor])
  const unconfirmed = await accept(firstSecret, counselor)
  check('an unconfirmed address is refused', unconfirmed?.code === 'PI002', unconfirmed?.message)
  await db.query(`update auth.users set email_confirmed_at = now(), email = 'DANA@northgate.example' where id = $1`, [counselor])

  const unknown = await accept(secret(), counselor)
  await service(`update public.invitations set expires_at = now() - interval '1 minute' where token_hash = $1`, [hash(firstSecret)])
  const expired = await accept(firstSecret, counselor)
  await service(`update public.invitations set expires_at = now() + interval '7 days', revoked_at = now() where token_hash = $1`, [hash(firstSecret)])
  const revoked = await accept(firstSecret, counselor)
  await service(`update public.invitations set revoked_at = null where token_hash = $1`, [hash(firstSecret)])

  const sameAddress = secret()
  await rpc(owner, `select public.invite_counselor('rowan@elsewhere.example', $1)`, [hash(sameAddress)])
  const already = await accept(sameAddress, otherOwner, 'Rowan Hale')
  check('a person who already belongs to a firm cannot join another', already?.code === 'PI004', already?.message)
  await rpc(owner, `select public.revoke_invitation(id) from public.invitations where email = 'rowan@elsewhere.example' and revoked_at is null`)

  const good = await accept(firstSecret, counselor)
  check('the invited person, confirmed, with the address in any case, is accepted', good === undefined, good?.message)
  const joined = await service(`select role, display_name from public.firm_members where firm_id = $1 and user_id = $2`, [firm, counselor])
  check('accepting makes a counselor, never an owner', (joined.rows[0] as { role: string } | undefined)?.role === 'counselor')
  const used = await accept(firstSecret, counselor)
  check('the second of two accepts is refused: an invitation is used once', used?.code === 'PI001', used?.message)
  const same = [unknown, expired, revoked, used]
  check('unknown, expired, revoked and used give one answer', same.every((r) => r?.code === 'PI001' && r.message === same[0]?.message), same.map((r) => r?.code).join())
  const source = await one<{ def: string }>(db, `select pg_get_functiondef('public.claim_invitation_(text, uuid, text)'::regprocedure) as def`)
  check('the invitation row is locked while it is checked, so two requests at once cannot both win', /for update/i.test(source.def) && /pg_advisory_xact_lock/.test(source.def))
  const line = await service(`select actor, student_id, text from public.activity where firm_id = $1 and text like '%joined the firm%'`, [firm])
  check('joining writes one activity line about the firm', line.rows.length === 1 && (line.rows[0] as { student_id: unknown }).student_id === null)

  const invite = await refused(counselor, `select public.invite_counselor('new@northgate.example', $1)`, [hash(secret())])
  check('a counselor cannot invite a counselor', invite?.code === '42501', invite?.message)
  const memberAlready = await refused(owner, `select public.invite_counselor('dana@northgate.example', $1)`, [hash(secret())])
  check('an address that already belongs to a member is not invited again', memberAlready?.code === 'PI004', memberAlready?.message)
}

// ── New link, revoke ────────────────────────────────────────────────────────
{
  const first = secret()
  const made = await rpc(owner, `select (public.invite_counselor('lee@northgate.example', $1) ->> 'id')::uuid as id`, [hash(first)])
  const id = (made.rows[0] as { id: string }).id
  const second = secret()
  const replaced = await refused(owner, `select public.invite_counselor('lee@northgate.example', $1, $2)`, [hash(second), id])
  check('“New link” revokes the old invitation and makes a new one', replaced === undefined, replaced?.message)
  const lee = await person('lee@northgate.example')
  check('the old link stops working', (await accept(first, lee, 'Lee Moreno'))?.code === 'PI001')
  const current = await service(`select id from public.invitations where token_hash = $1`, [hash(second)])
  const byCounselor = await refused(counselor, `select public.revoke_invitation($1)`, [(current.rows[0] as { id: string }).id])
  check('a counselor cannot revoke a counselor’s invitation', byCounselor?.code === '42501', byCounselor?.message)
  const foreign = await refused(otherOwner, `select public.revoke_invitation($1)`, [id])
  check('an owner of another firm cannot revoke it', foreign?.code === '42501', foreign?.message)
  await service(`update public.invitations set expires_at = now() - interval '1 day' where token_hash = $1`, [hash(second)])
  const afterExpiry = await refused(owner, `select public.invite_counselor('lee@northgate.example', $1)`, [hash(secret())])
  check('an invitation that ran out no longer blocks a new one', afterExpiry === undefined, afterExpiry?.message)
}

// ── Roles: a firm keeps an owner ────────────────────────────────────────────
{
  const byCounselor = await refused(counselor, `select public.set_member_role($1, 'owner')`, [counselor])
  check('a counselor cannot change a role', byCounselor?.code === '42501', byCounselor?.message)
  const lastDown = await refused(owner, `select public.set_member_role($1, 'counselor')`, [owner])
  check('the only owner cannot step down', lastDown?.code === 'PI010', lastDown?.message)
  const lastLeave = await refused(owner, `select public.leave_firm()`)
  check('the only owner cannot leave', lastLeave?.code === 'PI010', lastLeave?.message)
  const foreign = await refused(otherOwner, `select public.set_member_role($1, 'owner')`, [counselor])
  check('an owner of another firm cannot change this firm’s roles', foreign?.code === '42501', foreign?.message)

  const promote = await refused(owner, `select public.set_member_role($1, 'owner')`, [counselor])
  check('an owner makes a counselor an owner', promote === undefined, promote?.message)
  const demoteOther = await refused(owner, `select public.set_member_role($1, 'counselor')`, [counselor])
  check('an owner cannot change another owner’s role', demoteOther?.code === '42501', demoteOther?.message)
  const removeOwner = await refused(owner, `select public.remove_member($1)`, [counselor])
  check('an owner cannot be removed', removeOwner?.code === '42501', removeOwner?.message)
  const down = await refused(counselor, `select public.set_member_role($1, 'counselor')`, [counselor])
  check('with another owner, an owner can step down', down === undefined, down?.message)

  // Around the functions, as the service role: the constraint still holds.
  const planted = await serviceRefused(`update public.firm_members set role = 'counselor' where firm_id = $1`, [firm])
  check('no other path leaves a firm with members and no owner', planted?.code === 'PI010', planted?.message)
  const gone = await serviceRefused(`delete from public.firm_members where firm_id = $1 and role = 'owner'`, [firm])
  check('nor does deleting its only owner', gone?.code === 'PI010', gone?.message)
}

// ── Renaming yourself, and apply_changes ────────────────────────────────────
{
  const renamed = await refused(counselor, `select public.apply_changes($1, $2::jsonb)`, [firm, JSON.stringify({ firm: { displayName: ' Dana W. Whitlock ' } })])
  check('a member renames themselves through apply_changes', renamed === undefined, renamed?.message)
  const name = await service(`select display_name from public.firm_members where user_id = $1`, [counselor])
  check('the new name is saved, trimmed', (name.rows[0] as { display_name: string }).display_name === 'Dana W. Whitlock')
  const others = await service(`select display_name from public.firm_members where user_id = $1`, [owner])
  check('renaming yourself renames nobody else', (others.rows[0] as { display_name: string }).display_name === 'Avery Stone')
  const spare = randomUUID()
  await service(`insert into public.students (id, firm_id, first_name, last_name, grad_year) values ($1, $2, 'Spare', 'Student', 2027)`, [spare, firm])
  const del = await refused(counselor, `select public.apply_changes($1, $2::jsonb)`, [firm, JSON.stringify({ delete: { students: [spare] } })])
  check('a counselor cannot delete a student through apply_changes', del?.code === '42501', del?.message)
  const clear = await refused(counselor, `select public.apply_changes($1, $2::jsonb)`, [firm, JSON.stringify({ clear: true })])
  check('a counselor cannot clear the caseload', clear?.code === '42501', clear?.message)
  const edit = await refused(counselor, `select public.apply_changes($1, $2::jsonb)`, [firm, JSON.stringify({ upsert: { students: [{ id: spare, first_name: 'Spare', last_name: 'Renamed', grad_year: 2027 }] } })])
  check('a counselor can still edit a student', edit === undefined, edit?.message)
  const byOwner = await refused(owner, `select public.apply_changes($1, $2::jsonb)`, [firm, JSON.stringify({ delete: { students: [spare] } })])
  const left = await service(`select 1 from public.students where id = $1`, [spare])
  check('an owner deletes a student as before', byOwner === undefined && left.rows.length === 0, byOwner?.message)
}

// ── Removing a member does four things and writes one line ──────────────────
{
  const device = randomUUID()
  const queued = randomUUID()
  const waiting = randomUUID()
  const sent = randomUUID()
  const ownersOwn = randomUUID()
  await service(`insert into public.google_connections (user_id, firm_id, google_address, refresh_token_encrypted) values ($1, $2, 'dana@gmail.example', 'sealed')`, [counselor, firm])
  await service(`insert into public.phone_devices (id, firm_id, counselor_id, label, key_hash, wake_email, key_expires_at) values ($1, $2, $3, 'Dana’s iPhone', $4, 'dana@gmail.example', now() + interval '90 days')`, [device, firm, counselor, hash('device')])
  const message = (id: string, status: string, by: string) =>
    service(
      `insert into public.outbox (id, firm_id, student_id, to_kind, to_name, channel, language, kind, body, trigger, status, send_after, approved_by, approved_at)
       values ($1, $2, $3, 'student', 'Emily Chen', 'text', 'en', 'reminder_upcoming', 'Hello', 'approved', $4, now() + interval '1 hour', $5, now())`,
      [id, firm, student, status, by],
    )
  await message(queued, 'queued', counselor)
  await message(waiting, 'sending', counselor)
  await message(sent, 'sent', counselor)
  await message(ownersOwn, 'queued', owner)
  await service(`insert into public.phone_send_jobs (outbox_id, device_id, to_phone, body) values ($1, $2, '+15555550100', 'Hello')`, [waiting, device])
  await service(`insert into public.activity (firm_id, student_id, actor, actor_user, text) values ($1, $2, 'counselor', $3, 'Approved a reminder upcoming to Emily Chen.')`, [firm, student, counselor])

  const told = await rpc(owner, `select public.member_removal_summary($1) as s`, [counselor])
  const summary = (told.rows[0] as { s: { google: boolean; phone: boolean; queued: number } }).s
  check('the confirmation is told what removal will do', summary.google && summary.phone && summary.queued === 2, JSON.stringify(summary))
  const peek = await refused(counselor, `select public.member_removal_summary($1)`, [owner])
  check('a counselor cannot ask what removing someone would do', peek?.code === '42501', peek?.message)
  const byCounselor = await refused(counselor, `select public.remove_member($1)`, [owner])
  check('a counselor cannot remove a member', byCounselor?.code === '42501', byCounselor?.message)
  const self = await refused(owner, `select public.remove_member($1)`, [owner])
  check('removing yourself is refused: that is leaving', self?.code === '22023', self?.message)
  const foreign = await refused(otherOwner, `select public.remove_member($1)`, [counselor])
  check('an owner of another firm cannot remove this firm’s member', foreign?.code === '42501', foreign?.message)

  const removed = await rpc(owner, `select public.remove_member($1) as done`, [counselor])
  const done = (removed.rows[0] as { done: { google: boolean; phone: boolean; cancelled: number } }).done
  check('removal reports what it did', done.google && done.phone && done.cancelled === 2, JSON.stringify(done))
  const member = await service(`select 1 from public.firm_members where user_id = $1`, [counselor])
  check('1. the membership is gone', member.rows.length === 0)
  const google = await service(`select 1 from public.google_connections where user_id = $1`, [counselor])
  check('2. their Google connection is gone', google.rows.length === 0)
  const phone = await service(`select revoked_at from public.phone_devices where id = $1`, [device])
  check('3. their phone is revoked', (phone.rows[0] as { revoked_at: string | null }).revoked_at !== null)
  const rows = await service(`select id, status from public.outbox where id = any($1::uuid[])`, [[queued, waiting, sent, ownersOwn]])
  const status = Object.fromEntries((rows.rows as { id: string; status: string }[]).map((r) => [r.id, r.status]))
  check('4. their queued message, and the one waiting for their phone, are cancelled', status[queued] === 'cancelled' && status[waiting] === 'cancelled', JSON.stringify(status))
  check('a message they already sent, and another member’s queued message, are left alone', status[sent] === 'sent' && status[ownersOwn] === 'queued')
  const job = await service(`select status, body from public.phone_send_jobs where outbox_id = $1`, [waiting])
  check('the text waiting for their phone can no longer be claimed, and its words are cleared', (job.rows[0] as { status: string; body: string | null }).status === 'cancelled' && (job.rows[0] as { body: string | null }).body === null)
  const lines = await service(`select text, actor from public.activity where firm_id = $1 and text like '%removed%from the firm%'`, [firm])
  const text = (lines.rows[0] as { text: string } | undefined)?.text ?? ''
  check('one activity line says who removed whom and what happened', lines.rows.length === 1 && text === 'Avery Stone removed Dana W. Whitlock from the firm: Google disconnected, phone revoked, 2 queued messages cancelled.', text)
  const signIn = await one<{ n: number }>(db, `select count(*)::int as n from auth.users where id = $1`, [counselor])
  check('their sign-in itself is not deleted', signIn.n === 1)
  const kept = await service(`select approved_by from public.outbox where id = $1`, [sent])
  const logged = await service(`select actor_user from public.activity where firm_id = $1 and text = 'Approved a reminder upcoming to Emily Chen.'`, [firm])
  check('what they approved and logged before still carries them', (kept.rows[0] as { approved_by: string }).approved_by === counselor && (logged.rows[0] as { actor_user: string }).actor_user === counselor)
  const nothing = await rpc(counselor, `select id from public.students`)
  check('a removed member reads nothing of the firm', nothing.rows.length === 0)
  const back = await refused(counselor, `select public.apply_changes($1, '{}'::jsonb)`, [firm])
  check('and can change nothing', back?.code === '42501', back?.message)
}

// ── Student sign-ins ────────────────────────────────────────────────────────

const kai = await person('kai@northgate.example')
{
  const s = secret()
  await rpc(owner, `select public.invite_counselor('kai@northgate.example', $1)`, [hash(s)])
  await service(`select public.accept_counselor_invitation($1, $2, 'Kai Brandt')`, [hash(s), kai])
}
const emily = await person('emily.chen@students.example')
const emilySecret = secret()
{
  // The grade rule, here and in shared/account.ts, on both sides of July 1.
  let agree = true
  for (const day of ['2026-06-30', '2026-07-01', '2026-11-27', '2027-01-15', '2027-06-30', '2027-07-01']) {
    for (let year = 2025; year <= 2034; year++) {
      const sql = await one<{ g: number }>(db, `select public.student_grade($1, $2::date) as g`, [year, day])
      if (sql.g !== gradeFor(year, day)) agree = false
    }
  }
  check('the database and shared/account.ts give the same grade for every year, on both sides of July 1', agree)
  check('the class that graduates when the school year ends is 12th grade', gradeFor(2027, '2026-11-27') === 12 && gradeFor(2027, '2027-06-30') === 12 && gradeFor(2027, '2027-07-01') === 13 && gradeFor(2030, '2026-11-27') === 9 && gradeFor(2031, '2026-11-27') === 8)
  check('below 9th grade may not have a sign-in; 9th grade may', !maySignIn(2031, '2026-11-27') && maySignIn(2030, '2026-11-27') && maySignIn(2031, '2027-07-01'))

  const young = await refused(kai, `select public.invite_student($1, 'theo@students.example', $2, 'guardian-test-1')`, [youngStudent, hash(secret())])
  check('a student below 9th grade cannot be invited', young?.code === 'PI006' && /student link/.test(young.message), young?.message)
  const noTick = await refused(kai, `select public.invite_student($1, 'emily.chen@students.example', $2)`, [student, hash(secret())])
  check('a first student invitation needs the parent or guardian tick', noTick?.code === 'PI008', noTick?.message)
  const foreign = await refused(otherOwner, `select public.invite_student($1, 'emily.chen@students.example', $2, 'guardian-test-1')`, [student, hash(secret())])
  check('a member of another firm cannot invite this firm’s student', foreign?.code === '42501', foreign?.message)

  const firstTry = secret()
  const made = await refused(kai, `select public.invite_student($1, ' Emily.Chen@students.example', $2, 'guardian-test-1')`, [student, hash(firstTry)])
  check('any member, not only an owner, invites a student', made === undefined, made?.message)
  const tick = await service(`select kind, wording_version, by_user, at from public.student_account_consents where firm_id = $1 and student_id = $2`, [firm, student])
  const row = tick.rows[0] as { kind: string; wording_version: string; by_user: string; at: string } | undefined
  check('the tick is recorded: who, when, and which wording', tick.rows.length === 1 && row?.kind === 'guardian_knows' && row.wording_version === 'guardian-test-1' && row.by_user === kai && Boolean(row.at))
  const sameStudent = await refused(owner, `select public.invite_student($1, 'another@students.example', $2, 'guardian-test-1')`, [student, hash(secret())])
  check('a student with an invitation waiting is not invited again', sameStudent?.code === 'PI005', sameStudent?.message)
  const spare = randomUUID()
  await service(`insert into public.students (id, firm_id, first_name, last_name, grad_year) values ($1, $2, 'Maya', 'Ruiz', 2028)`, [spare, firm])
  const sameAddress = await refused(owner, `select public.invite_student($1, 'emily.chen@students.example', $2, 'guardian-test-1')`, [spare, hash(secret())])
  check('nor is an address that has one waiting', sameAddress?.code === 'PI005', sameAddress?.message)

  const waiting = await service(`select id from public.invitations where token_hash = $1`, [hash(firstTry)])
  const fresh = await refused(owner, `select public.invite_student($1, 'emily.chen@students.example', $2, null, $3)`, [student, hash(emilySecret), (waiting.rows[0] as { id: string }).id])
  check('“New link” for a student does not ask for the tick again', fresh === undefined, fresh?.message)
  const ticks = await service(`select 1 from public.student_account_consents where firm_id = $1 and student_id = $2`, [firm, student])
  check('and records no second tick', ticks.rows.length === 1)
}

const acceptStudent = (secretValue: string, who: string, age: string | null = 'age-test-1') => serviceRefused(`select public.accept_student_invitation($1, $2, $3)`, [hash(secretValue), who, age])
{
  const direct = await refused(emily, `select public.accept_student_invitation($1, $2, 'age-test-1')`, [hash(emilySecret), emily])
  check('a signed-in person cannot call the student accept function themselves', direct?.code === '42501', direct?.message)
  const noAge = await acceptStudent(emilySecret, emily, null)
  check('a student invitation is not accepted without the “13 or older” tick', noAge?.code === 'PI008', noAge?.message)
  const asCounselor = await serviceRefused(`select public.accept_counselor_invitation($1, $2, 'Emily')`, [hash(emilySecret), emily])
  check('a student invitation cannot be accepted as a counselor', asCounselor?.code === 'PI001', asCounselor?.message)

  const good = await acceptStudent(emilySecret, emily)
  check('the invited student is accepted', good === undefined, good?.message)
  const account = await service(`select firm_id, student_id, disabled_at from public.student_accounts where user_id = $1`, [emily])
  check('accepting makes the student account row', account.rows.length === 1 && (account.rows[0] as { student_id: string }).student_id === student)
  const member = await service(`select 1 from public.firm_members where user_id = $1`, [emily])
  check('a student is never a firm_members row', member.rows.length === 0)
  const age = await service(`select wording_version, by_user from public.student_account_consents where firm_id = $1 and student_id = $2 and kind = 'student_age'`, [firm, student])
  check('the student’s own tick is recorded with its wording', age.rows.length === 1 && (age.rows[0] as { wording_version: string; by_user: string }).wording_version === 'age-test-1' && (age.rows[0] as { by_user: string }).by_user === emily)
  const again = await acceptStudent(emilySecret, emily)
  check('a student invitation is used once', again?.code === 'PI001', again?.message)
  const second = await refused(kai, `select public.invite_student($1, 'emily.second@students.example', $2, 'guardian-test-1')`, [student, hash(secret())])
  check('a student who has a sign-in is not invited again', second?.code === 'PI007', second?.message)
}

// ── One kind of account per sign-in ─────────────────────────────────────────
{
  const passes = await asUser(db, emily, (tx) => one<{ member: boolean; owner: boolean }>(tx, `select public.is_firm_member($1) as member, public.is_firm_owner($1) as owner`, [firm]))
  check('a student never passes is_firm_member', passes.member === false && passes.owner === false)
  const start = await refused(emily, `select public.create_firm('My Own Firm', 'Emily Chen')`)
  check('a student cannot create a firm', start?.code === '42501', start?.message)
  const s = secret()
  await rpc(owner, `select public.invite_counselor('emily.chen@students.example', $1)`, [hash(s)])
  const join = await serviceRefused(`select public.accept_counselor_invitation($1, $2, 'Emily Chen')`, [hash(s), emily])
  check('a student cannot accept a counselor’s invitation', join?.code === 'PI004', join?.message)
  await rpc(owner, `select public.revoke_invitation(id) from public.invitations where email = 'emily.chen@students.example' and kind = 'counselor' and revoked_at is null`)
  const forMember = secret()
  await rpc(owner, `select public.invite_student(id, 'kai@northgate.example', $2, 'guardian-test-1') from public.students where firm_id = $1 and first_name = 'Maya'`, [firm, hash(forMember)])
  const byMember = await acceptStudent(forMember, kai)
  check('a member of a firm cannot accept a student invitation, even one sent to their own address', byMember?.code === 'PI004', byMember?.message)
  await rpc(owner, `select public.revoke_invitation(id) from public.invitations where email = 'kai@northgate.example' and kind = 'student' and revoked_at is null`)
  const planted = await serviceRefused(`insert into public.firm_members (firm_id, user_id, role, display_name) values ($1, $2, 'counselor', 'Planted')`, [firm, emily])
  check('even the service role cannot make a student a member', planted?.code === 'PI004', planted?.message)
  const reverse = await serviceRefused(`insert into public.student_accounts (user_id, firm_id, student_id) values ($1, $2, $3)`, [kai, firm, youngStudent])
  check('nor give a member a student account', reverse?.code === 'PI004', reverse?.message)
}

// ── What a student session can reach ────────────────────────────────────────
{
  // A second student with a sign-in in the same firm, so "only your own row" is not vacuous.
  const maya = await person('maya.ruiz@students.example')
  const mayaStudent = (await service(`select id from public.students where firm_id = $1 and first_name = 'Maya'`, [firm])).rows[0] as { id: string }
  const s = secret()
  await rpc(kai, `select public.invite_student($1, 'maya.ruiz@students.example', $2, 'guardian-test-1')`, [mayaStudent.id, hash(s)])
  await service(`select public.accept_student_invitation($1, $2, 'age-test-1')`, [hash(s), maya])
  await service(`insert into public.parents (firm_id, student_id, name, relationship, language, channel) values ($1, $2, 'Chen Chih-hao', 'Father', 'zh-Hant', 'email')`, [firm, student])
  await service(`insert into public.tasks (firm_id, student_id, title, category, owner, due_date, status, source) values ($1, $2, 'Revise the personal statement', 'essay', 'student', current_date, 'todo', 'counselor')`, [firm, student])
  await service(`insert into public.meetings (firm_id, student_id, title, date, time, status) values ($1, $2, 'Check-in', current_date, '16:00', 'scheduled')`, [firm, student])
  await service(`insert into public.google_connections (user_id, firm_id, google_address, refresh_token_encrypted) values ($1, $2, 'kai@gmail.example', 'sealed')`, [kai, firm])

  const tables = (await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map((r) => r.tablename)
  const filled = new Set<string>()
  for (const t of tables) if ((await one<{ n: number }>(db, `select count(*)::int as n from public."${t}"`)).n > 0) filled.add(t)
  check('the tables a student must not read hold rows in this run', ['students', 'parents', 'tasks', 'meetings', 'firms', 'firm_members', 'outbox', 'activity', 'invitations', 'student_account_consents', 'google_connections', 'phone_devices', 'document_types'].every((t) => filled.has(t)), [...filled].join(' '))

  const OPEN = ['college_directory', 'college_programs']
  const seen: string[] = []
  const wrote: string[] = []
  const before = new Map<string, number>()
  for (const t of tables) before.set(t, (await one<{ n: number }>(db, `select count(*)::int as n from public."${t}"`)).n)
  for (const t of tables) {
    const read = await refusal(async () => {
      // A student may read their own account row, but not who turned it off.
      const rows = await rpc(emily, t === 'student_accounts' ? `select user_id, firm_id, student_id, disabled_at from public.student_accounts` : `select * from public."${t}"`)
      if (t === 'student_accounts') {
        if (rows.rows.length !== 1 || (rows.rows[0] as { user_id: string }).user_id !== emily) seen.push(`${t}: ${rows.rows.length} rows`)
      } else if (!OPEN.includes(t) && rows.rows.length > 0) seen.push(`${t}: ${rows.rows.length} rows`)
    })
    if (read && (read.code !== '42501' || t === 'student_accounts')) seen.push(`${t}: ${read.message}`)
    const column = (await one<{ c: string }>(db, `select column_name as c from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position limit 1`, [t])).c
    for (const [what, sql] of [
      ['insert', `insert into public."${t}" default values`],
      ['update', `update public."${t}" set "${column}" = "${column}"`],
      ['delete', `delete from public."${t}"`],
    ] as const) {
      const result = await refusal(async () => {
        const done = await rpc(emily, sql)
        if ((done.affectedRows ?? 0) > 0) wrote.push(`${what} ${t}: ${done.affectedRows} rows`)
      })
      if (result && result.code !== '42501') wrote.push(`${what} ${t}: ${result.code} ${result.message}`)
    }
  }
  for (const t of tables) if ((await one<{ n: number }>(db, `select count(*)::int as n from public."${t}"`)).n !== before.get(t)) wrote.push(`${t} changed`)
  check(`a student session selects zero rows from every one of ${tables.length} tables but its own account row and the college directory`, seen.length === 0, seen.join('; '))
  check('and cannot insert, update or delete anywhere', wrote.length === 0, wrote.join('; '))
  const whoTurnedItOff = await refused(emily, `select disabled_by from public.student_accounts`)
  check('a student cannot read which member turned a sign-in off', whoTurnedItOff?.code === '42501', whoTurnedItOff?.message)
  const directory = await refusal(() => rpc(emily, `select 1 from public.college_directory limit 1`))
  check('the shared college directory stays readable', directory === undefined, directory?.message)
  const files = await rpc(emily, `select 1 from storage.objects`)
  check('no stored file is listed for a student', files.rows.length === 0)

  for (const [name, sql, params] of [
    ['queue a message', `select public.queue_message($1::jsonb)`, [JSON.stringify({ studentId: student, toKind: 'student', toName: 'Emily', channel: 'email', language: 'en', kind: 'reminder_upcoming', body: 'Hi' })]],
    ['save an edit', `select public.apply_changes($1, '{}'::jsonb)`, [firm]],
    ['invite a student', `select public.invite_student($1, 'x@students.example', $2, 'guardian-test-1')`, [youngStudent, hash(secret())]],
    ['invite a counselor', `select public.invite_counselor('x@northgate.example', $1)`, [hash(secret())]],
    ['turn a sign-in off', `select public.set_student_account_disabled($1, true)`, [mayaStudent.id]],
    ['turn their own sign-in back on', `select public.set_student_account_disabled($1, false)`, [student]],
    ['remove a member', `select public.remove_member($1)`, [kai]],
    ['change a role', `select public.set_member_role($1, 'owner')`, [emily]],
    ['count owner-only files', `select public.owner_only_file_count($1)`, [firm]],
    ['rename themselves as a member', `select public.rename_self('Emily')`, []],
  ] as const) {
    const result = await refused(emily, sql, [...params])
    check(`a student cannot ${name}`, result !== undefined && ['42501', '28000'].includes(result.code ?? ''), result ? `${result.code} ${result.message}` : 'it ran')
  }
}

// ── Turning a sign-in off and on, and the consent record ────────────────────
{
  const foreign = await refused(otherOwner, `select public.set_student_account_disabled($1, true)`, [student])
  check('a member of another firm cannot turn this firm’s sign-in off', foreign?.code === '42501', foreign?.message)
  const off = await refused(kai, `select public.set_student_account_disabled($1, true)`, [student])
  const row = await service(`select disabled_at, disabled_by from public.student_accounts where user_id = $1`, [emily])
  check('any member turns a student’s sign-in off', off === undefined && (row.rows[0] as { disabled_at: string | null }).disabled_at !== null && (row.rows[0] as { disabled_by: string }).disabled_by === kai, off?.message)
  const own = await rpc(emily, `select disabled_at from public.student_accounts`)
  check('the student can see that it is off', own.rows.length === 1 && (own.rows[0] as { disabled_at: string | null }).disabled_at !== null)
  const on = await refused(owner, `select public.set_student_account_disabled($1, false)`, [student])
  const after = await service(`select disabled_at from public.student_accounts where user_id = $1`, [emily])
  check('and on again', on === undefined && (after.rows[0] as { disabled_at: string | null }).disabled_at === null, on?.message)
  const none = await refused(owner, `select public.set_student_account_disabled($1, true)`, [youngStudent])
  check('a student with no sign-in has nothing to turn off', none?.code === '22023', none?.message)

  const change = await serviceRefused(`update public.student_account_consents set wording_version = 'changed'`)
  check('a consent record cannot be changed, even by the service role', change?.code === '42501', change?.message)
  const remove = await serviceRefused(`delete from public.student_account_consents`)
  check('or removed', remove?.code === '42501', remove?.message)
  const read = await rpc(kai, `select kind from public.student_account_consents where student_id = $1`, [student])
  const hidden = await rpc(otherOwner, `select kind from public.student_account_consents`)
  check('members read their firm’s consent records; another firm reads none', read.rows.length === 2 && hidden.rows.length === 0)

  await db.query(`delete from auth.users where id = $1`, [emily])
  const gone = await service(`select 1 from public.student_accounts where student_id = $1`, [student])
  const kept = await service(`select 1 from public.students where id = $1`, [student])
  const record = await service(`select 1 from public.student_account_consents where student_id = $1`, [student])
  check('deleting the sign-in removes the account row and keeps the student', gone.rows.length === 0 && kept.rows.length === 1)
  check('and keeps the record of who agreed to what', record.rows.length === 2)
}

// ── Only an owner deletes a student, by any path ────────────────────────────
{
  const doomed = randomUUID()
  await service(`insert into public.students (id, firm_id, first_name, last_name, grad_year) values ($1, $2, 'Doomed', 'Student', 2027)`, [doomed, firm])
  await service(`insert into public.tasks (firm_id, student_id, title, category, owner, due_date, status, source) values ($1, $2, 'A task', 'essay', 'student', current_date, 'todo', 'counselor')`, [firm, doomed])
  const direct = await asUser(db, kai, (tx) => tx.query(`delete from public.students where id = $1`, [doomed]))
  const still = await service(`select 1 from public.students where id = $1`, [doomed])
  check('a counselor cannot delete a student directly through the Data API: the row is not theirs to delete', (direct.affectedRows ?? 0) === 0 && still.rows.length === 1)
  const viaChild = await asUser(db, kai, (tx) => tx.query(`delete from public.tasks where student_id = $1`, [doomed]))
  check('a counselor can still delete a task, as before', (viaChild.affectedRows ?? 0) === 1)
  const archive = await refused(kai, `update public.students set archived = true where id = $1`, [doomed])
  check('and can still archive a student', archive === undefined, archive?.message)
  const foreign = await asUser(db, otherOwner, (tx) => tx.query(`delete from public.students where id = $1`, [doomed]))
  check('an owner of another firm cannot delete it either', (foreign.affectedRows ?? 0) === 0)
  const byOwner = await asUser(db, owner, (tx) => tx.query(`delete from public.students where id = $1`, [doomed]))
  check('an owner deletes a student directly, as before', (byOwner.affectedRows ?? 0) === 1)
}

// ── A stored file whose document row is gone is never readable ──────────────
{
  const withRow = randomUUID()
  const orphan = randomUUID()
  const elsewhere = randomUUID()
  const path = (f: string, doc: string) => `${f}/${student}/${doc}/transcript.pdf`
  await service(`insert into public.documents (id, firm_id, student_id, name, kind, category, added_by, storage_path, file_status) values ($1, $2, $3, 'Transcript', 'transcript', 'academic', 'counselor', $4, 'suggested')`, [withRow, firm, student, path(firm, withRow)])
  await service(`insert into public.documents (id, firm_id, student_id, name, kind, category, added_by) values ($1, $2, $3, 'Other firm file', 'transcript', 'academic', 'counselor')`, [elsewhere, otherFirm, otherStudent])
  await service(`insert into storage.objects (bucket_id, name) values ('documents', $1), ('documents', $2), ('documents', $3)`, [path(firm, withRow), path(firm, orphan), path(firm, elsewhere)])
  const seen = (await rpc(kai, `select name from storage.objects`)).rows.map((r) => (r as { name: string }).name)
  check('a member reads a stored file whose document row exists', seen.includes(path(firm, withRow)), seen.join(' '))
  check('a stored file with no document row is not readable: a missing row means no', !seen.includes(path(firm, orphan)))
  check('nor one whose path names a document of another firm', !seen.includes(path(firm, elsewhere)))
  const byOwner = (await rpc(owner, `select name from storage.objects`)).rows.map((r) => (r as { name: string }).name)
  check('not even for an owner', !byOwner.includes(path(firm, orphan)) && byOwner.includes(path(firm, withRow)))
  const removed = await asUser(db, kai, (tx) => tx.query(`delete from storage.objects where name = $1`, [path(firm, orphan)]))
  check('and it cannot be deleted by a member either', (removed.affectedRows ?? 0) === 0)
  await service(`delete from public.documents where id = $1`, [withRow])
  const after = (await rpc(kai, `select name from storage.objects`)).rows.length
  check('once a document row is deleted, its stored file stops being readable', after === 0, String(after))
  const log = await one<{ ok: boolean }>(db, `select public.document_is_readable($1) as ok`, [orphan])
  check('the file log’s own rule is untouched (it still answers for deleted documents)', log.ok === true)
}

// ── A counselor leaves ──────────────────────────────────────────────────────
{
  const leaving = await person('sam@northgate.example')
  const s = secret()
  await rpc(owner, `select public.invite_counselor('sam@northgate.example', $1)`, [hash(s)])
  await service(`select public.accept_counselor_invitation($1, $2, 'Sam Ortiz')`, [hash(s), leaving])
  const left = await refused(leaving, `select public.leave_firm()`)
  const member = await service(`select 1 from public.firm_members where user_id = $1`, [leaving])
  check('a counselor can leave the firm', left === undefined && member.rows.length === 0, left?.message)
  const whole = await serviceRefused(`delete from public.firms where id = $1`, [firm])
  const records = await one<{ n: number }>(db, `select count(*)::int as n from public.student_account_consents where firm_id = $1`, [firm])
  check('a whole firm can still be deleted: members, sign-ins and consent records go with it', whole === undefined && records.n === 0, whole?.message ?? String(records.n))
  void otherFirm
}

await db.close()
console.log(failed === 0 ? `\nAll ${count} database checks for accounts passed.` : `\n${failed} of ${count} database checks for accounts FAILED.`)
process.exit(failed === 0 ? 0 : 1)
