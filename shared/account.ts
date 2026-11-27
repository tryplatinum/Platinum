// The contract for /api/account: invitations, the firm's members, and (further
// down) student sign-ins. Shared by the browser (types and the small rules) and
// the server function (validation). Nothing here sends anything: an invitation
// is a link a person copies.

import { z } from 'zod'

export const ACCOUNT_ENDPOINT = '/api/account'

/** An invitation works for this many days after it is made. */
export const INVITE_DAYS = 7

/** The shortest password the screens accept. Supabase enforces its own minimum as well. */
export const MIN_PASSWORD = 8

/** An invitation's secret: 32 random bytes in base64url, 43 characters. */
export const INVITE_SECRET = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

/** An email address, trimmed and in lower case, which is how invitations store it. */
export const EMAIL = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)

const NAME = z.string().trim().min(1).max(200)

export const ACCOUNT_REQUEST = z.discriminatedUnion('action', [
  /** No sign-in. What an invitation is for, with the address masked. */
  z.object({ action: z.literal('preview'), secret: INVITE_SECRET }),
  /**
   * Signed in. `displayName` is how a counselor will be named in the firm.
   * `ageConfirmed` is the student's own "I am 13 or older" tick; it can only be true.
   */
  z.object({ action: z.literal('accept'), secret: INVITE_SECRET, displayName: NAME.optional(), ageConfirmed: z.literal(true).optional() }),
  /** Owners: the members with their addresses, and the invitations. */
  z.object({ action: z.literal('firm') }),
  z.object({ action: z.literal('invite_counselor'), email: EMAIL }),
  /** Revokes a waiting invitation and makes a new one for the same address. */
  z.object({ action: z.literal('new_link'), invitationId: z.uuid() }),
  z.object({ action: z.literal('revoke_invitation'), invitationId: z.uuid() }),
  z.object({ action: z.literal('set_role'), userId: z.uuid(), role: z.enum(['owner', 'counselor']) }),
  /** What removing this member would do, for the confirmation. */
  z.object({ action: z.literal('removal_summary'), userId: z.uuid() }),
  z.object({ action: z.literal('remove_member'), userId: z.uuid() }),
  z.object({ action: z.literal('leave') }),
  /** Any member. `guardianKnows` is the tick; it can only be true. */
  z.object({ action: z.literal('invite_student'), studentId: z.uuid(), email: EMAIL, guardianKnows: z.literal(true) }),
  /** Any member: the state of one student's sign-in, for the card on the student page. */
  z.object({ action: z.literal('student_signin'), studentId: z.uuid() }),
  /** Any member: turn a student's sign-in off or on. */
  z.object({ action: z.literal('set_student_signin'), studentId: z.uuid(), on: z.boolean() }),
  /** A student, about their own sign-in: delete it. The firm's record of the student stays. */
  z.object({ action: z.literal('delete_my_signin') }),
])

export type AccountRequest = z.infer<typeof ACCOUNT_REQUEST>

/** Why a request was refused. The screens choose their words from this, not from the message. */
export type AccountErrorCode =
  | 'dead_invitation' // unknown, expired, revoked or used: one answer for all four
  | 'confirm_email'
  | 'wrong_email'
  | 'already_member'
  | 'pending_exists'
  | 'has_signin' // the student already has a sign-in
  | 'too_young' // below 9th grade: use the student link instead
  | 'consent_missing'
  | 'last_owner'
  | 'forbidden'
  | 'unauthorized'
  | 'no_firm'
  | 'invalid'
  | 'rate_limited'
  | 'not_configured'
  | 'server'

export type InvitationKind = 'counselor' | 'student'

/** What someone holding an invitation link is shown before they sign in. */
export interface InvitationPreview {
  kind: InvitationKind
  firmName: string
  /** The invited address with most of it hidden. */
  email: string
  /** A student invitation only: whose sign-in it is. First name, nothing else. */
  studentFirstName?: string
}

export interface FirmMember {
  userId: string
  name: string
  email: string
  role: 'owner' | 'counselor'
  joinedAt: string
  you: boolean
}

export interface PendingInvitation {
  id: string
  kind: InvitationKind
  email: string
  studentId?: string
  createdAt: string
  expiresAt: string
  /** True once its seven days are over. It no longer works; "New link" replaces it. */
  expired: boolean
}

