// Invitations and members: what /api/account does once it knows who is asking.
//
// The rules live in the database (supabase/migrations/20261208000001): who may
// invite, that an invitation is used once, the invited address, one firm per
// person, and that a firm keeps an owner. This file asks the database, in the
// caller's own name wherever the caller is a member, and turns its refusals
// into the small set of reasons the screens know (shared/account.ts).
//
// The service role is used for exactly three things here: looking an
// invitation up by its hash (the person holding the link is not a member yet),
// accepting it (the database function is the service role's alone), and
// reading members' sign-in addresses for an owner.
//
// Nothing here writes the outbox or calls a transport. An invitation is not a
// message Platinum sends.

import { createHash, randomBytes } from 'node:crypto'
import { GUARDIAN_CONSENT, STUDENT_AGE, maskEmail, maySignIn, type AccountErrorCode, type FirmMember, type FirmOverview, type InvitationKind, type InvitationPreview, type NewInvitation, type PendingInvitation, type RemovalSummary, type StudentSignIn } from '../shared/account.js'
import { disconnectMember } from './google/connection.js'
import { serviceClient, type Caller, type Person } from './supabase.js'

type Member = Extract<Caller, { ok: true }>
type Known = Extract<Person, { ok: true }>

/** Something to tell the person. `code` is what the screen goes by. */
export class AccountError extends Error {
  code: AccountErrorCode
  status: number
  constructor(code: AccountErrorCode, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** One answer for an invitation that is unknown, expired, revoked or already used. */
export const DEAD_INVITATION = 'This invitation link does not work. It may have expired, been replaced, or been used already. Ask the person who sent it for a new one.'

const dead = () => new AccountError('dead_invitation', DEAD_INVITATION, 404)

/** SHA-256 of an invitation's secret. The secret itself is never written down. */
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex')

/** 32 random bytes, as the 43 characters that go in the link. */
export const newSecret = () => randomBytes(32).toString('base64url')

/** The database's refusals, by the code it raises them with. Anything else is a server failure. */
const REFUSALS: Record<string, { code: AccountErrorCode; status: number; message?: string }> = {
  PI001: { code: 'dead_invitation', status: 404, message: DEAD_INVITATION },
  PI002: { code: 'confirm_email', status: 403, message: 'Confirm your email address first. Open the confirmation email, then open your invitation link again.' },
  PI003: { code: 'wrong_email', status: 403, message: 'This invitation is for another email address. Sign in with the address it was sent to.' },
  PI004: { code: 'already_member', status: 409 },
  PI005: { code: 'pending_exists', status: 409 },
  PI006: { code: 'too_young', status: 403 },
  PI007: { code: 'has_signin', status: 409 },
  PI008: { code: 'consent_missing', status: 400 },
  PI009: { code: 'dead_invitation', status: 404 },
  PI010: { code: 'last_owner', status: 409 },
  '23514': { code: 'invalid', status: 400, message: 'That was not valid. Check it and try again.' },
  '23505': { code: 'pending_exists', status: 409, message: 'That address already has an invitation waiting. Make a new link for it instead.' },
  '42501': { code: 'forbidden', status: 403 },
  '22023': { code: 'invalid', status: 400 },
  '28000': { code: 'unauthorized', status: 401, message: 'Sign in again.' },
}

/** Throws what the database said, as something the screen can show. The database's own sentences are written for people. */
export function refuse(error: { code?: string; message: string } | null, doing: string): void {
  if (!error) return
  const known = error.code ? REFUSALS[error.code] : undefined
  if (known) throw new AccountError(known.code, known.message ?? error.message, known.status)
  throw new Error(`${doing} failed: ${error.message}`)
}

// ── An invitation, before anyone has signed in ──────────────────────────────

interface Found {
  id: string
  firmId: string
  kind: InvitationKind
  email: string
  studentId: string | null
}

/** The invitation a secret opens, or undefined when it is unknown, expired, revoked or used. Lookup is by hash only. */
export async function findInvitation(secret: string, now = Date.now()): Promise<Found | undefined> {
  const { data, error } = await serviceClient()
    .from('invitations')
    .select('id, firm_id, kind, email, student_id, expires_at, accepted_at, revoked_at')
    .eq('token_hash', hashSecret(secret))
    .maybeSingle()
  if (error) throw new Error(`invitation lookup failed: ${error.message}`)
  if (!data || data.accepted_at || data.revoked_at) return undefined
  const until = Date.parse(data.expires_at)
  if (Number.isNaN(until) || until <= now) return undefined
  return { id: data.id, firmId: data.firm_id, kind: data.kind === 'student' ? 'student' : 'counselor', email: data.email, studentId: data.student_id }
}

/** What the person holding the link is shown: the firm, the kind, the address masked, and for a student their first name. */
export async function previewInvitation(secret: string): Promise<InvitationPreview> {
  const found = await findInvitation(secret)
  if (!found) throw dead()
  const db = serviceClient()
  const firm = await db.from('firms').select('name').eq('id', found.firmId).maybeSingle()
  if (firm.error) throw new Error(`invitation firm lookup failed: ${firm.error.message}`)
  if (!firm.data) throw dead()
  const preview: InvitationPreview = { kind: found.kind, firmName: firm.data.name, email: maskEmail(found.email) }
  if (found.kind === 'student' && found.studentId) {
    const student = await db.from('students').select('first_name').eq('firm_id', found.firmId).eq('id', found.studentId).maybeSingle()
    if (student.error) throw new Error(`invitation student lookup failed: ${student.error.message}`)
    if (!student.data) throw dead()
    preview.studentFirstName = student.data.first_name
  }
  return preview
}

/**
 * Accepts an invitation for the signed-in person: a counselor joins the firm,
 * or a student gets their sign-in. The database function does every check
 * again with the row locked, and reads the address and its confirmation from
 * auth.users itself.
 */
export async function acceptInvitation(person: Known, input: { secret: string; displayName?: string; ageConfirmed?: true }): Promise<{ kind: InvitationKind }> {
  const found = await findInvitation(input.secret)
  if (!found) throw dead()
  if (!person.emailConfirmed) refuse({ code: 'PI002', message: '' }, 'accept')
  if (person.email !== found.email) refuse({ code: 'PI003', message: '' }, 'accept')
  const hash = hashSecret(input.secret)
  if (found.kind === 'student') {
    if (input.ageConfirmed !== true) throw new AccountError('consent_missing', 'Tick that you are 13 or older to continue.', 400)
    // The wording version is the server's, not the request's: it records what this version of the screen says.
    const { error } = await serviceClient().rpc('accept_student_invitation', { hash, person: person.userId, age_version: STUDENT_AGE.version })
    refuse(error, 'accepting the invitation')
    return { kind: 'student' }
  }
  if (!input.displayName) throw new AccountError('invalid', 'Enter your name.', 400)
  const { error } = await serviceClient().rpc('accept_counselor_invitation', { hash, person: person.userId, display_name: input.displayName })
  refuse(error, 'accepting the invitation')
  return { kind: 'counselor' }
}

// ── The firm, for an owner ──────────────────────────────────────────────────

const ownersOnly = (caller: Member, what: string) => {
  if (caller.role !== 'owner') throw new AccountError('forbidden', `Only an owner can ${what}.`, 403)
}

/** Invitations still waiting, newest first, read as the caller. The hash is not a column they can read. */
export async function pendingInvitations(caller: Member, now = Date.now()): Promise<PendingInvitation[]> {
  const { data, error } = await caller.client
    .from('invitations')
    .select('id, kind, email, student_id, created_at, expires_at')
    .eq('firm_id', caller.firmId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`reading invitations failed: ${error.message}`)
  return data.map((i) => ({
    id: i.id,
    kind: i.kind === 'student' ? 'student' : 'counselor',
    email: i.email,
    studentId: i.student_id ?? undefined,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
    expired: !(Date.parse(i.expires_at) > now),
  }))
}

/** The members with their sign-in addresses, and the invitations. Owners only: a counselor is not shown addresses. */
export async function firmOverview(caller: Member): Promise<FirmOverview> {
  ownersOnly(caller, 'open the firm page')
  const rows = await caller.client.from('firm_members').select('user_id, role, display_name, created_at').eq('firm_id', caller.firmId).order('created_at')
  if (rows.error) throw new Error(`reading members failed: ${rows.error.message}`)
  const admin = serviceClient().auth.admin
  const members: FirmMember[] = await Promise.all(
    rows.data.map(async (m) => {
      // The address is the sign-in's, which only the service role can read. One member at a time, each of this firm.
      const user = await admin.getUserById(m.user_id)
      return { userId: m.user_id, name: m.display_name, email: user.data.user?.email ?? '', role: m.role === 'owner' ? 'owner' : 'counselor', joinedAt: m.created_at, you: m.user_id === caller.userId }
    }),
  )
  const invitations = await pendingInvitations(caller)
  return { members, invitations, students: await studentSignIns(caller, undefined, invitations) }
}

/** An owner invites a counselor. The secret is returned once. */
export async function inviteCounselor(caller: Member, email: string, replace?: string): Promise<NewInvitation> {
  ownersOnly(caller, 'invite a counselor')
  const secret = newSecret()
  const { data, error } = await caller.client.rpc('invite_counselor', { email, token_hash: hashSecret(secret), ...(replace ? { replace } : {}) })
  refuse(error, 'making the invitation')
  const made = data as unknown as { id: string; email: string; expires_at: string }
  return { id: made.id, email: made.email, expiresAt: made.expires_at, secret }
}

/** "New link": the waiting invitation is revoked and a new one made for the same address, in one transaction. */
export async function newLink(caller: Member, invitationId: string): Promise<NewInvitation> {
  const { data, error } = await caller.client.from('invitations').select('id, kind, email, student_id').eq('id', invitationId).eq('firm_id', caller.firmId).maybeSingle()
  if (error) throw new Error(`reading the invitation failed: ${error.message}`)
  if (!data) throw new AccountError('dead_invitation', 'That invitation is no longer waiting.', 404)
  if (data.kind === 'student') {
    if (!data.student_id) throw new AccountError('dead_invitation', 'That invitation is no longer waiting.', 404)
    return inviteStudent(caller, { studentId: data.student_id, email: data.email, replace: data.id })
  }
  return inviteCounselor(caller, data.email, data.id)
}

export async function revokeInvitation(caller: Member, invitationId: string): Promise<void> {
  const { error } = await caller.client.rpc('revoke_invitation', { invitation: invitationId })
  refuse(error, 'revoking the invitation')
}

export async function setRole(caller: Member, userId: string, role: 'owner' | 'counselor'): Promise<void> {
  const { error } = await caller.client.rpc('set_member_role', { member: userId, new_role: role })
  refuse(error, 'changing the role')
}

export async function removalSummary(caller: Member, userId: string): Promise<RemovalSummary> {
  const { data, error } = await caller.client.rpc('member_removal_summary', { member: userId })
  refuse(error, 'reading what removal would do')
  const summary = data as unknown as RemovalSummary
  return { google: Boolean(summary.google), phone: Boolean(summary.phone), queued: Number(summary.queued) || 0 }
}

/**
 * Removes a counselor from the firm. The database function does the four
 * things in one transaction: the membership, the Google connection, the phone,
 * the queued messages, and one activity line. Before it, the grant is revoked
 * at Google when it can be, which only this server can do.
 */
export async function removeMember(caller: Member, userId: string): Promise<{ google: boolean; phone: boolean; cancelled: number }> {
  ownersOnly(caller, 'remove a member')
  if (userId === caller.userId) throw new AccountError('invalid', 'To remove yourself, leave the firm.', 400)
  // Read as the caller, so a person of another firm is simply not found.
  const target = await caller.client.from('firm_members').select('role').eq('firm_id', caller.firmId).eq('user_id', userId).maybeSingle()
  if (target.error) throw new Error(`reading the member failed: ${target.error.message}`)
  if (!target.data) throw new AccountError('forbidden', 'That person is not a member of your firm.', 403)
  if (target.data.role === 'owner') throw new AccountError('forbidden', 'An owner cannot be removed. They step down first.', 403)
  await disconnectMember({ userId, firmId: caller.firmId })
  const { data, error } = await caller.client.rpc('remove_member', { member: userId })
  refuse(error, 'removing the member')
  const done = data as unknown as { google: boolean; phone: boolean; cancelled: number }
  return { google: Boolean(done.google), phone: Boolean(done.phone), cancelled: Number(done.cancelled) || 0 }
}

/** Leaves the firm. An owner can only when another owner exists; that is checked before anything is disconnected. */
export async function leaveFirm(caller: Member): Promise<void> {
  if (caller.role === 'owner') {
    const owners = await caller.client.from('firm_members').select('user_id').eq('firm_id', caller.firmId).eq('role', 'owner')
    if (owners.error) throw new Error(`reading owners failed: ${owners.error.message}`)
    if (owners.data.length < 2) throw new AccountError('last_owner', 'You are the only owner. Make someone else an owner first.', 409)
  }
  await disconnectMember({ userId: caller.userId, firmId: caller.firmId })
  const { error } = await caller.client.rpc('leave_firm')
  refuse(error, 'leaving the firm')
}

// ── Student sign-ins ────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10)

/**
 * Any member invites a student of their firm. A first invitation carries the
 * "a parent or guardian knows" tick, which the database records with the
 * wording's version; "New link" (`replace`) does not ask again. The grade rule
 * is checked here for its plain answer and again in the database.
 */
export async function inviteStudent(caller: Member, input: { studentId: string; email: string; guardianKnows?: true; replace?: string }): Promise<NewInvitation> {
  // Read as the caller, so a student of another firm is simply not found.
  const student = await caller.client.from('students').select('first_name, grad_year, archived').eq('firm_id', caller.firmId).eq('id', input.studentId).maybeSingle()
  if (student.error) throw new Error(`reading the student failed: ${student.error.message}`)
  if (!student.data) throw new AccountError('forbidden', 'That student was not found.', 403)
  if (!maySignIn(student.data.grad_year, today())) {
    throw new AccountError('too_young', `${student.data.first_name} is below 9th grade, so cannot have a sign-in yet. Use the student link instead.`, 403)
  }
  if (!input.replace && input.guardianKnows !== true) throw new AccountError('consent_missing', `Tick that a parent or guardian of ${student.data.first_name} knows about this account and agrees to it.`, 400)
  const secret = newSecret()
  const { data, error } = await caller.client.rpc('invite_student', {
    student: input.studentId,
    email: input.email,
    token_hash: hashSecret(secret),
    ...(input.guardianKnows ? { consent_version: GUARDIAN_CONSENT.version } : {}),
    ...(input.replace ? { replace: input.replace } : {}),
  })
  refuse(error, 'making the invitation')
  const made = data as unknown as { id: string; email: string; expires_at: string }
  return { id: made.id, email: made.email, expiresAt: made.expires_at, secret }
}

/**
 * Where each active student's sign-in stands: none, invited, on or turned off.
 * Everything is read as the caller, so it is their own firm's and nothing else.
 */
export async function studentSignIns(caller: Member, studentId?: string, waiting?: PendingInvitation[]): Promise<StudentSignIn[]> {
  const students = caller.client.from('students').select('id, first_name, last_name, grad_year').eq('firm_id', caller.firmId).order('seq')
  const accounts = caller.client.from('student_accounts').select('user_id, student_id, invitation_id, disabled_at').eq('firm_id', caller.firmId)
  // The list is of active students. One student asked for by id is answered archived or not, so a sign-in can still be turned off.
  const [studentRows, accountRows, invitations] = await Promise.all([studentId ? students.eq('id', studentId) : students.eq('archived', false), studentId ? accounts.eq('student_id', studentId) : accounts, waiting ?? pendingInvitations(caller)])
  if (studentRows.error || accountRows.error) throw new Error(`reading sign-ins failed: ${(studentRows.error ?? accountRows.error)!.message}`)

  // The address a sign-in uses now, from the sign-in itself: one of this firm's student accounts at a time.
  const addresses = new Map<string, string>()
  const admin = serviceClient().auth.admin
  await Promise.all(
    accountRows.data.map(async (a) => {
      const user = await admin.getUserById(a.user_id)
      if (user.data.user?.email) addresses.set(a.user_id, user.data.user.email)
    }),
  )
  const day = today()
  return studentRows.data.map((s): StudentSignIn => {
    const base = { studentId: s.id, name: `${s.first_name} ${s.last_name}`.trim(), tooYoung: !maySignIn(s.grad_year, day) }
    const account = accountRows.data.find((a) => a.student_id === s.id)
    if (account) return { ...base, state: account.disabled_at ? 'off' : 'on', email: addresses.get(account.user_id) }
    const invitation = invitations.find((i) => i.kind === 'student' && i.studentId === s.id)
    if (invitation) return { ...base, state: 'invited', email: invitation.email, invitationId: invitation.id, expiresAt: invitation.expiresAt, expired: invitation.expired }
    return { ...base, state: 'none' }
  })
}

/** One student's sign-in, for the card on the student page. */
export async function studentSignIn(caller: Member, studentId: string): Promise<StudentSignIn> {
  const [found] = await studentSignIns(caller, studentId)
  if (!found) throw new AccountError('forbidden', 'That student was not found.', 403)
  return found
}

/** Any member turns a student's sign-in off or on. The student's next request is refused, or served, accordingly. */
export async function setStudentSignIn(caller: Member, studentId: string, on: boolean): Promise<StudentSignIn> {
  const { error } = await caller.client.rpc('set_student_account_disabled', { student: studentId, disabled: !on })
  refuse(error, 'changing the sign-in')
  return studentSignIn(caller, studentId)
}

/**
 * A student deletes their own sign-in: the account row and the auth user. The
 * firm's record of the student (tasks, meetings, files) is not touched, and
 * the student link still works. Refused for a member of a firm.
 */
export async function deleteMySignIn(person: Known): Promise<void> {
  const db = serviceClient()
  const account = await db.from('student_accounts').select('firm_id, student_id').eq('user_id', person.userId).maybeSingle()
  if (account.error) throw new Error(`reading the sign-in failed: ${account.error.message}`)
  if (!account.data) {
    // Not a student's. A member of a firm leaves the firm instead. Someone who belongs to nothing
    // (a student whose record the firm deleted, say) may delete the sign-in that is left over.
    const member = await db.from('firm_members').select('user_id').eq('user_id', person.userId).maybeSingle()
    if (member.error) throw new Error(`reading the membership failed: ${member.error.message}`)
    if (member.data) throw new AccountError('forbidden', 'This sign-in belongs to a firm. Leave the firm first.', 403)
    const leftover = await db.auth.admin.deleteUser(person.userId)
    if (leftover.error) throw new Error(`deleting the sign-in failed: ${leftover.error.message}`)
    return
  }
  const student = await db.from('students').select('first_name').eq('firm_id', account.data.firm_id).eq('id', account.data.student_id).maybeSingle()
  // The auth user first: if that fails, nothing has changed. Deleting it takes the account row with it.
  const gone = await db.auth.admin.deleteUser(person.userId)
  if (gone.error) throw new Error(`deleting the sign-in failed: ${gone.error.message}`)
  const row = await db.from('student_accounts').delete().eq('user_id', person.userId)
  if (row.error) console.error('[account] sign-in row not removed:', row.error.message)
  const line = await db.from('activity').insert({ firm_id: account.data.firm_id, student_id: account.data.student_id, actor: 'student', actor_user: null, text: `${student.data?.first_name ?? 'The student'} deleted their sign-in.` })
  if (line.error) console.error('[account] activity not written:', line.error.message)
}
