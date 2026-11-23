// An upcoming meeting with its pre-meeting brief. The facts (what is overdue,
// what changed, which deadlines are close) are computed by lib/facts.ts and are
// always shown. The AI adds a headline, a suggested agenda and questions when
// the counselor asks for them; that part is kept on the meeting.
// Only the counselor reads this, so there is nothing to approve.

import { useState } from 'react'
import { formatDateLong, formatRelative, formatTime } from '../../lib/dates'
import { briefFacts } from '../../lib/facts'
import { prepareBrief } from '../../services/workflows'
import { useData, useStore } from '../../store/store'
import type { Meeting, Student } from '../../types'
import { LogMeetingModal, MeetingFormModal } from '../forms'
import { AiErrorNote, AiTag, Button, Card, PlaceholderNote, SectionLabel, Thinking, textareaClass, useAi } from '../ui'

export function BriefCard({ meeting, student, heading = 'Before your next meeting' }: { meeting: Meeting; student: Student; heading?: string }) {
  const data = useData()
  const updateMeeting = useStore((s) => s.updateMeeting)
  const { busy, error, run } = useAi()
  const [modal, setModal] = useState<'reschedule' | 'log'>()
  const [editingAgenda, setEditingAgenda] = useState(false)
  const facts = briefFacts(data, meeting, student)
  const brief = meeting.brief
  const agenda = meeting.agenda ?? brief?.agenda.map((a) => a.topic) ?? []

  // The computed lines, shortest useful form.
  const lines = [
    ...facts.overdue.slice(0, 3).map((o) => `${o.title}: ${o.daysLate} ${o.daysLate === 1 ? 'day' : 'days'} late (${o.owner})`),
    facts.overdue.length > 3 ? `${facts.overdue.length - 3} more overdue` : '',
    ...facts.deadlines
      .filter((d) => d.kind === 'college')
      .slice(0, 2)
      .map((d) => `${d.label} is due ${formatRelative(d.date)}`),
    facts.waitingOnCounselor.length ? `${facts.waitingOnCounselor.length} of your own approvals are still waiting` : '',
  ].filter(Boolean)

  return (
    <Card tone="accent" className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{heading}</h2>
        {brief && <AiTag source={brief.source}>AI brief</AiTag>}
      </div>
      <div>
        <p className="text-lg font-bold leading-snug">
          {formatDateLong(meeting.date)}, {formatTime(meeting.time)}
        </p>
        <p className="text-[13px] text-ink-soft">
          {meeting.title} · {formatRelative(meeting.date)} · {meeting.durationMin} minutes{meeting.location && ` · ${meeting.location}`}
        </p>
      </div>

      {brief?.headline && <p className="text-sm leading-relaxed">{brief.headline}</p>}
      <PlaceholderNote source={brief?.source} />

      <div>
        <SectionLabel>From {student.firstName}’s tasks and deadlines</SectionLabel>
        {lines.length ? (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-ink-soft">Nothing is overdue and no application deadline is close.</p>
        )}
      </div>

      <div>
        <SectionLabel>{brief && !meeting.agenda ? 'Suggested agenda' : 'Agenda'}</SectionLabel>
        {editingAgenda ? (
          <textarea
            className={`${textareaClass} mt-1`}
            rows={Math.max(3, agenda.length + 1)}
            aria-label="Agenda, one item per line"
            defaultValue={agenda.join('\n')}
            onBlur={(e) => updateMeeting(meeting.id, { agenda: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
          />
        ) : agenda.length ? (
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-relaxed">
            {agenda.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
        ) : (
          <p className="mt-1 text-sm text-ink-soft">No agenda yet. Write one, or have the AI suggest one from the facts above.</p>
        )}
      </div>

      {brief && brief.questions.length > 0 && (
        <div>
          <SectionLabel>Questions worth asking</SectionLabel>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {brief.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      <AiErrorNote message={error} />
      {busy && <Thinking label="AI is preparing the brief…" />}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setEditingAgenda(!editingAgenda)}>
          {editingAgenda ? 'Save agenda' : 'Edit agenda'}
        </Button>
        <Button onClick={() => run(() => prepareBrief(meeting.id))} disabled={busy}>
          {brief ? 'Refresh AI brief' : 'Prepare AI brief'}
        </Button>
        <Button onClick={() => setModal('reschedule')}>Reschedule</Button>
        <Button onClick={() => setModal('log')}>Log this meeting</Button>
      </div>

      {modal === 'reschedule' && <MeetingFormModal meeting={meeting} onClose={() => setModal(undefined)} />}
      {modal === 'log' && <LogMeetingModal studentId={student.id} meetingId={meeting.id} onClose={() => setModal(undefined)} />}
    </Card>
  )
}
