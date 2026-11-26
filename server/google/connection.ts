// A counselor's Google connection: connect, status, disconnect, and a fresh
// access token whenever a feature needs one.
//
// The row lives in google_connections, which only the service role can touch.
// Every read and write here is filtered by the user id of a caller that
// api/google.ts has already verified, so one person can never reach another's
// connection. The refresh token is stored encrypted and is decrypted only in
// memory, to ask Google for an access token. Neither token is ever returned,
// logged or put in an error message.

import { CALENDAR_SCOPE } from '../../shared/calendar.js'
import { DRIVE_SCOPE, GMAIL_SEND_SCOPE, aboutReply, tokenFailure, tokenReply, type GoogleStatus } from '../../shared/google.js'
import { serviceClient, serviceConfigured, type Caller } from '../supabase.js'
import { AUTH_URL, DRIVE_API, REVOKE_URL, TOKEN_URL, clientId, clientSecret, fakeMode, google, googleConfigured, redirectUri, tokenKey } from './config.js'
import { FAKE_ADDRESS } from './fakeDrive.js'
import { STATE_SECONDS, decryptToken, encryptToken, newNonce, signState, verifyState } from './secrets.js'

type SignedIn = Extract<Caller, { ok: true }>

/** Whose Google connection, and for which firm. A connection is only ever used for the firm it was made in. */
export interface Who {
  userId: string
  firmId: string
}

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

export const RECONNECT_MESSAGE = 'Google has ended this connection. Reconnect Google in Settings.'
export const DRIVE_RECONNECT_MESSAGE = 'Reconnect Google Drive'

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
  if (!googleAvailable()) return { available: false, connected: false, drive: false, driveReconnect: false, gmail: false, calendar: false, reconnect: false }
  const row = await rowOf(caller.userId)
  // A connection made while in another firm is not this firm's.
  if (!row || row.firm_id !== caller.firmId) return { available: true, connected: false, drive: false, driveReconnect: false, gmail: false, calendar: false, reconnect: false }
  const drive = row.scopes.includes(DRIVE_SCOPE)
  return {
    available: true,
    connected: true,
    address: row.google_address,
    drive,
    // An older grant could read every file. It is not used for Drive.
    driveReconnect: !drive,
    gmail: row.scopes.includes(GMAIL_SEND_SCOPE),
    calendar: row.scopes.includes(CALENDAR_SCOPE),
    reconnect: row.last_error === 'reconnect',
  }
}

// ── Connect ─────────────────────────────────────────────────────────────────

export const STATE_COOKIE = 'google_state'

const cookie = (request: Request, value: string, maxAge: number) =>
  `${STATE_COOKIE}=${value}; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' || process.env.VERCEL ? '; Secure' : ''}`

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
/**
 * `keep` is what this connection already has: a consent replaces the grant, so
 * what was on is asked for again and stays on. Each add-on is recorded only when
 * it was asked for this time or was already on (see finishConnect).
 */
export function startConnect(caller: SignedIn, request: Request, options: { gmail?: boolean; calendar?: boolean; keep?: readonly string[] }): { url: string; setCookie: string } {
  requireAvailable()
  const nonce = newNonce()
  const gmail = Boolean(options.gmail) || Boolean(options.keep?.includes(GMAIL_SEND_SCOPE))
  const calendar = Boolean(options.calendar) || Boolean(options.keep?.includes(CALENDAR_SCOPE))
  const state = signState({ userId: caller.userId, firmId: caller.firmId, gmail: Boolean(options.gmail), calendar: Boolean(options.calendar) }, nonce, tokenKey())
  const back = redirectUri(request)
  let url: string
  if (fakeMode()) {
    // No Google: straight back to our own callback, as if consent had been given.
    url = `${back}?${new URLSearchParams({ code: `fake-code${gmail ? '-gmail' : ''}${calendar ? '-calendar' : ''}`, state })}`
  } else {
    url = `${AUTH_URL}?${new URLSearchParams({
      client_id: clientId(),
      redirect_uri: back,
      response_type: 'code',
      // Drive first; Gmail and the calendar only when asked for, or already on. Never bundled into the first consent.
      scope: [DRIVE_SCOPE, gmail && GMAIL_SEND_SCOPE, calendar && CALENDAR_SCOPE].filter(Boolean).join(' '),
      access_type: 'offline',
      prompt: 'consent',
      // Do not keep an older Drive permission. Gmail is asked for on its own when it is wanted.
      include_granted_scopes: 'false',
      state,
    })}`
  }
  return { url, setCookie: cookie(request, nonce, STATE_SECONDS) }
}

export type ConnectOutcome = 'connected' | 'gmail_on' | 'calendar_on' | 'declined' | 'unchanged' | 'failed'

/**
 * Google sends the person back here. There is no signed-in request at this
 * point (it is a plain page load), so who it is comes from `state` alone:
 * signed by us, ten minutes old at most, and matching the cookie this browser
 * was given when it started. Anything else is refused before Google is asked
 * anything. Returns where to send the person, never an error with details.
 */
export const clearStateCookie = (request: Request) => cookie(request, '', 0)

