// Google settings, and the one function every request to Google goes through.
//
// Three values make Google available: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// and GOOGLE_TOKEN_KEY. Without all three every Google feature is hidden.
//
// GOOGLE_FAKE=1 swaps Google for a small invented Drive (fakeDrive.ts), for
// local work only. It is refused anywhere but `npm run dev`.
//
// Nothing here logs a URL, a header or a body: they carry tokens and file names.

import { randomBytes } from 'node:crypto'
import { fakeGoogle } from './fakeDrive.js'

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const DRIVE_API = 'https://www.googleapis.com/drive/v3'
export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

const env = (name: string) => (process.env[name] ?? '').trim()

export const clientId = () => env('GOOGLE_CLIENT_ID') || (fakeMode() ? 'fake-client-id' : '')
export const clientSecret = () => env('GOOGLE_CLIENT_SECRET') || (fakeMode() ? 'fake-client-secret' : '')
/** In fake mode with no real key: a key made when the dev server starts and known to nobody, so a state cannot be forged from outside. */
const fakeKey = randomBytes(32).toString('hex')

/** The key refresh tokens are encrypted with, and state is signed with. */
export const tokenKey = () => env('GOOGLE_TOKEN_KEY') || (fakeMode() ? fakeKey : '')

/**
 * True when the invented Drive stands in for Google. Throws when GOOGLE_FAKE=1
 * is set anywhere it must not be: on Vercel, in a production build, or outside
 * the dev server. A deployment with that setting answers nothing.
 */
export function fakeMode(): boolean {
  if (env('GOOGLE_FAKE') !== '1') return false
  if (process.env.VERCEL || process.env.NODE_ENV === 'production' || process.env.PLATINUM_DEV_SERVER !== '1') {
    throw new Error('GOOGLE_FAKE=1 is only for `npm run dev`. Remove it from this environment.')
  }
  return true
}

/** Whether Google features exist at all on this server. */
export const googleConfigured = () => fakeMode() || Boolean(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET') && env('GOOGLE_TOKEN_KEY'))

/** Optional cap on files per sync call, for trying an interrupted sync by hand. Empty means time alone decides. */
export const syncBatchLimit = () => {
  const n = Number.parseInt(env('GOOGLE_SYNC_BATCH'), 10)
  return Number.isInteger(n) && n > 0 ? n : Infinity
}

/**
 * The address Google sends the person back to. It must be one registered in
 * Google Cloud: GOOGLE_REDIRECT_URI when set, otherwise /api/google on the
 * address this request came to.
 */
export function redirectUri(request: Request): string {
  return env('GOOGLE_REDIRECT_URI') || new URL('/api/google', request.url).toString()
}

/**
 * Every request to Google. Tests replace `fetch` to answer without the network;
 * fake mode answers from the invented Drive.
 */
export const google = {
  fetch(url: string, init?: RequestInit): Promise<Response> {
    if (fakeMode()) return fakeGoogle(url, init)
    return fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) })
  },
}
