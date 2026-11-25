// Task rows, used in the counselor's student page, meeting reports and the
// student's own view. Open tasks are bordered rows with a check circle; late
// ones get the red left edge and tint. Done tasks are quiet grey rows.

import { useState } from 'react'
import { formatDate } from '../lib/dates'
import { DOC_CATEGORIES, daysLate, isLate, isOpen, ownerLabel } from '../lib/derive'
import { useData, useStore } from '../store/store'
import type { Actor, DocCategory, Student, Task } from '../types'
import { ReminderComposer, reminderRecipient } from './ReminderComposer'
import { Button, CheckCircle, Pill, SectionLabel, cx, inputBase, inputClass, useConfirm } from './ui'

type Viewer = Extract<Actor, 'student' | 'counselor'>

const WHO: Record<Actor, (s: Student) => string> = {
  student: (s) => s.firstName,
  parent: () => 'a parent',
  counselor: () => 'you',
  ai: () => 'AI',
  system: () => 'the system',
}

function DueChip({ task }: { task: Task }) {
  const late = daysLate(task)
  if (late > 0) return <Pill tone="bad" className="px-3 py-1 text-[13px]">{late} {late === 1 ? 'day' : 'days'} late</Pill>
  return <Pill tone="neutral" className="px-3 py-1 text-[13px]">Due {formatDate(task.dueDate)}</Pill>
}

/** Where a task came from, e.g. "from the Nov 10 meeting". */
function useSourceText(task: Task): string | undefined {
  const meeting = useData().meetings.find((m) => m.id === task.meetingId)
  if (meeting) return `from the ${formatDate(meeting.date)} meeting`
  return task.source === 'ai_notes' ? 'from your notes' : undefined
}

