// Email through the sending counselor's own Gmail. Implements Transport, and
// like every transport is called by the dispatcher only, after the allowlist
// check. Nothing else may call it: there is no route, button or script that
// does.
//
// It sends one plain-text message as the counselor who approved it (the outbox
// row's approved_by), from their connected Google address, under their display
// name. The only scope it uses is gmail.send: it cannot read mail.
//
// Every failure is thrown as a short, plain sentence, which the dispatcher
// records on the row. A token, a mail body or Google's raw answer is never put
// in an error or a log.

import { GMAIL_SEND_SCOPE, gmailSent } from '../../shared/google.js'
import { GMAIL_SEND_URL, google } from '../google/config.js'
import { GoogleError, accessTokenFor, dropAccessToken, googleAvailable } from '../google/connection.js'
import { serviceClient } from '../supabase.js'
import type { Transport, TransportResult, TransportSend } from './types.js'

// ── The message ─────────────────────────────────────────────────────────────

/** Header values are one line: a line break in a name or subject can never start a new header. */
const oneLine = (text: string) => text.replace(/[\p{Cc}]+/gu, ' ').trim()

const ASCII = /^[\x20-\x7e]*$/

/**
 * A header value that is not plain ASCII, as RFC 2047 encoded words: UTF-8 in
 * base64, in short pieces (each well under the 75 characters allowed), never
 * split inside a character.
 * This is what carries a Chinese subject or name intact.
 */
export function encodeHeader(text: string): string {
  const value = oneLine(text)
  if (ASCII.test(value)) return value
  const words: string[] = []
  let piece = ''
  for (const char of value) {
    // 30 bytes become 40 base64 characters, 52 with "=?UTF-8?B?" and "?=": well inside the 75 an
    // encoded word may be, and short enough that "Subject: " in front still fits a 78-character line.
    if (Buffer.byteLength(piece + char, 'utf8') > 30) {
      words.push(piece)
      piece = ''
    }
    piece += char
  }
  if (piece) words.push(piece)
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`).join('\r\n ')
}

/** A display name as it goes in From: quoted when plain, encoded when not. */
function displayName(name: string): string {
  const value = oneLine(name)
  return ASCII.test(value) ? `"${value.replace(/["\\]/g, '')}"` : encodeHeader(value)
}

const EMAIL = /^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+\.[^\s@<>,;:"()[\]\\]+$/

/**
 * One plain-text message, ready for Gmail: headers, then the body as UTF-8 in
 * base64, 76 characters to a line. Pure, so the tests can read it back.
 */
export function buildMessage(input: { fromName: string; fromAddress: string; to: string; subject: string; body: string }): string {
  const body = Buffer.from(input.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')
  return [
    `From: ${displayName(input.fromName)} <${oneLine(input.fromAddress)}>`,
    `To: <${oneLine(input.to)}>`,
    `Subject: ${encodeHeader(input.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n')
}

// ── Sending ─────────────────────────────────────────────────────────────────

export class GmailTransport implements Transport {
  async send(input: TransportSend): Promise<TransportResult> {
    if (input.channel !== 'email') throw new Error('Gmail sends email only')
    if (!input.senderUserId) throw new Error('No counselor on this message')
    if (!googleAvailable()) throw new Error('Gmail is not set up on this server')
    const to = input.to.trim()
    if (!EMAIL.test(to)) throw new Error('not a valid email address')

    const db = serviceClient()
    const member = await db.from('firm_members').select('display_name').eq('user_id', input.senderUserId).maybeSingle()
    if (member.error) throw new Error('could not read the counselor')
    const name = member.data?.display_name?.trim() || 'the counselor'

    const connection = await db.from('google_connections').select('google_address, scopes, last_error').eq('user_id', input.senderUserId).maybeSingle()
    if (connection.error) throw new Error('could not read the Gmail connection')
    if (!connection.data || !connection.data.scopes.includes(GMAIL_SEND_SCOPE)) throw new Error(`Gmail not connected for ${name}`)
    if (connection.data.last_error === 'reconnect') throw new Error(`Reconnect Gmail for ${name}`)

    const message = buildMessage({ fromName: name, fromAddress: connection.data.google_address, to, subject: input.subject?.trim() || 'A message from your counselor', body: input.body })
    const raw = Buffer.from(message, 'utf8').toString('base64url')

    for (let attempt = 0; ; attempt++) {
      let token: string
      try {
        token = await accessTokenFor(input.senderUserId, GMAIL_SEND_SCOPE)
      } catch (error) {
        // accessTokenFor has already recorded an expired or revoked grant on the connection.
        // The cause is one of our own errors, whose message is already safe to show; it never holds a token.
        if (error instanceof GoogleError && error.code === 'reconnect') throw new Error(`Reconnect Gmail for ${name}`, { cause: error })
        if (error instanceof GoogleError && error.code === 'not_connected') throw new Error(`Gmail not connected for ${name}`, { cause: error })
        throw new Error('Gmail could not be reached', { cause: error })
      }
      let res: Response
      try {
        res = await google.fetch(GMAIL_SEND_URL, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw }) })
      } catch {
        throw new Error('Gmail could not be reached')
      }
      if (res.status === 401 && attempt === 0) {
        // The access token was refused: ask for a fresh one, once.
        dropAccessToken(input.senderUserId)
        continue
      }
      if (res.status === 401) throw new Error(`Reconnect Gmail for ${name}`)
      if (res.status === 403) throw new Error(`Gmail refused to send for ${name}`)
      if (res.status === 429 || res.status >= 500) throw new Error('Gmail is busy, try again')
      if (!res.ok) throw new Error('Gmail did not accept the message')
      const sent = gmailSent.safeParse(await res.json().catch(() => undefined))
      if (!sent.success) throw new Error('Gmail gave no message id')
      return { providerMessageId: sent.data.id }
    }
  }
}
