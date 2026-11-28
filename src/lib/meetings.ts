// The one way a meeting is made, changed or removed from a screen.
//
// Each of these does the store's change and then keeps the counselor's Google
// Calendar in step (src/lib/calendarSync.ts), so no path can do one without the
// other: the Schedule form, a Google event linked to a student, a meeting the
// assistant proposed and the counselor approved, and anything added later.
// Screens call these and never the store's addMeeting, updateMeeting or
// deleteMeeting (scripts/test-assistant.ts checks that).
//
// The calendar is optional. With it off, or Google unreachable, the meeting is
// saved all the same; calendarSync marks it and the screen offers Retry.

import { useStore, type NewMeeting } from '../store/store'
import type { ID, Meeting } from '../types'
import { removeMeetingFromCalendar, syncMeetingToCalendar } from './calendarSync'

/** What about a meeting is on the calendar. An agenda is not. */
const ON_THE_CALENDAR = ['title', 'date', 'time', 'durationMin', 'location'] as const

/**
 * Makes a meeting and puts it on the calendar. `calendar: false` is for a
 * meeting that is not an appointment to keep: one logged after it was held.
 * A meeting made from a Google event already has its event and is not sent back.
 */
export function scheduleMeeting(meeting: NewMeeting, options: { calendar?: boolean } = {}): ID {
  const id = useStore.getState().addMeeting(meeting)
  if (options.calendar !== false && !meeting.googleEventId) void syncMeetingToCalendar(id)
  return id
}

/** Changes a meeting. When the change names its title, time, length or place, its calendar event follows. An agenda alone does not. */
export function changeMeeting(id: ID, patch: Partial<Pick<Meeting, 'title' | 'date' | 'time' | 'durationMin' | 'location' | 'agenda'>>): void {
  const before = useStore.getState().data.meetings.find((m) => m.id === id)
  useStore.getState().updateMeeting(id, patch)
  if (before && before.status === 'scheduled' && ON_THE_CALENDAR.some((key) => key in patch)) void syncMeetingToCalendar(id)
}

/**
 * Removes a meeting, and the event Platinum made for it. `calendar: false` is
 * for a meeting whose event is already gone from Google.
 */
export function removeMeeting(meeting: Pick<Meeting, 'id' | 'googleEventId'>, options: { calendar?: boolean } = {}): void {
  useStore.getState().deleteMeeting(meeting.id)
  if (options.calendar !== false) void removeMeetingFromCalendar(meeting)
}