/** One task. `viewer` is who is looking: it changes the wording and what can be edited. */
export function TaskItem({ task, student, viewer }: { task: Task; student: Student; viewer: Viewer }) {
  const updateTaskProgress = useStore((s) => s.updateTaskProgress)
  const [open, setOpen] = useState(false)
  const [reminding, setReminding] = useState(false)
  const source = useSourceText(task)
  const late = isLate(task)
  const toggle = () => updateTaskProgress(task.id, { status: isOpen(task) ? 'done' : 'todo' }, viewer)
  const owner = viewer === 'student' && task.owner === 'student' ? undefined : ownerLabel(task, student)

  if (!isOpen(task)) {
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-canvas px-4 py-2.5">
        <CheckCircle done label={task.title} onToggle={toggle} />
        <span className="min-w-0 flex-1 text-sm text-muted line-through">{task.title}</span>
        <span className="text-[13px] text-muted">
          Done{task.completedOn && ` ${formatDate(task.completedOn)}`}
          {task.completedBy && ` by ${WHO[task.completedBy](student)}`}
        </span>
      </li>
    )
  }

  return (
    <li
      className={cx(
        'rounded-lg border border-l-4',
        late ? 'border-bad-line border-l-bad-bar bg-bad-tint' : task.owner === 'counselor' && viewer === 'counselor' ? 'border-line border-l-accent bg-surface' : 'border-line border-l-line-strong bg-surface',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <CheckCircle done={false} late={late} label={task.title} onToggle={toggle} />
        <button type="button" className="flex min-h-11 min-w-[12rem] flex-1 flex-col justify-center text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="block text-[15px] font-medium text-ink">{task.title}</span>
          <span className="block text-[13px] text-muted">
            {[owner, source, task.status === 'in_progress' ? 'in progress' : undefined, task.attachments.length ? `${task.attachments.length} attached` : undefined].filter(Boolean).join(' · ') || 'Details'}
          </span>
        </button>
        <DueChip task={task} />
        {viewer === 'counselor' && reminderRecipient(student, task) && (
          <Button variant={late ? 'remind' : 'secondary'} onClick={() => setReminding(!reminding)} aria-expanded={reminding}>
            Remind
          </Button>
        )}
        {viewer === 'student' && (
          <Button onClick={() => setOpen(!open)} aria-expanded={open}>
            Add file or link
          </Button>
        )}
      </div>
      {reminding && (
        <div className="px-4 pb-3">
          <ReminderComposer student={student} task={task} onDone={() => setReminding(false)} />
        </div>
      )}
      {open && <TaskDetails task={task} student={student} viewer={viewer} onDeleted={() => setOpen(false)} />}
    </li>
  )
}

function TaskDetails({ task, student, viewer, onDeleted }: { task: Task; student: Student; viewer: Viewer; onDeleted: () => void }) {
  const { updateTaskProgress, updateTask, attachToTask, deleteTask } = useStore.getState()
  const confirm = useConfirm()
  // A student on their secret link can attach a link, not a file.
  const onLink = useStore((s) => s.mode === 'student_link')
  const [note, setNote] = useState(task.progressNote ?? '')
  const [url, setUrl] = useState('')

  const addLink = () => {
    const link = url.trim()
    if (!link) return
    const href = /^https?:\/\//i.test(link) ? link : `https://${link}`
    attachToTask(task.id, { kind: 'link', name: link.includes('docs.google.com') ? `${task.title} (Google Doc)` : link.replace(/^https?:\/\//, '').slice(0, 60), url: href }, viewer)
    setUrl('')
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
      {task.detail && <p className="text-sm text-ink-soft">{task.detail}</p>}
      {task.progressNote && viewer === 'counselor' && <p className="text-sm italic text-ink-soft">“{task.progressNote}”</p>}

      {task.attachments.length > 0 && (
        <ul className="flex flex-col gap-1">
          {task.attachments.map((a) => (
            <li key={a.id} className="text-sm">
              {a.url ? (
                <a href={a.url} target="_blank" rel="noreferrer" className="font-medium text-accent underline">
                  {a.name}
                </a>
              ) : (
                <span className="font-medium">{a.name}</span>
              )}
              <span className="text-[13px] text-muted">
                {' '}
                · {a.kind === 'link' ? 'link' : 'file name only'} · {WHO[a.addedBy](student)}, {formatDate(a.addedOn)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          addLink()
        }}
      >
        <input className={cx(inputBase, 'min-w-[12rem] flex-1')} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a link, e.g. a Google Doc" aria-label="Link" />
        <Button type="submit" disabled={!url.trim()}>
          Add link
        </Button>
        {!onLink && <label className="inline-flex min-h-11 cursor-pointer items-center rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-heading hover:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
          <input
            type="file"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Only the file name is recorded. v0 has no file storage.
              if (file) attachToTask(task.id, { kind: 'file', name: file.name }, viewer)
              e.target.value = ''
            }}
          />
          Add a file
        </label>}
      </form>
      <p className="-mt-1 text-xs text-muted">v0 records the file’s name only. The file itself is not stored.</p>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          updateTaskProgress(task.id, { progressNote: note.trim(), status: task.status === 'todo' && note.trim() ? 'in_progress' : task.status }, viewer)
        }}
      >
        <input
          className={cx(inputBase, 'min-w-[12rem] flex-1')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={viewer === 'student' ? 'Where are you with this? Anything in the way?' : 'Progress note'}
          aria-label="Progress note"
        />
        <Button type="submit" disabled={note.trim() === (task.progressNote ?? '')}>
          Save note
        </Button>
      </form>

      {viewer === 'counselor' && (
        <div className="flex flex-wrap items-end gap-3">
          <label>
            <SectionLabel className="mb-1">Due</SectionLabel>
            <input type="date" className={inputBase} value={task.dueDate} onChange={(e) => e.target.value && updateTask(task.id, { dueDate: e.target.value })} />
          </label>
          <label>
            <SectionLabel className="mb-1">Asks for a document</SectionLabel>
            <select className={inputBase} value={task.expectsDocument ?? ''} onChange={(e) => updateTask(task.id, { expectsDocument: (e.target.value || undefined) as DocCategory | undefined })}>
              <option value="">No</option>
              {DOC_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="danger"
            onClick={async () => {
              if (!(await confirm({ title: 'Delete task', body: `Delete “${task.title}”?`, action: 'Delete task' }))) return
              deleteTask(task.id)
              onDeleted()
            }}
          >
            Delete task
          </Button>
        </div>
      )}
    </div>
  )
}

/** A compact, read-only line showing a task's current state. For meeting reports. */
export function TaskStateRow({ task, student }: { task: Task; student: Student }) {
  const late = daysLate(task)
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line py-2 first:border-t-0">
      <CheckCircle done={!isOpen(task)} late={late > 0} label={task.title} />
      <span className={cx('min-w-0 flex-1 text-sm', !isOpen(task) && 'text-muted line-through')}>
        {task.title} <span className="text-muted no-underline">· {ownerLabel(task, student)}</span>
      </span>
      {!isOpen(task) ? (
        <Pill tone="good">Done{task.completedOn && ` ${formatDate(task.completedOn)}`}</Pill>
      ) : late > 0 ? (
        <Pill tone="bad">
          {late} {late === 1 ? 'day' : 'days'} late
        </Pill>
      ) : (
        <Pill tone="neutral">Due {formatDate(task.dueDate)}</Pill>
      )}
    </li>
  )
}

/** The add-a-task form. */
export function AddTaskForm({ student, onDone }: { student: Student; onDone: () => void }) {
  const addTask = useStore((s) => s.addTask)
  const [title, setTitle] = useState('')
  const [ownerKey, setOwnerKey] = useState('student')
  const [due, setDue] = useState('')
  const [expects, setExpects] = useState('')
  return (
    <form
      className="flex flex-col gap-3 rounded-lg bg-canvas p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim() || !due) return
        const isParent = ownerKey.startsWith('parent:')
        addTask({
          studentId: student.id,
          title: title.trim(),
          owner: isParent ? 'parent' : (ownerKey as 'student' | 'counselor'),
          ownerParentId: isParent ? ownerKey.slice(7) : undefined,
          dueDate: due,
          expectsDocument: (expects || undefined) as DocCategory | undefined,
        })
        onDone()
      }}
    >
      <input className={inputClass} autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to happen?" aria-label="Task" />
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <SectionLabel className="mb-1">Owner</SectionLabel>
          <select className={inputBase} value={ownerKey} onChange={(e) => setOwnerKey(e.target.value)}>
            <option value="student">{student.firstName}</option>
            {student.parents.map((p) => (
              <option key={p.id} value={`parent:${p.id}`}>
                {p.name} ({p.relationship})
              </option>
            ))}
            <option value="counselor">You</option>
          </select>
        </label>
        <label>
          <SectionLabel className="mb-1">Due</SectionLabel>
          <input type="date" required className={inputBase} value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label>
          <SectionLabel className="mb-1">Asks for a document</SectionLabel>
          <select className={inputBase} value={expects} onChange={(e) => setExpects(e.target.value)}>
            <option value="">No</option>
            {DOC_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          <Button onClick={onDone}>Cancel</Button>
          <Button type="submit" variant="primary">
            Add task
          </Button>
        </div>
      </div>
    </form>
  )
}
