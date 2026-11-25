// Student overview. Left: tasks (to do, then done) and the college list.
// Right: the brief for the next meeting and the family's contact details.

import { useState } from 'react'
import { MeetingFormModal, ParentFormModal } from '../../../components/forms'
import { BriefCard } from '../../../components/meeting/BriefCard'
import { AddTaskForm, TaskItem } from '../../../components/TaskRows'
import { MotionList } from '../../../components/motion'
import { Button, Card, CardHeader, Disclosure, Empty, Pill, ProgressWithCount, SectionLabel, cx, inputBase } from '../../../components/ui'
import { formatDate, formatDateLong, formatTimestamp } from '../../../lib/dates'
import { eventWhen, isNotResponding, isOpen, isSlipping, nextMeeting, noteStatusLine, personalNotesByLife, sortByUrgency, statusText, summarize, tasksFor } from '../../../lib/derive'
import { CHANNEL_LABEL, LANGUAGE_LABEL } from '../../../lib/language'
import { useData, useStore } from '../../../store/store'
import { CollegeList } from './CollegeList'
import type { Parent, ParentCopySetting, PersonalNote, Student } from '../../../types'

export default function Overview({ student }: { student: Student }) {
  const data = useData()
  const [scheduling, setScheduling] = useState(false)
  const upcoming = nextMeeting(data, student.id)
  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-6">
        <TasksCard student={student} />
        <CollegeList student={student} />
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        {upcoming ? (
          <BriefCard meeting={upcoming} student={student} />
        ) : (
          <Card tone="accent" className="flex flex-col items-start gap-3 p-5">
            <h2 className="text-base font-semibold">No meeting scheduled</h2>
            <p className="text-sm text-ink-soft">Schedule the next meeting and a brief will be ready here before it.</p>
            <Button variant="primary" onClick={() => setScheduling(true)}>
              Schedule a meeting
            </Button>
          </Card>
        )}
        <ThingsToRemember student={student} />
        <Family student={student} />
      </div>
      {scheduling && <MeetingFormModal studentId={student.id} onClose={() => setScheduling(false)} />}
    </div>
  )
}

// ── Tasks ───────────────────────────────────────────────────────────────────

function TasksCard({ student }: { student: Student }) {
  const data = useData()
  const [adding, setAdding] = useState(false)
  const [showAllDone, setShowAllDone] = useState(false)
  const tasks = sortByUrgency(tasksFor(data, student.id))
  const open = tasks.filter(isOpen)
  const done = tasks.filter((t) => !isOpen(t))
  const summary = summarize(data, student)

  return (
    <Card className="flex flex-col gap-4 p-5">
      <CardHeader size="section" title="Tasks" action={!adding && <Button onClick={() => setAdding(true)}>Add task</Button>} />
      {adding && <AddTaskForm student={student} onDone={() => setAdding(false)} />}
      {tasks.length === 0 ? (
        !adding && (
          <Empty title={`No tasks for ${student.firstName} yet. Add one, or log a meeting and let the AI draft them from your notes.`}>
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add task
            </Button>
          </Empty>
        )
      ) : (
        <>
          <ProgressWithCount long progress={summary.progress} status={summary.status} text={summary.progress.late > 0 ? `${summary.progress.late} late` : statusText(summary)} />
          <SectionLabel>To do · {open.length}</SectionLabel>
          {open.length === 0 ? (
            <p className="text-sm text-muted">Everything is done.</p>
          ) : (
            <MotionList itemClassName="pb-2 last:pb-0">
              {open.map((t) => (
                <TaskItem key={t.id} task={t} student={student} viewer="counselor" />
              ))}
            </MotionList>
          )}
          {done.length > 0 && (
            <>
              <SectionLabel>Done · {done.length}</SectionLabel>
              <MotionList itemClassName="pb-2 last:pb-0">
                {(showAllDone ? done : done.slice(0, 3)).map((t) => (
                  <TaskItem key={t.id} task={t} student={student} viewer="counselor" />
                ))}
              </MotionList>
              {done.length > 3 && (
                <Button variant="quiet" className="self-start" onClick={() => setShowAllDone(!showAllDone)}>
                  {showAllDone ? 'Show fewer' : `Show ${done.length - 3} more done`}
                </Button>
              )}
            </>
          )}
        </>
      )}
    </Card>
  )
}

// ── Things to remember ──────────────────────────────────────────────────────

/**
 * What the counselor is keeping track of about this student: things they
 * mentioned in passing, saved from meetings once approved or typed in here.
 * Each line says where the note stands (coming up, happened, mentioned). Notes
 * that are over, or from an earlier meeting cycle, drop into "No longer used".
 */
