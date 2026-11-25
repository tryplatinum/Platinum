// The student table on the Students page: one row per student with progress, the next deadline, and who things are waiting on.
// A remind button opens a drafted reminder in a row underneath.

import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { daysFromToday, formatDate } from '../lib/dates'
import { dueText, fullName, lastReminder, statusText, type StudentSummary } from '../lib/derive'
import { useData } from '../store/store'
import { ReminderComposer } from './ReminderComposer'
import { Button, DateChip, LinkButton, ProgressWithCount, StatusPill, cx } from './ui'

/** Deadlines this close are shown in the alert colour. */
const NEAR_DAYS = 10

export function StudentTable({ rows }: { rows: StudentSummary[] }) {
  const data = useData()
  const [reminding, setReminding] = useState<string>()

  return (
    <div className="overflow-x-auto rounded-b-card">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr className="bg-surface-2 text-left text-xs text-muted">
            <th className="px-5 py-3 font-semibold">Student</th>
            <th className="w-[220px] px-3 py-3 font-semibold">Progress</th>
            <th className="px-3 py-3 font-semibold">Next deadline</th>
            <th className="py-3 pl-3 pr-5 font-semibold">Waiting on</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const w = s.waitingOn
            const d = s.nextDeadline
            const near = d ? daysFromToday(d.date) <= NEAR_DAYS : false
            const reminded = w ? lastReminder(data, w.task.id) : undefined
            const open = reminding === s.student.id
            return (
              <Fragment key={s.student.id}>
                <tr className="border-t border-line align-middle transition-colors hover:bg-surface-2">
                  <td className="px-5 py-4">
                    <Link to={`/app/students/${s.student.id}`} className="font-semibold text-heading hover:text-accent hover:underline">
                      {fullName(s.student)}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      Class of {s.student.gradYear}
                      <StatusPill status={s.status} />
                    </div>
                  </td>
                  <td className="px-3 py-4">
                    {s.progress.total > 0 ? <ProgressWithCount progress={s.progress} status={s.status} text={statusText(s)} /> : <span className="text-[13px] text-muted">No tasks yet</span>}
                  </td>
                  <td className="px-3 py-4">
                    {d ? (
                      <div className="flex items-center gap-3">
                        <DateChip date={d.date} tone={near ? 'bad' : 'neutral'} />
                        <div className="min-w-0">
                          <div className="font-semibold">{d.label}</div>
                          <div className={cx('text-xs font-semibold', near ? 'text-bad' : 'text-muted')}>{dueText(d.date)}</div>
                        </div>
                      </div>
                    ) : (
                      <span className="text-[13px] text-muted">No deadline set</span>
                    )}
                  </td>
                  <td className="py-4 pl-3 pr-5">
                    {w ? (
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div>
                            <span className="font-semibold">{w.label}:</span> {w.task.title}
                          </div>
                          <div className={cx('text-xs', w.daysLate > 0 ? 'font-semibold text-bad' : 'text-muted')}>
                            {w.daysLate > 0 ? `${w.daysLate} ${w.daysLate === 1 ? 'day' : 'days'} late` : `due ${formatDate(w.task.dueDate)}`}
                            {reminded && <span className="font-normal text-muted"> · reminded {formatDate(reminded.slice(0, 10))}</span>}
                          </div>
                        </div>
                        {w.owner === 'counselor' ? (
                          <LinkButton to={`/app/students/${s.student.id}`} className="shrink-0">
                            Open
                          </LinkButton>
                        ) : (
                          <Button variant="remind" className="shrink-0" aria-expanded={open} onClick={() => setReminding(open ? undefined : s.student.id)}>
                            {w.owner === 'parent' ? 'Remind parent' : 'Remind student'}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <span className="text-[13px] text-muted">Nothing open</span>
                    )}
                  </td>
                </tr>
                {open && w && (
                  <tr>
                    <td colSpan={4} className="px-5 pb-4">
                      <ReminderComposer student={s.student} task={w.task} onDone={() => setReminding(undefined)} />
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
