// The counselor's own Google Calendar: reading the events in a range, and
// keeping one event in step with one Platinum meeting.
//
// What this file may and may not do:
//   * It reads and writes the signed-in counselor's primary calendar only,
//     with the one permission in shared/calendar.ts.
//   * Every write goes through `write`, which refuses a body with a guest in
//     it and an address without sendUpdates=none. Google sends nobody
//     anything: a calendar invitation would be a message that skipped
//     approval, the outbox and the allowlist.
//   * An event's description is a link back to the meeting and nothing else.
//   * It only ever deletes an event that carries the mark Platinum put on it
//     when it made it.
//   * Events are read for the screen and returned. None is stored.
//   * Text that comes from Google (titles, places) is cut down and returned as
//     text. Nothing here hands it to a model.

import { CALENDAR_ID, CALENDAR_SCOPE, MADE_BY_KEY, SEND_UPDATES, assertQuiet, eventPayload, googleEvent, googleEventList, toCalendarEvent, wallEnd, type CalendarEvent, type CalendarRead, type GoogleEvent } from '../../shared/calendar.js'
import type { Caller } from '../supabase.js'
import { google } from './config.js'
import { GoogleError, accessTokenFor, dropAccessToken } from './connection.js'

type SignedIn = Extract<Caller, { ok: true }>

export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const EVENTS = `${CALENDAR_API}/calendars/${CALENDAR_ID}/events`

const unreachable = () => new GoogleError('google', 'Google Calendar could not be reached. Try again in a moment.', 502)

async function token(caller: SignedIn): Promise<string> {
  return accessTokenFor({ userId: caller.userId, firmId: caller.firmId }, CALENDAR_SCOPE)
}

