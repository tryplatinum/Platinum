// Sends queued outbox rows for one firm once the undo window has passed.
// Uses the service-role client for status updates. The only caller of a
// transport. The allowlist is checked before every send.

import { randomBytes, randomUUID } from 'node:crypto'
import {
  STUDENT_LINK_PLACEHOLDER,
  allowlistAllows,
  fillStudentLink,
  parseAllowlist,
  resolveAddress,
  studentLinkExpiry,
  withoutStudentLinks,
  type RecipientContact,
} from '../shared/dispatch.js'
import { emailSubject } from '../shared/emailSubject.js'
import { QUEUE_CHANNELS, type QueueChannel, type QueueLanguage } from '../shared/outbox.js'
import { HAND_SENT_NOTE } from '../shared/phoneGateway.js'
import { sweepJobs } from './phoneGateway/jobs.js'
import { hashToken } from './studentLink.js'
import { serviceClient } from './supabase.js'
import { getTransport } from './transport/index.js'

type OutboxRow = {
  id: string
  firm_id: string
  student_id: string
  to_kind: string
  to_name: string
  parent_id: string | null
  channel: string
  language: string
  kind: string
  body: string
  body_en: string | null
  status: string
  /** Who approved it. Email through Gmail is sent from this person's mailbox. */
  approved_by: string | null
  /** "Sent from your own phone" marks a text the counselor already sent by hand. */
  note: string | null
  /** 'approved' when a counselor approved this message; 'automatic' when a rule queued it. */
  trigger: string | null
}

export type DispatchSummary = {
  processed: number
  sent: number
  failed: number
  skipped: number
  /** Handed to the counselor's own phone and not sent yet. Counted in `processed`, not in `sent`. */
  waiting: number
  /** Texts given up on in this run because a phone never answered. Their rows changed, so the browser reloads. */
  swept: number
}

const kindLabel = (kind: string) => kind.replace(/_/g, ' ')

async function activity(firmId: string, studentId: string, text: string): Promise<void> {
  const { error } = await serviceClient().from('activity').insert({
    firm_id: firmId,
    student_id: studentId,
    actor: 'system',
    text,
  })
  if (error) console.error('[dispatch] activity not written:', error.message)
}

async function markFailed(row: OutboxRow, error: string, detail?: string): Promise<void> {
  const { error: updateError } = await serviceClient()
    .from('outbox')
    .update({ status: 'failed', error, ...(detail ? { delivery_detail: detail } : {}) })
    .eq('id', row.id)
    .eq('status', 'sending')
  if (updateError) console.error('[dispatch] fail update:', updateError.message)
  await activity(row.firm_id, row.student_id, `Failed to send a ${kindLabel(row.kind)} to ${row.to_name}: ${error}`)
}

