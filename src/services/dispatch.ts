// Calls /api/dispatch after the undo window, and on app load. The server
// claims rows atomically, so a double trigger still sends each row once.

import { DISPATCH_ENDPOINT } from '../../shared/constants'
import { accessToken } from '../store/session'

async function post(token: string): Promise<Response> {
  return fetch(DISPATCH_ENDPOINT, {
    method: 'POST',
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  })
}

/** Ask the server to send this firm's due queued messages. Quiet on failure. */
export async function runDispatch(): Promise<void> {
  try {
    const token = await accessToken()
    if (!token) return
    let res = await post(token)
    if (res.status === 401) {
      const fresh = await accessToken(true)
      if (fresh) res = await post(fresh)
    }
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return
    // Refresh local outbox after a send so status/error show up.
    const body = (await res.json()) as { ok?: boolean; processed?: number }
    if (body.ok && (body.processed ?? 0) > 0) {
      const { useStore } = await import('../store/store')
      void useStore.getState().reload(true)
    }
  } catch {
    // Offline or misconfigured: the next app load retries.
  }
}
