// Google Calendar: the pure rules the server, the browser and the offline
// checks share. What an event Platinum writes may contain, how a meeting's
// date and local time become an event and back, and how a change made in
// Google is noticed.
//
// The rule that matters most is at the top: an event Platinum writes never has
// a guest and never lets Google send an email. A calendar invitation is an
// outbound message, and every outbound message goes through approval and the
// outbox. `assertQuiet` is called on every write and is checked offline.

import { z } from 'zod'

/**
 * The one Calendar permission Platinum asks for: "See, create, change, and
 * delete events on Google calendars you own." It is asked for on its own,
 * after Drive, and the connection works without it.
 */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.owned'

/** The counselor's own main calendar. No other calendar is read or written. */
export const CALENDAR_ID = 'primary'

/** Passed on every insert, change and delete: Google sends nobody anything. */
export const SEND_UPDATES = 'none'

/** The private mark on an event Platinum made, holding the meeting's id. Platinum only ever deletes an event that carries it. */
export const MADE_BY_KEY = 'platinumMeeting'

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
/** A Calendar event id: letters, digits, dash and underscore. Checked before it is put in a URL. */
export const eventId = z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/)

// ── What the browser sends ──────────────────────────────────────────────────

export const calendarEventsInput = z.object({ from: day, to: day })
export const calendarPutInput = z.object({ meetingId: uuid })
export const calendarRemoveInput = z.object({ meetingId: uuid, eventId })

// ── A meeting as an event ───────────────────────────────────────────────────

export interface MeetingForEvent {
  id: string
  title: string
  /** "2026-11-28" */
  date: string
  /** "16:30", local time with no zone. */
  time: string
  durationMin: number
  location?: string | null
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The wall-clock end of a meeting: its date and time plus its length, carried
 * over midnight when it runs past it. No time zone is involved: the result is
 * what a clock on the wall would read.
 */
export function wallEnd(date: string, time: string, durationMin: number): { date: string; time: string } {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = time.split(':').map(Number)
  const end = new Date(Date.UTC(y, m - 1, d, h, min + durationMin))
  return { date: end.toISOString().slice(0, 10), time: `${pad(end.getUTCHours())}:${pad(end.getUTCMinutes())}` }
}

export interface EventPayload {
  summary: string
  description: string
  location?: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  extendedProperties: { private: Record<string, string> }
  /** Always "private": the title names a student. */
  visibility: 'private'
  reminders: { useDefault: true }
}

/**
 * The event for a meeting. Title "<first name>: <meeting title>", the time,
 * the length, the place. The description is a link back to the meeting in
 * Platinum and nothing else: no notes, no brief, no tasks, no student details.
 *
 * The times are the meeting's own wall-clock times with the calendar's time
 * zone beside them, so Google does the zone arithmetic, including across a
 * daylight-saving change.
 */
export function eventPayload(meeting: MeetingForEvent, studentFirstName: string, link: string, timeZone: string): EventPayload {
  const end = wallEnd(meeting.date, meeting.time, meeting.durationMin)
  const payload: EventPayload = {
    summary: `${studentFirstName}: ${meeting.title}`.slice(0, 300),
    description: link,
    start: { dateTime: `${meeting.date}T${meeting.time}:00`, timeZone },
    end: { dateTime: `${end.date}T${end.time}:00`, timeZone },
    extendedProperties: { private: { [MADE_BY_KEY]: meeting.id } },
    visibility: 'private',
    reminders: { useDefault: true },
  }
  const place = meeting.location?.trim()
  if (place) payload.location = place.slice(0, 300)
  return payload
}

/** Fields that would make Google contact someone, or let someone else in. None may ever be in a write. */
const LOUD_FIELDS = ['attendees', 'attendeesOmitted', 'guestsCanInviteOthers', 'guestsCanModify', 'guestsCanSeeOtherGuests', 'conferenceData', 'organizer', 'creator', 'anyoneCanAddSelf', 'source']

/**
 * Throws unless this write is silent: no guest anywhere in the body, and the
 * address says `sendUpdates=none` and nothing else about notifications. Called
 * on every request the calendar code makes that is not a read.
 */
export function assertQuiet(url: string, body: unknown): void {
  const params = new URL(url).searchParams
  if (params.get('sendUpdates') !== SEND_UPDATES) throw new Error('A calendar write must pass sendUpdates=none.')
  if (params.has('sendNotifications')) throw new Error('A calendar write must not pass sendNotifications.')
  if (params.has('conferenceDataVersion')) throw new Error('A calendar write must not make a meeting link.')
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (!value || typeof value !== 'object') return
    for (const [key, inner] of Object.entries(value)) {
      if (LOUD_FIELDS.includes(key)) throw new Error(`A calendar write must not contain “${key}”.`)
      walk(inner)
    }
  }
  walk(body)
}

// ── An event as Platinum shows it ───────────────────────────────────────────

/** One event from the counselor's calendar, cut down to what the screen shows. Its text is untrusted: shown as text, never acted on. */
export interface CalendarEvent {
  id: string
  /** As typed in Google. Text only. */
  title: string
  /** Wall-clock start in the calendar's time zone. All-day events have a date and no time. */
  date: string
  time?: string
  durationMin?: number
  location?: string
  cancelled: boolean
  /** The Platinum meeting this event was made for, when Platinum made it. */
  madeFor?: string
  /** When Google last changed it. Used to tell a new change from one already answered. */
  updated?: string
}

