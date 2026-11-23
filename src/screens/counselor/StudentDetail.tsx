// One student: profile, tasks, college list, documents, meetings and reports.
// The tab is kept in the URL (?tab=tasks) so links can point at a tab.

import { useState, type ReactNode } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ParentLine } from '../../components/Bilingual'
import { TaskRow } from '../../components/TaskRow'
import { Avatar, Button, Card, Empty, PageHeader, Pill, ProgressBar, StatusPill, cx, inputClass } from '../../components/ui'
import { addDays, formatDate, formatDateLong, formatRelative, formatTime, todayISO } from '../../lib/dates'
import {
  classLabel,
  findStudent,
  fullName,
  isOpen,
  meetingsFor,
  pendingApprovals,
  pendingInMeeting,
  sortByUrgency,
  summarize,
  tasksFor,
} from '../../lib/derive'
import { useData, useStore } from '../../store/store'
import type { ApplicationPlan, CollegeStatus, DocumentKind, OwnerType, Student } from '../../types'
import { ReportsPanel } from './ParentReports'

const TABS = ['overview', 'tasks', 'colleges', 'documents', 'meetings', 'reports'] as const
type Tab = (typeof TABS)[number]

export default function StudentDetail() {
  const data = useData()
  const { studentId } = useParams()
  const [params, setParams] = useSearchParams()
  const student = findStudent(data, studentId)
  if (!student) return <Navigate to="/app/students" replace />

  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'overview'
  const summary = summarize(data, student)
  const counts: Partial<Record<Tab, number>> = {
    tasks: summary.open,
    colleges: data.colleges.filter((c) => c.studentId === student.id).length,
    documents: data.documents.filter((d) => d.studentId === student.id).length,
    meetings: data.meetings.filter((m) => m.studentId === student.id).length,
    reports: data.reports.filter((r) => r.studentId === student.id).length,
  }

  return (
    <div>
      <PageHeader
        back={{ to: '/app/students', label: 'Students' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Avatar name={fullName(student)} size="lg" />
            <span>
              {fullName(student)}
              {student.localName && <span className="ml-2 text-lg font-normal text-muted">{student.localName}</span>}
            </span>
            <StatusPill status={summary.status} />
          </span>
        }
        subtitle={`${classLabel(student.gradYear)}, class of ${student.gradYear} · ${student.school}, ${student.city}`}
        actions={
          <>
            {summary.nextMeeting && (
              <Link to={`/app/students/${student.id}/meetings/${summary.nextMeeting.id}/brief`}>
                <Button>✦ Pre-meeting brief</Button>
              </Link>
            )}
            <Link to={`/student/${student.id}`}>
              <Button>Open student view</Button>
            </Link>
          </>
        }
      />

      {summary.reasons.length > 0 && (
        <div
          className={cx(
            'mb-5 rounded-xl border px-4 py-3 text-sm',
            summary.status === 'behind' && 'border-bad/20 bg-bad-soft text-bad',
            summary.status === 'slipping' && 'border-warn/20 bg-warn-soft text-warn',
            (summary.status === 'new' || summary.status === 'on_track') && 'border-info/20 bg-info-soft text-info',
          )}
        >
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            {summary.reasons.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setParams(t === 'overview' ? {} : { tab: t })}
            className={cx(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium capitalize',
              tab === t ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t === 'colleges' ? 'College list' : t}
            {counts[t] !== undefined && <span className="ml-1.5 text-xs text-faint">{counts[t]}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview student={student} />}
      {tab === 'tasks' && <Tasks student={student} />}
      {tab === 'colleges' && <Colleges student={student} />}
      {tab === 'documents' && <Documents student={student} />}
      {tab === 'meetings' && <Meetings student={student} />}
      {tab === 'reports' && <ReportsPanel studentId={student.id} />}
    </div>
  )
}

// ── Overview ────────────────────────────────────────────────────────────────

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm font-medium text-ink">{children}</dd>
    </div>
  )
}

function Overview({ student }: { student: Student }) {
  const data = useData()
  const updateProfile = useStore((s) => s.updateProfile)
  const summary = summarize(data, student)
  const approvals = pendingApprovals(data, student.id)
  const urgent = sortByUrgency(tasksFor(data, student.id).filter(isOpen)).slice(0, 5)
  const [notes, setNotes] = useState(student.counselorNotes)

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        {approvals.length > 0 && (
          <Card tone="ai" title="Waiting for your approval">
            <ul>
              {approvals.map((a) => (
                <li key={a.key} className="border-b border-line last:border-b-0">
                  <Link to={a.to} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-canvas/60">
                    <span className="text-sm text-ink">{a.label}</span>
                    <span className="shrink-0 text-xs font-medium text-ai">
                      ✦ {a.count} {a.count === 1 ? 'draft' : 'drafts'} · Review →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card
          title="Most urgent tasks"
          action={
            <Link to="?tab=tasks" className="text-xs text-accent hover:underline">
              All tasks →
            </Link>
          }
        >
          <div className="border-b border-line px-4 py-3">
            <ProgressBar done={summary.done} late={summary.late} total={summary.total} />
            <p className="mt-1.5 text-xs text-muted">
              {summary.done} of {summary.total} done · {summary.open} open
              {summary.late > 0 && <span className="font-medium text-bad"> · {summary.late} late</span>}
            </p>
          </div>
          {urgent.length === 0 && <Empty>No open tasks.</Empty>}
          <ul>
            {urgent.map((t) => (
              <TaskRow key={t.id} task={t} student={student} actor="counselor" />
            ))}
          </ul>
        </Card>

        <Card title="Profile">
          <dl className="grid grid-cols-2 gap-4 px-4 py-4 sm:grid-cols-4">
            <Fact label="GPA (unweighted)">{student.gpa.toFixed(2)}</Fact>
            <Fact label="GPA (weighted)">{student.gpaWeighted?.toFixed(2) ?? 'n/a'}</Fact>
            <Fact label="SAT">{student.tests.sat ?? 'Not taken'}</Fact>
            <Fact label="ACT">{student.tests.act ?? 'Not taken'}</Fact>
            {student.tests.toefl && <Fact label="TOEFL">{student.tests.toefl}</Fact>}
            <div className="col-span-2">
              <Fact label="Intended majors">{student.majors.join(', ')}</Fact>
            </div>
            <div className="col-span-2">
              <Fact label="Interests">{student.interests.join(', ') || 'None listed'}</Fact>
            </div>
            {student.tests.aps.length > 0 && (
              <div className="col-span-2 sm:col-span-4">
                <Fact label="AP exams">{student.tests.aps.map((a) => `${a.subject} ${a.score}`).join(' · ')}</Fact>
              </div>
            )}
          </dl>
          <div className="border-t border-line px-4 py-4">
            <p className="mb-2 text-xs text-muted">Activities</p>
            <ul className="space-y-2">
              {student.activities.map((a) => (
                <li key={a.id} className="text-sm">
                  <span className="font-medium text-ink">{a.name}</span>
                  <span className="text-muted"> · {a.role}</span>
                  {a.detail && <p className="text-xs text-muted">{a.detail}</p>}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Card title="Meetings">
          <div className="space-y-3 px-4 py-3 text-sm">
            <div>
              <p className="text-xs text-muted">Next</p>
              {summary.nextMeeting ? (
                <p className="text-ink">
                  {summary.nextMeeting.title}
                  <span className="block text-xs text-muted">
                    {formatDateLong(summary.nextMeeting.date)}, {formatTime(summary.nextMeeting.time)} · {formatRelative(summary.nextMeeting.date)}
                  </span>
                </p>
              ) : (
                <p className="text-warn">Nothing booked</p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted">Last</p>
              {summary.lastMeeting ? (
                <Link to={`/app/students/${student.id}/meetings/${summary.lastMeeting.id}`} className="text-ink hover:underline">
                  {summary.lastMeeting.title}
                  <span className="block text-xs text-muted">{formatRelative(summary.lastMeeting.date)}</span>
                </Link>
              ) : (
                <p className="text-muted">None yet</p>
              )}
            </div>
          </div>
        </Card>

        <Card title="Family">
          <ul>
            {student.parents.map((p) => (
              <li key={p.id} className="border-b border-line px-4 py-3 last:border-b-0">
                <ParentLine parent={p} />
                <p className="mt-1 text-xs text-muted">{p.contact}</p>
                {p.note && <p className="mt-1 text-xs italic text-muted">{p.note}</p>}
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2.5 text-xs text-faint">Parents never log in. They receive reports and reminders on their channel.</p>
        </Card>

        <Card title="Counselor’s notes" action={<Pill>Private</Pill>}>
          <div className="px-4 py-3">
            <textarea
              className={cx(inputClass, 'leading-relaxed')}
              rows={7}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== student.counselorNotes && updateProfile(student.id, { counselorNotes: notes }, 'counselor')}
              aria-label="Counselor's notes"
            />
            <p className="mt-1 text-xs text-faint">Saved when you click away. Never shown to the student or parents.</p>
          </div>
        </Card>
      </div>
    </div>
  )
}

// ── Tasks ───────────────────────────────────────────────────────────────────

function Tasks({ student }: { student: Student }) {
  const data = useData()
  const addTask = useStore((s) => s.addTask)
  const tasks = sortByUrgency(tasksFor(data, student.id))
  const open = tasks.filter(isOpen)
  const done = tasks.filter((t) => !isOpen(t))
  const [title, setTitle] = useState('')
  const [ownerKey, setOwnerKey] = useState('student')
  const [due, setDue] = useState(addDays(todayISO(), 7))

  const submit = () => {
    if (!title.trim()) return
    const isParent = ownerKey.startsWith('parent:')
    addTask({
      studentId: student.id,
      title: title.trim(),
      owner: (isParent ? 'parent' : ownerKey) as OwnerType,
      ownerParentId: isParent ? ownerKey.slice(7) : undefined,
      dueDate: due,
    })
    setTitle('')
  }

  return (
    <div className="space-y-6">
      <Card title="Add a task">
        <form
          className="flex flex-wrap items-end gap-3 px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label className="block min-w-[14rem] flex-1">
            <span className="mb-1 block text-xs font-medium text-muted">Task</span>
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to happen?" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Owner</span>
            <select className={cx(inputClass, 'w-auto')} value={ownerKey} onChange={(e) => setOwnerKey(e.target.value)}>
              <option value="student">{student.firstName} (student)</option>
              {student.parents.map((p) => (
                <option key={p.id} value={`parent:${p.id}`}>
                  {p.name} ({p.relationship})
                </option>
              ))}
              <option value="counselor">Counselor</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Due</span>
            <input type="date" className={cx(inputClass, 'w-auto')} value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <Button type="submit" variant="primary" disabled={!title.trim()}>
            Add task
          </Button>
        </form>
      </Card>

      <Card title={`Open (${open.length})`}>
        {open.length === 0 && <Empty>Nothing open.</Empty>}
        <ul>
          {open.map((t) => (
            <TaskRow key={t.id} task={t} student={student} actor="counselor" />
          ))}
        </ul>
      </Card>

      <Card title={`Done (${done.length})`}>
        {done.length === 0 && <Empty>Nothing finished yet.</Empty>}
        <ul>
          {done.map((t) => (
            <TaskRow key={t.id} task={t} student={student} actor="counselor" />
          ))}
        </ul>
      </Card>
    </div>
  )
}

// ── College list ────────────────────────────────────────────────────────────

const PLANS: ApplicationPlan[] = ['ED', 'ED2', 'EA', 'REA', 'RD', 'Rolling', 'UC']
const COLLEGE_STATUS: { value: CollegeStatus; label: string }[] = [
  { value: 'considering', label: 'Considering' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'admitted', label: 'Admitted' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'waitlisted', label: 'Waitlisted' },
  { value: 'denied', label: 'Denied' },
]
const STATUS_COLOR: Record<CollegeStatus, string> = {
  considering: 'text-muted',
  in_progress: 'text-info',
  submitted: 'text-accent',
  admitted: 'text-good',
  deferred: 'text-warn',
  waitlisted: 'text-warn',
  denied: 'text-bad',
}

function Colleges({ student }: { student: Student }) {
  const data = useData()
  const addCollege = useStore((s) => s.addCollege)
  const updateCollege = useStore((s) => s.updateCollege)
  const today = todayISO()
  const colleges = data.colleges.filter((c) => c.studentId === student.id).sort((a, b) => a.deadline.localeCompare(b.deadline))
  const [name, setName] = useState('')
  const [plan, setPlan] = useState<ApplicationPlan>('RD')
  const [deadline, setDeadline] = useState(addDays(today, 40))

  return (
    <div className="space-y-6">
      <Card className="overflow-x-auto">
        {colleges.length === 0 ? (
          <Empty>No colleges yet. The list usually starts after the first planning meeting.</Empty>
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="px-4 py-2.5 font-medium">College</th>
                <th className="px-3 py-2.5 font-medium">Plan</th>
                <th className="px-3 py-2.5 font-medium">Fit</th>
                <th className="px-3 py-2.5 font-medium">Deadline</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {colleges.map((c) => {
                const pending = c.status === 'considering' || c.status === 'in_progress'
                return (
                  <tr key={c.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{c.name}</p>
                      {c.note && <p className="text-xs text-muted">{c.note}</p>}
                    </td>
                    <td className="px-3 py-3">
                      <Pill tone={c.plan.startsWith('ED') ? 'accent' : 'neutral'}>{c.plan}</Pill>
                    </td>
                    <td className="px-3 py-3 text-muted">{c.fit}</td>
                    <td className="px-3 py-3">
                      <p className="text-ink">{formatDate(c.deadline)}</p>
                      {pending && <p className={cx('text-xs', c.deadline <= addDays(today, 10) ? 'font-medium text-warn' : 'text-muted')}>{formatRelative(c.deadline)}</p>}
                    </td>
                    <td className="px-3 py-3">
                      <select
                        aria-label={`Status of ${c.name}`}
                        className={cx('cursor-pointer rounded-md border border-line bg-surface px-2 py-1 text-sm font-medium', STATUS_COLOR[c.status])}
                        value={c.status}
                        onChange={(e) => updateCollege(c.id, { status: e.target.value as CollegeStatus })}
                      >
                        {COLLEGE_STATUS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Add a college">
        <form
          className="flex flex-wrap items-end gap-3 px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            addCollege({ studentId: student.id, name: name.trim(), plan, deadline, status: 'considering', fit: 'Target' })
            setName('')
          }}
        >
          <label className="block min-w-[12rem] flex-1">
            <span className="mb-1 block text-xs font-medium text-muted">College</span>
            {/* TODO: no college search database in v0; this is free text. */}
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="College name" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Plan</span>
            <select className={cx(inputClass, 'w-auto')} value={plan} onChange={(e) => setPlan(e.target.value as ApplicationPlan)}>
              {PLANS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Deadline</span>
            <input type="date" className={cx(inputClass, 'w-auto')} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Add
          </Button>
        </form>
      </Card>
    </div>
  )
}

// ── Documents ───────────────────────────────────────────────────────────────

const KIND_LABEL: Record<DocumentKind, string> = {
  essay: 'Essays',
  transcript: 'Transcripts',
  score_report: 'Score reports',
  recommendation: 'Recommendations',
  resume: 'Résumés',
  other: 'Other',
}
const KIND_ORDER: DocumentKind[] = ['essay', 'transcript', 'score_report', 'recommendation', 'resume', 'other']

function Documents({ student }: { student: Student }) {
  const data = useData()
  const addDocument = useStore((s) => s.addDocument)
  const docs = data.documents.filter((d) => d.studentId === student.id)
  const [kind, setKind] = useState<DocumentKind>('essay')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const who = (by: string) => (by === 'student' ? student.firstName : by === 'parent' ? 'Parent' : 'Counselor')

  return (
    <div className="space-y-6">
      {docs.length === 0 && (
        <Card>
          <Empty>No documents yet.</Empty>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {KIND_ORDER.filter((k) => docs.some((d) => d.kind === k)).map((k) => (
          <Card key={k} title={KIND_LABEL[k]}>
            <ul>
              {docs
                .filter((d) => d.kind === k)
                .sort((a, b) => b.addedOn.localeCompare(a.addedOn))
                .map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {d.url ? '🔗' : '📄'}{' '}
                        {d.url ? (
                          <a href={d.url} target="_blank" rel="noreferrer" className="hover:underline">
                            {d.name}
                          </a>
                        ) : (
                          d.name
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {who(d.addedBy)} · {formatDate(d.addedOn)}
                        {d.taskId && ' · attached to a task'}
                      </p>
                    </div>
                    {d.kind === 'essay' && (
                      <Link to={`/app/students/${student.id}/documents/${d.id}`} className="shrink-0">
                        {d.feedback ? (
                          <Pill tone={d.feedback.review === 'approved' ? 'good' : 'warn'}>
                            {d.feedback.review === 'approved' ? '✓ Feedback shared' : 'Feedback to approve'}
                          </Pill>
                        ) : (
                          <Pill tone="ai">✦ Essay feedback →</Pill>
                        )}
                      </Link>
                    )}
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card title="Add a document">
        <form
          className="flex flex-wrap items-end gap-3 px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            addDocument({ studentId: student.id, name: name.trim(), kind, addedBy: 'counselor', url: url.trim() || undefined })
            setName('')
            setUrl('')
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Type</span>
            <select className={cx(inputClass, 'w-auto')} value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
              {KIND_ORDER.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-[12rem] flex-1">
            <span className="mb-1 block text-xs font-medium text-muted">Name</span>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="File name or title" />
          </label>
          <label className="block min-w-[12rem] flex-1">
            <span className="mb-1 block text-xs font-medium text-muted">Link (optional)</span>
            <input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </label>
          <label className="cursor-pointer rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-canvas">
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) setName(file.name)
                e.target.value = ''
              }}
            />
            Choose file
          </label>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Add
          </Button>
        </form>
        <p className="border-t border-line px-4 py-2.5 text-xs text-faint">Demo: only the file name is recorded. No file is stored or uploaded.</p>
      </Card>
    </div>
  )
}

// ── Meetings ────────────────────────────────────────────────────────────────

function Meetings({ student }: { student: Student }) {
  const data = useData()
  const meetings = meetingsFor(data, student.id)
  const upcoming = meetings.filter((m) => m.status === 'scheduled').reverse()
  const past = meetings.filter((m) => m.status === 'completed')

  return (
    <div className="space-y-6">
      <Card title="Upcoming">
        {upcoming.length === 0 && <Empty>Nothing booked. Scheduling is outside this demo.</Empty>}
        <ul>
          {upcoming.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0">
              <div>
                <p className="text-sm font-medium text-ink">{m.title}</p>
                <p className="text-xs text-muted">
                  {formatDateLong(m.date)}, {formatTime(m.time)} · {formatRelative(m.date)} · {m.durationMin} min
                  {m.aiAttended && ' · AI notetaker will join'}
                </p>
              </div>
              <Link to={`/app/students/${student.id}/meetings/${m.id}/brief`}>
                <Button size="sm">✦ Pre-meeting brief</Button>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Past">
        {past.length === 0 && <Empty>No meetings yet.</Empty>}
        <ul>
          {past.map((m) => {
            const pending = pendingInMeeting(m)
            return (
              <li key={m.id} className="border-b border-line last:border-b-0">
                <Link to={`/app/students/${student.id}/meetings/${m.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-canvas/60">
                  <div>
                    <p className="text-sm font-medium text-ink">{m.title}</p>
                    <p className="text-xs text-muted">
                      {formatDateLong(m.date)} · {formatRelative(m.date)} · {m.durationMin} min
                    </p>
                  </div>
                  {pending > 0 ? (
                    <Pill tone="warn">✦ {pending} drafts need your approval</Pill>
                  ) : m.recap?.review === 'approved' ? (
                    <Pill tone="good">✓ Recap shared</Pill>
                  ) : m.aiAttended ? (
                    <Pill tone="ai">✦ Recording ready to process</Pill>
                  ) : (
                    <Pill>No AI notes</Pill>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
