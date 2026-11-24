// Sends queued outbox rows for one firm once the undo window has passed.
// Uses the service-role client for status updates. The only caller of a
// transport. The allowlist is checked before every send.

import { randomBytes } from 'node:crypto'
import {
  STUDENT_LINK_PLACEHOLDER,
  allowlistAllows,
  fillStudentLink,
  parseAllowlist,
  resolveAddress,
  type RecipientContact,
} from '../shared/dispatch.js'
import { emailSubject } from '../shared/emailSubject.js'
import type { QueueChannel, QueueLanguage } from '../shared/outbox.js'
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
}

export type DispatchSummary = {
  processed: number
  sent: number
  failed: number
  skipped: number
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

async function markFailed(row: OutboxRow, error: string): Promise<void> {
  const { error: updateError } = await serviceClient()
    .from('outbox')
    .update({ status: 'failed', error })
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
  const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString()
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

async function processOne(row: OutboxRow, allowlist: ReturnType<typeof parseAllowlist>): Promise<'sent' | 'failed'> {
  try {
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
    })
    await markSent(row, result.providerMessageId)
    return 'sent'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'send failed'
    // LogTransport and allowlist refusal never throw into here for the allowlist
    // case; a thrown error means the transport or link step failed. Do not log
    // the body (it may contain a raw student-link token).
    console.error('[dispatch] send error:', message)
    await markFailed(row, message)
    return 'failed'
  }
}

/**
 * Claims and sends every due queued message for one firm. Atomic claim:
 * status queued → sending, skip when another caller already took the row.
 */
export async function dispatchFirm(firmId: string): Promise<DispatchSummary> {
  const allowlist = parseAllowlist(process.env.SEND_ALLOWLIST)
  const now = new Date().toISOString()
  const { data: due, error } = await serviceClient()
    .from('outbox')
    .select('id, firm_id, student_id, to_kind, to_name, parent_id, channel, language, kind, body, body_en, status, approved_by')
    .eq('firm_id', firmId)
    .eq('status', 'queued')
    .lte('send_after', now)
    .order('send_after', { ascending: true })

  if (error) throw new Error(`outbox read failed: ${error.message}`)

  const summary: DispatchSummary = { processed: 0, sent: 0, failed: 0, skipped: 0 }
  for (const candidate of due ?? []) {
    const claimed = await serviceClient()
      .from('outbox')
      .update({ status: 'sending' })
      .eq('id', candidate.id)
      .eq('status', 'queued')
      .select('id, firm_id, student_id, to_kind, to_name, parent_id, channel, language, kind, body, body_en, status, approved_by')
      .maybeSingle()

    if (claimed.error) throw new Error(`outbox claim failed: ${claimed.error.message}`)
    if (!claimed.data) {
      summary.skipped++
      continue
    }

    summary.processed++
    const outcome = await processOne(claimed.data as OutboxRow, allowlist)
    if (outcome === 'sent') summary.sent++
    else summary.failed++
  }
  return summary
}
