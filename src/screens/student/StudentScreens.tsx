// The student view: three small screens inside StudentLayout, built for a
// phone. A student sees only their own tasks, deadlines, approved recaps and
// approved feedback. AI drafts the counselor has not approved never show here.

import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { TaskRow } from '../../components/TaskRow'
import { Button, Card, Empty, Field, Pill, cx, inputClass } from '../../components/ui'
import { daysFromToday, formatDate, formatDateLong, formatRelative, formatTime } from '../../lib/dates'
import { deadlinesFor, isLate, isOpen, meetingsFor, nextMeeting, ownerLabel, sortByUrgency, tasksFor } from '../../lib/derive'
import { useData, useStore } from '../../store/store'
import type { Student } from '../../types'

/** The student this view belongs to, provided by StudentLayout. */
const useStudent = () => useOutletContext<Student>()

// ── Tasks, deadlines and next meeting ───────────────────────────────────────

export function StudentHome() {
  const data = useData()
  const student = useStudent()
  const all = tasksFor(data, student.id)
  const mine = sortByUrgency(all.filter((t) => t.owner === 'student'))
  const open = mine.filter(isOpen)
  const late = open.filter((t) => isLate(t))
  const done = mine.filter((t) => !isOpen(t)).slice(0, 5)
  const others = sortByUrgency(all.filter((t) => t.owner !== 'student' && isOpen(t)))
  const meeting = nextMeeting(data, student.id)
  const applications = deadlinesFor(data, student.id)
    .filter((d) => d.kind === 'college' && daysFromToday(d.date) >= 0)
    .slice(0, 6)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Hi {student.firstName}</h1>
        <p className="mt-0.5 text-sm text-muted">
          {open.length === 0 ? (
            'You are all caught up.'
          ) : (
            <>
              {open.length} {open.length === 1 ? 'thing' : 'things'} to do
              {late.length > 0 && <span className="font-medium text-bad"> · {late.length} late</span>}
            </>
          )}
        </p>
      </div>

      {meeting && (
        <div className="rounded-xl border border-accent/20 bg-accent-soft px-4 py-3">
          <p className="text-xs font-medium text-accent">Next meeting · {formatRelative(meeting.date)}</p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{meeting.title}</p>
          <p className="text-sm text-muted">
            {formatDateLong(meeting.date)} at {formatTime(meeting.time)} · {meeting.durationMin} min with {data.firm.counselorFirstName}
          </p>
        </div>
      )}

      <Card title="What I owe">
        {open.length === 0 && <Empty>Nothing to do right now.</Empty>}
        <ul>
          {open.map((t) => (
            <TaskRow key={t.id} task={t} student={student} actor="student" showOwner={false} />
          ))}
        </ul>
      </Card>

      <Card title="Upcoming application deadlines">
        {applications.length === 0 && <Empty>No application deadlines yet.</Empty>}
        <ul>
          {applications.map((d) => {
            const n = daysFromToday(d.date)
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
                <span className="text-sm text-ink">{d.label}</span>
                <span className={cx('shrink-0 text-xs', n <= 7 ? 'font-medium text-warn' : 'text-muted')}>
                  {formatDate(d.date)} · {formatRelative(d.date)}
                </span>
              </li>
            )
          })}
        </ul>
      </Card>

      {others.length > 0 && (
        <Card title="Waiting on others">
          <ul>
            {others.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{t.title}</span>
                  <span className="text-xs text-muted">{ownerLabel(t, student)}</span>
                </span>
                {isLate(t) ? <Pill tone="bad">Late</Pill> : <span className="shrink-0 text-xs text-muted">{formatDate(t.dueDate)}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {done.length > 0 && (
        <Card title="Recently done">
          <ul>
            {done.map((t) => (
              <TaskRow key={t.id} task={t} student={student} actor="student" showOwner={false} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

// ── Meeting recaps and shared feedback ──────────────────────────────────────

export function StudentRecaps() {
  const data = useData()
  const student = useStudent()
  // Only recaps and feedback the counselor has approved.
  const recaps = meetingsFor(data, student.id).filter((m) => m.status === 'completed' && m.recap?.review === 'approved')
  const feedback = data.documents.filter((d) => d.studentId === student.id && d.feedback?.review === 'approved')

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Meeting recaps</h1>
      {recaps.length === 0 && (
        <Card>
          <Empty>Your recap will appear here after each meeting.</Empty>
        </Card>
      )}
      {recaps.map((m, i) => (
        <Card key={m.id} className={i === 0 ? 'border-accent/30' : undefined}>
          <div className="px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted">
                {formatDateLong(m.date)} · {formatRelative(m.date)}
              </p>
              {i === 0 && <Pill tone="accent">Latest</Pill>}
            </div>
            <p className="mt-0.5 text-sm font-semibold text-ink">{m.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink">{m.recap!.summary}</p>
            <p className="mb-1 mt-3 text-xs font-medium text-muted">Your next steps</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
              {m.recap!.nextSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-faint">From {data.firm.counselorName}</p>
          </div>
        </Card>
      ))}

      {feedback.length > 0 && <h2 className="pt-2 text-base font-semibold text-ink">Essay feedback</h2>}
      {feedback.map((d) => (
        <Card key={d.id}>
          <div className="space-y-3 px-4 py-4">
            <p className="text-sm font-semibold text-ink">{d.name}</p>
            <p className="text-sm leading-relaxed text-ink">{d.feedback!.overall}</p>
            {d.feedback!.points.map((p) => (
              <div key={p.area} className="rounded-lg bg-canvas p-3">
                <p className="text-xs font-medium text-muted">{p.area}</p>
                <p className="mt-1 text-sm text-ink">{p.observation}</p>
                <p className="mt-1 text-sm font-medium text-ink">{p.question}</p>
              </div>
            ))}
            <p className="text-xs text-faint">Feedback is questions and observations only. The writing is always yours.</p>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── Profile update form ─────────────────────────────────────────────────────

const toList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
const toScore = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? undefined : Number(s))

export function StudentProfile() {
  const student = useStudent()
  const updateProfile = useStore((s) => s.updateProfile)
  const [sat, setSat] = useState(String(student.tests.sat ?? ''))
  const [act, setAct] = useState(String(student.tests.act ?? ''))
  const [toefl, setToefl] = useState(String(student.tests.toefl ?? ''))
  const [gpa, setGpa] = useState(String(student.gpa))
  const [majors, setMajors] = useState(student.majors.join(', '))
  const [interests, setInterests] = useState(student.interests.join(', '))
  const [activity, setActivity] = useState({ name: '', role: '' })
  const [saved, setSaved] = useState(false)

  const save = () => {
    const changed: string[] = []
    if (toScore(sat) !== student.tests.sat) changed.push('SAT')
    if (toScore(act) !== student.tests.act) changed.push('ACT')
    if (toScore(toefl) !== student.tests.toefl) changed.push('TOEFL')
    if (Number(gpa) !== student.gpa) changed.push('GPA')
    if (majors !== student.majors.join(', ')) changed.push('majors')
    if (interests !== student.interests.join(', ')) changed.push('interests')
    if (changed.length === 0) return
    updateProfile(
      student.id,
      {
        gpa: Number(gpa) || student.gpa,
        tests: { ...student.tests, sat: toScore(sat), act: toScore(act), toefl: toScore(toefl) },
        majors: toList(majors),
        interests: toList(interests),
      },
      'student',
      changed.join(', '),
    )
    setSaved(true)
  }

  const addActivity = () => {
    if (!activity.name.trim()) return
    updateProfile(
      student.id,
      { activities: [...student.activities, { id: `act-${Date.now()}`, name: activity.name.trim(), role: activity.role.trim() || 'Member' }] },
      'student',
      `new activity “${activity.name.trim()}”`,
    )
    setActivity({ name: '', role: '' })
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">My profile</h1>
        <p className="mt-0.5 text-sm text-muted">
          {student.school} · Class of {student.gradYear}
        </p>
      </div>

      <Card title="Scores and interests">
        <form
          className="space-y-3 px-4 py-4"
          onChange={() => setSaved(false)}
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="GPA (unweighted)">
              <input className={inputClass} inputMode="decimal" value={gpa} onChange={(e) => setGpa(e.target.value)} />
            </Field>
            <Field label="SAT">
              <input className={inputClass} inputMode="numeric" value={sat} onChange={(e) => setSat(e.target.value)} placeholder="Not taken" />
            </Field>
            <Field label="ACT">
              <input className={inputClass} inputMode="numeric" value={act} onChange={(e) => setAct(e.target.value)} placeholder="Not taken" />
            </Field>
            <Field label="TOEFL">
              <input className={inputClass} inputMode="numeric" value={toefl} onChange={(e) => setToefl(e.target.value)} placeholder="Not taken" />
            </Field>
          </div>
          <Field label="Intended majors" hint="Separate with commas">
            <input className={inputClass} value={majors} onChange={(e) => setMajors(e.target.value)} />
          </Field>
          <Field label="Interests" hint="Separate with commas">
            <input className={inputClass} value={interests} onChange={(e) => setInterests(e.target.value)} />
          </Field>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary">
              Save changes
            </Button>
            {saved && <span className="text-sm text-good">✓ Saved. {`Your counselor can see it.`}</span>}
          </div>
        </form>
      </Card>

      <Card title="Activities">
        <ul>
          {student.activities.map((a) => (
            <li key={a.id} className="border-b border-line px-4 py-2.5">
              <p className="text-sm font-medium text-ink">{a.name}</p>
              <p className="text-xs text-muted">
                {a.role}
                {a.detail && ` · ${a.detail}`}
              </p>
            </li>
          ))}
        </ul>
        <form
          className="space-y-2 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault()
            addActivity()
          }}
        >
          <input className={inputClass} placeholder="New activity" value={activity.name} onChange={(e) => setActivity({ ...activity, name: e.target.value })} aria-label="Activity name" />
          <div className="flex gap-2">
            <input className={inputClass} placeholder="Your role" value={activity.role} onChange={(e) => setActivity({ ...activity, role: e.target.value })} aria-label="Role" />
            <Button type="submit" disabled={!activity.name.trim()}>
              Add
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
