// /api/google: a counselor's Google connection and their Drive.
//
//   POST { action, ... }   for signed-in members of a firm. The same caller
//                          check and rate limits as /api/documents: the request
//                          carries Authorization: Bearer <Supabase access token>,
//                          verified with Supabase on every call.
//   GET  ?code=&state=     where Google sends the person back after consent.
//                          It is a plain page load with no Authorization header,
//                          so it is trusted only for what its signed `state`
//                          says, and only in the browser that started it.
//
// This file is only the HTTP handler. What each action does lives in
// server/google/. No token ever leaves the server: not in an answer, a log or
// an error message. Nothing here logs file names, folder names or addresses.

import { browseInput, connectInput, folderInput, foldersInput, importInput, linkInput, syncInput } from '../shared/google.js'
import { FileError } from '../server/documentSorting.js'
import { GoogleError, clearStateCookie, connectionStatus, disconnect, finishConnect, startConnect } from '../server/google/connection.js'
import { browseDrive } from '../server/google/drive.js'
import { importDriveFile, importRemovedAgain, linkFolder, listFolders, syncFolder, unlinkFolder } from '../server/google/driveFiles.js'
import { addressOf, rateLimited } from '../server/rateLimit.js'
import { authConfigured, identify, type Caller } from '../server/supabase.js'

export const config = { maxDuration: 60 }

/** Requests per person per five minutes. A long sync is a few calls a minute. */
const MAX_PER_USER = 120
/** Requests per address per five minutes, counted before sign-in is checked. */
const MAX_PER_ADDRESS = 240
const MAX_BODY_BYTES = 20_000

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } })

const fail = (code: string, message: string, status: number) => json({ ok: false, code, message }, status)

type SignedIn = Extract<Caller, { ok: true }>
type Answer = { data: unknown; headers?: Record<string, string> }

/** The body, checked against the action's shape. A body that does not fit is refused with nothing echoed back. */
function checked<T>(shape: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }, body: unknown): T {
  const result = shape.safeParse(body)
  if (!result.success) throw new GoogleError('refused', 'That request was not understood.', 400)
  return result.data
}

/** One function per action. Each gets the verified caller, the request body and the request itself. */
const ACTIONS: Record<string, (caller: SignedIn, body: unknown, request: Request) => Promise<Answer>> = {
  /** The connected address and what it may do. Never a token. */
  status: async (caller) => ({ data: await connectionStatus(caller) }),
  /** The address of Google's consent screen, and the cookie that ties the answer to this browser. */
  connect: async (caller, body, request) => {
    const { url, setCookie } = startConnect(caller, request, checked(connectInput, body))
    return { data: { url }, headers: { 'set-cookie': setCookie } }
  },
  /** Revokes the grant at Google, then deletes our row. */
  disconnect: async (caller) => ({ data: await disconnect(caller) }),
  /** One page of the Drive panel, live from Google. Not saved. */
  browse: async (caller, body) => ({ data: await browseDrive({ userId: caller.userId, firmId: caller.firmId }, checked(browseInput, body)) }),
  /** Copies one picked file into storage. It then waits for the counselor like an upload. */
  import: async (caller, body) => ({ data: await importDriveFile(caller, checked(importInput, body)) }),
  folders: async (caller, body) => ({ data: await listFolders(caller, checked(foldersInput, body).studentId) }),
  link: async (caller, body) => ({ data: await linkFolder(caller, checked(linkInput, body)) }),
  unlink: async (caller, body) => ({ data: await unlinkFolder(caller, checked(folderInput, body).id) }),
  /** One bounded batch of a linked folder's sync. The browser calls again while `more` is true. */
  sync: async (caller, body) => ({ data: await syncFolder(caller, checked(syncInput, body)) }),
  /** Forgets which files were deleted here, so the next sync imports them again. */
  import_removed: async (caller, body) => ({ data: await importRemovedAgain(caller, checked(folderInput, body).id) }),
}

export async function POST(request: Request): Promise<Response> {
  // Fail closed: if sign-ins cannot be checked, the endpoint does nothing.
  if (!authConfigured()) return fail('not_configured', 'The server has no Supabase settings, so it cannot check who is asking.', 503)
  if (rateLimited(`addr:${addressOf(request)}`, MAX_PER_ADDRESS)) return fail('rate_limited', 'Too many requests. Wait a few minutes and try again.', 429)

  const caller = await identify(request)
  if (!caller.ok) {
    return caller.reason === 'no_firm' ? fail('no_firm', 'Your account does not belong to a firm yet.', 403) : fail('unauthorized', 'Sign in again to use Google Drive.', 401)
  }
  if (rateLimited(`google:${caller.userId}`, MAX_PER_USER)) return fail('rate_limited', 'Too many requests. Wait a few minutes and try again.', 429)

  const raw = await request.text()
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return fail('too_large', 'That request is too large.', 413)
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return fail('bad_request', 'The request was not valid JSON.', 400)
  }
  const action = typeof body?.action === 'string' && Object.hasOwn(ACTIONS, body.action) ? ACTIONS[body.action] : undefined
  if (!action) return fail('bad_request', 'Unknown action.', 400)

  try {
    const answer = await action(caller, body, request)
    return json({ ok: true, data: answer.data }, 200, answer.headers)
  } catch (error) {
    if (error instanceof GoogleError) return fail(error.code, error.message, error.status)
    if (error instanceof FileError) return fail('refused', error.message, error.status)
    console.error('[google]', error instanceof Error ? error.message : 'unknown')
    return fail('server', 'Something went wrong. Please try again.', 500)
  }
}

/** Google's redirect. Always answers with a redirect back to the app, with one word about how it went. */
export async function GET(request: Request): Promise<Response> {
  const back = (outcome: string, headers: Record<string, string> = {}) =>
    new Response(null, { status: 302, headers: { location: new URL(`/app?google=${outcome}`, request.url).toString(), 'cache-control': 'no-store', ...headers } })
  // However it ends, the one-time cookie is cleared, so its state cannot be used again.
  const clear = { 'set-cookie': clearStateCookie(request) }
  if (rateLimited(`addr:${addressOf(request)}`, MAX_PER_ADDRESS)) return back('failed', clear)
  try {
    const { outcome } = await finishConnect(request)
    return back(outcome, clear)
  } catch (error) {
    console.error('[google] the connection could not be finished:', error instanceof Error ? error.message : 'unknown')
    return back('failed', clear)
  }
}
