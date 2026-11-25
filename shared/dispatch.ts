// Pure rules for the send path. The dispatcher and the offline tests share
// these so phone/email matching, placeholders, and expiry stay in one place.

import { QUEUE_CHANNELS, type QueueChannel } from './outbox.js'

/** Replaced in the body at send time with a fresh /s/... URL. Never stored. */
export const STUDENT_LINK_PLACEHOLDER = '{{student_link}}'

/** Shown in the counselor UI instead of the raw placeholder. */
export const STUDENT_LINK_PREVIEW = '[student link added when sent]'

export type RecipientContact = {
  phone?: string | null
  email?: string | null
}

/** Digits-only E.164 form for comparison. Returns undefined when there are no digits. */
export function normalizePhone(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const hasPlus = trimmed.includes('+')
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return undefined
  if (hasPlus || trimmed.startsWith('+')) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

/** Lowercased, trimmed email for comparison. */
export function normalizeEmail(raw: string): string | undefined {
  const value = raw.trim().toLowerCase()
  return value.includes('@') ? value : undefined
}

/**
 * Parses SEND_ALLOWLIST. An empty or unset list means nothing is allowed.
 * Entries that look like emails are compared case-insensitively; everything
 * else is treated as a phone and normalized to E.164.
 */
export function parseAllowlist(raw: string | undefined | null): { phones: Set<string>; emails: Set<string> } {
  const phones = new Set<string>()
  const emails = new Set<string>()
  if (!raw || raw.trim() === '') return { phones, emails }
  for (const part of raw.split(',')) {
    const entry = part.trim()
    if (!entry) continue
    if (entry.includes('@')) {
      const email = normalizeEmail(entry)
      if (email) emails.add(email)
    } else {
      const phone = normalizePhone(entry)
      if (phone) phones.add(phone)
    }
  }
  return { phones, emails }
}

/** True when the recipient is on the allowlist for this channel. Empty list → false. */
export function allowlistAllows(
  allowlist: { phones: Set<string>; emails: Set<string> },
  channel: 'text' | 'email',
  address: string,
): boolean {
  if (channel === 'text') {
    const phone = normalizePhone(address)
    return Boolean(phone && allowlist.phones.has(phone))
  }
  const email = normalizeEmail(address)
  return Boolean(email && allowlist.emails.has(email))
}

export type AddressResult = { ok: true; to: string; channel: 'text' | 'email' } | { ok: false; error: string }

/** Resolve the delivery address from the parent or student record for the channel. */
export function resolveAddress(channel: QueueChannel, recipient: RecipientContact): AddressResult {
  if (!(QUEUE_CHANNELS as readonly string[]).includes(channel)) {
    return { ok: false, error: 'unknown channel' }
  }
  if (channel === 'line' || channel === 'wechat') {
    return { ok: false, error: 'channel not connected yet.' }
  }
  if (channel === 'text') {
    const phone = recipient.phone?.trim()
    if (!phone) return { ok: false, error: 'no phone number on the recipient' }
    return { ok: true, to: phone, channel: 'text' }
  }
  const email = recipient.email?.trim()
  if (!email) return { ok: false, error: 'no email address on the recipient' }
  return { ok: true, to: email, channel: 'email' }
}

/** Swap every {{student_link}} for the real URL. */
export function fillStudentLink(body: string, url: string): string {
  return body.split(STUDENT_LINK_PLACEHOLDER).join(url)
}

/** Replaces any student link (an address with /s/ in it) so the text can be logged or stored. */
export function withoutStudentLinks(text: string): string {
  return text.replace(/\S*\/s\/\S*/g, '[student link]')
}

/** Counselor-facing preview of a body that still has the placeholder. */
export function previewStudentLink(body: string): string {
  return body.split(STUDENT_LINK_PLACEHOLDER).join(STUDENT_LINK_PREVIEW)
}

/** How long a student link opens the page after it is made or replaced. */
export const STUDENT_LINK_DAYS = 30

/** The expiry for a link made or replaced now. */
export const studentLinkExpiry = (now = Date.now()) => new Date(now + STUDENT_LINK_DAYS * 86_400_000).toISOString()

/**
 * True when the link must not open: its expiry has passed, or it has no
 * readable expiry at all. Every link has one.
 */
export function linkIsExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (expiresAt == null || expiresAt.trim() === '') return true
  const at = Date.parse(expiresAt)
  if (Number.isNaN(at)) return true
  return at <= now
}

/**
 * A recipient as it may appear in a log line: the last 4 digits of a phone, or
 * the first letter and the domain of an email address.
 */
export function maskRecipient(to: string): string {
  const value = to.trim()
  const at = value.lastIndexOf('@')
  if (at > 0) return `${value[0]}…${value.slice(at)}`
  const digits = value.replace(/\D/g, '')
  return digits.length >= 4 ? `…${digits.slice(-4)}` : '…'
}
