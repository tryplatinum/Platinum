// The student link: /api/student, with the link's token in a header.
//
//   GET   returns the student's page (see server/studentLink.ts for exactly what).
//   POST  one of three writes: mark a task done or not done, leave a progress
//         note, attach a link to a task. Returns the page again.
//
// A student has no login. The token (32 random bytes) is the whole credential.
// Only its SHA-256 hash is stored. An unknown token and a revoked one get the
// same 404. Requests are rate limited by token and by address, and nothing here
// reveals which of the two it was.

import { STUDENT_TOKEN_HEADER } from '../shared/constants.js'
import { STUDENT_TOKEN, STUDENT_WRITE } from '../shared/student.js'
import { addressOf, rateLimited } from '../server/rateLimit.js'
import { StudentLinkError, findLink, hashToken, studentPage, studentWrite, type Link } from '../server/studentLink.js'
import { serviceConfigured } from '../server/supabase.js'

export const config = { maxDuration: 30 }

const MAX_PER_ADDRESS = 120
const MAX_PER_TOKEN = 60
const MAX_BODY_BYTES = 8_000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const fail = (message: string, status: number) => json({ ok: false, message }, status)
const notFound = () => fail('This link does not work. Ask your counselor for a new one.', 404)

/** The link behind this request, or the response to send instead. */
async function open(request: Request): Promise<Link | Response> {
  if (!serviceConfigured()) return fail('Student links are not set up on this server.', 503)
  if (rateLimited(`addr:${addressOf(request)}`, MAX_PER_ADDRESS)) return fail('Too many requests. Wait a few minutes and try again.', 429)
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