/** One request to the Calendar API. A refused token is forgotten so the next call asks for a fresh one. */
async function call(caller: SignedIn, url: string, init: RequestInit = {}): Promise<Response> {
  const bearer = await token(caller)
  let res: Response
  try {
    res = await google.fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${bearer}` } })
  } catch {
    throw unreachable()
  }
  if (res.status === 401) {
    dropAccessToken(caller.userId)
    throw new GoogleError('reconnect', 'Google has ended this connection. Reconnect Google in Settings.', 409)
  }
  if (res.status === 403) throw new GoogleError('refused', 'Google did not allow that on this calendar.', 403)
  return res
}

/** The one way this file changes the calendar. Silent, or it does not happen. */
async function write(caller: SignedIn, method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<Response> {
  const url = `${EVENTS}${path}?sendUpdates=${SEND_UPDATES}`
  assertQuiet(url, body)
  return call(caller, url, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
}

const dayBefore = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString()
}

/**
 * The counselor's events from `from` to `to` (both days included), as wall
 * clock times in the calendar's own time zone, which is how Google answers
 * when no other zone is asked for. Cancelled events are included, marked, so
 * a meeting tied to one can say so. Nothing is saved.
 */
export async function readCalendar(caller: SignedIn, range: { from: string; to: string }): Promise<CalendarRead> {
  if (range.to < range.from) throw new GoogleError('refused', 'That request was not understood.', 400)
  const events: CalendarEvent[] = []
  let timeZone = 'UTC'
  let pageToken: string | undefined
  // A day either side in UTC, so no zone is left out; the exact days are kept below.
  const query = { timeMin: dayBefore(range.from, -1), timeMax: dayBefore(range.to, 2), singleEvents: 'true', showDeleted: 'true', orderBy: 'startTime', maxResults: '250', fields: 'timeZone,nextPageToken,items(id,status,summary,location,updated,start,end,extendedProperties/private)' }
  for (let page = 0; page < 4; page++) {
    const res = await call(caller, `${EVENTS}?${new URLSearchParams({ ...query, ...(pageToken ? { pageToken } : {}) })}`)
    if (!res.ok) throw unreachable()
    const list = googleEventList.safeParse(await res.json().catch(() => undefined))
    if (!list.success) throw new GoogleError('google', 'Google Calendar gave an answer that could not be read.', 502)
    timeZone = list.data.timeZone
    for (const raw of list.data.items) {
      const parsed = googleEvent.safeParse(raw)
      const event = parsed.success ? toCalendarEvent(parsed.data) : undefined
      if (event && (event.cancelled || (event.date >= range.from && event.date <= range.to))) events.push(event)
    }
    pageToken = list.data.nextPageToken
    if (!pageToken) break
  }
  return { events, timeZone, readAt: new Date().toISOString() }
}

async function calendarZone(caller: SignedIn): Promise<string> {
  const res = await call(caller, `${EVENTS}?${new URLSearchParams({ maxResults: '1', fields: 'timeZone' })}`)
  const zone = res.ok ? googleEventList.pick({ timeZone: true }).safeParse(await res.json().catch(() => undefined)) : undefined
  if (!zone?.success) throw unreachable()
  return zone.data.timeZone
}

/** The event with this id, or undefined when it is gone or was cancelled. */
async function eventNow(caller: SignedIn, id: string): Promise<GoogleEvent | undefined> {
  const res = await call(caller, `${EVENTS}/${encodeURIComponent(id)}?fields=${encodeURIComponent('id,status,summary,location,updated,start,end,extendedProperties/private')}`)
  if (res.status === 404 || res.status === 410) return undefined
  if (!res.ok) throw unreachable()
  const parsed = googleEvent.safeParse(await res.json().catch(() => undefined))
  return parsed.success && parsed.data.status !== 'cancelled' ? parsed.data : undefined
}

const madeFor = (event: GoogleEvent | undefined, meetingId: string) => event?.extendedProperties?.private?.[MADE_BY_KEY] === meetingId

/** Where "back to the meeting in Platinum" points. No student name, no notes: an id in an address that needs a sign-in. */
function meetingLink(request: Request, studentId: string): string {
  const base = (process.env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')
  return `${base}/app/meetings?student=${studentId}`
}

/**
 * Makes the event for a meeting, or brings it up to date. The meeting and the
 * student's first name are read with the caller's own sign-in, so a meeting in
 * another firm is simply not found. For an event that was made in Google and
 * tied to a meeting, only the time is changed: its title and text are the
 * counselor's.
 */
export async function putEvent(caller: SignedIn, request: Request, meetingId: string): Promise<{ eventId: string; sync: 'synced' | 'linked' }> {
  const found = await caller.client.from('meetings').select('id, student_id, title, date, time, duration_min, location, google_event_id').eq('id', meetingId).eq('firm_id', caller.firmId).maybeSingle()
  if (found.error) throw new Error(`reading the meeting failed: ${found.error.message}`)
  const meeting = found.data
  if (!meeting) throw new GoogleError('refused', 'That meeting was not found.', 404)
  const student = await caller.client.from('students').select('first_name').eq('id', meeting.student_id).eq('firm_id', caller.firmId).maybeSingle()
  if (student.error || !student.data) throw new GoogleError('refused', 'That meeting was not found.', 404)

  const zone = await calendarZone(caller)
  const payload = eventPayload({ id: meeting.id, title: meeting.title, date: meeting.date, time: meeting.time, durationMin: meeting.duration_min, location: meeting.location }, student.data.first_name, meetingLink(request, meeting.student_id), zone)

  const existing = meeting.google_event_id ? await eventNow(caller, meeting.google_event_id) : undefined
  if (existing && !madeFor(existing, meeting.id)) {
    // Made in Google and tied to this meeting: move it, change nothing else.
    const end = wallEnd(meeting.date, meeting.time, meeting.duration_min)
    const res = await write(caller, 'PATCH', `/${encodeURIComponent(existing.id)}`, { start: { dateTime: `${meeting.date}T${meeting.time}:00`, timeZone: zone }, end: { dateTime: `${end.date}T${end.time}:00`, timeZone: zone } })
    if (!res.ok) throw unreachable()
    return { eventId: existing.id, sync: 'linked' }
  }
  const res = existing ? await write(caller, 'PATCH', `/${encodeURIComponent(existing.id)}`, payload) : await write(caller, 'POST', '', payload)
  if (!res.ok) throw unreachable()
  const saved = googleEvent.safeParse(await res.json().catch(() => undefined))
  if (!saved.success) throw new GoogleError('google', 'Google Calendar gave an answer that could not be read.', 502)
  return { eventId: saved.data.id, sync: 'synced' }
}

/**
 * Removes the event Platinum made for a meeting that was cancelled here. An
 * event without Platinum's mark for that meeting is left exactly as it is:
 * Platinum never deletes what it did not create.
 */
export async function removeEvent(caller: SignedIn, input: { meetingId: string; eventId: string }): Promise<{ removed: boolean; reason?: 'gone' | 'not_ours' }> {
  const existing = await eventNow(caller, input.eventId)
  if (!existing) return { removed: false, reason: 'gone' }
  if (!madeFor(existing, input.meetingId)) return { removed: false, reason: 'not_ours' }
  const res = await write(caller, 'DELETE', `/${encodeURIComponent(existing.id)}`)
  if (!res.ok && res.status !== 404 && res.status !== 410) throw unreachable()
  return { removed: true }
}
