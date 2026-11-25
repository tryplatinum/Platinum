// The browser side of Google: talks to /api/google as the signed-in person,
// and keeps the connection's status so every screen agrees on whether Google
// features are shown. No token is ever here: the server keeps them.

import { useSyncExternalStore } from 'react'
import { GOOGLE_ENDPOINT, type GoogleStatus } from '../../shared/google'
import { accessToken } from '../store/session'
import { useStore } from '../store/store'

/** A failure with a message fit to show. `code` is 'reconnect' when Google has ended the connection. */
export class GoogleFailure extends Error {
  code: string
  status: number
  constructor(message: string, code = 'failed', status = 0) {
    super(message)
    this.code = code
    this.status = status
  }
}

type Reply<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

async function post(token: string, body: string, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(GOOGLE_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new GoogleFailure('The server took too long to answer. Please try again.')
    throw new GoogleFailure('There is no connection to the server.')
  }
}

/** One action of api/google.ts, as the signed-in person. */
export async function callGoogle<T>(action: string, body: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
  const token = await accessToken()
  if (!token) throw new GoogleFailure('Sign in again to use Google Drive.', 'unauthorized', 401)
  const payload = JSON.stringify({ action, ...body })
  let res = await post(token, payload, timeoutMs)
  if (res.status === 401) {
    const fresh = await accessToken(true)
    if (fresh) res = await post(fresh, payload, timeoutMs)
  }
  if (!res.headers.get('content-type')?.includes('application/json')) throw new GoogleFailure('Google Drive is not available on this deployment.', 'not_available', 404)
  const reply = (await res.json()) as Reply<T>
  if (!reply.ok) {
    // Google ended the connection: every screen switches to "Reconnect Google".
    if (reply.code === 'reconnect' && status?.connected && !status.reconnect) setStatus({ ...status, reconnect: true })
    throw new GoogleFailure(reply.message, reply.code, res.status)
  }
  return reply.data
}

// ── Status ──────────────────────────────────────────────────────────────────

const HIDDEN: GoogleStatus = { available: false, connected: false, drive: false, driveReconnect: false, gmail: false, reconnect: false }

let status: GoogleStatus | undefined
let loading: Promise<void> | undefined
const listeners = new Set<() => void>()

function setStatus(next: GoogleStatus): void {
  status = next
  for (const listener of listeners) listener()
}

/** Asks the server. A server with no Google settings, or no server functions, hides every Google feature. */
export function loadGoogleStatus(force = false): Promise<void> {
  if (loading && !force) return loading
  loading = callGoogle<GoogleStatus>('status').then(setStatus, () => setStatus(HIDDEN))
  return loading
}

export const takeGoogleStatus = setStatus

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Whose status is held. Another person signing in on this tab starts again from nothing. */
let heldFor: string | undefined

/** The connection as last heard. Undefined until the server has answered once; asks on first use. */
export function useGoogleStatus(): GoogleStatus | undefined {
  const me = useStore((s) => (s.account.status === 'ready' ? s.account.userId : undefined))
  if (me !== heldFor) {
    heldFor = me
    status = undefined
    loading = undefined
  }
  const value = useSyncExternalStore(subscribe, () => status)
  if (me && !loading) void loadGoogleStatus()
  return value
}

/** True when Drive can be used right now: connected, allowed, and not waiting for a reconnect. */
export const driveReady = (s: GoogleStatus | undefined) => Boolean(s?.available && s.connected && s.drive && !s.reconnect)

/** Sends the person to Google's consent screen. They come back to /app?google=…. */
export async function startGoogleConnect(options: { gmail?: boolean } = {}): Promise<void> {
  const { url } = await callGoogle<{ url: string }>('connect', options)
  window.location.assign(url)
}
