// A student's meetings. Main column: the most recent meeting as a full report
// (or its review, if drafts are waiting), then past meetings. Right column: the
// upcoming meeting with its brief.

import { useState } from 'react'
import { LogMeetingModal, MeetingFormModal } from '../../../components/forms'
import { BriefCard } from '../../../components/meeting/BriefCard'
import { MeetingReport, meetingHeading } from '../../../components/meeting/MeetingReport'
import { MeetingReview } from '../../../components/meeting/MeetingReview'
import { removeMeetingFromCalendar } from '../../../lib/calendarSync'
import { Button, Card, CardHeader, Empty, PhoneFold, Pill, SectionLabel, useConfirm } from '../../../components/ui'
import { formatDate, formatDateLong, formatTime } from '../../../lib/dates'
import { meetingBuckets, meetingOneLine, pendingInMeeting, taskProgress, tasksFromMeeting } from '../../../lib/derive'
import { useData, useStore } from '../../../store/store'
import type { Student } from '../../../types'

export default function MeetingsTab({ student }: { student: Student }) {
  const data = useData()
  const deleteMeeting = useStore((s) => s.deleteMeeting)
  const confirm = useConfirm()
  const [modal, setModal] = useState<'log' | 'schedule'>()
  const [viewing, setViewing] = useState<string>()
  const [showAll, setShowAll] = useState(false)
  const { upcoming, later, recent, past } = meetingBuckets(data, student.id)
  const needsDrafting = recent && !recent.ai && !recent.recap
  const reviewing = recent && (pendingInMeeting(recent) > 0 || (needsDrafting && recent.transcript))

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-6">
        {recent ? (
          <Card className="flex flex-col gap-4 p-5">
            <div>
              <SectionLabel>Most recent meeting{reviewing ? ' · to review' : ''}</SectionLabel>
              <h2 className="mt-0.5 text-xl font-bold">{meetingHeading(recent)}</h2>
              <p className="text-[13px] text-muted">
                {recent.durationMin} minutes{recent.location && ` on ${recent.location}`}
                {recent.ai?.notesApproval && ` · notes approved by ${recent.ai.notesApproval.by}, ${formatDate(recent.ai.notesApproval.at.slice(0, 10))}`}
              </p>
            </div>
            {reviewing ? <MeetingReview meeting={recent} student={student} /> : <MeetingReport meeting={recent} student={student} />}
          </Card>
        ) : (
          <Card>
            <Empty title={`No meetings with ${student.firstName} yet. Log one that happened, or schedule the first.`}>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setModal('log')}>
                  Log a meeting
                </Button>
                {!upcoming && <Button onClick={() => setModal('schedule')}>Schedule a meeting</Button>}
              </div>
            </Empty>
          </Card>
        )}

        {past.length > 0 && (
          <Card>
            <CardHeader size="section" className="px-5 py-4" title="Past meetings" action={<span className="text-[13px] text-muted">{past.length + 1} in all</span>} />
            <ul>
              {(showAll ? past : past.slice(0, 4)).map((m) => {
                const progress = taskProgress(tasksFromMeeting(data, m.id))
                const open = viewing === m.id
                // An older meeting can still have drafts waiting: its row says so and opens the review, not the report.
                const waiting = pendingInMeeting(m)
                return (
                  <li key={m.id} className="border-t border-line px-5 py-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <div className="w-16 shrink-0 text-sm font-semibold">{formatDate(m.date)}</div>
                      <div className="min-w-[12rem] flex-1">
                        <div className="text-sm font-semibold">{m.title}</div>
                        <div className="text-[13px] text-muted">{meetingOneLine(m)}</div>
                      </div>
                      {waiting > 0 ? <Pill tone="accent">{waiting} to review</Pill> : <div className="text-[13px] text-muted">{progress.total ? `${progress.done} of ${progress.total} tasks done` : 'No tasks'}</div>}
                      <Button variant="quiet" onClick={() => setViewing(open ? undefined : m.id)} aria-expanded={open} aria-label={`${open ? 'Hide' : waiting > 0 ? 'Review' : 'View report of'} the ${formatDate(m.date)} meeting`}>
                        {open ? 'Hide' : waiting > 0 ? 'Review' : 'View report'}
                      </Button>
                    </div>
                    {open && (
                      <div className="mt-3 flex flex-col gap-3">
                        {waiting > 0 ? <MeetingReview meeting={m} student={student} /> : <MeetingReport meeting={m} student={student} />}
                        <Button
                          variant="danger"
                          className="self-start"
                          onClick={async () => {
                            if (await confirm({ title: 'Delete meeting', body: 'Delete this meeting and its notes? Tasks that came from it are kept.', action: 'Delete meeting' })) {
                              deleteMeeting(m.id)
                              void removeMeetingFromCalendar(m)
                            }
                          }}
                        >
                          Delete meeting
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            {past.length > 4 && (
              <div className="border-t border-line px-5 py-2">
                <Button variant="quiet" onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'Show fewer' : `Show ${past.length - 4} older ${past.length - 4 === 1 ? 'meeting' : 'meetings'}`}
                </Button>
              </div>
            )}
          </Card>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        {upcoming ? (
          <PhoneFold label="Brief for the upcoming meeting">
            <BriefCard meeting={upcoming} student={student} heading="Upcoming" />
          </PhoneFold>
        ) : (
          <Card tone="accent" className="flex flex-col items-start gap-3 p-5">
            <h2 className="text-base font-semibold">Nothing scheduled</h2>
            <p className="text-sm text-ink-soft">Schedule the next meeting to get a brief before it.</p>
            <Button onClick={() => setModal('schedule')}>
              Schedule a meeting
            </Button>
          </Card>
        )}
        {later.length > 0 && (
          <Card className="p-5">
            <h2 className="text-base font-semibold">Also scheduled</h2>
            <ul className="mt-2 text-sm">
              {later.map((m) => (
                <li key={m.id} className="border-t border-line py-2 first:border-t-0">
                  <span className="font-semibold">{m.title}</span>
                  <span className="block text-[13px] text-muted">
                    {formatDateLong(m.date)}, {formatTime(m.time)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card className="flex flex-col items-start gap-2 p-5">
          <h2 className="text-base font-semibold">After a meeting</h2>
          <p className="text-sm text-ink-soft">
            Press “Log a meeting” at the top of this page, paste your notes or a transcript, and the AI drafts notes, tasks, a parent update and profile changes for your review. Nothing goes to {student.firstName} or the family until you approve it.
          </p>
        </Card>
      </div>

      {modal === 'log' && <LogMeetingModal studentId={student.id} onClose={() => setModal(undefined)} />}
      {modal === 'schedule' && <MeetingFormModal studentId={student.id} onClose={() => setModal(undefined)} />}
    </div>
  )
}
