// Talks to /api/student for a student. Two ways in, one page behind both:
//
//   * a secret link: the token in the link is the only credential, or
//   * a student sign-in: the Supabase session's access token.
//
// Either way the server decides what may be read and changed, and it is the
// same for both.

import { STUDENT_ENDPOINT, STUDENT_TOKEN_HEADER } from '../../shared/constants'
import type { StudentErrorCode, StudentWrite } from '../../shared/student'
import { supabase } from '../lib/supabase'
import type { AppData } from '../types'

export type { StudentWrite }

type Reply = { ok: true; data: AppData } | { ok: false; message: string; code?: StudentErrorCode }

/** A refusal from /api/student. `code` is set only for a student sign-in, and says which screen to show. */
export class StudentPageError extends Error {
  code?: StudentErrorCode
  constructor(message: string, code?: StudentErrorCode) {
    super(message)
    this.code = code
  }
}

/**
 * What proves who the student is: the link's token when there is one,
 * otherwise the signed-in student's own session.
 */
export async function studentHeaders(linkToken?: string): Promise<Record<string, string>> {
  if (linkToken) return { [STUDENT_TOKEN_HEADER]: linkToken }
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new StudentPageError('Sign in again.', 'unauthorized')
  return { authorization: `Bearer ${data.session.access_token}` }
}

async function call(linkToken: string | undefined, write?: StudentWrite): Promise<AppData> {
  const who = await studentHeaders(linkToken)
  let res: Response
  try {
    res = await fetch(STUDENT_ENDPOINT, {
      method: write ? 'POST' : 'GET',
      headers: { accept: 'application/json', ...who, ...(write ? { 'content-type': 'application/json' } : {}) },
      body: write ? JSON.stringify(write) : undefined,
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new StudentPageError('There is no connection right now. Try again in a moment.')
  }
  if (!res.headers.get('content-type')?.includes('application/json')) throw new StudentPageError('This page is not available right now.')
  const body = (await res.json()) as Reply
  if (!body.ok) throw new StudentPageError(body.message, body.code)
  return body.data
}

/** The student's page. With no token, the signed-in student's. Throws when the link or the sign-in does not open one. */
export const studentLinkLoad = (linkToken?: string) => call(linkToken)

/** One of the three writes. Returns the page again, as the server now has it. */
export const studentLinkWrite = (linkToken: string | undefined, write: StudentWrite) => call(linkToken, write)
