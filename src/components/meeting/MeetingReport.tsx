// The record of a completed meeting once its drafts are settled: what was
// decided, how its tasks are going now, what went to the parents and to the
// student, and what changed in the profile. Read-only.

import { useState } from 'react'
import { formatDate, formatDateLong } from '../../lib/dates'
import { findParent, taskProgress, tasksFromMeeting } from '../../lib/derive'
import { CHANNEL_LABEL, LANGUAGE_LABEL } from '../../lib/language'
import { useData } from '../../store/store'
import type { Meeting, Student } from '../../types'
import { TaskStateRow } from '../TaskRows'
import { ApprovalStamp, SectionLabel } from '../ui'
import { SummaryCards } from './MeetingReview'

export function MeetingReport({ meeting, student }: { meeting: Meeting; student: Student }) {
  const data = useData()
  const [reading, setReading] = useState<string>()
  const tasks = tasksFromMeeting(data, meeting.id)
  const progress = taskProgress(tasks)
  const sent = data.reports.filter((r) => r.meetingId === meeting.id && r.status === 'sent')
  const applied = meeting.ai?.profileChanges.filter((c) => c.review === 'approved') ?? []
  const notesApproved = meeting.ai?.notesReview === 'approved'

  return (
    <div className="flex flex-col gap-4">
      {meeting.ai && notesApproved ? (
        <SummaryCards ai={meeting.ai} />
      ) : (
        <p className="rounded-lg bg-canvas p-3 text-sm text-muted">{meeting.transcript ? meeting.transcript.slice(0, 280) + (meeting.transcript.length > 280 ? '…' : '') : 'No notes were recorded for this meeting.'}</p>
      )}
      {meeting.ai?.notesApproval && <ApprovalStamp approval={meeting.ai.notesApproval} />}

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[15px] font-semibold">Tasks from this meeting</h3>
          {tasks.length > 0 && (
            <span className="text-[13px] font-semibold text-muted">
              {progress.done} of {progress.total} done{progress.late > 0 && <span className="text-bad"> · {progress.late} late</span>}
            </span>
          )}
        </div>
        {tasks.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No tasks came out of this meeting.</p>
        ) : (
          <ul className="mt-1">
            {tasks.map((t) => (
              <TaskStateRow key={t.id} task={t} student={student} />
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))]">
        <div className="rounded-lg bg-canvas p-3">
          <SectionLabel>Parent update</SectionLabel>
          {sent.length === 0 ? (
            <p className="mt-1 text-sm text-muted">Nothing was sent to the parents after this meeting.</p>
          ) : (
            sent.map((r) => {
              const parent = findParent(student, r.parentId)
              return (
                <div key={r.id} className="mt-1 text-sm">
                  <p>
                    Logged as sent to {parent?.name ?? 'a parent'} on {formatDate(r.sentOn ?? r.createdOn)} by {CHANNEL_LABEL[r.channel]}, in {LANGUAGE_LABEL[r.language]}.
                  </p>
                  <button type="button" className="flex min-h-11 items-center text-[13px] font-semibold text-accent underline" onClick={() => setReading(reading === r.id ? undefined : r.id)} aria-expanded={reading === r.id}>
                    {reading === r.id ? 'Hide' : 'Read what was sent'}
                  </button>
                  {reading === r.id && (
                    <p lang={r.language} className="whitespace-pre-wrap rounded-lg bg-surface p-3 leading-relaxed">
                      {r.bodyLocal ?? r.bodyEn}
                      {r.bodyLocal && <span lang="en" className="mt-2 block text-[13px] text-muted">English: {r.bodyEn}</span>}
                    </p>
                  )}
                </div>
              )
            })
          )}
        </div>
        <div className="rounded-lg bg-canvas p-3">
          <SectionLabel>Profile changes</SectionLabel>
          {applied.length === 0 ? (
            <p className="mt-1 text-sm text-muted">None.</p>
          ) : (
            <p className="mt-1 text-sm">
              {applied.length} approved: {applied.map((c) => `${c.label.toLowerCase()} → ${c.to}`).join('; ')}.
            </p>
          )}
        </div>
        {meeting.recap?.review === 'approved' && (
          <div className="rounded-lg bg-canvas p-3">
            <SectionLabel>Recap shared with {student.firstName}</SectionLabel>
            <p className="mt-1 text-sm leading-relaxed">{meeting.recap.summary}</p>
          </div>
        )}
      </div>
    </div>
  )
}

/** "Tuesday, Nov 10 · UC essays and campus list" */
export const meetingHeading = (m: Meeting) => `${formatDateLong(m.date)} · ${m.title}`
