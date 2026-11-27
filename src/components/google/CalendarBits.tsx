// The small pieces that show Google Calendar beside Platinum's meetings: an
// event from Google with its label, "Link to a student", the question asked
// when a linked event was changed in Google, and the line under a meeting that
// is not on the calendar yet.
//
// Text from Google (an event's title and place) is shown as text and nothing
// more. It is never read as an instruction and never handed to the assistant.
// An event is not stored unless a counselor links it.

import { useState } from 'react'
import { alreadyKept, googleChange, suggestStudent, type CalendarEvent, type GoogleChange } from '../../../shared/calendar'
import { removeMeetingFromCalendar, syncMeetingToCalendar } from '../../lib/calendarSync'
import { formatDateLong, formatTime } from '../../lib/dates'
import { activeStudents, fullName } from '../../lib/derive'
import { calendarReady, useGoogleStatus } from '../../services/google'
import { useData, useStore } from '../../store/store'
import type { Meeting } from '../../types'
import { Button, Field, Modal, Pill, cx, inputClass, useConfirm, useToast } from '../ui'

/** Google events that are not already a Platinum meeting: neither tied to one, nor made by Platinum for one that still exists. */
export function looseEvents(events: CalendarEvent[], meetings: Meeting[]): CalendarEvent[] {
  const tied = new Set(meetings.map((m) => m.googleEventId).filter(Boolean))
  const ids = new Set(meetings.map((m) => m.id))
  return events.filter((e) => !e.cancelled && e.date && !tied.has(e.id) && !(e.madeFor && ids.has(e.madeFor)))
}

/** The change to ask about for one meeting, if Google has one the counselor has not already answered. */
export function changeFor(meeting: Meeting, events: CalendarEvent[]): { change: GoogleChange; event: CalendarEvent } | undefined {
  if (!meeting.googleEventId) return undefined
  // Only an event Google actually sent back is compared: one outside the days on screen says nothing.
  const event = events.find((e) => e.id === meeting.googleEventId)
  if (!event || alreadyKept(meeting.googleSync, event.updated)) return undefined
  const change = googleChange(meeting, event)
  return change ? { change, event } : undefined
}

/** One event from Google, marked as Google's, with the way to make it a meeting. */
export function GoogleEventRow({ event, className }: { event: CalendarEvent; className?: string }) {
  const [linking, setLinking] = useState(false)
  return (
    <div className={cx('flex flex-col gap-1 rounded-lg border border-dashed border-line-strong bg-surface px-3 py-2 text-left', className)}>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Pill>Google</Pill>
        <span className="nums text-xs font-semibold text-muted">{event.time ? formatTime(event.time) : 'All day'}</span>
      </span>
      <span className="break-words text-[13px] font-semibold text-ink">{event.title}</span>
      {event.location && <span className="break-words text-xs text-muted">{event.location}</span>}
      {event.time && (
        <Button variant="quiet" className="-ml-3 self-start" onClick={() => setLinking(true)} aria-label={`Link “${event.title}” to a student`}>
          Link to a student
        </Button>
      )}
      {linking && <LinkEventModal event={event} onClose={() => setLinking(false)} />}
    </div>
  )
}

