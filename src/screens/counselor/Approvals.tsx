// Inbox: the counselor's home. Every AI draft and pending send is reviewed here
// (edited, approved or discarded) before anything leaves the firm. Files to
// file or check and draft college lists are here too.

import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApprovalCard, ApproveAll } from '../../components/ApprovalCard'
import { FileRow } from '../../components/files/FileRow'
import { FilingRow } from '../../components/files/FilingRow'
import { Button, Card, CardHeader, Empty, LinkButton, PageHeader, inputBase } from '../../components/ui'
import { formatTimestamp } from '../../lib/dates'
import { APPROVAL_TYPE_LABEL, activeStudents, approvalGroups, findStudent, fullName, type ApprovalItem } from '../../lib/derive'
import { isStoredFile } from '../../lib/files'
import { inboxContents, inboxSize, messageOnItsWay } from '../../lib/inbox'
import { useData, useStore } from '../../store/store'
import type { CollegeListDraft, StudentDocument } from '../../types'

const FILES = 'files'
const LISTS = 'college-list-drafts'

/** "Parent update" is "parent-update" in the address. Kinds that read the same are one choice. */
const slug = (label: string) => label.toLowerCase().replace(/ /g, '-')
const KINDS: { value: string; label: string }[] = [
  ...[...new Set(Object.values(APPROVAL_TYPE_LABEL))].map((label) => ({ value: slug(label), label })),
  { value: FILES, label: 'Files' },
  { value: LISTS, label: 'College list drafts' },
]

export default function Inbox() {
  const data = useData()
  const [params, setParams] = useSearchParams()
  const studentId = params.get('student') || undefined
  const asked = params.get('kind')
  const kind = KINDS.some((k) => k.value === asked) ? asked : ''
  const student = studentId ? findStudent(data, studentId) : undefined
  const setFilter = (key: 'student' | 'kind', value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const all = useMemo(() => inboxContents(data, studentId), [data, studentId])
  const shown = {
    approvals: all.approvals.filter((i) => !kind || slug(APPROVAL_TYPE_LABEL[i.kind]) === kind),
    toFile: !kind || kind === FILES ? all.toFile : [],
    toCheck: !kind || kind === FILES ? all.toCheck : [],
    listDrafts: !kind || kind === LISTS ? all.listDrafts : [],
  }
  const count = inboxSize(shown)
  const filtered = Boolean(studentId || kind)
  const students = activeStudents(data)

  // While a file is being sorted, ask the server how it is going, so it appears here by itself.
  const refreshFiles = useStore((s) => s.refreshFiles)
  const sorting = data.documents.filter((d) => isStoredFile(d) && d.fileStatus === 'sorting').length
  useEffect(() => {
    if (sorting === 0) return
    const timer = setInterval(() => void refreshFiles(), 4000)
    return () => clearInterval(timer)
  }, [sorting, refreshFiles])

  return (
    <>
      <PageHeader
        title="Inbox"
        above={student ? `Filtered to ${fullName(student)}` : undefined}
        sub={count === 0 ? 'Nothing waiting for review.' : `${count} waiting for review`}
        actions={
          <>
            <select aria-label="Filter by student" className={inputBase} value={student?.id ?? ''} onChange={(e) => setFilter('student', e.target.value)}>
              <option value="">All students</option>
              {/* An archived student can still be named in the address. */}
              {student?.archived && <option value={student.id}>{fullName(student)}</option>}
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {fullName(s)}
                </option>
              ))}
            </select>
            <select aria-label="Filter by kind" className={inputBase} value={kind ?? ''} onChange={(e) => setFilter('kind', e.target.value)}>
              <option value="">All kinds</option>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </>
        }
      />

      <OnTheirWay />

      {count === 0 ? (
        <Card>
          <Empty title={filtered ? 'Nothing waiting matches these filters.' : 'Nothing waiting for review.'}>
            {filtered && <Button onClick={() => setParams({}, { replace: true })}>Clear filters</Button>}
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {approvalGroups(shown.approvals).map((g) => (
            <ApprovalGroupCard key={`${g.studentId}:${g.sourceKey}`} studentId={g.studentId} sourceLabel={g.sourceLabel} items={g.items} />
          ))}
          <Files toFile={shown.toFile} toCheck={shown.toCheck} />
          <ListDrafts drafts={shown.listDrafts} />
        </div>
      )}
    </>
  )
}

/** One line, only while a message can still be undone or is waiting for the phone. */
function OnTheirWay() {
  const outbox = useData().outbox
  const [now, setNow] = useState(() => Date.now())
  const count = outbox.filter((m) => messageOnItsWay(m, now)).length
  useEffect(() => {
    // A message queued since the last tick is measured from now, not from then.
    setNow(Date.now())
  }, [outbox])
  useEffect(() => {
    if (count === 0) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [count])
  if (count === 0) return null
  return (
    <p className="text-sm text-ink-soft">
      {count} {count === 1 ? 'message is' : 'messages are'} on the way out.{' '}
      <Link to="/app/messages" className="font-semibold text-accent hover:underline">
        Open Messages
      </Link>
    </p>
  )
}

function Files({ toFile, toCheck }: { toFile: StudentDocument[]; toCheck: StudentDocument[] }) {
  if (toFile.length + toCheck.length === 0) return null
  return (
    <Card>
      <CardHeader
        size="section"
        className="px-5 py-4"
        title="Files"
        count={toFile.length + toCheck.length}
        action={
          <Link to="/app/documents" className="text-sm font-semibold text-accent hover:underline">
            Open Documents
          </Link>
        }
      />
      {toFile.length > 0 && (
        <>
          <p className="border-t border-line bg-canvas px-5 py-2 text-xs font-semibold text-muted">Waiting to be filed</p>
          <ul>
            {toFile.map((d) => (
              <li key={d.id} className="border-t border-line px-5 py-4">
                <FilingRow doc={d} />
              </li>
            ))}
          </ul>
        </>
      )}
      {toCheck.length > 0 && (
        <>
          <p className="border-t border-line bg-canvas px-5 py-2 text-xs font-semibold text-muted">Waiting to be checked</p>
          <ul>
            {toCheck.map((d) => (
              <FileRow key={d.id} doc={d} showStudent />
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

function ListDrafts({ drafts }: { drafts: CollegeListDraft[] }) {
  const data = useData()
  if (drafts.length === 0) return null
  return (
    <Card>
      <CardHeader size="section" className="px-5 py-4" title="College list drafts" count={drafts.length} />
      <ul>
        {drafts.map((d) => {
          const student = findStudent(data, d.studentId)
          return (
            student && (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
                <span className="text-sm">
                  <span className="font-semibold">{fullName(student)}</span>
                  <span className="text-muted"> · drafted {formatTimestamp(d.createdAt)}</span>
                </span>
                <LinkButton to={`/app/students/${student.id}/list-draft`} aria-label={`Open ${fullName(student)}’s college list draft`}>
                  Open draft
                </LinkButton>
              </li>
            )
          )
        })}
      </ul>
    </Card>
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
