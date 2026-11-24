// Texts from a counselor's own phone: the rules the browser and the server
// share. The status of a job and which moves are allowed live here as a pure
// function, so the offline tests can try every one.

import { z } from 'zod'

export const PHONE_ENDPOINT = '/api/phone'

// ── Limits ──────────────────────────────────────────────────────────────────

/** A job nobody took is given up after this long. */
export const JOB_EXPIRES_MS = 10 * 60_000
/** A phone that took a job has this long to report. */
export const JOB_LEASE_MS = 2 * 60_000
/** At most one wake email per phone in this time. */
export const WAKE_GAP_MS = 20_000
export const CLAIMS_PER_HOUR = 20
export const CLAIMS_PER_DAY = 100
/** This many jobs in a row with no answer, and the phone is treated as stopped. */
export const STOP_AFTER = 3
/** A phone not heard from for this long is shown as "Not seen since". */
export const SEEN_RECENTLY_MS = 7 * 86_400_000

/** The note the weekly text flow puts on a text the counselor sent by hand. Such a row is never handed to a phone. */
export const HAND_SENT_NOTE = 'Sent from your own phone'

export const TEST_BODY = 'Platinum test. Your phone is connected.'
export const WAKE_BODY = 'Wake.'
export const WAKE_SUBJECT_PREFIX = 'Platinum wake '
/** The whole of a wake email's subject: the fixed words and six letters or digits. */
export const WAKE_SUBJECT = /^Platinum wake [a-z0-9]{6}$/

// ── Job status ──────────────────────────────────────────────────────────────

