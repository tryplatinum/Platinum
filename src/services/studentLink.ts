// Talks to /api/student for a student who opened their secret link. There is
// no login on this path: the token in the link is the only credential, and the
// server decides what it may read and change.

import { STUDENT_ENDPOINT, STUDENT_TOKEN_HEADER } from '../../shared/constants'
import type { StudentWrite } from '../../shared/student'
import type { AppData } from '../types'

export type { StudentWrite }

type Reply = { ok: true; data: AppData } | { ok: false; message: string }

async function call(token: string, write?: StudentWrite): Promise<AppData> {
  let res: Response
  try {
    res = await fetch(STUDENT_ENDPOINT, {
      method: write ? 'POST' : 'GET',
      headers: { accept: 'application/json', [STUDENT_TOKEN_HEADER]: token, ...(write ? { 'content-type': 'application/json' } : {}) },
      body: write ? JSON.stringify(write) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new Error('There is no connection right now. Try again in a moment.')
  }
  if (!res.headers.get('content-type')?.includes('application/json')) throw new Error('This page is not available right now.')
  const body = (await res.json()) as Reply
  if (!body.ok) throw new Error(body.message)
  return body.data
}

/** The student's page. Throws when the link is unknown or has been revoked. */
export const studentLinkLoad = (token: string) => call(token)

/** One of the three writes. Returns the page again, as the server now has it. */
export const studentLinkWrite = (token: string, write: StudentWrite) => call(token, write)
