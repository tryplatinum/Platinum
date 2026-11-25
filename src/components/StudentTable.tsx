// The students, most urgent first: progress, the next deadline, and who things
// are waiting on. A table where there is room for one, and stacked cards on a
// phone, so nothing is off the side of the screen. A remind button opens a
// drafted reminder underneath. Today uses the same cards for students who are
// slipping.

import { Fragment, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { daysFromToday, formatDate } from '../lib/dates'
import { dueText, fullName, lastReminder, statusText, type StudentSummary } from '../lib/derive'
import { useData } from '../store/store'
import { useRoomFor } from './motion'
import { ReminderComposer } from './ReminderComposer'
import { Button, DateChip, LinkButton, ProgressWithCount, StatusPill, cx } from './ui'

/** Deadlines this close are shown in the alert colour. */
const NEAR_DAYS = 10

export function StudentTable({ rows }: { rows: StudentSummary[] }) {
  const box = useRef<HTMLDivElement>(null)
  const wide = useRoomFor(box, 680)
  return <div ref={box}>{wide ? <Table rows={rows} /> : <StudentCards rows={rows} />}</div>
}

// ── The pieces both shapes share ────────────────────────────────────────────

function Who({ s }: { s: StudentSummary }) {
  return (
    <>
      <Link to={`/app/students/${s.student.id}`} className="tap-link font-semibold text-heading hover:text-accent hover:underline">
        {fullName(s.student)}
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
        Class of {s.student.gradYear}
        <StatusPill status={s.status} />
      </div>
    </>
  )
}

function Progress({ s }: { s: StudentSummary }) {
  return s.progress.total > 0 ? <ProgressWithCount progress={s.progress} status={s.status} text={statusText(s)} /> : <span className="text-[13px] text-muted">No tasks yet</span>
}

function NextDeadline({ s }: { s: StudentSummary }) {
  const d = s.nextDeadline
  if (!d) return <span className="text-[13px] text-muted">No deadline set</span>
  const near = daysFromToday(d.date) <= NEAR_DAYS
  return (
    <div className="flex items-center gap-3">
      <DateChip date={d.date} tone={near ? 'bad' : 'neutral'} />
      <div className="min-w-0">
        <div className="font-semibold">{d.label}</div>
        <div className={cx('text-xs font-semibold', near ? 'text-bad' : 'text-muted')}>{dueText(d.date)}</div>
      </div>
    </div>
  )
}

function Waiting({ s }: { s: StudentSummary }) {
  const data = useData()
  const w = s.waitingOn
  if (!w) return <span className="text-[13px] text-muted">Nothing open</span>
  const reminded = lastReminder(data, w.task.id)
  return (
    <div className="min-w-0">
      <div>
        <span className="font-semibold">{w.label}:</span> {w.task.title}
      </div>
      <div className={cx('text-xs', w.daysLate > 0 ? 'font-semibold text-bad' : 'text-muted')}>
        {w.daysLate > 0 ? `${w.daysLate} ${w.daysLate === 1 ? 'day' : 'days'} late` : `due ${formatDate(w.task.dueDate)}`}
        {reminded && <span className="font-normal text-muted"> · reminded {formatDate(reminded.slice(0, 10))}</span>}
      </div>
    </div>
  )
}

/** Remind the person it waits on, or open the student when it waits on the counselor. */
function Act({ s, open, onToggle, className, short }: { s: StudentSummary; open: boolean; onToggle: () => void; className?: string; /** "Remind", where the line beside it says who. */ short?: boolean }) {
  const w = s.waitingOn
  if (!w) return null
  if (w.owner === 'counselor')
    return (
      <LinkButton to={`/app/students/${s.student.id}`} className={className} aria-label={`Open ${fullName(s.student)}`}>
        Open
      </LinkButton>
    )
  return (
    <Button variant={short ? 'secondary' : 'remind'} className={className} aria-expanded={open} aria-label={`${w.owner === 'parent' ? 'Remind parent' : 'Remind student'}: ${fullName(s.student)}`} onClick={onToggle}>
      {short ? 'Remind' : w.owner === 'parent' ? 'Remind parent' : 'Remind student'}
    </Button>
  )
}

// ── Stacked cards ───────────────────────────────────────────────────────────

/** The one line that says why a student is on the list: what they are waiting on, or the first reason. */
function why(s: StudentSummary): string {
  const w = s.waitingOn
  if (!w) return s.reasons[0] ?? statusText(s)
  return `${w.label}: ${w.task.title} · ${w.daysLate > 0 ? `${w.daysLate} ${w.daysLate === 1 ? 'day' : 'days'} late` : `due ${formatDate(w.task.dueDate)}`}`
}

/** `brief` is one compact row a student, for a short list of who needs chasing: name, status, why, and the button. */
export function StudentCards({ rows, brief = false }: { rows: StudentSummary[]; brief?: boolean }) {
  const [reminding, setReminding] = useState<string>()
  return (
    <ul className="text-sm">
      {rows.map((s) => {
        const open = reminding === s.student.id
        if (brief)
          return (
            <li key={s.student.id} className="border-t border-line px-4 py-2.5 first:border-t-0 sm:px-5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <Link to={`/app/students/${s.student.id}`} className="tap-link font-semibold text-heading hover:text-accent hover:underline">
                      {fullName(s.student)}
                    </Link>
                    <StatusPill status={s.status} />
                  </div>
                  <p className="truncate text-[13px] text-ink-soft" title={why(s)}>
                    {why(s)}
                  </p>
                </div>
                <Act s={s} open={open} short onToggle={() => setReminding(open ? undefined : s.student.id)} className="shrink-0" />
              </div>
              {open && s.waitingOn && (
                <div className="motion-rise mt-2">
                  <ReminderComposer student={s.student} task={s.waitingOn.task} onDone={() => setReminding(undefined)} />
                </div>
              )}
            </li>
          )
        return (
          <li key={s.student.id} className="flex flex-col gap-3 border-t border-line px-5 py-4 first:border-t-0">
            <div>
              <Who s={s} />
            </div>
            <Progress s={s} />
            <NextDeadline s={s} />
            <div className="flex flex-col gap-2">
              <div>
                <p className="text-xs font-semibold text-muted">Waiting on</p>
                <Waiting s={s} />
              </div>
              <Act s={s} open={open} onToggle={() => setReminding(open ? undefined : s.student.id)} className="self-start" />
            </div>
            {open && s.waitingOn && (
              <div className="motion-rise">
                <ReminderComposer student={s.student} task={s.waitingOn.task} onDone={() => setReminding(undefined)} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ── Table ───────────────────────────────────────────────────────────────────

function Table({ rows }: { rows: StudentSummary[] }) {
  const [reminding, setReminding] = useState<string>()
  return (
    <div className="overflow-hidden rounded-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-surface-2 text-left text-xs text-muted">
            <th scope="col" className="px-5 py-3 font-semibold">
              Student
            </th>
            <th scope="col" className="w-[22%] px-3 py-3 font-semibold">
              Progress
            </th>
            <th scope="col" className="px-3 py-3 font-semibold">
              Next deadline
            </th>
            <th scope="col" className="py-3 pl-3 pr-5 font-semibold">
              Waiting on
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const open = reminding === s.student.id
            return (
              <Fragment key={s.student.id}>
                <tr className="border-t border-line align-middle transition-colors hover:bg-surface-2">
                  <td className="px-5 py-4">
                    <Who s={s} />
                  </td>
                  <td className="px-3 py-4">
                    <Progress s={s} />
                  </td>
                  <td className="px-3 py-4">
                    <NextDeadline s={s} />
                  </td>
                  <td className="py-4 pl-3 pr-5">
                    <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between xl:gap-3">
                      <Waiting s={s} />
                      <Act s={s} open={open} onToggle={() => setReminding(open ? undefined : s.student.id)} className="shrink-0 self-start xl:self-auto" />
                    </div>
                  </td>
                </tr>
                {open && s.waitingOn && (
                  <tr>
                    <td colSpan={4} className="px-5 pb-4">
                      <div className="motion-rise">
                        <ReminderComposer student={s.student} task={s.waitingOn.task} onDone={() => setReminding(undefined)} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