export async function finishConnect(request: Request): Promise<{ outcome: ConnectOutcome; clearCookie: string }> {
  const clearCookie = clearStateCookie(request)
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
  const granted = (tokens.data.scope ?? '').split(/\s+/)
  const existing = await rowOf(claims.userId)
  // Sending from Gmail is recorded only when the person asked for it this time, or already had it on this
  // connection. Google can hand back a permission given long ago; that alone never turns sending on.
  const mayHaveGmail = claims.gmail || Boolean(existing && existing.firm_id === claims.firmId && existing.scopes.includes(GMAIL_SEND_SCOPE))
  // The same rule for the calendar: asked for this time, or already on.
  const mayHaveCalendar = claims.calendar === true || Boolean(existing && existing.firm_id === claims.firmId && existing.scopes.includes(CALENDAR_SCOPE))
  const scopes = [DRIVE_SCOPE, GMAIL_SEND_SCOPE, CALENDAR_SCOPE].filter((scope) => granted.includes(scope) && (scope !== GMAIL_SEND_SCOPE || mayHaveGmail) && (scope !== CALENDAR_SCOPE || mayHaveCalendar))
  // The invented Google never replaces a real connection (a dev server pointed at a shared database).
  if (fakeMode() && existing && existing.google_address !== FAKE_ADDRESS) return done('failed')
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
  await serviceClient().from('student_drive_folders').update({ status: 'idle', last_error: null }).eq('firm_id', claims.firmId).eq('linked_by', claims.userId).eq('status', 'reconnect')
  if (claims.calendar) return done(scopes.includes(CALENDAR_SCOPE) ? 'calendar_on' : 'unchanged')
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
  return { available: true, connected: false, drive: false, driveReconnect: false, gmail: false, calendar: false, reconnect: false }
}

/**
 * Turns the calendar off for this connection: Platinum stops reading and
 * writing it at once. The permission itself stays at Google until the whole
 * connection is disconnected, because Google has no way to give back one part.
 * Meetings are not touched.
 */
export async function calendarOff(caller: SignedIn): Promise<GoogleStatus> {
  requireAvailable()
  const row = await rowOf(caller.userId)
  if (row && row.firm_id === caller.firmId && row.scopes.includes(CALENDAR_SCOPE)) {
    const { error } = await connections().update({ scopes: row.scopes.filter((s) => s !== CALENDAR_SCOPE) }).eq('user_id', caller.userId)
    if (error) throw new Error(`turning the calendar off failed: ${error.message}`)
    cached.delete(caller.userId)
  }
  return connectionStatus(caller)
}

/** What this connection already has, so a new consent can ask for it again. */
export async function scopesOf(caller: SignedIn): Promise<string[]> {
  const row = await rowOf(caller.userId)
  return row && row.firm_id === caller.firmId ? row.scopes : []
}

// ── Access tokens ───────────────────────────────────────────────────────────

/** Access tokens, in this instance's memory only, until a minute before they expire. */
const cached = new Map<string, { token: string; until: number; scopes: string[]; connectedAt: string }>()

/** For tests. */
export const forgetAccessTokens = () => cached.clear()

/**
 * A fresh access token for one user in one firm, for one scope. When Google
 * says the grant is expired or revoked (every 7 days while the Google project
 * is in testing), that is recorded on the row and a GoogleError with code
 * 'reconnect' is thrown: every feature then shows "Reconnect Google" instead of
 * failing.
 *
 * The connection row is read every time, before the cache is trusted: a
 * connection that was disconnected, or that belongs to another firm, is never
 * used from memory. And a token is only ever asked of Google for someone who is
 * still a member of that firm.
 */
export async function accessTokenFor(who: Who, scope: string = DRIVE_SCOPE): Promise<string> {
  requireAvailable()
  const { userId } = who
  const row = await rowOf(userId)
  if (!row || row.firm_id !== who.firmId) {
    cached.delete(userId)
    throw new GoogleError('not_connected', 'Connect Google in Settings first.', 409)
  }
  if (row.last_error === 'reconnect') throw new GoogleError('reconnect', RECONNECT_MESSAGE, 409)
  if (!row.scopes.includes(scope)) {
    const message = scope === CALENDAR_SCOPE ? 'The calendar is not turned on for this Google account.' : scope === GMAIL_SEND_SCOPE ? 'Sending from Gmail is not turned on for this Google account.' : scope === DRIVE_SCOPE ? DRIVE_RECONNECT_MESSAGE : RECONNECT_MESSAGE
    throw new GoogleError('reconnect', message, 409)
  }

  const hit = cached.get(userId)
  if (hit && hit.until > Date.now() && hit.scopes.includes(scope) && hit.connectedAt === row.connected_at) return hit.token

  // Someone who has left the firm keeps no working connection in it.
  const member = await serviceClient().from('firm_members').select('user_id').eq('user_id', userId).eq('firm_id', who.firmId).maybeSingle()
  if (member.error) throw new Error(`reading the membership failed: ${member.error.message}`)
  if (!member.data) throw new GoogleError('not_connected', 'Connect Google in Settings first.', 409)

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
  cached.set(userId, { token: tokens.data.access_token, until: Date.now() + (tokens.data.expires_in - 60) * 1000, scopes: row.scopes, connectedAt: row.connected_at })
  return tokens.data.access_token
}

/** Google refused a token it gave us a moment ago (revoked in between): the next call asks again. */
export function dropAccessToken(userId: string): void {
  cached.delete(userId)
}
