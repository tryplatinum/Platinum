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
  /** Signed in. `displayName` is how a counselor will be named in the firm. */
  z.object({ action: z.literal('accept'), secret: INVITE_SECRET, displayName: NAME.optional() }),
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
])

export type AccountRequest = z.infer<typeof ACCOUNT_REQUEST>

/** Why a request was refused. The screens choose their words from this, not from the message. */
export type AccountErrorCode =
  | 'dead_invitation' // unknown, expired, revoked or used: one answer for all four
  | 'confirm_email'
  | 'wrong_email'
  | 'already_member'
  | 'pending_exists'
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

export interface FirmOverview {
  members: FirmMember[]
  invitations: PendingInvitation[]
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
