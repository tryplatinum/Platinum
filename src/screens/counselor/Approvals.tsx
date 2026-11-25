// Approvals: the counselor's home. Every AI draft and pending send is reviewed
// here — edited, approved or discarded — before anything leaves the firm.

import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { outboxStatusLabel } from '../../../shared/outbox'
import { ApprovalCard, ApproveAll } from '../../components/ApprovalCard'
import { Card, CardHeader, Empty, PageHeader } from '../../components/ui'
import { formatTimestamp } from '../../lib/dates'
import { allPendingApprovals, approvalGroups, findStudent, fullName, type ApprovalItem } from '../../lib/derive'
import { reminderQueue } from '../../lib/reminders'
import { filesWaitingCount } from '../../lib/files'
import { useData } from '../../store/store'
import type { OutboxMessage } from '../../types'

export default function Approvals() {
  const data = useData()
  const [params] = useSearchParams()
  const studentFilter = params.get('student') || undefined
  const reminders = reminderQueue(data)
  const items = useMemo(() => allPendingApprovals(data, reminders, studentFilter), [data, reminders, studentFilter])
  const groups = useMemo(() => approvalGroups(items), [items])
  const student = studentFilter ? findStudent(data, studentFilter) : undefined
  const recent = data.outbox.slice(0, 10)

  return (
    <>
      <PageHeader
        title="Approvals"
        above={student ? `Filtered to ${fullName(student)}` : undefined}
        sub={items.length === 0 ? 'Nothing waiting for review.' : `${items.length} waiting for review`}
        actions={
          studentFilter ? (
            <Link to="/app" className="text-sm font-semibold text-accent hover:underline">
              Show all students
            </Link>
          ) : undefined
        }
      />

      {recent.length > 0 && <RecentlyQueued rows={recent} />}

      {groups.length === 0 ? (
        <Card>
          <Empty title="Nothing waiting for review." />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <ApprovalGroupCard key={`${g.studentId}:${g.sourceKey}`} studentId={g.studentId} sourceLabel={g.sourceLabel} items={g.items} />
          ))}
        </div>
      )}

      <WaitingElsewhere />
    </>
  )
}

function WaitingElsewhere() {
  const data = useData()
  const drafts = data.collegeListDrafts.filter((d) => d.status === 'draft')
  const files = filesWaitingCount(data)
  if (drafts.length === 0 && files === 0) return null
  const draftLink =
    drafts.length === 1 ? `/app/students/${drafts[0]!.studentId}/list-draft` : '/app/students'
  return (
    <Card>
      <CardHeader size="section" className="border-b border-line px-5 py-4" title="Waiting on other screens" />
      <ul>
        {drafts.length > 0 && (
          <li className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
            <span className="text-sm">
              {drafts.length} college list {drafts.length === 1 ? 'draft' : 'drafts'}
            </span>
            <Link to={draftLink} className="text-sm font-semibold text-accent hover:underline">
              Open {drafts.length === 1 ? 'draft' : 'students'}
            </Link>
          </li>
        )}
        {files > 0 && (
          <li className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
            <span className="text-sm">
              {files} waiting {files === 1 ? 'file' : 'files'}
            </span>
            <Link to="/app/documents" className="text-sm font-semibold text-accent hover:underline">
              Open Documents
            </Link>
          </li>
        )}
      </ul>
    </Card>
  )
}

function RecentlyQueued({ rows }: { rows: OutboxMessage[] }) {
  return (
    <Card>
      <CardHeader size="section" className="border-b border-line px-5 py-3" title="Recently queued" sub="The last 10 messages through the outbox." />
      <ul>
        {rows.map((m) => (
          <RecentRow key={m.id} message={m} />
        ))}
      </ul>
    </Card>
  )
}

function RecentRow({ message: m }: { message: OutboxMessage }) {
  const [now, setNow] = useState(() => Date.now())
  const counting = m.status === 'queued' && Date.parse(m.sendAfter) > now
  useEffect(() => {
    if (!counting) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [counting])
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-2.5">
      <Link to={`/app/messages?message=${m.id}`} className="min-w-0 flex-1 text-sm font-medium text-accent hover:underline">
        {m.toName} · {m.kind.replace(/_/g, ' ')}
      </Link>
      <span className="text-[13px] font-semibold text-ink">{outboxStatusLabel(m, now)}</span>
      <span className="text-[13px] text-muted">{formatTimestamp(m.sentAt)}</span>
    </li>
  )
}

function ApprovalGroupCard({ studentId, sourceLabel, items }: { studentId: string; sourceLabel: string; items: ApprovalItem[] }) {
  const student = findStudent(useData(), studentId)
  if (!student) return null
  return (
    <Card>
      <CardHeader
        size="section"
        className="border-b border-line px-5 py-4"
        title={
          <>
            <Link to={`/app/students/${student.id}`} className="text-accent hover:underline">
              {fullName(student)}
            </Link>
            <span className="font-medium text-ink-soft"> · {sourceLabel}</span>
            <span className="font-medium text-muted"> · {items.length}</span>
          </>
        }
        action={<ApproveAll items={items} />}
      />
      <ul>
        {items.map((item) => (
          <ApprovalCard key={item.key} item={item} />
        ))}
      </ul>
    </Card>
  )
}