/** Makes a Google event a Platinum meeting for the student the counselor chooses. A name in the title is a suggestion, never a decision. */
function LinkEventModal({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const data = useData()
  const students = activeStudents(data)
  const suggested = suggestStudent(event.title, students)
  const [studentId, setStudentId] = useState(suggested?.id ?? '')
  // The title was typed in Google by whoever could write to the calendar. The counselor sees it and can change it before it becomes a meeting's title.
  const [title, setTitle] = useState(event.title)
  const addMeeting = useStore((s) => s.addMeeting)
  const toast = useToast()
  return (
    <Modal title="Link to a student" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          const student = students.find((s) => s.id === studentId)
          if (!student || !event.time) return
          // Tied to the event that is already there. Platinum did not make it, and will never delete it.
          addMeeting({ studentId, title: title.trim() || 'Meeting', date: event.date, time: event.time, durationMin: event.durationMin || 45, location: event.location, googleEventId: event.id, googleSync: 'linked' })
          toast(`“${title.trim() || 'Meeting'}” is now a meeting with ${student.firstName}.`)
          onClose()
        }}
      >
        <p className="text-sm text-ink-soft">
          <span className="font-semibold text-ink">{event.title}</span>
          <br />
          {formatDateLong(event.date)}
          {event.time && `, ${formatTime(event.time)}`}
        </p>
        <Field label="Student" hint={suggested ? `Suggested because the title names ${suggested.firstName}. Check before you link.` : 'This makes a Platinum meeting for the student, tied to this event. The event itself is not changed.'}>
          <select data-autofocus className={inputClass} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Choose a student…</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {fullName(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What the meeting is about" hint="From the event’s title. Change it if it is not what you would call the meeting.">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!studentId}>
            Link
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** "Changed in Google Calendar: now Tue 4:00 PM. Update the meeting?" Platinum never moves or removes a meeting by itself. */
export function GoogleChangeNote({ meeting, events, className, name }: { meeting: Meeting; events: CalendarEvent[]; className?: string; /** Whose meeting it is, where several are listed together. */ name?: string }) {
  const found = changeFor(meeting, events)
  const { updateMeeting, setMeetingCalendar, deleteMeeting } = useStore.getState()
  const confirm = useConfirm()
  if (!found) return null
  const { change, event } = found
  const keep = () => setMeetingCalendar(meeting.id, { googleSync: `kept:${event.updated ?? ''}` })
  return (
    <div role="status" className={cx('flex flex-col gap-2 rounded-lg bg-warn-soft px-3 py-2', className)}>
      <p className="text-[13px] font-medium text-warn">
        {name && <span className="font-semibold">{name}: </span>}
        {change.kind === 'moved' ? (
          <>
            Changed in Google Calendar: now {formatDateLong(change.date)}, {formatTime(change.time)}
            {change.durationMin !== meeting.durationMin && `, ${change.durationMin} minutes`}. Update the meeting?
          </>
        ) : (
          'Cancelled in Google Calendar. Remove the meeting here too?'
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {change.kind === 'moved' ? (
          <Button onClick={() => updateMeeting(meeting.id, { date: change.date, time: change.time, durationMin: change.durationMin })}>Update</Button>
        ) : (
          <Button
            variant="danger"
            onClick={async () => {
              if (await confirm({ title: 'Remove meeting', body: 'Remove this meeting from Platinum? Its notes go with it. Tasks that came from it are kept.', action: 'Remove meeting' })) deleteMeeting(meeting.id)
            }}
          >
            Remove meeting
          </Button>
        )}
        <Button variant="quiet" onClick={keep}>
          Keep
        </Button>
      </div>
    </div>
  )
}

/** Under a scheduled meeting, when the calendar is on: whether its event is there, and Retry when it is not. */
export function CalendarLine({ meeting, className }: { meeting: Meeting; className?: string }) {
  const on = calendarReady(useGoogleStatus())
  const [busy, setBusy] = useState(false)
  if (!on || meeting.status !== 'scheduled') return null
  const there = Boolean(meeting.googleEventId) && meeting.googleSync !== 'failed'
  if (there) return <p className={cx('text-xs text-muted', className)}>{meeting.googleSync === 'linked' ? 'Tied to an event on your Google Calendar.' : 'On your Google Calendar.'}</p>
  return (
    <p className={cx('flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-warn', className)}>
      Not on your calendar yet.
      <Button
        variant="quiet"
        busy={busy}
        aria-label={`Put “${meeting.title}” on your Google Calendar`}
        onClick={() => {
          setBusy(true)
          void syncMeetingToCalendar(meeting.id).finally(() => setBusy(false))
        }}
      >
        Retry
      </Button>
    </p>
  )
}

export { removeMeetingFromCalendar, syncMeetingToCalendar }
