// A counselor's Google connection: connect, status, disconnect, and a fresh
// access token whenever a feature needs one.
//
// The row lives in google_connections, which only the service role can touch.
// Every read and write here is filtered by the user id of a caller that
// api/google.ts has already verified, so one person can never reach another's
// connection. The refresh token is stored encrypted and is decrypted only in
// memory, to ask Google for an access token. Neither token is ever returned,
// logged or put in an error message.

import { DRIVE_SCOPE, GMAIL_SEND_SCOPE, aboutReply, tokenFailure, tokenReply, type GoogleStatus } from '../../shared/google.js'
import { serviceClient, serviceConfigured, type Caller } from '../supabase.js'
import { AUTH_URL, DRIVE_API, REVOKE_URL, TOKEN_URL, clientId, clientSecret, fakeMode, google, googleConfigured, redirectUri, tokenKey } from './config.js'
import { STATE_SECONDS, decryptToken, encryptToken, newNonce, signState, verifyState } from './secrets.js'

type SignedIn = Extract<Caller, { ok: true }>

/** Something to tell the person. The message is safe to show; `code` lets the screen offer "Reconnect Google". */
export class GoogleError extends Error {
  code: 'not_available' | 'not_connected' | 'reconnect' | 'google' | 'refused'
  status: number
  constructor(code: GoogleError['code'], message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export const RECONNECT_MESSAGE = 'Google has ended this connection. Reconnect Google in Firm settings.'

/** Google features need the three Google settings and the service role (the only role that can read a connection). */
export const googleAvailable = () => googleConfigured() && serviceConfigured()

function requireAvailable(): void {
  if (!googleAvailable()) throw new GoogleError('not_available', 'Google is not set up on this server.', 503)
}

const connections = () => serviceClient().from('google_connections')

async function rowOf(userId: string) {
  const { data, error } = await connections().select('*').eq('user_id', userId).maybeSingle()
  if (error) throw new Error(`reading the Google connection failed: ${error.message}`)
  return data
}

// ── Status ──────────────────────────────────────────────────────────────────

export async function connectionStatus(caller: SignedIn): Promise<GoogleStatus> {
  if (!googleAvailable()) return { available: false, connected: false, drive: false, gmail: false, reconnect: false }
  const row = await rowOf(caller.userId)
  // A connection made while in another firm is not this firm's.
  if (!row || row.firm_id !== caller.firmId) return { available: true, connected: false, drive: false, gmail: false, reconnect: false }
  return {
    available: true,
    connected: true,
    address: row.google_address,
    drive: row.scopes.includes(DRIVE_SCOPE),
    gmail: row.scopes.includes(GMAIL_SEND_SCOPE),
    reconnect: row.last_error === 'reconnect',
  }
}

// ── Connect ─────────────────────────────────────────────────────────────────

export const STATE_COOKIE = 'google_state'

const cookie = (request: Request, value: string, maxAge: number) =>
  `${STATE_COOKIE}=${value}; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return undefined
}

/**
 * The address of Google's consent screen for this person, and the cookie that
 * ties the answer to this browser. Offline access with prompt=consent, so
 * Google always returns a refresh token. Asking for Gmail keeps the Drive
 * permission already given (incremental authorization).
 */
export function startConnect(caller: SignedIn, request: Request, options: { gmail?: boolean }): { url: string; setCookie: string } {
  requireAvailable()
  const nonce = newNonce()
  const state = signState({ userId: caller.userId, firmId: caller.firmId, gmail: Boolean(options.gmail) }, nonce, tokenKey())
  const back = redirectUri(request)
  let url: string
  if (fakeMode()) {
    // No Google: straight back to our own callback, as if consent had been given.
    url = `${back}?${new URLSearchParams({ code: options.gmail ? 'fake-code-gmail' : 'fake-code', state })}`
  } else {
    url = `${AUTH_URL}?${new URLSearchParams({
      client_id: clientId(),
      redirect_uri: back,
      response_type: 'code',
      scope: options.gmail ? `${DRIVE_SCOPE} ${GMAIL_SEND_SCOPE}` : DRIVE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    })}`
  }
  return { url, setCookie: cookie(request, nonce, STATE_SECONDS) }
}

export type ConnectOutcome = 'connected' | 'gmail_on' | 'declined' | 'unchanged' | 'failed'

/**
 * Google sends the person back here. There is no signed-in request at this
 * point (it is a plain page load), so who it is comes from `state` alone:
 * signed by us, ten minutes old at most, and matching the cookie this browser
 * was given when it started. Anything else is refused before Google is asked
 * anything. Returns where to send the person, never an error with details.
 */
export async function finishConnect(request: Request): Promise<{ outcome: ConnectOutcome; clearCookie: string }> {
  const clearCookie = cookie(request, '', 0)
  const done = (outcome: ConnectOutcome) => ({ outcome, clearCookie })
  if (!googleAvailable()) return done('failed')
  const params = new URL(request.url).searchParams
  const claims = verifyState(params.get('state'), readCookie(request, STATE_COOKIE), tokenKey())
  if (!claims) return done('failed')
  // The person pressed Cancel at Google, or Google refused.
  if (params.get('error')) return done(params.get('error') === 'access_denied' ? 'declined' : 'failed')
  const code = params.get('code')
  if (!code || code.length > 2000) return done('failed')

  // Still a member of the firm the state names?
  const member = await serviceClient().from('firm_members').select('user_id').eq('user_id', claims.userId).eq('firm_id', claims.firmId).maybeSingle()
  if (member.error || !member.data) return done('failed')

  const exchanged = await google.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId(), client_secret: clientSecret(), redirect_uri: redirectUri(request), grant_type: 'authorization_code' }),
  })
  if (!exchanged.ok) return done('failed')
  const tokens = tokenReply.safeParse(await exchanged.json().catch(() => undefined))
  if (!tokens.success) return done('failed')
  const scopes = (tokens.data.scope ?? '').split(/\s+/).filter((s) => s === DRIVE_SCOPE || s === GMAIL_SEND_SCOPE)

  const existing = await rowOf(claims.userId)
  // Drive was unticked on Google's screen. An existing connection is left exactly as it was.
  if (!scopes.includes(DRIVE_SCOPE) || !tokens.data.refresh_token) return done(existing ? 'unchanged' : 'failed')

  const about = await google.fetch(`${DRIVE_API}/about?fields=${encodeURIComponent('user(emailAddress)')}`, { headers: { authorization: `Bearer ${tokens.data.access_token}` } })
  const who = about.ok ? aboutReply.safeParse(await about.json().catch(() => undefined)) : undefined
  if (!who?.success) return done('failed')

  const { error } = await connections().upsert({
    user_id: claims.userId,
    firm_id: claims.firmId,
    google_address: who.data.user.emailAddress,
    scopes,
    refresh_token_encrypted: encryptToken(tokens.data.refresh_token, claims.userId, tokenKey()),
    connected_at: new Date().toISOString(),
    last_error: null,
  })
  if (error) {
    console.error('[google] the connection was not saved:', error.message)
    return done('failed')
  }
  cached.delete(claims.userId)
  // Folders this person linked can sync again.
  await serviceClient().from('student_drive_folders').update({ status: 'idle', last_error: null }).eq('linked_by', claims.userId).eq('status', 'reconnect')
  if (claims.gmail) return done(scopes.includes(GMAIL_SEND_SCOPE) ? 'gmail_on' : 'unchanged')
  return done('connected')
}

// ── Disconnect ──────────────────────────────────────────────────────────────

/** Revokes the grant at Google, then deletes the row. The row goes even when Google cannot be reached. */
export async function disconnect(caller: SignedIn): Promise<GoogleStatus> {
  requireAvailable()
  const row = await rowOf(caller.userId)
  if (row) {
    try {
      const refresh = decryptToken(row.refresh_token_encrypted, caller.userId, tokenKey())
      await google.fetch(REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refresh }) })
    } catch {
      // Already revoked, unreadable, or Google is unreachable: our copy is deleted all the same.
    }
    const { error } = await connections().delete().eq('user_id', caller.userId)
    if (error) throw new Error(`deleting the Google connection failed: ${error.message}`)
    cached.delete(caller.userId)
  }
  return { available: true, connected: false, drive: false, gmail: false, reconnect: false }
}

// ── Access tokens ───────────────────────────────────────────────────────────

/** Access tokens, in this instance's memory only, until a minute before they expire. */
const cached = new Map<string, { token: string; until: number; scopes: string[] }>()

/** For tests. */
export const forgetAccessTokens = () => cached.clear()

/**
 * A fresh access token for one user, for one scope. When Google says the grant
 * is expired or revoked (every 7 days while the Google project is in testing),
 * that is recorded on the row and a GoogleError with code 'reconnect' is thrown:
 * every feature then shows "Reconnect Google" instead of failing.
 */
export async function accessTokenFor(userId: string, scope: string = DRIVE_SCOPE): Promise<string> {
  requireAvailable()
  const hit = cached.get(userId)
  if (hit && hit.until > Date.now() && hit.scopes.includes(scope)) return hit.token

  const row = await rowOf(userId)
  if (!row) throw new GoogleError('not_connected', 'Connect Google in Firm settings first.', 409)
  if (row.last_error === 'reconnect') throw new GoogleError('reconnect', RECONNECT_MESSAGE, 409)
  if (!row.scopes.includes(scope)) throw new GoogleError('reconnect', scope === GMAIL_SEND_SCOPE ? 'Sending from Gmail is not turned on for this Google account.' : RECONNECT_MESSAGE, 409)

  let refresh: string
  try {
    refresh = decryptToken(row.refresh_token_encrypted, userId, tokenKey())
  } catch {
    // The key changed, or the row was tampered with. Either way the stored token is of no use.
    await connections().update({ last_error: 'reconnect' }).eq('user_id', userId)
    throw new GoogleError('reconnect', RECONNECT_MESSAGE, 409)
  }

  let res: Response
  try {
    res = await google.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), refresh_token: refresh, grant_type: 'refresh_token' }),
    })
  } catch {
    throw new GoogleError('google', 'Google could not be reached. Try again in a moment.', 502)
  }
  const body: unknown = await res.json().catch(() => undefined)
  if (!res.ok) {
    const failure = tokenFailure.safeParse(body)
    if (failure.success && failure.data.error === 'invalid_grant') {
      await connections().update({ last_error: 'reconnect' }).eq('user_id', userId)
      throw new GoogleError('reconnect', RECONNECT_MESSAGE, 409)
    }
    throw new GoogleError('google', 'Google could not be reached. Try again in a moment.', 502)
  }
  const tokens = tokenReply.safeParse(body)
  if (!tokens.success) throw new GoogleError('google', 'Google gave an answer that could not be read. Try again in a moment.', 502)
  cached.set(userId, { token: tokens.data.access_token, until: Date.now() + (tokens.data.expires_in - 60) * 1000, scopes: row.scopes })
  return tokens.data.access_token
}

/** Google refused a token it gave us a moment ago (revoked in between): the next call asks again. */
export function dropAccessToken(userId: string): void {
  cached.delete(userId)
}
