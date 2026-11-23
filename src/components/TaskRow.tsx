// One task, used in both the counselor view and the student view. Collapsed it
// is a single scannable line; expanded it holds the update form (progress,
// note, attach a link or file).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { daysFromToday, formatDate } from '../lib/dates'
import { fullName, isLate, ownerLabel } from '../lib/derive'
import { useStore } from '../store/store'
import type { Actor, Student, Task, TaskStatus } from '../types'
import { Button, OwnerBadge, Pill, cx, inputClass } from './ui'

/** "Due Nov 28 · in 6 days", or a red late marker. */
export function DueLabel({ task }: { task: Task }) {
  if (task.status === 'done') {
    return <span className="text-xs text-faint">Done {task.completedOn ? formatDate(task.completedOn) : ''}</span>
  }
  const n = daysFromToday(task.dueDate)
  if (isLate(task)) {
    return (
      <Pill tone="bad">
        {-n} {n === -1 ? 'day' : 'days'} late
      </Pill>
    )
  }
  const when = n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`
  return (
    <span className={cx('text-xs', n <= 2 ? 'font-medium text-warn' : 'text-muted')}>
      Due {formatDate(task.dueDate)} · {when}
    </span>
  )
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
]

export function TaskRow({
  task,
  student,
  actor,
  showStudent = false,
  showOwner = true,
}: {
  task: Task
  student: Student
  /** Who is using the row. Recorded on updates so the other view can say who did what. */
  actor: Extract<Actor, 'student' | 'counselor'>
  showStudent?: boolean
  showOwner?: boolean
}) {
  const [open, setOpen] = useState(false)
  const updateTaskProgress = useStore((s) => s.updateTaskProgress)
  const done = task.status === 'done'

  return (
    <li className={cx('border-b border-line last:border-b-0', isLate(task) && 'bg-bad-soft/40')}>
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          aria-label={done ? 'Mark not done' : 'Mark done'}
          onClick={() => updateTaskProgress(task.id, { status: done ? 'todo' : 'done' }, actor)}
          className={cx(
            'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] text-white',
            done ? 'border-good bg-good' : 'border-faint bg-surface hover:border-good',
          )}
        >
          {done && '✓'}
        </button>
        <button onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <span className={cx('block text-sm', done ? 'text-faint line-through' : 'text-ink')}>{task.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {showStudent && <span className="text-xs font-medium text-ink">{fullName(student)}</span>}
            {showOwner && <OwnerBadge owner={task.owner} label={ownerLabel(task, student)} />}
            <DueLabel task={task} />
            {task.status === 'in_progress' && <Pill tone="info">In progress</Pill>}
            {task.attachments.length > 0 && <span className="text-xs text-muted">📎 {task.attachments.length}</span>}
            {task.source !== 'counselor' && <Pill tone="ai">✦ {task.source === 'ai_meeting' ? 'From meeting' : 'From notes'}</Pill>}
          </span>
          {task.progressNote && !open && <span className="mt-1 block truncate text-xs italic text-muted">“{task.progressNote}”</span>}
        </button>
        <button onClick={() => setOpen(!open)} className="px-1 text-faint" aria-label={open ? 'Collapse' : 'Expand'}>
          {open ? '▾' : '▸'}
        </button>
      </div>
      {open && <TaskUpdatePanel task={task} student={student} actor={actor} />}
    </li>
  )
}

function TaskUpdatePanel({ task, student, actor }: { task: Task; student: Student; actor: 'student' | 'counselor' }) {
  const updateTaskProgress = useStore((s) => s.updateTaskProgress)
  const updateTask = useStore((s) => s.updateTask)
  const attachToTask = useStore((s) => s.attachToTask)
  const [note, setNote] = useState(task.progressNote ?? '')
  const [url, setUrl] = useState('')

  const addLink = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    const isDoc = trimmed.includes('docs.google.com')
    attachToTask(task.id, { kind: 'link', name: isDoc ? `${task.title} (Google Doc)` : trimmed.replace(/^https?:\/\//, '').slice(0, 60), url: trimmed }, actor)
    setUrl('')
  }

  return (
    <div className="space-y-4 border-t border-line bg-canvas/60 px-4 py-4 sm:pl-12">
      {task.detail && <p className="text-sm text-muted">{task.detail}</p>}

      {task.attachments.length > 0 && (
        <ul className="space-y-1">
          {task.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <span>{a.kind === 'link' ? '🔗' : '📄'}</span>
              {a.url ? (
                <a href={a.url} target="_blank" rel="noreferrer" className="truncate text-accent hover:underline">
                  {a.name}
                </a>
              ) : (
                <span className="truncate text-ink">{a.name}</span>
              )}
              <span className="shrink-0 text-xs text-faint">
                {a.addedBy === 'student' ? student.firstName : 'Counselor'}, {formatDate(a.addedOn)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">Progress</p>
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => updateTaskProgress(task.id, { status: o.value }, actor)}
              className={cx(
                'rounded-md px-3 py-1.5 text-xs font-medium',
                task.status === o.value ? 'bg-ink text-white' : 'text-muted hover:text-ink',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (note.trim() !== (task.progressNote ?? '')) updateTaskProgress(task.id, { progressNote: note.trim() }, actor)
        }}
      >
        <input
          className={inputClass}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={actor === 'student' ? 'Where are you with this? Anything blocking you?' : 'Progress note'}
          aria-label="Progress note"
        />
        <Button type="submit" disabled={note.trim() === (task.progressNote ?? '')}>
          Save note
        </Button>
      </form>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted">Attach your work</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            addLink()
          }}
        >
          <input
            className={inputClass}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a link, e.g. your Google Doc"
            aria-label="Link"
          />
          <Button type="submit" disabled={!url.trim()}>
            Add link
          </Button>
        </form>
        <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-sm text-accent hover:underline">
          <input
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Only the file name is recorded. The file itself never leaves the device.
              if (file) attachToTask(task.id, { kind: 'file', name: file.name }, actor)
              e.target.value = ''
            }}
          />
          or upload a file
        </label>
        <span className="ml-2 text-xs text-faint">Demo: only the file name is recorded.</span>
      </div>

      {actor === 'counselor' && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2 text-xs text-muted">
            Due
            <input
              type="date"
              className={cx(inputClass, 'w-auto py-1')}
              value={task.dueDate}
              onChange={(e) => e.target.value && updateTask(task.id, { dueDate: e.target.value })}
            />
          </label>
          <Link to={`/student/${student.id}`} className="text-xs text-muted hover:text-ink">
            See this in {student.firstName}’s view →
          </Link>
        </div>
      )}
    </div>
  )
}