export const JOB_STATUSES = ['pending', 'claimed', 'submitted', 'failed', 'unknown', 'expired', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

/** Every allowed move. Anything not listed is refused, and nothing returns to pending. */
const MOVES: Record<JobStatus, readonly JobStatus[]> = {
  pending: ['claimed', 'expired', 'cancelled'],
  claimed: ['submitted', 'failed', 'unknown'],
  // A late report from the phone, or the counselor's answer.
  unknown: ['submitted', 'failed'],
  submitted: [],
  failed: [],
  expired: [],
  cancelled: [],
}

export function jobCanMove(from: string, to: string): boolean {
  return Object.hasOwn(MOVES, from) && (MOVES[from as JobStatus] as readonly string[]).includes(to)
}

/** A job that ended with no answer from the phone. */
export const jobWentUnanswered = (status: string) => status === 'expired' || status === 'unknown'

/** True when the last STOP_AFTER finished jobs (newest first) all went unanswered. */
export function phoneHasStopped(finishedNewestFirst: readonly string[]): boolean {
  return finishedNewestFirst.length >= STOP_AFTER && finishedNewestFirst.slice(0, STOP_AFTER).every(jobWentUnanswered)
}

// ── What the outbox row says ────────────────────────────────────────────────

export const DELIVERY_DETAILS = ['phone_waiting', 'phone_sent', 'phone_unknown', 'phone_expired', 'phone_failed', 'phone_none'] as const
export type DeliveryDetail = (typeof DELIVERY_DETAILS)[number]

/** The status line for a text that was handed to a phone. Undefined for every other message. Never says "delivered". */
export function phoneStatusLabel(message: { status: string; detail?: string; error?: string }): string | undefined {
  switch (message.detail) {
    case 'phone_waiting':
      return message.status === 'sending' ? 'Waiting for your phone' : undefined
    case 'phone_unknown':
      return message.status === 'sending' ? 'Not confirmed' : undefined
    case 'phone_sent':
      return message.status === 'sent' ? 'Sent from your phone' : undefined
    case 'phone_expired':
      return message.status === 'failed' ? 'Phone did not answer' : undefined
    default:
      return undefined
  }
}

export const NOT_CONFIRMED = 'Your phone took this text but did not confirm. Check Messages on your phone before doing anything else.'

/** True when the text did not go out through the phone and the counselor can send it by hand. */
export const canSendByHand = (message: { channel: string; status: string; detail?: string }) =>
  message.channel === 'text' && message.status === 'failed' && (message.detail === 'phone_none' || message.detail === 'phone_expired' || message.detail === 'phone_failed')

/** The plain sentences a text row can fail with on this path. */
export const PHONE_REASON = {
  noDevice: 'No phone is connected. Send this one by hand.',
  stopped: 'Your phone has stopped answering. Send this one by hand, then send a test from settings.',
  noGmail: 'Connect Gmail in settings so Platinum can wake your phone, or send this one by hand.',
  wakeNotAllowed: 'Your wake address is not on the allowed list. Send this one by hand.',
  noCounselor: 'No counselor on this message',
  expired: 'Your phone did not answer. Send this one by hand, or retry.',
  notSent: 'Counselor confirmed it was not sent',
  offList: 'recipient not on allowlist',
  cancelled: 'The message was cancelled before your phone took it.',
  alreadyHanded: 'This text was already handed to your phone once. It was not handed over again.',
} as const

// ── What the server tells the phone ─────────────────────────────────────────

/** Always a flat object, always with `next`. A hand-built Shortcut depends on these exact shapes. */
export type ClaimAnswer = { next: 'none' } | { next: 'send'; job_id: string; claim_id: string; to_phone: string; body: string }

// ── What the browser sends ──────────────────────────────────────────────────

const uuid = z.string().uuid()

export const reportInput = z.object({
  job_id: uuid,
  claim_id: uuid,
  result: z.enum(['submitted', 'failed']),
  error: z.string().max(2000).optional(),
})
export const connectInput = z.object({ label: z.string().trim().min(1).max(80), noticeShown: z.boolean().optional() })
export const numberInput = z.object({ phone: z.string().trim().max(40) })
export const resolveInput = z.object({ jobId: uuid.optional(), outboxId: uuid.optional(), sent: z.boolean() }).refine((v) => Boolean(v.jobId) !== Boolean(v.outboxId))
export const cancelInput = z.object({ outboxId: uuid })

// ── What the browser is told ────────────────────────────────────────────────

export type PhoneState = 'waiting' | 'connected' | 'not_seen' | 'stopped'

export type PhoneJobLine = {
  id: string
  /** The recipient's name, or "You (test)". Never a number. */
  to: string
  status: JobStatus
  createdAt: string
  claimedAt?: string
  reportedAt?: string
  error?: string
}

export type PhoneStatus = {
  /** False when the server cannot run this at all (no service role). The whole section is hidden. */
  available: boolean
  /** True when TRANSPORT_TEXT is exactly "phone" on the server: approved texts go to the phone. */
  on: boolean
  gmail: { connected: boolean; address?: string; allowed: boolean }
  /** Whether this counselor has already been shown the notice about texting from their own number. */
  noticeShown: boolean
  device?: {
    label: string
    wakeEmail: string
    ownPhone?: string
    firstSeenAt?: string
    lastSeenAt?: string
    state: PhoneState
    /** The state in plain words. */
    stateLabel: string
  }
  jobs: PhoneJobLine[]
}

export const PHONE_NOTICE = 'Texts are sent from your own number on your own phone plan. Carriers treat software-assisted texts from a business as business messaging and may filter them. Platinum limits this to 20 an hour and 100 a day.'

export function phoneStateLabel(state: PhoneState, lastSeenAt?: string): string {
  if (state === 'waiting') return 'Waiting for your phone'
  if (state === 'connected') return 'Connected'
  if (state === 'stopped') return 'Stopped'
  return `Not seen since ${lastSeenAt ? new Date(lastSeenAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'it was connected'}`
}

/** Whole seconds between two instants, for the latency log. */
export function secondsBetween(from?: string, to?: string): number | undefined {
  if (!from || !to) return undefined
  const ms = Date.parse(to) - Date.parse(from)
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : undefined
}

/** The recent jobs as CSV, for the device tests. Names and timings only: no number and no message text. */
export function jobsCsv(jobs: readonly PhoneJobLine[]): string {
  const cell = (value: string | number | undefined) => {
    const text = value === undefined ? '' : String(value)
    // A cell that could be read as a formula is kept as text.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  const lines = jobs.map((j) => [j.to, j.status, j.createdAt, secondsBetween(j.createdAt, j.claimedAt), secondsBetween(j.claimedAt, j.reportedAt), j.error].map(cell).join(','))
  return ['recipient,status,created_at,seconds_created_to_claimed,seconds_claimed_to_reported,error', ...lines].join('\n')
}
