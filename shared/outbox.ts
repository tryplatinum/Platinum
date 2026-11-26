// Rules for a message that is about to be queued. The database repeats these
// checks in queue_message. This copy is what the offline test can run.

import { phoneStatusLabel } from './phoneGateway.js'

/** How long an approved message waits. queue_message in the database sets the real time. */
export const UNDO_SECONDS = 10

export const QUEUE_CHANNELS = ['email', 'wechat', 'line', 'text'] as const
export const QUEUE_LANGUAGES = ['en', 'zh-Hans', 'zh-Hant'] as const
export const QUEUE_KINDS = ['parent_report', 'reminder_upcoming', 'reminder_late', 'meeting_recap', 'essay_feedback', 'weekly_text'] as const
export const QUEUE_STATUSES = ['queued', 'cancelled', 'sending', 'sent', 'failed'] as const

export type QueueChannel = (typeof QUEUE_CHANNELS)[number]
export type QueueLanguage = (typeof QUEUE_LANGUAGES)[number]
export type QueueKind = (typeof QUEUE_KINDS)[number]
export type QueueStatus = (typeof QUEUE_STATUSES)[number]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface QueuePayload {
  id: string
  studentId: string
  toKind: 'student' | 'parent'
  toName: string
  parentId?: string
  channel: QueueChannel
  language: QueueLanguage
  kind: QueueKind
  body: string
  bodyEn?: string
  trigger: 'automatic' | 'approved'
  taskId?: string
  note?: string
  dedupeKey?: string
  /** The counselor's display name, stored on the approval record. */
  approvedBy?: string
}

export type QueueResult = { ok: true; value: QueuePayload } | { ok: false; message: string }

const fail = (message: string): QueueResult => ({ ok: false, message })

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

/** Rejects a payload that is missing a student, recipient, channel, language, kind, or body. */
export function validateQueuePayload(input: unknown): QueueResult {
  if (input === null || typeof input !== 'object') return fail('The message is missing.')
  const raw = input as Record<string, unknown>
  if (typeof raw.id !== 'string' || !UUID.test(raw.id)) return fail('The message needs an id.')
  if (typeof raw.studentId !== 'string' || !UUID.test(raw.studentId)) return fail('The message needs a student.')
  if (raw.toKind !== 'student' && raw.toKind !== 'parent') return fail('The message needs a recipient.')
  if (typeof raw.toName !== 'string' || raw.toName.trim() === '') return fail('The message needs a recipient.')
  if (raw.toKind === 'parent' && (typeof raw.parentId !== 'string' || !UUID.test(raw.parentId))) {
    return fail('The message needs the parent it is addressed to.')
  }
  if (!isOneOf(raw.channel, QUEUE_CHANNELS)) return fail('The message needs a channel.')
  if (!isOneOf(raw.language, QUEUE_LANGUAGES)) return fail('The message needs a language.')
  if (!isOneOf(raw.kind, QUEUE_KINDS)) return fail('The message needs a kind.')
  if (typeof raw.body !== 'string' || raw.body.trim() === '') return fail('The message needs a body.')
  if (raw.taskId !== undefined && (typeof raw.taskId !== 'string' || !UUID.test(raw.taskId))) return fail('The message names a task that is not an id.')

  const value: QueuePayload = {
    id: raw.id,
    studentId: raw.studentId,
    toKind: raw.toKind,
    toName: raw.toName.trim(),
    channel: raw.channel,
    language: raw.language,
    kind: raw.kind,
    body: raw.body,
    trigger: raw.trigger === 'automatic' ? 'automatic' : 'approved',
  }
  if (raw.toKind === 'parent' && typeof raw.parentId === 'string') value.parentId = raw.parentId
  if (typeof raw.bodyEn === 'string' && raw.bodyEn !== '') value.bodyEn = raw.bodyEn
  if (typeof raw.taskId === 'string') value.taskId = raw.taskId
  if (typeof raw.note === 'string' && raw.note !== '') value.note = raw.note
  if (typeof raw.dedupeKey === 'string' && raw.dedupeKey !== '') value.dedupeKey = raw.dedupeKey
  if (typeof raw.approvedBy === 'string' && raw.approvedBy.trim() !== '') value.approvedBy = raw.approvedBy.trim()
  return { ok: true, value }
}

/** The line shown beside a queued, cancelled, sent, or failed message. */
export function outboxStatusLabel(message: { status: QueueStatus; sendAfter: string; error?: string; detail?: string }, now = Date.now()): string {
  // A text handed to the counselor's own phone has its own wording. Every other message is unchanged.
  const viaPhone = phoneStatusLabel(message)
  if (viaPhone) return viaPhone
  if (message.status === 'cancelled') return 'Cancelled'
  if (message.status === 'sending') return 'Sending'
  if (message.status === 'sent') return 'Sent'
  if (message.status === 'failed') return message.error ? `Failed: ${message.error}` : 'Failed'
  if (message.status === 'queued') {
    const left = Math.ceil((Date.parse(message.sendAfter) - now) / 1000)
    if (left > 0) return `Queued, sends in ${left}s`
    return 'Queued, sending soon'
  }
  return 'Unknown'
}