export interface CalendarRead {
  events: CalendarEvent[]
  /** The calendar's own time zone, as Google gives it. */
  timeZone: string
  readAt: string
}

/** What Google sends for one event. Only what is used is kept; everything else is dropped unread. */
export const googleEvent = z.object({
  id: eventId,
  status: z.string().max(40).optional(),
  summary: z.string().max(4000).optional(),
  location: z.string().max(4000).optional(),
  updated: z.string().max(60).optional(),
  start: z.object({ dateTime: z.string().max(60).optional(), date: z.string().max(20).optional() }).optional(),
  end: z.object({ dateTime: z.string().max(60).optional(), date: z.string().max(20).optional() }).optional(),
  extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional(),
})
export type GoogleEvent = z.infer<typeof googleEvent>

export const googleEventList = z.object({ items: z.array(z.unknown()).default([]), timeZone: z.string().min(1).max(100), nextPageToken: z.string().optional() })

/** The wall-clock part of a time Google sent in the zone we asked for: "2026-11-28T16:30:00-08:00" is Nov 28, 16:30. */
export function wallFromGoogle(dateTime: string): { date: string; time: string } | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(dateTime)
  return m ? { date: m[1], time: m[2] } : undefined
}

const minutesBetween = (a: { date: string; time: string }, b: { date: string; time: string }) => {
  const at = (x: { date: string; time: string }) => {
    const [y, m, d] = x.date.split('-').map(Number)
    const [h, min] = x.time.split(':').map(Number)
    return Date.UTC(y, m - 1, d, h, min)
  }
  return Math.round((at(b) - at(a)) / 60_000)
}

/** Printable text only, cut to a line: an event's title is typed by anyone who can write to the calendar. */
const plain = (text: string | undefined, max: number) => (text ?? '').replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

export function toCalendarEvent(raw: GoogleEvent): CalendarEvent | undefined {
  const cancelled = raw.status === 'cancelled'
  const made = raw.extendedProperties?.private?.[MADE_BY_KEY]
  const base = { id: raw.id, title: plain(raw.summary, 200) || '(no title)', location: plain(raw.location, 200) || undefined, cancelled, madeFor: made && uuid.safeParse(made).success ? made : undefined, updated: raw.updated }
  const start = raw.start?.dateTime ? wallFromGoogle(raw.start.dateTime) : undefined
  if (start) {
    const end = raw.end?.dateTime ? wallFromGoogle(raw.end.dateTime) : undefined
    return { ...base, date: start.date, time: start.time, durationMin: end ? Math.max(0, minutesBetween(start, end)) : undefined }
  }
  if (raw.start?.date && /^\d{4}-\d{2}-\d{2}$/.test(raw.start.date)) return { ...base, date: raw.start.date }
  // A cancelled event can come back with nothing but its id.
  return cancelled ? { ...base, date: '' } : undefined
}

// ── A change made in Google ─────────────────────────────────────────────────

export type GoogleChange =
  | { kind: 'moved'; date: string; time: string; durationMin: number }
  /** Cancelled or deleted in Google. */
  | { kind: 'cancelled' }

/**
 * How a linked event differs from its meeting, if it does. `event` undefined
 * means the event was looked for in its own range and is not there. Platinum
 * never acts on this by itself: the counselor is asked.
 */
export function googleChange(meeting: { date: string; time: string; durationMin: number }, event: CalendarEvent | undefined): GoogleChange | undefined {
  if (!event || event.cancelled) return { kind: 'cancelled' }
  // Made all-day in Google: there is no time to move the meeting to, so it is left alone.
  if (!event.time) return undefined
  const durationMin = event.durationMin ?? meeting.durationMin
  if (event.date === meeting.date && event.time === meeting.time && durationMin === meeting.durationMin) return undefined
  return { kind: 'moved', date: event.date, time: event.time, durationMin }
}

/** The student to suggest for an event: the one whose name is in its title, when exactly one is. Never linked without a person choosing. */
export function suggestStudent<T extends { id: string; firstName: string; lastName: string }>(title: string, students: T[]): T | undefined {
  const text = ` ${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  const named = students.filter((s) => {
    const full = `${s.firstName} ${s.lastName}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const first = s.firstName.toLowerCase().trim()
    return (full && text.includes(` ${full} `)) || (first.length > 1 && text.includes(` ${first} `))
  })
  return named.length === 1 ? named[0] : undefined
}

// ── What a meeting remembers about its event ────────────────────────────────

/**
 * `synced`: the event matches the meeting. `failed`: Google refused or could
 * not be reached; the meeting is saved and shows "Not on your calendar yet".
 * `linked`: an event made in Google was tied to this meeting; Platinum did
 * not make it and will never delete it. `kept:<stamp>`: the counselor chose to
 * keep the meeting as it is after a change in Google stamped `<stamp>`.
 */
export type CalendarSync = 'synced' | 'failed' | 'linked' | `kept:${string}`

/** True when a change stamped `updated` has already been answered with Keep. */
export const alreadyKept = (sync: string | undefined, updated: string | undefined) => Boolean(sync && updated && sync === `kept:${updated}`)
