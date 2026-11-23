// A simple rate limit, in memory, per server instance. Serverless instances do
// not share memory and are recycled often, so this slows abuse down; it does
// not stop a determined caller. Replace with a shared store (a database table
// or Redis) before relying on it.

const WINDOW_MS = 5 * 60_000
const hits = new Map<string, number[]>()

/** True when `key` has already made `max` requests in the last five minutes. Counts this request otherwise. */
export function rateLimited(key: string, max: number): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (recent.length >= max) {
    hits.set(key, recent)
    return true
  }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > 5_000) hits.clear()
  return false
}

export const addressOf = (request: Request) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
