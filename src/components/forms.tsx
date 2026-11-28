// The forms a counselor uses to enter their own caseload: students, parents,
// meetings, and logging a meeting that has happened. Each is a modal that
// writes through a store action.

import { changeMeeting, removeMeeting, scheduleMeeting } from '../lib/meetings'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MAX_TEXT_CHARS } from '../../shared/constants'
import { addDays, formatDateLong, formatTime, todayISO } from '../lib/dates'
import { activeStudents, findStudent, fullName, meetingBuckets } from '../lib/derive'
import { CHANNEL_LABEL, LANGUAGE_LABEL } from '../lib/language'
import { draftMeeting, type DraftMode } from '../services/workflows'
import { useData, useStore } from '../store/store'
import type { Channel, ID, Language, Meeting, Parent } from '../types'
import { AiErrorNote, Button, CheckRow, Field, Modal, SegmentedControl, Thinking, inputClass, textareaClass, useAi, useConfirm, useToast } from './ui'

const CHANNELS = Object.entries(CHANNEL_LABEL) as [Channel, string][]
const LANGUAGES = Object.entries(LANGUAGE_LABEL) as [Language, string][]

function FormActions({ onClose, submit, onDelete, deleteLabel, disabled, busy }: { onClose: () => void; submit: string; onDelete?: () => void; deleteLabel?: string; disabled?: boolean; busy?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
      {onDelete ? (
        <Button variant="danger" onClick={onDelete}>
          {deleteLabel}
        </Button>
      ) : (
        <span />
      )}
      <div className="flex gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={disabled} busy={busy}>
          {submit}
        </Button>
      </div>
    </div>
  )
}

// ── Student ─────────────────────────────────────────────────────────────────

export function StudentFormModal({ onClose }: { onClose: () => void }) {
  const addStudent = useStore((s) => s.addStudent)
  const navigate = useNavigate()
  const now = new Date()
  const senior = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear()
  const [f, setF] = useState({ firstName: '', lastName: '', localName: '', gradYear: String(senior), school: '', city: '', email: '', phone: '', preferredChannel: 'text' as Channel })
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch })

  return (
    <Modal title="Add a student" onClose={onClose} typed={Boolean(f.firstName || f.lastName || f.school || f.email || f.phone)}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          const id = addStudent({
            firstName: f.firstName.trim(),
            lastName: f.lastName.trim(),
            localName: f.localName.trim() || undefined,
            gradYear: Number(f.gradYear) || senior,
            school: f.school.trim(),
            city: f.city.trim(),
            email: f.email.trim() || undefined,
            phone: f.phone.trim() || undefined,
            preferredChannel: f.preferredChannel,
          })
          onClose()
          navigate(`/app/students/${id}?tab=profile`)
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            <input className={inputClass} required data-autofocus value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} />
          </Field>
          <Field label="Last name">
            <input className={inputClass} required value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} />
          </Field>
          <Field label="Name in Chinese (optional)">
            <input className={inputClass} value={f.localName} onChange={(e) => set({ localName: e.target.value })} />
          </Field>
          <Field label="Graduation year">
            <input className={inputClass} required inputMode="numeric" pattern="20[0-9]{2}" value={f.gradYear} onChange={(e) => set({ gradYear: e.target.value })} />
          </Field>
          <Field label="School">
            <input className={inputClass} value={f.school} onChange={(e) => set({ school: e.target.value })} />
          </Field>
          <Field label="City">
            <input className={inputClass} value={f.city} onChange={(e) => set({ city: e.target.value })} />
          </Field>
          <Field label="Student email">
            <input className={inputClass} type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="Student phone">
            <input className={inputClass} type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
        </div>
        <Field label="Student prefers to hear from you by">
          <select className={inputClass} value={f.preferredChannel} onChange={(e) => set({ preferredChannel: e.target.value as Channel })}>
            {CHANNELS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-[13px] text-muted">You can add parents, tasks, colleges and scores on the student’s page next.</p>
        <FormActions onClose={onClose} submit="Add student" />
      </form>
    </Modal>
  )
}

