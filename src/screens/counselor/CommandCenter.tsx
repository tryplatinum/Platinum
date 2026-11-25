// Overview (formerly the command center): caseload summary and shortcuts.
// The Inbox is at /app.

import { useState } from 'react'
import { LogMeetingModal, StudentFormModal } from '../../components/forms'
import { StudentTable } from '../../components/StudentTable'
import { Button, Card, CardHeader, Empty, LinkButton, PageHeader } from '../../components/ui'
import { formatDateLong, todayISO } from '../../lib/dates'
import { WEEKDAYS, allPendingApprovals, summarizeAll, weeklyTextRows } from '../../lib/derive'
import { reminderQueue } from '../../lib/reminders'
import { useData, useStore } from '../../store/store'

export default function CommandCenter() {
  const data = useData()
  const loadSample = useStore((s) => s.loadSample)
  const [modal, setModal] = useState<'student' | 'meeting'>()
  const summaries = summarizeAll(data)
  const approvalCount = allPendingApprovals(data, reminderQueue(data)).length
  const behind = summaries.filter((s) => s.status === 'behind').length
  const late = summaries.reduce((n, s) => n + s.progress.late, 0)
  const queued = reminderQueue(data).length
  const weekly = weeklyTextRows(data).length
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

  return (
    <>
      <PageHeader
        above={`${formatDateLong(todayISO())} · ${plural(summaries.length, 'student')} · ${behind} behind · ${plural(late, 'late task')} · ${approvalCount} waiting for approval`}
        title="Overview"
        actions={
          <>
            <Button onClick={() => setModal('student')}>Add student</Button>
            <Button variant="primary" onClick={() => setModal('meeting')} disabled={summaries.length === 0}>
              Log a meeting
            </Button>
          </>
        }
      />

      {summaries.length === 0 ? (
        <Card>
          <Empty title="No students yet. Add your first student, or load the invented sample caseload to look around.">
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => setModal('student')}>
                Add student
              </Button>
              <Button onClick={loadSample}>Load the sample caseload</Button>
            </div>
          </Empty>
        </Card>
      ) : (
        <>
          <Card tone="accent" className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="text-[15px] font-semibold">
                Waiting for your approval <span className="font-medium text-ink-soft">({approvalCount})</span>
              </p>
              <p className="text-[13px] text-ink-soft">Drafts and pending sends are reviewed in the Inbox. Nothing is sent until you approve.</p>
            </div>
            <LinkButton variant="primary" to="/app">
              Open the Inbox
            </LinkButton>
          </Card>

          {weekly > 0 && (
            <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="text-[15px] font-semibold">Weekly texts: {weekly} to send</p>
                <p className="text-[13px] text-muted">
                  This week’s text to each student (the week starts on {WEEKDAYS[data.firm.weeklyTextDay]}): next meeting, what is late, what is due.
                </p>
              </div>
              <LinkButton variant="primary" to="/app">
                Review in the Inbox
              </LinkButton>
            </Card>
          )}

          <Card>
            <CardHeader
              size="section"
              className="border-b border-line px-5 py-4"
              title="Students, most urgent first"
              action={
                <>
                  <span className="text-[13px] text-muted">Behind first, then by next deadline</span>
                  {queued > 0 && <LinkButton to="/app/messages?tab=queue">Review {plural(queued, 'reminder')} in the queue</LinkButton>}
                </>
              }
            />
            <StudentTable rows={summaries} />
          </Card>
        </>
      )}

      {modal === 'student' && <StudentFormModal onClose={() => setModal(undefined)} />}
      {modal === 'meeting' && <LogMeetingModal onClose={() => setModal(undefined)} />}
    </>
  )
}