async function markSent(row: OutboxRow, providerMessageId: string): Promise<void> {
  const { error } = await serviceClient()
    .from('outbox')
    .update({ status: 'sent', provider_message_id: providerMessageId, error: null, sent_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('status', 'sending')
  if (error) console.error('[dispatch] sent update:', error.message)
  await activity(row.firm_id, row.student_id, `Sent a ${kindLabel(row.kind)} to ${row.to_name}.`)
}

/**
 * The message was handed to the counselor's own phone and has not been sent
 * yet. The row stays 'sending', so no later run picks it up; the phone's report
 * (or the sweep in /api/phone) settles it.
 */
async function markWaiting(row: OutboxRow): Promise<void> {
  const { error } = await serviceClient().from('outbox').update({ delivery_detail: 'phone_waiting', error: null }).eq('id', row.id).eq('status', 'sending')
  if (error) console.error('[dispatch] waiting update:', error.message)
  await activity(row.firm_id, row.student_id, `Waiting for your phone to send a ${kindLabel(row.kind)} to ${row.to_name}.`)
}

async function loadRecipient(row: OutboxRow): Promise<RecipientContact> {
  const db = serviceClient()
  if (row.to_kind === 'parent' && row.parent_id) {
    const { data, error } = await db.from('parents').select('phone, email').eq('id', row.parent_id).eq('firm_id', row.firm_id).maybeSingle()
    if (error) throw new Error(`recipient lookup failed: ${error.message}`)
    return { phone: data?.phone, email: data?.email }
  }
  const { data, error } = await db.from('students').select('phone, email').eq('id', row.student_id).eq('firm_id', row.firm_id).maybeSingle()
  if (error) throw new Error(`recipient lookup failed: ${error.message}`)
  return { phone: data?.phone, email: data?.email }
}

/** Someone with every kind of address, so only the channel decides. */
const ANYONE: RecipientContact = { phone: '+15550100', email: 'someone@example.com' }

/**
 * True for a message a counselor approved on a channel Platinum has no way to
 * send on (WeChat, LINE). The screen only lets such a message be approved with
 * Copy, so the counselor has the text and sends it from their own app. The row
 * is the record of that, exactly as a weekly text sent with Copy or Open in
 * Messages is: it was sent by hand, it did not fail. A message a rule queued by
 * itself on such a channel was copied by nobody, and still fails.
 */
export function approvedToSendByHand(row: { channel: string; trigger?: string | null }): boolean {
  // A channel the queue knows, that resolveAddress refuses even for someone with every address.
  const known = (QUEUE_CHANNELS as readonly string[]).includes(row.channel)
  return row.trigger === 'approved' && known && !resolveAddress(row.channel as QueueChannel, ANYONE).ok
}

/**
 * Records a message the counselor sent by hand, the way the phone transport
 * records a hand-sent text: 'sent', a `hand_` id, and the note "Sent from your
 * own phone" unless the row already says how it went. Nothing is sent from
 * here and no transport is called.
 */
async function markSentByHand(row: OutboxRow): Promise<void> {
  const { error } = await serviceClient()
    .from('outbox')
    .update({ status: 'sent', provider_message_id: `hand_${randomUUID()}`, error: null, sent_at: new Date().toISOString(), note: row.note?.trim() ? row.note : HAND_SENT_NOTE })
    .eq('id', row.id)
    .eq('status', 'sending')
  if (error) console.error('[dispatch] sent-by-hand update:', error.message)
  await activity(row.firm_id, row.student_id, `Sent a ${kindLabel(row.kind)} to ${row.to_name}.`)
}

function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * For a student-recipient body that still has {{student_link}}, insert a fresh
 * student_links row (30-day expiry) and replace the placeholder. The raw token
 * never touches the database or the activity log.
 */
async function withStudentLink(row: OutboxRow, body: string, bodyEn: string | null): Promise<{ body: string; bodyEn: string | null }> {
  if (row.to_kind !== 'student' || !body.includes(STUDENT_LINK_PLACEHOLDER)) {
    return { body, bodyEn }
  }
  const base = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '')
  if (!base) throw new Error('PUBLIC_APP_URL is not set on the server')

  const token = newToken()
  const expiresAt = studentLinkExpiry()
  const { error } = await serviceClient()
    .from('student_links')
    .insert({
      firm_id: row.firm_id,
      student_id: row.student_id,
      token_hash: hashToken(token),
      expires_at: expiresAt,
    })
  if (error) throw new Error(`student link insert failed: ${error.message}`)

  const url = `${base}/s/${token}`
  return {
    body: fillStudentLink(body, url),
    bodyEn: bodyEn && bodyEn.includes(STUDENT_LINK_PLACEHOLDER) ? fillStudentLink(bodyEn, url) : bodyEn,
  }
}

async function processOne(row: OutboxRow, allowlist: ReturnType<typeof parseAllowlist>): Promise<'sent' | 'failed' | 'waiting'> {
  try {
    // Approved on a channel with no transport: the counselor copied it and sends it themselves.
    if (approvedToSendByHand(row)) {
      await markSentByHand(row)
      return 'sent'
    }
    const recipient = await loadRecipient(row)
    const address = resolveAddress(row.channel as QueueChannel, recipient)
    if (!address.ok) {
      await markFailed(row, address.error)
      return 'failed'
    }
    if (!allowlistAllows(allowlist, address.channel, address.to)) {
      await markFailed(row, 'recipient not on allowlist')
      return 'failed'
    }

    const filled = await withStudentLink(row, row.body, row.body_en)
    // Chosen per channel, and only after the allowlist check above.
    const transport = getTransport(row.channel as QueueChannel)
    const result = await transport.send({
      channel: row.channel as QueueChannel,
      to: address.to,
      body: filled.body,
      language: row.language as QueueLanguage,
      // The outbox has no subject yet: an email gets one from its kind, in its language.
      ...(address.channel === 'email' ? { subject: emailSubject(row.kind, row.language) } : {}),
      senderUserId: row.approved_by ?? undefined,
      outboxId: row.id,
      note: row.note ?? undefined,
    })
    if (result.waiting) {
      await markWaiting(row)
      return 'waiting'
    }
    await markSent(row, result.providerMessageId)
    return 'sent'
  } catch (error) {
    const message = withoutStudentLinks(error instanceof Error ? error.message : 'send failed')
    // The phone transport says why a text can be sent by hand instead.
    const detail = error instanceof Error && 'deliveryDetail' in error && typeof error.deliveryDetail === 'string' ? error.deliveryDetail : undefined
    // LogTransport and allowlist refusal never throw into here for the allowlist
    // case; a thrown error means the transport or link step failed. Do not log
    // the body (it may contain a raw student-link token).
    console.error('[dispatch] send error:', message)
    await markFailed(row, message, detail)
    return 'failed'
  }
}

/**
 * Claims and sends every due queued message for one firm. Atomic claim:
 * status queued → sending, skip when another caller already took the row.
 */
export async function dispatchFirm(firmId: string): Promise<DispatchSummary> {
  // Texts a phone never answered for are given up on here too, so a row does not sit on
  // "Waiting for your phone" until someone opens a page. It sends nothing, and a failure
  // (the phone tables not being there, say) never stops the messages below from going out.
  let swept = 0
  try {
    swept = await sweepJobs()
  } catch (error) {
    console.error('[dispatch] phone sweep:', error instanceof Error ? error.message : 'unknown')
  }
  const allowlist = parseAllowlist(process.env.SEND_ALLOWLIST)
  const now = new Date().toISOString()
  const { data: due, error } = await serviceClient()
    .from('outbox')
    .select('id, firm_id, student_id, to_kind, to_name, parent_id, channel, language, kind, body, body_en, status, approved_by, note, trigger')
    .eq('firm_id', firmId)
    .eq('status', 'queued')
    .lte('send_after', now)
    .order('send_after', { ascending: true })

  if (error) throw new Error(`outbox read failed: ${error.message}`)

  const summary: DispatchSummary = { processed: 0, sent: 0, failed: 0, skipped: 0, waiting: 0, swept }
  for (const candidate of due ?? []) {
    const claimed = await serviceClient()
      .from('outbox')
      .update({ status: 'sending' })
      .eq('id', candidate.id)
      .eq('status', 'queued')
      .select('id, firm_id, student_id, to_kind, to_name, parent_id, channel, language, kind, body, body_en, status, approved_by, note, trigger')
      .maybeSingle()

    if (claimed.error) throw new Error(`outbox claim failed: ${claimed.error.message}`)
    if (!claimed.data) {
      summary.skipped++
      continue
    }

    summary.processed++
    const outcome = await processOne(claimed.data as OutboxRow, allowlist)
    if (outcome === 'sent') summary.sent++
    else if (outcome === 'waiting') summary.waiting++
    else summary.failed++
  }
  return summary
}