// ── Parent ──────────────────────────────────────────────────────────────────

export function ParentFormModal({ studentId, parent, onClose }: { studentId: ID; parent?: Parent; onClose: () => void }) {
  const { addParent, updateParent, removeParent } = useStore.getState()
  const confirm = useConfirm()
  const [f, setF] = useState({
    name: parent?.name ?? '',
    localName: parent?.localName ?? '',
    relationship: parent?.relationship ?? ('Mother' as Parent['relationship']),
    language: parent?.language ?? ('en' as Language),
    channel: parent?.channel ?? ('email' as Channel),
    phone: parent?.phone ?? '',
    email: parent?.email ?? '',
    wechatId: parent?.wechatId ?? '',
    lineId: parent?.lineId ?? '',
    isPrimary: parent?.isPrimary ?? false,
    note: parent?.note ?? '',
  })
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch })
  const clean = (v: string) => v.trim() || undefined

  return (
    <Modal title={parent ? `Edit ${parent.name}` : 'Add a parent or guardian'} onClose={onClose} typed={f.name !== (parent?.name ?? '') || f.note !== (parent?.note ?? '') || f.phone !== (parent?.phone ?? '') || f.email !== (parent?.email ?? '')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          const fields = { ...f, name: f.name.trim(), localName: clean(f.localName), phone: clean(f.phone), email: clean(f.email), wechatId: clean(f.wechatId), lineId: clean(f.lineId), note: clean(f.note) }
          if (parent) updateParent(studentId, parent.id, fields)
          else addParent(studentId, fields)
          onClose()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input className={inputClass} required data-autofocus value={f.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Name in their language (optional)" hint="Used to greet them, e.g. 张伟.">
            <input className={inputClass} value={f.localName} onChange={(e) => set({ localName: e.target.value })} />
          </Field>
          <Field label="Relationship">
            <select className={inputClass} value={f.relationship} onChange={(e) => set({ relationship: e.target.value as Parent['relationship'] })}>
              <option>Mother</option>
              <option>Father</option>
              <option>Guardian</option>
            </select>
          </Field>
          <Field label="Reads">
            <select className={inputClass} value={f.language} onChange={(e) => set({ language: e.target.value as Language })}>
              {LANGUAGES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Phone">
            <input className={inputClass} type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
          <Field label="Email">
            <input className={inputClass} type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="WeChat ID">
            <input className={inputClass} value={f.wechatId} onChange={(e) => set({ wechatId: e.target.value })} />
          </Field>
          <Field label="LINE ID">
            <input className={inputClass} value={f.lineId} onChange={(e) => set({ lineId: e.target.value })} />
          </Field>
        </div>
        <Field label="Preferred channel" hint="Reports and reminders to this parent are drafted for this channel.">
          <select className={inputClass} value={f.channel} onChange={(e) => set({ channel: e.target.value as Channel })}>
            {CHANNELS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <CheckRow checked={f.isPrimary} onChange={(isPrimary) => set({ isPrimary })}>
          Main contact for this family
        </CheckRow>
        <Field label="Your private note (optional)">
          <input className={inputClass} value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. replies fastest to voice messages" />
        </Field>
        <FormActions
          onClose={onClose}
          submit={parent ? 'Save' : 'Add parent'}
          deleteLabel="Remove"
          onDelete={
            parent
              ? async () => {
                  if (!(await confirm({ title: 'Remove parent', body: `Remove ${parent.name}? Their open tasks move to you.`, action: 'Remove parent' }))) return
                  removeParent(studentId, parent.id)
                  onClose()
                }
              : undefined
          }
        />
      </form>
    </Modal>
  )
}

// ── Schedule or reschedule a meeting ────────────────────────────────────────

export function MeetingFormModal({ studentId, meeting, onClose }: { studentId?: ID; meeting?: Meeting; onClose: () => void }) {
  const data = useData()
  const confirm = useConfirm()
  const students = activeStudents(data)
  const [f, setF] = useState({
    studentId: meeting?.studentId ?? studentId ?? students[0]?.id ?? '',
    title: meeting?.title ?? '',
    date: meeting?.date ?? addDays(todayISO(), 7),
    time: meeting?.time ?? '16:00',
    durationMin: String(meeting?.durationMin ?? 45),
    location: meeting?.location ?? 'Zoom',
  })
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch })

  return (
    <Modal title={meeting ? 'Reschedule meeting' : 'Schedule a meeting'} onClose={onClose}>
      {students.length === 0 ? (
        <p className="text-sm text-muted">Add a student first, then you can schedule a meeting with them.</p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const fields = { title: f.title.trim() || 'Check-in', date: f.date, time: f.time, durationMin: Number(f.durationMin) || 45, location: f.location.trim() || undefined }
            // The meeting is saved first and never waits for Google: its event follows, or it says "Not on your calendar yet".
            if (meeting) changeMeeting(meeting.id, fields)
            else scheduleMeeting({ studentId: f.studentId, ...fields })
            onClose()
          }}
        >
          {!meeting && !studentId && (
            <Field label="Student">
              <select className={inputClass} value={f.studentId} onChange={(e) => set({ studentId: e.target.value })}>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {fullName(s)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="What the meeting is about">
            <input className={inputClass} data-autofocus value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. UC essays and campus list" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date">
              <input className={inputClass} type="date" required value={f.date} onChange={(e) => set({ date: e.target.value })} />
            </Field>
            <Field label="Time">
              <input className={inputClass} type="time" required value={f.time} onChange={(e) => set({ time: e.target.value })} />
            </Field>
            <Field label="Length (minutes)">
              <input className={inputClass} inputMode="numeric" value={f.durationMin} onChange={(e) => set({ durationMin: e.target.value })} />
            </Field>
            <Field label="Where">
              <input className={inputClass} value={f.location} onChange={(e) => set({ location: e.target.value })} />
            </Field>
          </div>
          <p className="text-[13px] text-muted">Platinum keeps your schedule. It does not send calendar invitations.</p>
          <FormActions
            onClose={onClose}
            submit={meeting ? 'Save' : 'Schedule'}
            deleteLabel="Cancel this meeting"
            onDelete={
              meeting
                ? async () => {
                    if (!(await confirm({ title: 'Cancel this meeting', body: 'Cancel this meeting and remove it from the schedule?', action: 'Cancel this meeting' }))) return
                    removeMeeting(meeting)
                    onClose()
                  }
                : undefined
            }
          />
        </form>
      )}
    </Modal>
  )
}

// ── Log a meeting that happened ─────────────────────────────────────────────

const NEW_MEETING = 'new'

/**
 * Paste or type notes (or a transcript) from a meeting, and the AI drafts the
 * follow-through for review. Works for a meeting that was on the schedule or
 * for one that was not.
 */
export function LogMeetingModal({ studentId, meetingId, onClose }: { studentId?: ID; meetingId?: ID; onClose: () => void }) {
  const data = useData()
  const navigate = useNavigate()
  const toast = useToast()
  const { completeMeeting } = useStore.getState()
  const students = activeStudents(data)
  const [student, setStudent] = useState(studentId ?? students[0]?.id ?? '')
  const scheduled = (() => {
    const b = meetingBuckets(data, student)
    const named = data.meetings.find((m) => m.id === meetingId && m.studentId === student)
    const open = [b.upcoming, ...b.later].filter((m): m is Meeting => Boolean(m))
    return named && !open.includes(named) ? [named, ...open] : open
  })()
  const [which, setWhich] = useState(meetingId ?? scheduled[0]?.id ?? NEW_MEETING)
  const [title, setTitle] = useState('')
  // A meeting whose day has passed was held on that day.
  const [heldOn, setHeldOn] = useState(() => {
    const named = data.meetings.find((m) => m.id === meetingId)
    return named && named.date < todayISO() ? named.date : todayISO()
  })
  const [notes, setNotes] = useState('')
  const [mode, setMode] = useState<DraftMode>('full')
  const { busy, error, run } = useAi()
  const [logged, setLogged] = useState<ID>()
  const who = findStudent(data, student)
  const tooLong = notes.length > MAX_TEXT_CHARS

  const open = (id: ID) => {
    onClose()
    navigate(`/app/meetings?student=${id}`)
  }

  const submit = () =>
    run(async () => {
      // Log the meeting first so nothing typed is lost if drafting fails.
      let id = logged
      if (!id) {
        // A meeting logged after it was held is a record, not an appointment: it does not go on the calendar.
        id = which === NEW_MEETING ? scheduleMeeting({ studentId: student, title: title.trim() || 'Meeting', date: heldOn, time: '16:00' }, { calendar: false }) : which
        completeMeeting(id, notes, heldOn)
        setLogged(id)
      }
      if (notes.trim()) await draftMeeting(id, mode)
      toast(notes.trim() ? 'Meeting logged. Drafts are ready for your review.' : 'Meeting logged.')
      open(student)
    })

  return (
    <Modal title="Log a meeting" onClose={onClose} wide typed={notes.trim() !== ''}>
      {students.length === 0 ? (
        <p className="text-sm text-muted">Add a student first, then you can log a meeting with them.</p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {!studentId && (
              <Field label="Student">
                <select
                  className={inputClass}
                  value={student}
                  disabled={Boolean(logged)}
                  onChange={(e) => {
                    setStudent(e.target.value)
                    setWhich(meetingBuckets(data, e.target.value).upcoming?.id ?? NEW_MEETING)
                  }}
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {fullName(s)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Which meeting">
              <select className={inputClass} value={which} disabled={Boolean(logged)} onChange={(e) => setWhich(e.target.value)}>
                {scheduled.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} · {formatDateLong(m.date)}, {formatTime(m.time)}
                  </option>
                ))}
                <option value={NEW_MEETING}>A meeting that was not on the schedule</option>
              </select>
            </Field>
            {which === NEW_MEETING && (
              <Field label="What it was about">
                <input className={inputClass} value={title} disabled={Boolean(logged)} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Essay check-in" />
              </Field>
            )}
            <Field label="Held on">
              <input className={inputClass} type="date" required max={todayISO()} value={heldOn} disabled={Boolean(logged)} onChange={(e) => setHeldOn(e.target.value)} />
            </Field>
          </div>

          <Field label="Your notes or a transcript" hint={`${notes.length.toLocaleString()} of ${MAX_TEXT_CHARS.toLocaleString()} characters. The AI reads only what is here.`}>
            <textarea className={textareaClass} rows={9} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Paste or type what was discussed, decided and assigned…" />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <label data-press className="inline-flex min-h-11 cursor-pointer items-center rounded-control border border-line-strong px-4 text-sm font-semibold hover:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
              <input
                type="file"
                accept=".txt,.md,.vtt,text/plain"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  // Read in the browser only. The file itself is not uploaded or stored.
                  if (file) setNotes(await file.text())
                  e.target.value = ''
                }}
              />
              Load a text file
            </label>
            <SegmentedControl
              label="What to draft"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'full', label: 'Notes, tasks, parent update' },
                { value: 'tasks', label: 'Tasks only' },
              ]}
            />
          </div>

          {tooLong && <AiErrorNote message="That is more text than one request can carry. Shorten it or split it across two meetings." />}
          <AiErrorNote message={error} />
          {logged && error && (
            <p className="text-[13px] text-muted">
              The meeting itself is saved. You can try drafting again, or{' '}
              <button type="button" className="tap-link font-semibold text-accent underline" onClick={() => open(student)}>
                open it without drafts
              </button>
              .
            </p>
          )}
          {busy && <Thinking label={`AI is reading the notes and drafting follow-ups for ${who?.firstName}…`} />}
          <p className="text-[13px] text-muted">Everything drafted waits for your approval. Nothing goes to {who?.firstName ?? 'the student'} or the family from here.</p>
          <FormActions onClose={onClose} submit={logged ? 'Try drafting again' : notes.trim() ? 'Log and draft' : 'Log without notes'} disabled={tooLong} busy={busy} />
        </form>
      )}
    </Modal>
  )
}
