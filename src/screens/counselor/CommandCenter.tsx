// Command center: the landing page. Answers "who needs me today?" without
// opening a single student.

import { Link } from 'react-router-dom'
import { Avatar, Card, Empty, Pill, ProgressBar, StatusPill, cx } from '../../components/ui'
import { addDays, daysFromToday, formatDate, formatDateLong, formatRelative, formatTime, formatTimestamp, todayISO } from '../../lib/dates'
import { deadlinesFor, findStudent, fullName, needsAttention, pendingApprovals, summarizeAll, type Deadline } from '../../lib/derive'
import { useData } from '../../store/store'

const WEEK_DAYS = 7

export default function CommandCenter() {
  const data = useData()
  const today = todayISO()
  const weekEnd = addDays(today, WEEK_DAYS)
  const summaries = summarizeAll(data)
  const attention = summaries.filter(needsAttention)
  const approvals = pendingApprovals(data)
  const approvalCount = approvals.reduce((n, a) => n + a.count, 0)
  const lateCount = summaries.reduce((n, s) => n + s.late, 0)

  const thisWeek: Deadline[] = data.students
    .flatMap((s) => deadlinesFor(data, s.id))
    .filter((d) => d.date >= today && d.date <= weekEnd)
    .sort((a, b) => a.date.localeCompare(b.date))
  // A student's applications due on the same day (four UC campuses, say) show as one line.
  const byDay = new Map<string, Deadline[]>()
  for (const d of thisWeek) {
    const day = byDay.get(d.date) ?? []
    const same = d.kind === 'college' ? day.find((x) => x.kind === 'college' && x.studentId === d.studentId) : undefined
    if (same) same.label = `${same.label.replace(/ application$/, '')}, ${d.label}`
    else day.push({ ...d })
    byDay.set(d.date, day)
  }
  const dueCount = [...byDay.values()].reduce((n, day) => n + day.length, 0)

  const meetings = data.meetings
    .filter((m) => m.status === 'scheduled' && m.date >= today && m.date <= weekEnd)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {greeting}, {data.firm.counselorFirstName}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {formatDateLong(today)} · {data.students.length} students
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Need attention" value={attention.length} tone={attention.length ? 'bad' : 'good'} hint="students behind or slipping" />
        <Stat label="Late tasks" value={lateCount} tone={lateCount ? 'bad' : 'good'} hint="across all students" />
        <Stat label="Due this week" value={dueCount} tone="neutral" hint="tasks and applications" />
        <Stat label="Waiting for your approval" value={approvalCount} tone={approvalCount ? 'ai' : 'neutral'} hint="AI drafts" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Needs attention today">
            {attention.length === 0 && <Empty>Nobody is behind. Enjoy it.</Empty>}
            <ul>
              {attention.map((s) => (
                <li key={s.student.id} className="border-b border-line last:border-b-0">
                  <Link to={`/app/students/${s.student.id}`} className="flex items-start gap-3 px-4 py-3.5 hover:bg-canvas/60">
                    <Avatar name={fullName(s.student)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-ink">{fullName(s.student)}</span>
                        <StatusPill status={s.status} />
                        {s.pendingApprovalCount > 0 && <Pill tone="ai">✦ {s.pendingApprovalCount} to approve</Pill>}
                      </div>
                      <ul className="mt-1.5 space-y-0.5">
                        {s.reasons.map((r) => (
                          <li key={r} className="text-sm text-muted">
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="hidden shrink-0 text-right text-xs text-muted sm:block">
                      {s.nextMeeting ? (
                        <>
                          Next meeting
                          <br />
                          <span className="font-medium text-ink">{formatRelative(s.nextMeeting.date)}</span>
                        </>
                      ) : (
                        <span className="text-warn">No meeting booked</span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Everyone at a glance" action={<Link to="/app/students" className="text-xs text-accent hover:underline">Full roster →</Link>}>
            <ul className="grid gap-px bg-line sm:grid-cols-2">
              {summaries.map((s) => (
                <li key={s.student.id} className="bg-surface">
                  <Link to={`/app/students/${s.student.id}`} className="block px-4 py-3 hover:bg-canvas/60">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">{fullName(s.student)}</span>
                      <StatusPill status={s.status} />
                    </div>
                    <div className="mt-2">
                      <ProgressBar done={s.done} late={s.late} total={s.total} />
                    </div>
                    <p className="mt-1.5 truncate text-xs text-muted">
                      {s.open} open{s.late > 0 && <span className="font-medium text-bad"> · {s.late} late</span>}
                      {s.nextDeadline && ` · next: ${s.nextDeadline.label} (${formatDate(s.nextDeadline.date)})`}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Deadlines in the next 7 days">
            {thisWeek.length === 0 && <Empty>Nothing due this week.</Empty>}
            <div className="divide-y divide-line">
              {[...byDay.entries()].map(([date, items]) => (
                <div key={date} className="flex gap-4 px-4 py-3">
                  <div className="w-24 shrink-0">
                    <p className="text-sm font-medium text-ink">{formatDateLong(date)}</p>
                    <p className={cx('text-xs', daysFromToday(date) <= 1 ? 'text-warn' : 'text-muted')}>{formatRelative(date)}</p>
                  </div>
                  <ul className="min-w-0 flex-1 space-y-1.5">
                    {items.map((d) => {
                      const student = findStudent(data, d.studentId)!
                      return (
                        <li key={d.kind + d.id} className="flex items-baseline gap-2 text-sm">
                          <Link to={`/app/students/${student.id}`} className="shrink-0 font-medium text-ink hover:underline">
                            {student.firstName}
                          </Link>
                          <span className="min-w-0 text-muted">{d.label}</span>
                          {d.kind === 'college' && <Pill tone="accent">Application</Pill>}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Waiting for your approval" tone={approvals.length ? 'ai' : undefined}>
            {approvals.length === 0 && <Empty>No AI drafts are waiting.</Empty>}
            <ul>
              {approvals.map((a) => (
                <li key={a.key} className="border-b border-line last:border-b-0">
                  <Link to={a.to} className="block px-4 py-3 hover:bg-canvas/60">
                    <p className="text-sm font-medium text-ink">{findStudent(data, a.studentId)?.firstName}</p>
                    <p className="text-sm text-muted">{a.label}</p>
                    <p className="mt-1 text-xs font-medium text-ai">
                      ✦ {a.count} {a.count === 1 ? 'draft' : 'drafts'} · Review →
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
            {approvals.length > 0 && <p className="border-t border-line px-4 py-2.5 text-xs text-muted">🔒 Nothing here has been sent to anyone.</p>}
          </Card>

          <Card title="Meetings this week">
            {meetings.length === 0 && <Empty>No meetings in the next 7 days.</Empty>}
            <ul>
              {meetings.map((m) => {
                const student = findStudent(data, m.studentId)!
                return (
                  <li key={m.id} className="border-b border-line px-4 py-3 last:border-b-0">
                    <p className="text-xs text-muted">
                      {formatDateLong(m.date)}, {formatTime(m.time)}
                    </p>
                    <p className="text-sm font-medium text-ink">
                      {student.firstName}: {m.title}
                    </p>
                    <Link to={`/app/students/${student.id}/meetings/${m.id}/brief`} className="mt-1 inline-block text-xs font-medium text-ai hover:underline">
                      ✦ Pre-meeting brief →
                    </Link>
                  </li>
                )
              })}
            </ul>
          </Card>

          <Card title="Recent activity">
            <ul>
              {data.activity.slice(0, 8).map((e) => (
                <li key={e.id} className="border-b border-line px-4 py-2.5 last:border-b-0">
                  <p className="text-sm text-ink">{e.text}</p>
                  <p className="text-xs text-faint">{formatTimestamp(e.at)}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: 'bad' | 'good' | 'neutral' | 'ai' }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p
        className={cx(
          'mt-1 text-3xl font-semibold tracking-tight',
          tone === 'bad' && 'text-bad',
          tone === 'good' && 'text-good',
          tone === 'ai' && 'text-ai',
          tone === 'neutral' && 'text-ink',
        )}
      >
        {value}
      </p>
      <p className="text-xs text-faint">{hint}</p>
    </div>
  )
}
