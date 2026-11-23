// The student's own view, built for a phone. A student sees their next meeting
// and deadline, their tasks, the latest recap their counselor approved, and any
// approved essay feedback. Students never see drafts.

import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { TaskItem } from '../../components/TaskRows'
import { Button, Card, Empty, Field, SectionLabel, inputClass, useToast } from '../../components/ui'
import { formatDate, formatDateLong, formatTime } from '../../lib/dates'
import { dueText, essaysFor, isOpen, meetingsFor, nextApplicationDeadline, nextMeeting, ownerLabel, sortByUrgency, tasksFor } from '../../lib/derive'
import { useData, useStore } from '../../store/store'
import type { Student } from '../../types'

/** The student this view belongs to, provided by StudentLayout. */
const useStudent = () => useOutletContext<Student>()

export function StudentHome() {
  const data = useData()
  const student = useStudent()
  // The profile form is part of the counselor's preview only; the student link allows three writes, all on tasks.
  const onLink = useStore((s) => s.mode === 'student_link')
  const [showDone, setShowDone] = useState(false)
  const all = tasksFor(data, student.id)
  const mine = sortByUrgency(all.filter((t) => t.owner === 'student'))
  const open = mine.filter(isOpen)
  const done = mine.filter((t) => !isOpen(t))
  const others = sortByUrgency(all.filter((t) => t.owner !== 'student' && isOpen(t)))
  const meeting = nextMeeting(data, student.id)
  const deadline = nextApplicationDeadline(data, student.id)
  // Only what the counselor has approved.
  const recap = meetingsFor(data, student.id).find((m) => m.status === 'completed' && m.recap?.review === 'approved')
  const feedback = essaysFor(data, student.id).filter((d) => d.feedback?.review === 'approved')

  return (
    <>
      <header>
        <p className="text-[13px] text-muted">{data.firm.name}</p>
        <h1 className="text-2xl font-bold">Hi {student.firstName}</h1>
      </header>

      <Card className="grid grid-cols-2 divide-x divide-line">
        <div className="p-4">
          <SectionLabel>Next meeting</SectionLabel>
          {meeting ? (
            <>
              <div className="mt-0.5 text-[15px] font-semibold">{formatDateLong(meeting.date)}</div>
              <div className="text-[13px] text-muted">
                {formatTime(meeting.time)}
                {meeting.location && `, ${meeting.location}`}
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-sm text-muted">Not scheduled yet</div>
          )}
        </div>
        <div className="p-4">
          <SectionLabel>Next deadline</SectionLabel>
          {deadline ? (
            <>
              <div className="mt-0.5 text-[15px] font-semibold">{deadline.label}</div>
              <div className="text-[13px] text-muted">
                {formatDate(deadline.date)}, {dueText(deadline.date)}
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-sm text-muted">None yet</div>
          )}
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-[15px] font-semibold">What you owe{open.length > 0 && ` · ${open.length}`}</h2>
        {mine.length === 0 ? (
          <Empty title="Nothing yet. Tasks appear here after you meet with your counselor." />
        ) : open.length === 0 ? (
          <p className="text-sm text-muted">You are all caught up.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {open.map((t) => (
              <TaskItem key={t.id} task={t} student={student} viewer="student" />
            ))}
          </ul>
        )}
        {done.length > 0 && (
          <>
            <ul className="flex flex-col gap-2">
              {(showDone ? done : done.slice(0, 2)).map((t) => (
                <TaskItem key={t.id} task={t} student={student} viewer="student" />
              ))}
            </ul>
            {done.length > 2 && (
              <Button variant="quiet" className="self-start" onClick={() => setShowDone(!showDone)}>
                {showDone ? 'Show fewer' : `Show ${done.length - 2} more done`}
              </Button>
            )}
          </>
        )}
      </Card>

      {recap?.recap && (
        <Card tone="accent" className="flex flex-col gap-2 p-4">
          <h2 className="text-[15px] font-semibold">Recap from {formatDateLong(recap.date)}</h2>
          <p className="text-sm leading-relaxed">{recap.recap.summary}</p>
          {recap.recap.nextSteps.length > 0 && (
            <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
              {recap.recap.nextSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
          <p className="text-[13px] text-ink-soft">From {data.firm.counselorName}</p>
        </Card>
      )}

      {feedback.map((d) => (
        <Card key={d.id} className="flex flex-col gap-3 p-4">
          <div>
            <SectionLabel>Feedback on your essay</SectionLabel>
            <h2 className="text-[15px] font-semibold">{d.name}</h2>
          </div>
          <p className="text-sm leading-relaxed">{d.feedback!.overall}</p>
          {d.feedback!.strengths.length > 0 && (
            <div>
              <SectionLabel>What works</SectionLabel>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
                {d.feedback!.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <SectionLabel>Questions to think about</SectionLabel>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
              {d.feedback!.points.map((p, i) => (
                <li key={i}>
                  {p.question}
                  <span className="block text-[13px] text-muted">
                    {p.location ? `${p.location}: ` : ''}
                    {p.observation}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted">Feedback is questions and observations only. The writing is always yours.</p>
        </Card>
      ))}

      {others.length > 0 && (
        <Card className="p-4">
          <h2 className="text-[15px] font-semibold">Waiting on others</h2>
          <ul className="mt-1">
            {others.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 border-t border-line py-2 text-sm first:border-t-0">
                <span className="min-w-0">
                  {t.title}
                  <span className="block text-[13px] text-muted">{ownerLabel(t, student) === 'You' ? data.firm.counselorFirstName : ownerLabel(t, student)}</span>
                </span>
                <span className="shrink-0 text-[13px] text-muted">{formatDate(t.dueDate)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!onLink && <Link to="profile" className="flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface text-sm font-semibold text-accent hover:bg-canvas">
        Update my scores and activities
      </Link>}
    </>
  )
}

// ── Profile update form ─────────────────────────────────────────────────────

const toList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
const toNumber = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? undefined : Number(s))

export function StudentProfile() {
  const student = useStudent()
  const updateStudent = useStore((s) => s.updateStudent)
  const toast = useToast()
  const [f, setF] = useState({
    gpa: student.gpa?.toString() ?? '',
    sat: student.tests.sat?.toString() ?? '',
    act: student.tests.act?.toString() ?? '',
    toefl: student.tests.toefl?.toString() ?? '',
    majors: student.majors.join(', '),
    interests: student.interests.join(', '),
  })
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch })
  const [activity, setActivity] = useState({ name: '', role: '' })

  const save = () => {
    const changed = [
      toNumber(f.gpa) !== student.gpa && 'GPA',
      toNumber(f.sat) !== student.tests.sat && 'SAT',
      toNumber(f.act) !== student.tests.act && 'ACT',
      toNumber(f.toefl) !== student.tests.toefl && 'TOEFL',
      f.majors !== student.majors.join(', ') && 'majors',
      f.interests !== student.interests.join(', ') && 'interests',
    ].filter(Boolean)
    if (changed.length === 0) return toast('Nothing changed.')
    updateStudent(
      student.id,
      { gpa: toNumber(f.gpa), tests: { ...student.tests, sat: toNumber(f.sat), act: toNumber(f.act), toefl: toNumber(f.toefl) }, majors: toList(f.majors), interests: toList(f.interests) },
      'student',
      changed.join(', '),
    )
    toast('Saved. Your counselor can see it.')
  }

  return (
    <>
      <header>
        <Link to=".." className="flex min-h-11 items-center text-sm font-semibold text-accent">
          ← Back to my tasks
        </Link>
        <h1 className="text-2xl font-bold">My profile</h1>
        <p className="text-[13px] text-muted">
          {student.school} · Class of {student.gradYear}
        </p>
      </header>

      <Card className="p-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="GPA">
              <input className={inputClass} inputMode="decimal" value={f.gpa} onChange={(e) => set({ gpa: e.target.value })} />
            </Field>
            <Field label="SAT">
              <input className={inputClass} inputMode="numeric" value={f.sat} onChange={(e) => set({ sat: e.target.value })} placeholder="Not taken" />
            </Field>
            <Field label="ACT">
              <input className={inputClass} inputMode="numeric" value={f.act} onChange={(e) => set({ act: e.target.value })} placeholder="Not taken" />
            </Field>
            <Field label="TOEFL">
              <input className={inputClass} inputMode="numeric" value={f.toefl} onChange={(e) => set({ toefl: e.target.value })} placeholder="Not taken" />
            </Field>
          </div>
          <Field label="Intended majors" hint="Separate with commas">
            <input className={inputClass} value={f.majors} onChange={(e) => set({ majors: e.target.value })} />
          </Field>
          <Field label="Interests" hint="Separate with commas">
            <input className={inputClass} value={f.interests} onChange={(e) => set({ interests: e.target.value })} />
          </Field>
          <Button type="submit" variant="primary">
            Save changes
          </Button>
        </form>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-[15px] font-semibold">Activities</h2>
        {student.activities.length === 0 && <p className="text-sm text-muted">Add what you do outside class.</p>}
        <ul>
          {student.activities.map((a) => (
            <li key={a.id} className="border-t border-line py-2 text-sm first:border-t-0">
              <span className="font-semibold">{a.name}</span>
              <span className="block text-[13px] text-muted">
                {a.role}
                {a.detail && ` · ${a.detail}`}
              </span>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!activity.name.trim()) return
            updateStudent(
              student.id,
              { activities: [...student.activities, { id: `act-${Date.now()}`, name: activity.name.trim(), role: activity.role.trim() || 'Member' }] },
              'student',
              `new activity “${activity.name.trim()}”`,
            )
            setActivity({ name: '', role: '' })
            toast('Activity added.')
          }}
        >
          <input className={inputClass} placeholder="New activity" aria-label="Activity" value={activity.name} onChange={(e) => setActivity({ ...activity, name: e.target.value })} />
          <input className={inputClass} placeholder="Your role" aria-label="Role" value={activity.role} onChange={(e) => setActivity({ ...activity, role: e.target.value })} />
          <Button type="submit" disabled={!activity.name.trim()}>
            Add activity
          </Button>
        </form>
      </Card>
    </>
  )
}
