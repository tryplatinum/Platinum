// The browser side of the college directory. Screens look colleges up through
// here; it calls /api/colleges with the signed-in person's access token, the
// same way services/aiClient.ts calls /api/ai. Nothing here touches a table.
//
// The directory is not part of the store: it is public reference data, the
// same for every firm. What has been looked up is remembered here for as long
// as the page is open, so a student's list shows its figures at once the second
// time. Figures are never copied onto a student's list rows.

import { useEffect, useSyncExternalStore } from 'react'
import { COLLEGES_ENDPOINT, type CollegeSearchFilters, type CollegeSearchResult, type CollegeSummary } from '../../shared/colleges'
import { accessToken } from '../store/session'
import type { ID } from '../types'

const TIMEOUT_MS = 20_000

/** The directory could not be asked. Screens show `message`. */
export class DirectoryFailure extends Error {}

const NO_ENDPOINT = 'The college directory is not available here.'

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const token = await accessToken()
  if (!token) throw new DirectoryFailure('Sign in again to look up colleges.')
  const post = (bearer: string) =>
    fetch(COLLEGES_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  let res: Response
  try {
    res = await post(token)
    // The token may have expired since the page loaded: get a fresh one and try once more.
    if (res.status === 401) {
      const fresh = await accessToken(true)
      if (fresh) res = await post(fresh)
    }
  } catch {
    throw new DirectoryFailure('The college directory could not be reached. Check your connection and try again.')
  }
  // A static host answers with the app's HTML (or a 404): there is no endpoint.
  if (!res.headers.get('content-type')?.includes('application/json')) throw new DirectoryFailure(NO_ENDPOINT)
  const answer = (await res.json()) as { ok: true; data: T } | { ok: false; message: string }
  if (!answer.ok) throw new DirectoryFailure(answer.message)
  return answer.data
}

// ── What has been looked up ─────────────────────────────────────────────────

/** By UNITID. null means the directory has no such row. */
const known = new Map<number, CollegeSummary | null>()
const asking = new Set<number>()
/** By lower-cased name: the closest directory match, or null when there is none. */
const matches = new Map<string, CollegeSummary | null>()
const matching = new Set<string>()
let problem: string | undefined
let version = 0
const listeners = new Set<() => void>()

function changed(): void {
  version++
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const useVersion = () => useSyncExternalStore(subscribe, () => version)

function remember(colleges: CollegeSummary[]): void {
  for (const college of colleges) known.set(college.unitid, college)
}

/** Type-ahead and filtered search. Throws DirectoryFailure. */
export async function searchDirectory(filters: CollegeSearchFilters): Promise<CollegeSearchResult> {
  const result = await call<CollegeSearchResult>({ action: 'search', filters })
  remember(result.colleges)
  problem = undefined
  return result
}

async function load(unitids: number[]): Promise<void> {
  for (const id of unitids) asking.add(id)
  try {
    for (let i = 0; i < unitids.length; i += 100) {
      const batch = unitids.slice(i, i + 100)
      const found = await call<CollegeSearchResult>({ action: 'search', filters: { unitids: batch, limit: 100 } })
      remember(found.colleges)
      for (const id of batch) if (!known.has(id)) known.set(id, null)
    }
    problem = undefined
  } catch (error) {
    problem = error instanceof DirectoryFailure ? error.message : 'The college directory could not be read.'
  } finally {
    for (const id of unitids) asking.delete(id)
    changed()
  }
}

export interface DirectoryFigures {
  /** The directory row, once it has arrived. */
  college: (unitid: number) => CollegeSummary | undefined
  /** True when the directory answered and has no such row. */
  missing: (unitid: number) => boolean
  loading: boolean
  /** Why figures could not be fetched, when they could not. */
  error?: string
}

/** The directory rows for these UNITIDs, fetched once and then remembered. */
export function useDirectoryColleges(unitids: number[]): DirectoryFigures {
  useVersion()
  const wanted = [...new Set(unitids)].sort((a, b) => a - b)
  const key = wanted.join(',')
  useEffect(() => {
    const need = wanted.filter((id) => !known.has(id) && !asking.has(id))
    if (need.length) void load(need)
    // `key` stands for `wanted`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return {
    college: (unitid) => known.get(unitid) ?? undefined,
    missing: (unitid) => known.get(unitid) === null,
    loading: wanted.some((id) => asking.has(id)),
    error: wanted.some((id) => !known.has(id)) ? problem : undefined,
  }
}

async function match(name: string): Promise<void> {
  const key = name.trim().toLowerCase()
  matching.add(key)
  try {
    const found = await call<CollegeSearchResult>({ action: 'search', filters: { name, limit: 1 } })
    remember(found.colleges)
    matches.set(key, found.colleges[0] ?? null)
  } catch {
    // No suggestion this time. The counselor can still search by hand.
  } finally {
    matching.delete(key)
    changed()
  }
}

/**
 * The closest directory match for each of these names, to offer as a
 * suggestion. It is only ever a suggestion: the counselor confirms each link.
 */
export function useSuggestedMatches(names: string[]): (name: string) => CollegeSummary | undefined {
  useVersion()
  const wanted = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
  const key = wanted.join('\n').toLowerCase()
  useEffect(() => {
    for (const name of wanted) {
      const k = name.toLowerCase()
      if (!matches.has(k) && !matching.has(k)) void match(name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return (name) => matches.get(name.trim().toLowerCase()) ?? undefined
}

// ── Suggestions the counselor turned down ───────────────────────────────────
// Kept in this browser only, as "list row : UNITID", so the same suggestion is
// not offered again on every visit. It is a convenience, not data.

const DISMISSED_KEY = 'platinum.collegeMatchesDismissed'
const MAX_DISMISSED = 500

function readDismissed(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as unknown
    return Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
let dismissed = new Set(readDismissed())

export const matchDismissed = (collegeId: ID, unitid: number) => dismissed.has(`${collegeId}:${unitid}`)

export function dismissMatch(collegeId: ID, unitid: number): void {
  dismissed = new Set([...dismissed, `${collegeId}:${unitid}`].slice(-MAX_DISMISSED))
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]))
  } catch {
    // Private browsing or a full disk: it is remembered until the page closes.
  }
  changed()
}
