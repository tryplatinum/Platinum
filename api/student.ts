// The student's page: /api/student. Two ways in, and one page behind both:
//
//   * the link's token in the x-student-token header, as always, or
//   * Authorization: Bearer <Supabase access token> of a student sign-in.
//
//   GET   returns the student's page (see server/studentLink.ts for exactly what).
//   POST  one of three writes: mark a task done or not done, leave a progress
//         note, attach a link to a task. Returns the page again.
//         Or one of the two steps of adding a file (start_upload, finish_upload),
//         which return only what the upload needs. The link can add files; it can
//         never list, open or download one.
//
// A student has no login. The token (32 random bytes) is the whole credential.
// Only its SHA-256 hash is stored. An unknown token and a revoked one get the
// same 404. Requests are rate limited by token and by address, and nothing here
// reveals which of the two it was.
//
// A student sign-in is verified with Supabase, then its account is looked up
// with the service role. It is refused when a member has turned it off or the
// student is archived, on every request. After that it runs the very same page,
// write and upload code as the link: nothing more is readable, nothing more is
// writable. Requests are limited by user id and by address. A counselor's
// token has no student account behind it and gets nothing here.

import { STUDENT_TOKEN_HEADER } from '../shared/constants.js'
import { STUDENT_TOKEN, STUDENT_UPLOAD, STUDENT_WRITE, type StudentErrorCode } from '../shared/student.js'
import { inBackground } from '../server/documentSorting.js'
import { addressOf, rateLimited } from '../server/rateLimit.js'
import { StudentLinkError, findLink, findStudentAccount, finishStudentUpload, hashToken, startStudentUpload, studentPage, studentWrite, type Link } from '../server/studentLink.js'
import { authConfigured, serviceConfigured, signedIn } from '../server/supabase.js'

// Long enough for the sorting that carries on after finish_upload has answered.
export const config = { maxDuration: 60 }

const MAX_PER_ADDRESS = 120
const MAX_PER_TOKEN = 60
const MAX_BODY_BYTES = 8_000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const fail = (message: string, status: number, code?: StudentErrorCode) => json(code ? { ok: false, code, message } : { ok: false, message }, status)
const notFound = () => fail('This link does not work. Ask your counselor for a new one.', 404)
const tooMany = () => fail('Too many requests. Wait a few minutes and try again.', 429)

/** The student behind a sign-in, or the response to send instead. `code` tells an app which screen to show. */
async function openAccount(request: Request): Promise<Link | Response> {
  if (!authConfigured()) return fail('Student sign-ins are not set up on this server.', 503)
  const person = await signedIn(request)
  if (!person.ok) return fail('Sign in again.', 401, 'unauthorized')
  if (rateLimited(`student-user:${person.userId}`, MAX_PER_TOKEN)) return tooMany()
  const account = await findStudentAccount(person.userId)
  if (account === 'off') return fail('This sign-in has been turned off. Ask your counselor about it.', 403, 'signin_off')
  // No student account: a counselor, or a person who belongs to nothing. Nothing here is theirs.
  if (!account) return fail('This is not a student sign-in.', 403, 'not_a_student')
  return account
}

/** The link behind this request, or the response to send instead. */
async function open(request: Request): Promise<Link | Response> {
  if (!serviceConfigured()) return fail('Student links are not set up on this server.', 503)
  if (rateLimited(`addr:${addressOf(request)}`, MAX_PER_ADDRESS)) return tooMany()
  // A link token, when one is sent, is the whole credential, exactly as before. A sign-in is only looked at without one.
  if (request.headers.get(STUDENT_TOKEN_HEADER) === null && request.headers.get('authorization')) return openAccount(request)
  const token = STUDENT_TOKEN.safeParse(request.headers.get(STUDENT_TOKEN_HEADER))
  if (!token.success) return notFound()
  if (rateLimited(`token:${hashToken(token.data)}`, MAX_PER_TOKEN)) return fail('Too many requests. Wait a few minutes and try again.', 429)
  return (await findLink(token.data)) ?? notFound()
}

async function respond(request: Request, write: boolean): Promise<Response> {
  try {
    const link = await open(request)
    if (link instanceof Response) return link

    if (write) {
      const raw = await request.text()
      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return fail('That is too long. Shorten it and try again.', 413)
      let body: unknown
      try {
        body = JSON.parse(raw)
      } catch {
        return fail('The request was not valid.', 400)
      }
      // Adding a file: two actions that answer with their own small result, never the page.
      const action = (body as { action?: unknown } | null)?.action
      if (action === 'start_upload' || action === 'finish_upload') {
        const upload = STUDENT_UPLOAD.safeParse(body)
        if (!upload.success) return fail('The request was not valid.', 400)
        if (upload.data.action === 'start_upload') return json({ ok: true, upload: await startStudentUpload(link, upload.data) })
        const done = await finishStudentUpload(link, upload.data.documentId)
        // The student gets their answer now; sorting carries on after the response.
        inBackground(done.sort())
        return json({ ok: true, added: { name: done.name } })
      }
      const parsed = STUDENT_WRITE.safeParse(body)
      if (!parsed.success) {
        const field = parsed.error.issues[0]?.path.join('.')
        return fail(field === 'url' ? 'That does not look like a link. It should start with https://' : 'The request was not valid.', 400)
      }
      await studentWrite(link, parsed.data)
    }
    return json({ ok: true, data: await studentPage(link) })
  } catch (error) {
    if (error instanceof StudentLinkError) return fail(error.message, error.status)
    console.error('[student]', error instanceof Error ? error.message : error)
    return fail('Something went wrong. Please try again.', 500)
  }
}

export const GET = (request: Request) => respond(request, false)
export const POST = (request: Request) => respond(request, true)