/** Where one student's sign-in stands. */
export type SignInState = 'none' | 'invited' | 'on' | 'off'

export interface StudentSignIn {
  studentId: string
  /** First and last name, for the owner's list. */
  name: string
  state: SignInState
  /** The invited address while an invitation waits, or the address the sign-in was made with. */
  email?: string
  /** While invited: the invitation, when it runs out, and whether it already has. */
  invitationId?: string
  expiresAt?: string
  expired?: boolean
  /** Below 9th grade today: no invitation can be made. The screen says to use the student link. */
  tooYoung: boolean
}

export interface FirmOverview {
  members: FirmMember[]
  invitations: PendingInvitation[]
  /** Every active student and the state of their sign-in. */
  students: StudentSignIn[]
}

/** A new invitation. `secret` is given once and cannot be read again. */
export interface NewInvitation {
  id: string
  email: string
  expiresAt: string
  secret: string
}

export interface RemovalSummary {
  google: boolean
  phone: boolean
  /** Messages this person approved that are still queued, or waiting for their phone. */
  queued: number
}

/** The link a person opens. The secret is in the fragment, so it reaches no server log and no Referer. */
export const joinLink = (origin: string, secret: string) => `${origin}/join#${secret}`

/**
 * An address with most of it hidden: the first character and the domain.
 * "jordan@example.com" becomes "j•••@example.com".
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return '•••'
  return `${email[0]}•••${email.slice(at)}`
}

/** The sentence under a removal confirmation: only what will really happen. */
export function removalWords(summary: RemovalSummary): string {
  const parts = [
    summary.google ? 'their Google connection is disconnected' : '',
    summary.phone ? 'their phone is revoked' : '',
    summary.queued > 0 ? `${summary.queued} queued ${summary.queued === 1 ? 'message is' : 'messages are'} cancelled` : '',
  ].filter(Boolean)
  if (parts.length === 0) return 'They have no Google connection, no phone and no queued messages.'
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
  return `${list[0].toUpperCase()}${list.slice(1)}.`
}

// ── Student sign-ins ────────────────────────────────────────────────────────
// Students are mostly minors. These are the rules the screens and the server
// share. None of it is a legal review.

/** The school year turns over on this month (1 = January): July 1. */
export const SCHOOL_YEAR_STARTS_MONTH = 7

/** A student below this grade cannot be given a sign-in. They use the student link. */
export const MIN_SIGNIN_GRADE = 9

/**
 * The grade a student with this graduation year is in on `today` (an ISO date).
 * A student who graduates in the calendar year the current school year ends in
 * is in 12th grade. The database has the same rule (student_grade).
 */
export function gradeFor(gradYear: number, today: string): number {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const schoolYearEnds = month >= SCHOOL_YEAR_STARTS_MONTH ? year + 1 : year
  return 12 - (gradYear - schoolYearEnds)
}

/** True when a student may be invited to make a sign-in: 9th grade or above. */
export const maySignIn = (gradYear: number, today: string) => gradeFor(gradYear, today) >= MIN_SIGNIN_GRADE

/**
 * The sentence a member ticks before a student invitation is made. The version
 * is stored with the tick; change it whenever the words change.
 */
export const GUARDIAN_CONSENT = {
  version: 'guardian-2026-11-27',
  text: (firstName: string) => `A parent or guardian of ${firstName} knows about this account and agrees to it.`,
} as const

/** The sentence a student ticks on the join screen. Stored the same way. */
export const STUDENT_AGE = {
  version: 'age-2026-11-27',
  text: 'I am 13 or older',
} as const

/** What a student's counselors can see. Shown on the join screen and on the student's Account page. */
export const COUNSELORS_CAN_SEE = [
  'Which tasks you have marked done, and when',
  'The notes you leave on a task',
  'The links and files you add',
  'That you have a sign-in, and the email address it uses',
] as const

/** What a student's page shows. The same list the student link has always had. */
export const STUDENT_SEES = ['Your tasks and their due dates', 'Your next meeting and your application deadlines', 'The latest meeting recap your counselor approved', 'Essay feedback your counselor approved'] as const
