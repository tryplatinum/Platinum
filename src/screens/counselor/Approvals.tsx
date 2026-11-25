// Inbox. Every AI draft and pending send is reviewed here (edited, approved or
// discarded) before anything leaves the firm. Files to file or check and draft
// college lists are here too. Each group can be closed; the text of a message
// is never cut short, so it can all be read before it is approved.

import { ChevronRight } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApprovalCard, ApproveAll } from '../../components/ApprovalCard'
import { FileRow } from '../../components/files/FileRow'
import { FilingRow } from '../../components/files/FilingRow'
import { OnTheirWay } from '../../components/OnTheirWay'
import { MotionList, Reveal } from '../../components/motion'
import { Button, Card, Empty, LinkButton, PageHeader, inputBase, usePageTitle } from '../../components/ui'
import { formatTimestamp } from '../../lib/dates'
import { APPROVAL_TYPE_LABEL, activeStudents, approvalGroups, findStudent, fullName, type ApprovalItem } from '../../lib/derive'
import { isStoredFile } from '../../lib/files'
import { inboxContents, inboxSize } from '../../lib/inbox'
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

/** Groups a counselor has closed. Kept for the session, so coming back finds the Inbox as it was left. */
const closedGroups = new Set<string>()

export default function Inbox() {
  const data = useData()
  const [params, setParams] = useSearchParams()
  const studentId = params.get('student') || undefined
  const asked = params.get('kind')
  const kind = KINDS.some((k) => k.value === asked) ? asked : ''
  const student = studentId ? findStudent(data, studentId) : undefined
  usePageTitle('Inbox')
  const setFilter = (key: string, value: string) => {
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

  const files = shown.toFile.length + shown.toCheck.length

  return (
    <>
      <PageHeader title="Inbox" above={student ? `Filtered to ${fullName(student)}` : undefined} sub={count === 0 ? 'Nothing waiting for review.' : `${count} waiting for review`} />

      {/* Stays in view, under the bar at the top on a phone. */}
      <div className="sticky top-[57px] z-10 -mx-4 -my-3 flex flex-wrap items-center gap-2 bg-canvas px-4 py-3 sm:-mx-6 sm:px-6 lg:top-0 lg:mx-0 lg:px-0">
        <select aria-label="Filter by student" className={`${inputBase} min-w-0 flex-1 sm:flex-none`} value={student?.id ?? ''} onChange={(e) => setFilter('student', e.target.value)}>
          <option value="">All students</option>
          {/* An archived student can still be named in the address. */}
          {student?.archived && <option value={student.id}>{fullName(student)}</option>}
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {fullName(s)}
            </option>
          ))}
        </select>
        <select aria-label="Filter by kind" className={`${inputBase} min-w-0 flex-1 sm:flex-none`} value={kind ?? ''} onChange={(e) => setFilter('kind', e.target.value)}>
          <option value="">All kinds</option>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        {filtered && count > 0 && (
          <Button variant="quiet" onClick={() => setParams({}, { replace: true })}>
            Clear filters
          </Button>
        )}
      </div>

      <OnTheirWay />

      {count === 0 && (
        <Card className="motion-page">
          <Empty title={filtered ? 'Nothing waiting matches these filters.' : 'Nothing waiting for review. Drafts from meetings, reports, reminders and the assistant appear here for you to approve.'}>
            {filtered ? <Button onClick={() => setParams({}, { replace: true })}>Clear filters</Button> : <LinkButton to="/app/today">Back to Today</LinkButton>}
          </Empty>
        </Card>
      )}

      <MotionList as="div" stagger itemClassName="pb-3 last:pb-0">
        {approvalGroups(shown.approvals).map((g) => (
          <ApprovalGroup key={`${g.studentId}:${g.sourceKey}`} id={`${g.studentId}:${g.sourceKey}`} studentId={g.studentId} sourceLabel={g.sourceLabel} items={g.items} />
        ))}
        {files > 0 && <Files key="files" toFile={shown.toFile} toCheck={shown.toCheck} />}
        {shown.listDrafts.length > 0 && <ListDrafts key="lists" drafts={shown.listDrafts} />}
      </MotionList>
    </>
  )
}

/** One group: its name opens and closes it, and what can be done to all of it stays beside the name. */
function Group({ id, name, title, count, link, action, children }: { id: string; name: string; title: ReactNode; count: number; link?: ReactNode; action?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(!closedGroups.has(id))
  const bodyId = useId()
  const toggle = () => {
    if (open) closedGroups.add(id)
    else closedGroups.delete(id)
    setOpen(!open)
  }
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-x-3 px-2 py-1 sm:px-3">
        <h2 className="min-w-0 text-lg">
          <button type="button" aria-expanded={open} aria-controls={bodyId} aria-label={`${name}, ${count}`} onClick={toggle} className="flex min-h-11 items-center gap-2 rounded-control px-2 text-left font-semibold hover:bg-surface-2">
            <ChevronRight size={20} strokeWidth={1.75} className="motion-chevron shrink-0 text-muted" aria-hidden />
            <span className="min-w-0">
              {title}
              <span className="nums font-sans font-medium text-muted"> · {count}</span>
            </span>
          </button>
        </h2>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2">
          {link}
          {action}
        </span>
      </div>
      <Reveal open={open} id={bodyId}>
        {children}
      </Reveal>
    </Card>
  )
}

const linkClass = 'inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline'

function ApprovalGroup({ id, studentId, sourceLabel, items }: { id: string; studentId: string; sourceLabel: string; items: ApprovalItem[] }) {
  const student = findStudent(useData(), studentId)
  if (!student) return null
  return (
    <Group
      id={id}
      name={`${fullName(student)}, ${sourceLabel}`}
      count={items.length}
      title={
        <>
          {fullName(student)}
          <span className="font-medium text-ink-soft"> · {sourceLabel}</span>
        </>
      }
      link={
        <Link to={`/app/students/${student.id}`} className={linkClass} aria-label={`Open ${fullName(student)}’s page`}>
          Open {student.firstName}
        </Link>
      }
      action={<ApproveAll items={items} />}
    >
      <MotionList itemClassName="border-t border-line">
        {items.map((item) => (
          <ApprovalCard key={item.key} item={item} />
        ))}
      </MotionList>
    </Group>
  )
}

function Files({ toFile, toCheck }: { toFile: StudentDocument[]; toCheck: StudentDocument[] }) {
  return (
    <Group
      id="files"
      name="Files"
      title="Files"
      count={toFile.length + toCheck.length}
      link={
        <Link to="/app/documents" className={linkClass}>
          Open Documents
        </Link>
      }
    >
      {toFile.length > 0 && <p className="border-t border-line bg-canvas px-5 py-2 text-xs font-semibold text-muted">Waiting to be filed</p>}
      <MotionList itemClassName="border-t border-line px-5 py-4">
        {toFile.map((d) => (
          <FilingRow key={d.id} doc={d} />
        ))}
      </MotionList>
      {toCheck.length > 0 && <p className="border-t border-line bg-canvas px-5 py-2 text-xs font-semibold text-muted">Waiting to be checked</p>}
      <MotionList itemClassName="border-t border-line">
        {toCheck.map((d) => (
          <FileRow key={d.id} doc={d} showStudent />
        ))}
      </MotionList>
    </Group>
  )
}

function ListDrafts({ drafts }: { drafts: CollegeListDraft[] }) {
  const data = useData()
  return (
    <Group id="lists" name="College list drafts" title="College list drafts" count={drafts.length}>
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
    </Group>
  )
}
