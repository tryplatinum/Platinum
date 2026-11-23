// Student roster: one row per student, with progress readable at a glance.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar, Card, PageHeader, Pill, ProgressBar, StatusPill, cx, inputClass } from '../../components/ui'
import { formatDate, formatRelative } from '../../lib/dates'
import { classLabel, fullName, summarizeAll, type StudentStatus } from '../../lib/derive'
import { useData } from '../../store/store'

const FILTERS: { value: StudentStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'behind', label: 'Behind' },
  { value: 'slipping', label: 'Slipping' },
  { value: 'on_track', label: 'On track' },
  { value: 'new', label: 'Just onboarded' },
]

export default function Roster() {
  const data = useData()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<StudentStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const all = summarizeAll(data)
  const rows = all.filter(
    (s) => (filter === 'all' || s.status === filter) && fullName(s.student).toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <div>
      <PageHeader title="Students" subtitle={`${all.length} students, the ones who need you most first`} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cx('rounded-md px-3 py-1.5 text-xs font-medium', filter === f.value ? 'bg-ink text-white' : 'text-muted hover:text-ink')}
            >
              {f.label}
              {f.value !== 'all' && <span className="ml-1 opacity-70">{all.filter((s) => s.status === f.value).length}</span>}
            </button>
          ))}
        </div>
        <input className={cx(inputClass, 'max-w-xs')} placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs font-medium text-muted">
              <th className="px-4 py-2.5 font-medium">Student</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="w-44 px-3 py-2.5 font-medium">Progress</th>
              <th className="px-3 py-2.5 text-right font-medium">Open</th>
              <th className="px-3 py-2.5 text-right font-medium">Late</th>
              <th className="px-3 py-2.5 font-medium">Next deadline</th>
              <th className="px-3 py-2.5 font-medium">Last meeting</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={s.student.id}
                onClick={() => navigate(`/app/students/${s.student.id}`)}
                className="cursor-pointer border-b border-line last:border-b-0 hover:bg-canvas/60"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={fullName(s.student)} size="sm" />
                    <div>
                      <p className="font-medium text-ink">{fullName(s.student)}</p>
                      <p className="text-xs text-muted">
                        {classLabel(s.student.gradYear)} · {s.student.school}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <StatusPill status={s.status} />
                  {s.pendingApprovalCount > 0 && <Pill tone="ai" className="ml-1.5">✦ {s.pendingApprovalCount}</Pill>}
                </td>
                <td className="px-3 py-3">
                  <ProgressBar done={s.done} late={s.late} total={s.total} />
                  <p className="mt-1 text-xs text-faint">
                    {s.done} of {s.total} done
                  </p>
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">{s.open}</td>
                <td className={cx('px-3 py-3 text-right tabular-nums', s.late > 0 ? 'font-semibold text-bad' : 'text-faint')}>{s.late}</td>
                <td className="max-w-[16rem] px-3 py-3">
                  {s.nextDeadline ? (
                    <>
                      <p className="truncate text-ink">{s.nextDeadline.label}</p>
                      <p className="text-xs text-muted">
                        {formatDate(s.nextDeadline.date)} · {formatRelative(s.nextDeadline.date)}
                      </p>
                    </>
                  ) : (
                    <span className="text-faint">None</span>
                  )}
                </td>
                <td className="px-3 py-3 text-muted">{s.lastMeeting ? formatRelative(s.lastMeeting.date) : 'Never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No students match.</p>}
      </Card>
    </div>
  )
}
