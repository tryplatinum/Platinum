// Talks to /api/account: invitations, the firm's members and student sign-ins.
// Screens call the functions here; none of them build a request themselves.
// The firm and the person are never sent: the server takes them from the
// session's access token.

import { ACCOUNT_ENDPOINT, type AccountErrorCode, type AccountRequest, type FirmOverview, type InvitationKind, type InvitationPreview, type NewInvitation, type RemovalSummary, type StudentSignIn } from '../../shared/account'
import { supabase } from '../lib/supabase'

/** A refusal from /api/account. Screens choose their words from `code`. */
export class AccountFailure extends Error {
  code: AccountErrorCode
  constructor(code: AccountErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

type Reply<T> = { ok: true; data: T } | { ok: false; code: AccountErrorCode; message: string }

async function call<T>(body: AccountRequest, signedIn = true): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' }
  if (signedIn) {
    const { data } = await supabase.auth.getSession()
    if (!data.session) throw new AccountFailure('unauthorized', 'Sign in again.')
    headers.authorization = `Bearer ${data.session.access_token}`
  }
  let res: Response
  try {
    res = await fetch(ACCOUNT_ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
  } catch {
    throw new AccountFailure('server', 'There is no connection right now. Try again in a moment.')
  }
  if (!res.headers.get('content-type')?.includes('application/json')) throw new AccountFailure('server', 'This is not available right now.')
  const reply = (await res.json()) as Reply<T>
  if (!reply.ok) throw new AccountFailure(reply.code, reply.message)
  return reply.data
}

/** What an invitation is for. Needs no sign-in. Throws `dead_invitation` for any link that does not work. */
export const previewInvitation = (secret: string) => call<InvitationPreview>({ action: 'preview', secret }, false)

export const acceptInvitation = (secret: string, input: { displayName?: string; ageConfirmed?: true }) => call<{ kind: InvitationKind }>({ action: 'accept', secret, ...input })

export const loadFirm = () => call<FirmOverview>({ action: 'firm' })
export const inviteCounselor = (email: string) => call<NewInvitation>({ action: 'invite_counselor', email })
export const newInvitationLink = (invitationId: string) => call<NewInvitation>({ action: 'new_link', invitationId })
export const revokeInvitation = (invitationId: string) => call<null>({ action: 'revoke_invitation', invitationId })
export const setMemberRole = (userId: string, role: 'owner' | 'counselor') => call<null>({ action: 'set_role', userId, role })
export const removalSummary = (userId: string) => call<RemovalSummary>({ action: 'removal_summary', userId })
export const removeMember = (userId: string) => call<{ google: boolean; phone: boolean; cancelled: number }>({ action: 'remove_member', userId })
export const leaveFirm = () => call<null>({ action: 'leave' })

export const inviteStudent = (studentId: string, email: string) => call<NewInvitation>({ action: 'invite_student', studentId, email, guardianKnows: true })
export const studentSignIn = (studentId: string) => call<StudentSignIn>({ action: 'student_signin', studentId })
export const setStudentSignIn = (studentId: string, on: boolean) => call<StudentSignIn>({ action: 'set_student_signin', studentId, on })

/** A student deletes their own sign-in. The firm's record of them stays. */
export const deleteMySignIn = () => call<null>({ action: 'delete_my_signin' })
