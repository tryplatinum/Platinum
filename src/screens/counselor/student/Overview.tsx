// Student overview. Left: tasks (to do, then done) and the college list.
// Right: the brief for the next meeting and the family's contact details.

import { useState } from 'react'
import { MeetingFormModal, ParentFormModal } from '../../../components/forms'
import { BriefCard } from '../../../components/meeting/BriefCard'
import { AddTaskForm, TaskItem } from '../../../components/TaskRows'
import { Button, Card, CardHeader, Empty, Pill, ProgressWithCount, SectionLabel, cx, inputBase } from '../../../components/ui'
import { addDays, formatDate, todayISO } from '../../../lib/dates'
import { collegeIsPending, collegesFor, dueText, isOpen, nextMeeting, sortByUrgency, statusText, summarize, tasksFor } from '../../../lib/derive'
import { CHANNEL_LABEL, LANGUAGE_LABEL } from '../../../lib/language'
import { useData, useStore } from '../../../store/store'
import type { ApplicationPlan, CollegeStatus, Parent, Student } from '../../../types'

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
            <ul className="flex flex-col gap-2">
              {open.map((t) => (
                <TaskItem key={t.id} task={t} student={student} viewer="counselor" />
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <>
              <SectionLabel>Done · {done.length}</SectionLabel>
              <ul className="flex flex-col gap-2">
                {(showAllDone ? done : done.slice(0, 3)).map((t) => (
                  <TaskItem key={t.id} task={t} student={student} viewer="counselor" />
                ))}
              </ul>
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

// ── College list ────────────────────────────────────────────────────────────

const PLANS: ApplicationPlan[] = ['ED', 'ED2', 'EA', 'REA', 'RD', 'Rolling', 'UC']
const STATUSES: { value: CollegeStatus; label: string }[] = [
  { value: 'considering', label: 'Planning' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'admitted', label: 'Admitted' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'waitlisted', label: 'Waitlisted' },
  { value: 'denied', label: 'Denied' },
]

function CollegeList({ student }: { student: Student }) {
  const data = useData()
  const { addCollege, updateCollege, removeCollege } = useStore.getState()
  const colleges = collegesFor(data, student.id)
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ name: '', plan: 'RD' as ApplicationPlan, deadline: addDays(todayISO(), 45) })

  return (
    <Card>
      <CardHeader size="section" className="px-5 py-4" title="College list" count={colleges.length || undefined} action={!adding && <Button onClick={() => setAdding(true)}>Add college</Button>} />
      {adding && (
        <form
          className="mx-5 mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-canvas p-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!f.name.trim()) return
            addCollege({ studentId: student.id, name: f.name.trim(), plan: f.plan, deadline: f.deadline, status: 'considering', fit: 'Target' })
            setF({ ...f, name: '' })
            setAdding(false)
          }}
        >
          <label className="min-w-[12rem] flex-1">
            <SectionLabel className="mb-1">College</SectionLabel>
            {/* v0 has no college database: the name is free text. */}
            <input className={cx(inputBase, 'w-full')} autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <label>
            <SectionLabel className="mb-1">Plan</SectionLabel>
            <select className={inputBase} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value as ApplicationPlan })}>
              {PLANS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            <SectionLabel className="mb-1">Deadline</SectionLabel>
            <input type="date" required className={inputBase} value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />
          </label>
          <Button onClick={() => setAdding(false)}>Cancel</Button>
          <Button type="submit" variant="primary">
            Add
          </Button>
        </form>
      )}
      {colleges.length === 0 ? (
        !adding && (
          <Empty title="No colleges on the list yet.">
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add college
            </Button>
          </Empty>
        )
      ) : (
        <div className="relative overflow-x-auto border-t border-line">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-5 py-3 font-semibold">College</th>
                <th className="px-3 py-3 font-semibold">Plan</th>
                <th className="px-3 py-3 font-semibold">Deadline</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                {/* The scroll container above is "relative" so this hidden label stays inside it. */}
                <th className="py-3 pl-3 pr-5">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {colleges.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-5 py-2.5">
                    <span className="font-semibold">{c.name}</span>
                    {c.note && <span className="block text-[13px] text-muted">{c.note}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill tone={c.plan.startsWith('ED') ? 'accent' : 'neutral'}>{c.plan}</Pill>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    {formatDate(c.deadline)}
                    {collegeIsPending(c) && <span className="text-muted"> · {dueText(c.deadline)}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <select aria-label={`Status of ${c.name}`} className={inputBase} value={c.status} onChange={(e) => updateCollege(c.id, { status: e.target.value as CollegeStatus })}>
                      {STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2.5 pl-3 pr-5 text-right">
                    <Button variant="quiet" aria-label={`Remove ${c.name}`} onClick={() => window.confirm(`Remove ${c.name} from the list?`) && removeCollege(c.id)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// ── Family ──────────────────────────────────────────────────────────────────

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
      {editing && <ParentFormModal studentId={student.id} parent={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} />}
    </Card>
  )
}
