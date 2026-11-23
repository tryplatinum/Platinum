// Pre-meeting brief for an upcoming meeting. The lists (what changed, what is
// overdue, which deadlines are close) are computed by our code in lib/facts.ts.
// The AI writes the headline, the agenda and the questions around them. Only
// the counselor reads this page, so there is nothing to approve here.

import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AiErrorNote, Button, Card, Empty, OwnerBadge, PageHeader, Pill, PlaceholderNote, SourceBadge, Thinking } from '../../components/ui'
import { formatDate, formatDateLong, formatRelative, formatTime } from '../../lib/dates'
import { findStudent } from '../../lib/derive'
import { briefFacts } from '../../lib/facts'
import { preMeetingBrief, type Brief } from '../../services/ai'
import { useData } from '../../store/store'

export default function PreMeetingBrief() {
  const data = useData()
  const { studentId, meetingId } = useParams()
  const student = findStudent(data, studentId)
  const meeting = data.meetings.find((m) => m.id === meetingId && m.studentId === studentId)
  const [brief, setBrief] = useState<Brief>()
  const [error, setError] = useState<string>()
  const [version, setVersion] = useState(0)

  // The AI part is written once when the page opens (and on "Refresh"), from the data at that moment.
  useEffect(() => {
    let cancelled = false
    setBrief(undefined)
    setError(undefined)
    if (meetingId) {
      preMeetingBrief(data, meetingId)
        .then((b) => !cancelled && setBrief(b))
        .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Something went wrong.'))
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId, version])

  if (!student || !meeting) return <Navigate to="/app/students" replace />

  // The facts are always live and always shown, with or without the AI's part.
  const facts = briefFacts(data, meeting, student)

  return (
    <div className="max-w-4xl">
      <PageHeader
        back={{ to: `/app/students/${student.id}?tab=meetings`, label: `${student.firstName}’s meetings` }}
        title={`Brief: ${meeting.title}`}
        subtitle={`${student.firstName} ${student.lastName} · ${formatDateLong(meeting.date)}, ${formatTime(meeting.time)} · ${formatRelative(meeting.date)}`}
        actions={
          <>
            <Pill>For your eyes only</Pill>
            <Button size="sm" onClick={() => setVersion(version + 1)}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        <AiErrorNote message={error} />

        {!brief && !error && (
          <Card tone="ai">
            <Thinking label="AI is preparing your brief…" />
          </Card>
        )}

        {brief && (
          <Card tone="ai" title="Suggested agenda" action={<SourceBadge source={brief.source} />}>
            <div className="space-y-3 border-b border-line px-4 py-3 empty:hidden">
              <PlaceholderNote source={brief.source} />
              {brief.headline && <p className="text-sm leading-relaxed text-ink">{brief.headline}</p>}
            </div>
            <ol>
              {brief.agenda.map((a, i) => (
                <li key={i} className="flex gap-3 border-b border-line px-4 py-3 last:border-b-0">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ai-soft text-xs font-semibold text-ai">{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium text-ink">{a.topic}</p>
                    <p className="text-sm text-muted">{a.why}</p>
                  </div>
                </li>
              ))}
            </ol>
            {brief.questions.length > 0 && (
              <div className="border-t border-line px-4 py-3">
                <p className="mb-1.5 text-xs font-medium text-muted">Questions worth asking {student.firstName}</p>
                <ul className="space-y-1">
                  {brief.questions.map((q) => (
                    <li key={q} className="text-sm text-ink">
                      • {q}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}

        <p className="text-xs text-muted">The lists below are computed by Platinum from {student.firstName}’s tasks and deadlines, not written by the AI.</p>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={`Overdue (${facts.overdue.length})`}>
            {facts.overdue.length === 0 && <Empty>Nothing overdue.</Empty>}
            <ul>
              {facts.overdue.map((o) => (
                <li key={o.id} className="border-b border-line px-4 py-3 last:border-b-0">
                  <p className="text-sm text-ink">{o.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2">
                    <OwnerBadge owner={o.ownerType} label={o.owner} />
                    <Pill tone="bad">{o.daysLate} days late</Pill>
                  </p>
                  {o.progressNote && <p className="mt-1 text-xs italic text-muted">“{o.progressNote}”</p>}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Deadlines in the next two weeks">
            {facts.deadlines.length === 0 && <Empty>No deadlines in the next two weeks.</Empty>}
            <ul>
              {facts.deadlines.map((d) => (
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
            facts.previous ? `What changed since “${facts.previous.title}” (${formatRelative(facts.previous.date)})` : 'What changed in the last month'
          }
        >
          {facts.changes.length === 0 && <Empty>No recorded changes.</Empty>}
          <ul className="space-y-1.5 px-4 py-3">
            {facts.changes.map((c) => (
              <li key={c} className="flex gap-2 text-sm text-ink">
                <span className={c.startsWith('Completed') ? 'text-good' : 'text-faint'}>{c.startsWith('Completed') ? '✓' : '•'}</span>
                {c}
              </li>
            ))}
          </ul>
        </Card>

        {facts.waitingOnCounselor.length > 0 && (
          <Card tone="ai" title="Still waiting for your approval">
            <ul className="space-y-1.5 px-4 py-3">
              {facts.waitingOnCounselor.map((w) => (
                <li key={w} className="text-sm text-ink">
                  {w}
                </li>
              ))}
            </ul>
            {facts.previous && (
              <p className="border-t border-line px-4 py-2.5 text-sm">
                <Link to={`/app/students/${student.id}/meetings/${facts.previous.id}`} className="font-medium text-ai hover:underline">
                  Review drafts from the last meeting →
                </Link>
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
