// Keeping a meeting and its Google Calendar event in step, from the browser.
// The server does the talking to Google (api/google); this asks it to, after
// the meeting itself has been saved, and records the answer on the meeting.
//
// A meeting never waits for Google. If Google refuses or cannot be reached the
// meeting is saved all the same and is marked "failed", which the screen shows
// as "Not on your calendar yet" with Retry. With the calendar turned off none
// of this runs.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { CalendarEvent, CalendarRead } from '../../shared/calendar'
import { calendarReady, callGoogle, googleStatusNow, useGoogleStatus } from '../services/google'
import { useStore } from '../store/store'
import type { ID, Meeting } from '../types'
import { notify } from './notify'

/** Makes or updates the event for a meeting. Resolves when the answer is on the meeting; never rejects. */
export async function syncMeetingToCalendar(meetingId: ID): Promise<void> {
  if (!calendarReady(googleStatusNow())) return
  const store = useStore.getState()
  // The server reads the meeting from the database, so it has to be there first.
  await store.whenSaved()
  if (!useStore.getState().data.meetings.some((m) => m.id === meetingId)) return
  try {
    const { eventId, sync } = await callGoogle<{ eventId: string; sync: 'synced' | 'linked' }>('calendar_put', { meetingId })
    useStore.getState().setMeetingCalendar(meetingId, { googleEventId: eventId, googleSync: sync })
  } catch {
    useStore.getState().setMeetingCalendar(meetingId, { googleSync: 'failed' })
  }
}

/** After a meeting is cancelled here: removes the event Platinum made for it. An event it did not make is left on the calendar. */
export async function removeMeetingFromCalendar(meeting: Pick<Meeting, 'id' | 'googleEventId'>): Promise<void> {
  if (!meeting.googleEventId || !calendarReady(googleStatusNow())) return
  try {
    const { removed, reason } = await callGoogle<{ removed: boolean; reason?: string }>('calendar_remove', { meetingId: meeting.id, eventId: meeting.googleEventId })
    if (!removed && reason === 'not_ours') notify('The meeting is removed here. Its event was made in Google Calendar, so it is still on your calendar.')
  } catch {
    notify('The meeting is removed here, but its event could not be removed from Google Calendar. Remove it there.')
  }
}

// ── Reading the calendar for a screen ───────────────────────────────────────

let lastRead: string | undefined
const readListeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  readListeners.add(listener)
  return () => readListeners.delete(listener)
}
/** When the calendar was last read in this tab, for Settings. */
export const useLastCalendarRead = () => useSyncExternalStore(subscribe, () => lastRead)

export interface CalendarView {
  /** True when the calendar is turned on for this connection. */
  on: boolean
  events: CalendarEvent[]
  timeZone?: string
  loading: boolean
  error?: string
  refresh: () => void
}

/**
 * The counselor's Google events from `from` to `to`, read when the screen
 * opens and when Refresh is pressed. Nothing is polled and nothing is stored:
 * leaving the screen forgets them.
 */
export function useCalendarEvents(from: string, to: string): CalendarView {
  const on = calendarReady(useGoogleStatus())
  const [read, setRead] = useState<CalendarRead>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [turn, setTurn] = useState(0)
  useEffect(() => {
    if (!on) return
    let live = true
    setLoading(true)
    setError(undefined)
    callGoogle<CalendarRead>('calendar_events', { from, to })
      .then((answer) => {
        if (!live) return
        setRead(answer)
        lastRead = answer.readAt
        readListeners.forEach((l) => l())
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Google Calendar could not be read.'))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [on, from, to, turn])
  const refresh = useCallback(() => setTurn((n) => n + 1), [])
  return { on, events: on ? (read?.events ?? []) : [], timeZone: read?.timeZone, loading, error, refresh }
}
