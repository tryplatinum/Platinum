// Command center: the landing page. Top: everything AI-drafted that is waiting
// for the counselor. Below: every student, most urgent first, with the next
// deadline and who things are waiting on.

import { useState } from 'react'
import { recipientLine } from '../../components/Bilingual'
import { LogMeetingModal, StudentFormModal } from '../../components/forms'
import { StudentTable } from '../../components/StudentTable'
import { AiTag, Button, Card, CardHeader, Empty, LinkButton, PageHeader, SENT_NOTE, useToast } from '../../components/ui'
import { formatDate, formatDateLong, formatRelative, todayISO } from '../../lib/dates'
import { WEEKDAYS, findParent, findStudent, fullName, pendingApprovals, summarizeAll, weeklyTextRows, type ApprovalItem } from '../../lib/derive'
import { reminderQueue } from '../../lib/reminders'
import { useData, useStore } from '../../store/store'

export default function CommandCenter() {
  const data = useData()
  const loadSample = useStore((s) => s.loadSample)
  const [modal, setModal] = useState<'student' | 'meeting'>()
  const summaries = summarizeAll(data)
  const approvals = pendingApprovals(data)
  const approvalCount = approvals.reduce((n, a) => n + a.count, 0)
  const behind = summaries.filter((s) => s.status === 'behind').length
  const late = summaries.reduce((n, s) => n + s.progress.late, 0)
  const queued = reminderQueue(data).length
  const weekly = weeklyTextRows(data).length
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

  return (
    <>
      <PageHeader
        above={`${formatDateLong(todayISO())} · ${plural(summaries.length, 'student')} · ${behind} behind · ${plural(late, 'late task')} · ${approvalCount} waiting for approval`}
        title="Command center"
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
          <Card tone="accent" className="flex flex-col gap-4 p-5">
            <CardHeader
              size="section"
              title={
                <>
                  Waiting for your approval <span className="font-medium text-ink-soft">({approvalCount})</span>
                </>
              }
              action={<span className="text-[13px] text-ink-soft">Drafted by AI. Nothing is sent or saved until you approve.</span>}
            />
            {approvals.length === 0 ? (
              <p className="rounded-card border border-accent-line bg-surface px-5 py-6 text-center text-sm text-muted">
                Nothing is waiting. Drafts appear here after you log a meeting, draft a parent report, or ask for essay feedback.
              </p>
            ) : (
              <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))]">
                {approvals.map((a) => (
                  <ApprovalCard key={a.key} item={a} />
                ))}
              </div>
            )}
            <p className="text-[13px] text-ink-soft">Nothing in this box has been sent to anyone.</p>
          </Card>

          {weekly > 0 && (
            <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="text-[15px] font-semibold">Weekly texts: {weekly} to send</p>
                <p className="text-[13px] text-muted">
                  This week’s text to each student (the week starts on {WEEKDAYS[data.firm.weeklyTextDay]}): next meeting, what is late, what is due. You send them from your own phone.
                </p>
              </div>
              <LinkButton variant="primary" to="/app/messages?tab=weekly">
                Write this week’s texts
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

function Tile({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-lg bg-canvas px-3 py-2.5">
      <div className="nums text-xl font-semibold text-heading">{n}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  )
}

const cardClass = 'flex flex-col gap-3 rounded-card border border-accent-line bg-surface p-5'

/** One pending item, with enough on the card to decide whether to approve it here or open it. */
function ApprovalCard({ item }: { item: ApprovalItem }) {
  const data = useData()
  const toast = useToast()
  const { approveAllInMeeting, approveReport, reviewEssayFeedback } = useStore.getState()
  const student = findStudent(data, item.studentId)
  if (!student) return null

  if (item.kind === 'meeting') {
    const m = item.meeting
    const ai = m.ai
    const bullets = ai ? [...ai.decided, ...ai.progress, ...ai.watch].slice(0, 3) : []
    return (
      <article className={cardClass}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-base font-semibold">
            {fullName(student)} · meeting on {formatDate(m.date)}
          </h3>
          <span className="whitespace-nowrap text-xs text-muted">{formatRelative(m.date)}</span>
        </div>
        <p className="-mt-2 text-[13px] text-muted">{m.title}</p>
        {ai && (
          <div className="grid grid-cols-3 gap-2">
            <Tile n={ai.draftTasks.filter((t) => t.review === 'pending').length} label="new tasks" />
            <Tile n={ai.parentUpdates.filter((u) => u.review === 'pending').length} label="parent updates" />
            <Tile n={ai.profileChanges.filter((c) => c.review === 'pending').length + (ai.personalNotes ?? []).filter((p) => p.review === 'pending').length} label="profile and notes" />
          </div>
        )}
        {bullets.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm leading-relaxed text-ink-soft">
            {bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <LinkButton variant="primary" to={item.to}>
            Review and approve
          </LinkButton>
          <Button
            onClick={() => {
              approveAllInMeeting(m.id)
              toast(`Approved everything from ${student.firstName}’s meeting. ${SENT_NOTE}`)
            }}
          >
            Approve all
          </Button>
          <AiTag source={ai?.source} />
        </div>
      </article>
    )
  }

  if (item.kind === 'report') {
    const report = data.reports.find((r) => r.id === item.reportId)
    const parent = report && findParent(student, report.parentId)
    if (!report || !parent) return null
    return (
      <article className={cardClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 className="text-base font-semibold">
            {fullName(student)} · {report.subject}
          </h3>
          <span className="text-xs text-muted">{recipientLine(parent)}</span>
        </div>
        {report.bodyLocal && (
          <p lang={report.language} className="line-clamp-4 rounded-lg bg-canvas p-3 text-sm leading-relaxed">
            {report.bodyLocal}
          </p>
        )}
        <p className={report.bodyLocal ? 'line-clamp-3 text-[13px] leading-relaxed text-muted' : 'line-clamp-5 rounded-lg bg-canvas p-3 text-sm leading-relaxed'}>
          {report.bodyLocal && 'English: '}
          {report.bodyEn}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={() => {
              approveReport(report.id)
              toast(`Report to ${parent.name} approved. ${SENT_NOTE}`)
            }}
          >
            Approve and send
          </Button>
          <LinkButton to={item.to}>Edit</LinkButton>
          <AiTag source={report.source} />
        </div>
      </article>
    )
  }

  const doc = data.documents.find((d) => d.id === item.docId)
  if (!doc?.feedback) return null
  return (
    <article className={cardClass}>
      <h3 className="text-base font-semibold">
        {fullName(student)} · feedback on {doc.name}
      </h3>
      <p className="line-clamp-4 rounded-lg bg-canvas p-3 text-sm leading-relaxed">{doc.feedback.overall}</p>
      <p className="text-[13px] text-muted">
        {doc.feedback.strengths.length} things that work · {doc.feedback.points.length} questions. No rewritten text.
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <LinkButton variant="primary" to={item.to}>
          Review
        </LinkButton>
        <Button
          onClick={() => {
            reviewEssayFeedback(doc.id, 'approved')
            toast(`Feedback shared with ${student.firstName}. ${SENT_NOTE}`)
          }}
        >
          Approve and send
        </Button>
        <AiTag source={doc.feedback.source} />
      </div>
    </article>
  )
}
