// /api/account: invitations and the firm's members.
//
//   POST { action, ... }      (shared/account.ts has every shape)
//
// Three kinds of caller, told apart by the action:
//
//   * nobody ("preview"): someone holding an invitation link, before they sign
//     in. Rate limited by address. Unknown, expired, revoked and used
//     invitations all get the same 404.
//   * a signed-in person who is not a member of anything yet ("accept"):
//     Authorization: Bearer <Supabase access token>, verified with Supabase.
//   * a member of a firm (everything else), through identify(). The firm id and
//     the user id always come from there, never from the body. A student has
//     no membership, so identify() refuses them here as on every counselor route.
//
// This file is only the HTTP handler. What each action does is in
// server/account.ts, and the rules are in the database. Nothing here sends a
// message: an invitation is a link a person copies.

import { ACCOUNT_REQUEST, type AccountErrorCode, type AccountRequest } from '../shared/account.js'
import { AccountError, DEAD_INVITATION, acceptInvitation, firmOverview, inviteCounselor, leaveFirm, newLink, previewInvitation, removalSummary, removeMember, revokeInvitation, setRole } from '../server/account.js'
import { addressOf, rateLimited } from '../server/rateLimit.js'
import { authConfigured, identify, serviceConfigured, signedIn, type Caller } from '../server/supabase.js'

/** Previews per address per five minutes. Nobody is signed in, so this is the only brake on guessing. */
const MAX_PREVIEWS = 30
/** Every other request, per address and per person, per five minutes. */
const MAX_PER_ADDRESS = 240
const MAX_PER_USER = 120
const MAX_BODY_BYTES = 4_000

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const fail = (code: AccountErrorCode, message: string, status: number) => json({ ok: false, code, message }, status)
const tooMany = () => fail('rate_limited', 'Too many requests. Wait a few minutes and try again.', 429)

type Member = Extract<Caller, { ok: true }>
type Action<K extends AccountRequest['action']> = Extract<AccountRequest, { action: K }>

/** What a member of a firm may ask for. Who may do which is decided in server/account.ts and again in the database. */
const MEMBER: { [K in Exclude<AccountRequest['action'], 'preview' | 'accept'>]: (caller: Member, body: Action<K>) => Promise<unknown> } = {
  firm: (caller) => firmOverview(caller),
  invite_counselor: (caller, body) => inviteCounselor(caller, body.email),
  new_link: (caller, body) => newLink(caller, body.invitationId),
  revoke_invitation: (caller, body) => revokeInvitation(caller, body.invitationId),
  set_role: (caller, body) => setRole(caller, body.userId, body.role),
  removal_summary: (caller, body) => removalSummary(caller, body.userId),
  remove_member: (caller, body) => removeMember(caller, body.userId),
  leave: (caller) => leaveFirm(caller),
}

async function respond(request: Request): Promise<Response> {
  // Fail closed: if sign-ins cannot be checked, or invitations cannot be looked up, the endpoint does nothing.
  if (!authConfigured() || !serviceConfigured()) return fail('not_configured', 'Accounts are not set up on this server.', 503)
  const address = addressOf(request)

  const raw = await request.text()
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return fail('invalid', 'That request is too large.', 413)
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return fail('invalid', 'The request was not valid.', 400)
  }
  const parsed = ACCOUNT_REQUEST.safeParse(value)

  if ((value as { action?: unknown } | null)?.action === 'preview') {
    if (rateLimited(`account-preview:${address}`, MAX_PREVIEWS)) return tooMany()
    // A secret of the wrong shape cannot be an invitation. It gets the answer a dead one gets.
    if (!parsed.success || parsed.data.action !== 'preview') return fail('dead_invitation', DEAD_INVITATION, 404)
    return json({ ok: true, data: await previewInvitation(parsed.data.secret) })
  }

  if (rateLimited(`account:${address}`, MAX_PER_ADDRESS)) return tooMany()
  if (!parsed.success) return fail('invalid', 'The request was not valid.', 400)
  const body = parsed.data

  if (body.action === 'accept') {
    const person = await signedIn(request)
    if (!person.ok) return fail('unauthorized', 'Sign in first.', 401)
    if (rateLimited(`account:${person.userId}`, MAX_PER_USER)) return tooMany()
    return json({ ok: true, data: await acceptInvitation(person, body) })
  }
  if (body.action === 'preview') return fail('invalid', 'The request was not valid.', 400)

  const caller = await identify(request)
  if (!caller.ok) return caller.reason === 'no_firm' ? fail('no_firm', 'This account does not belong to a firm.', 403) : fail('unauthorized', 'Sign in again.', 401)
  if (rateLimited(`account:${caller.userId}`, MAX_PER_USER)) return tooMany()
  const run = MEMBER[body.action] as (caller: Member, body: AccountRequest) => Promise<unknown>
  return json({ ok: true, data: (await run(caller, body)) ?? null })
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await respond(request)
  } catch (error) {
    if (error instanceof AccountError) return fail(error.code, error.message, error.status)
    // The real error stays on the server. It never names an invitation's secret or its hash.
    console.error('[account]', error instanceof Error ? error.message : 'unknown')
    return fail('server', 'Something went wrong. Try again.', 500)
  }
}
