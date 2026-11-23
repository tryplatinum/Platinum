// Pre-meeting brief for an upcoming meeting: what changed since last time, what
// is overdue, which deadlines are close, and a suggested agenda. For the
// counselor only, so there is nothing to approve here.

import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AiBadge, Button, Card, Empty, OwnerBadge, PageHeader, Pill, Thinking } from '../../components/ui'
import { formatDate, formatDateLong, formatRelative, formatTime } from '../../lib/dates'
import { findStudent } from '../../lib/derive'
import { preMeetingBrief, type Brief } from '../../services/ai'
import { useData } from '../../store/store'

export default function PreMeetingBrief() {
  const data = useData()
  const { studentId, meetingId } = useParams()
  const student = findStudent(data, studentId)
  const meeting = data.meetings.find((m) => m.id === meetingId && m.studentId === studentId)
  const [brief, setBrief] = useState<Brief>()
  const [version, setVersion] = useState(0)

  // Built once when the page opens (and on "Refresh"), from the data at that moment.
  useEffect(() => {
    let cancelled = false
    setBrief(undefined)
    if (meetingId) void preMeetingBrief(data, meetingId).then((b) => !cancelled && setBrief(b))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, version])

  if (!student || !meeting) return <Navigate to="/app/students" replace />

  return (
    <div className="max-w-4xl">
      <PageHeader
        back={{ to: `/app/students/${student.id}?tab=meetings`, label: `${student.firstName}’s meetings` }}
        title={`Brief: ${meeting.title}`}
        subtitle={`${student.firstName} ${student.lastName} · ${formatDateLong(meeting.date)}, ${formatTime(meeting.time)} · ${formatRelative(meeting.date)}`}
        actions={
          <>
            <AiBadge>AI brief · for your eyes only</AiBadge>
            <Button size="sm" onClick={() => setVersion(version + 1)}>
              Refresh
            </Button>
          </>
        }
      />

      {!brief ? (
        <Card tone="ai">
          <Thinking label="AI is preparing your brief…" />
        </Card>
      ) : (
        <div className="space-y-6">
          <Card tone="ai" title="Suggested agenda">
            <ol>
              {brief.agenda.map((a, i) => (
                <li key={a.topic} className="flex gap-3 border-b border-line px-4 py-3 last:border-b-0">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ai-soft text-xs font-semibold text-ai">{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium text-ink">{a.topic}</p>
                    <p className="text-sm text-muted">{a.why}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={`Overdue (${brief.overdue.length})`}>
              {brief.overdue.length === 0 && <Empty>Nothing overdue.</Empty>}
              <ul>
                {brief.overdue.map((o) => (
                  <li key={o.task.id} className="border-b border-line px-4 py-3 last:border-b-0">
                    <p className="text-sm text-ink">{o.task.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2">
                      <OwnerBadge owner={o.task.owner} label={o.owner} />
                      <Pill tone="bad">{o.daysLate} days late</Pill>
                    </p>
                    {o.task.progressNote && <p className="mt-1 text-xs italic text-muted">“{o.task.progressNote}”</p>}
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Deadlines in the next two weeks">
              {brief.deadlines.length === 0 && <Empty>No deadlines in the next two weeks.</Empty>}
              <ul>
                {brief.deadlines.map((d) => (
                  <li key={d.kind + d.id} className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
                    <span className="text-sm text-ink">
                      {d.label} {d.kind === 'college' && <Pill tone="accent">Application</Pill>}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {formatDate(d.date)} · {formatRelative(d.date)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card
            title={
              brief.previous
                ? `What changed since “${brief.previous.title}” (${formatRelative(brief.previous.date)})`
                : 'What changed in the last month'
            }
          >
            {brief.changes.length === 0 && <Empty>No recorded changes.</Empty>}
            <ul className="space-y-1.5 px-4 py-3">
              {brief.changes.map((c) => (
                <li key={c} className="flex gap-2 text-sm text-ink">
                  <span className={c.startsWith('Completed') ? 'text-good' : 'text-faint'}>{c.startsWith('Completed') ? '✓' : '•'}</span>
                  {c}
                </li>
              ))}
            </ul>
          </Card>

          {brief.waitingOnCounselor.length > 0 && (
            <Card tone="ai" title="Still waiting for your approval">
              <ul className="space-y-1.5 px-4 py-3">
                {brief.waitingOnCounselor.map((w) => (
                  <li key={w} className="text-sm text-ink">
                    {w}
                  </li>
                ))}
              </ul>
              {brief.previous && (
                <p className="border-t border-line px-4 py-2.5 text-sm">
                  <Link to={`/app/students/${student.id}/meetings/${brief.previous.id}`} className="font-medium text-ai hover:underline">
                    Review drafts from the last meeting →
                  </Link>
                </p>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