function ThingsToRemember({ student }: { student: Student }) {
  const data = useData()
  const { addPersonalNote, deletePersonalNote } = useStore.getState()
  const { live, finished } = personalNotesByLife(data, student.id)
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  const row = (note: PersonalNote) => (
    <div key={note.id} className="flex items-start justify-between gap-2 text-sm">
      <div className="min-w-0">
        <p className="break-words">
          {note.text}
          {note.eventDate && <span className="text-muted"> · {note.eventDateApprox ? `around ${formatDate(note.eventDate)}` : `${formatDateLong(note.eventDate)}, ${eventWhen(note.eventDate)}`}</span>}
        </p>
        <p className="text-[13px] text-ink-soft">{noteStatusLine(data, note)}</p>
        <p className="text-xs text-muted">
          {note.source === 'meeting' ? 'From a meeting' : 'Added by hand'} · {note.approval.by}, {formatTimestamp(note.approval.at)}
        </p>
      </div>
      <Button variant="quiet" className="-my-1.5 shrink-0" aria-label={`Delete: ${note.text}`} onClick={() => deletePersonalNote(note.id)}>
        Delete
      </Button>
    </div>
  )
  return (
    <Card className="flex flex-col gap-3 p-5">
      <CardHeader title="Things to remember" count={live.length || undefined} />
      {live.length === 0 ? (
        <p className="text-sm text-muted">Nothing current. Things {student.firstName} mentions in passing in a meeting appear here once you approve them.</p>
      ) : (
        <MotionList itemClassName="border-t border-line py-2.5 first:border-t-0 first:pt-0">{live.map(row)}</MotionList>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          addPersonalNote(student.id, text, date || undefined)
          setText('')
          setDate('')
        }}
      >
        <input className={cx(inputBase, 'min-w-[10rem] flex-1 basis-full')} maxLength={300} placeholder="Add one, e.g. school play on Friday" aria-label="Add a thing to remember" value={text} onChange={(e) => setText(e.target.value)} />
        <input type="date" className={inputBase} aria-label="Date of the event, if there is one" value={date} onChange={(e) => setDate(e.target.value)} />
        <Button type="submit" disabled={!text.trim()}>
          Add
        </Button>
      </form>
      {finished.length > 0 && (
        <Disclosure label="No longer used" count={finished.length}>
          <MotionList itemClassName="border-t border-line py-2.5 first:border-t-0">{finished.map(row)}</MotionList>
        </Disclosure>
      )}
      <p className="text-xs text-muted">
        A text to {student.firstName} brings one of these up: good luck beforehand, “how did it go?” afterwards, and then not again. With a date it is kept until a week after the day. Without one it is dropped when you log the next meeting. Never
        used in anything a parent reads. {student.firstName} cannot see this list.
      </p>
    </Card>
  )
}

// ── Family ──────────────────────────────────────────────────────────────────

const PARENT_COPY_OPTIONS: { value: ParentCopySetting; label: string }[] = [
  { value: 'always', label: 'Always' },
  { value: 'when_slipping', label: 'Only when slipping' },
  { value: 'never', label: 'Never' },
]

/** When a reminder or weekly text to the student also gets a short, separate message to the main contact. */
function ParentCopyRow({ student }: { student: Student }) {
  const data = useData()
  const updateStudent = useStore((s) => s.updateStudent)
  const setting = student.parentCopy ?? 'when_slipping'
  const slipping = isSlipping(data, student)
  const quiet = isNotResponding(data, student)
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
      <label className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">Also tell a parent</span>
        <select
          className={inputBase}
          value={setting}
          onChange={(e) => updateStudent(student.id, { parentCopy: e.target.value === 'when_slipping' ? undefined : (e.target.value as ParentCopySetting) })}
        >
          {PARENT_COPY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted">
        {setting === 'never'
          ? `Reminders and weekly texts to ${student.firstName} do not offer a parent copy.`
          : `Whether “Also tell parent” starts ticked on a reminder or weekly text to ${student.firstName}. The copy is its own short draft to the main contact, and you approve it separately.`}
        {setting === 'when_slipping' &&
          ` “Slipping” means a late task, or no activity from ${student.firstName} for 5 days after your last message. Right now: ${slipping ? (quiet ? 'slipping (not responding)' : 'slipping (late task)') : 'not slipping'}.`}
      </p>
    </div>
  )
}


function Family({ student }: { student: Student }) {
  const [editing, setEditing] = useState<Parent | 'new'>()
  const line = (parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ')
  return (
    <Card className="flex flex-col gap-4 p-5">
      <CardHeader title="Family" action={<Button onClick={() => setEditing('new')}>Add parent</Button>} />
      {student.parents.length === 0 && <p className="text-sm text-muted">No parent or guardian yet. Add one to send reports and reminders in their language.</p>}
      {student.parents.map((p) => (
        <div key={p.id} className="flex flex-col gap-1 border-t border-line pt-3 text-sm first:border-t-0 first:pt-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="font-semibold">{p.name}</span>
              {p.localName && <span className="text-muted"> {p.localName}</span>}
              <span className="text-muted">
                {' '}
                · {p.relationship.toLowerCase()}
                {p.isPrimary && ' · main contact'}
              </span>
            </div>
            <Button variant="quiet" className="-my-2 shrink-0" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
              Edit
            </Button>
          </div>
          {(p.wechatId || p.lineId) && <div className="text-[13px] text-ink-soft">{line([p.wechatId && `WeChat: ${p.wechatId}`, p.lineId && `LINE: ${p.lineId}`])}</div>}
          {(p.phone || p.email) && <div className="break-words text-[13px] text-ink-soft">{line([p.phone, p.email])}</div>}
          {p.note && <div className="text-[13px] italic text-muted">{p.note}</div>}
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Pill>Reads {LANGUAGE_LABEL[p.language]}</Pill>
            <Pill>Prefers {CHANNEL_LABEL[p.channel]}</Pill>
          </div>
        </div>
      ))}
      <div className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
        <div>
          <span className="font-semibold">{student.firstName}</span>
          <span className="text-muted"> · student</span>
        </div>
        {(student.phone || student.email) && <div className="break-words text-[13px] text-ink-soft">{line([student.phone, student.email])}</div>}
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Pill>Prefers {CHANNEL_LABEL[student.preferredChannel ?? 'text']}</Pill>
        </div>
        <p className="mt-1 text-xs text-muted">Edit {student.firstName}’s details on the Profile tab. Parents never sign in: they receive reports and reminders.</p>
      </div>
      {student.parents.length > 0 && <ParentCopyRow student={student} />}
      {editing && <ParentFormModal studentId={student.id} parent={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} />}
    </Card>
  )
}
