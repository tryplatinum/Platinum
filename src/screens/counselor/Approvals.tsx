// Inbox. Every AI draft and pending send is reviewed here (edited, approved or
// discarded) before anything leaves the firm. Files to file or check and draft
// college lists are here too.
//
// It is a triage view. The list is short rows in groups; choosing a row shows
// the whole draft, with its actions, beside the list where there is room and in
// place of it where there is not. Nothing is approved from the short row: the
// text of a message is always shown in full before it can be approved.
// `?item=` in the address holds the row that is open.

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApprovalCard, ApproveAll } from '../../components/ApprovalCard'
import { FileRow } from '../../components/files/FileRow'
import { FilingRow } from '../../components/files/FilingRow'
import { InboxLine } from '../../components/InboxLine'
import { OnTheirWay } from '../../components/OnTheirWay'
import { MotionList, Reveal, focusPage, useRoomFor } from '../../components/motion'
import { Button, Card, Empty, LinkButton, PageHeader, cx, inputBase, usePageTitle } from '../../components/ui'
import { formatTimestamp } from '../../lib/dates'
import { APPROVAL_TYPE_LABEL, activeStudents, findStudent, fullName, type ApprovalItem } from '../../lib/derive'
import { isStoredFile } from '../../lib/files'
import { inboxContents, inboxGroups, inboxSize, rowAfter, type InboxGroup, type InboxRow } from '../../lib/inbox'
import { useData, useStore } from '../../store/store'

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

/** The list and the open draft sit side by side when the page is at least this wide. */
const TWO_PANES = 760

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || el.matches('input, textarea, select'))

/** What is open, and what it takes to keep it right as rows come and go. */
interface Selection {
  /** The rows there were, in order, the last time they changed. */
  keys: string[]
  /** The open row. */
  item?: string
  /** `?item=` as it was last read, to tell a change of address from a change made here. */
  asked?: string
  /** The open row that was last decided. If it comes back (Undo), it is opened again. */
  gone?: string
}

export default function Inbox() {
  const data = useData()
  const [params, setParams] = useSearchParams()
  const studentId = params.get('student') || undefined
  const askedKind = params.get('kind')
  const kind = KINDS.some((k) => k.value === askedKind) ? askedKind : ''
  const asked = params.get('item') || undefined
  const student = studentId ? findStudent(data, studentId) : undefined
  usePageTitle('Inbox')
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const clearFilters = () => setParams(asked ? { item: asked } : {}, { replace: true })

  const all = inboxContents(data, studentId)
  const shown = {
    approvals: all.approvals.filter((i) => !kind || slug(APPROVAL_TYPE_LABEL[i.kind]) === kind),
    toFile: !kind || kind === FILES ? all.toFile : [],
    toCheck: !kind || kind === FILES ? all.toCheck : [],
    listDrafts: !kind || kind === LISTS ? all.listDrafts : [],
  }
  const count = inboxSize(shown)
  const filtered = Boolean(studentId || kind)
  const students = activeStudents(data)
  const groups = inboxGroups(data, shown)
  const rows = groups.flatMap((g) => g.rows)
  const keys = rows.map((r) => r.key)

  // While a file is being sorted, ask the server how it is going, so it appears here by itself.
  const refreshFiles = useStore((s) => s.refreshFiles)
  const sorting = data.documents.filter((d) => isStoredFile(d) && d.fileStatus === 'sorting').length
  useEffect(() => {
    if (sorting === 0) return
    const timer = setInterval(() => void refreshFiles(), 4000)
    return () => clearInterval(timer)
  }, [sorting, refreshFiles])

  const [closed, setClosed] = useState(() => new Set(closedGroups))
  const toggle = (id: string) => {
    if (closedGroups.has(id)) closedGroups.delete(id)
    else closedGroups.add(id)
    setClosed(new Set(closedGroups))
  }
  /** The rows the arrow keys move through: a closed group is passed over. */
  const reachable = groups.filter((g) => !closed.has(g.id)).flatMap((g) => g.rows.map((r) => r.key))

  const frame = useRef<HTMLDivElement>(null)
  const two = useRoomFor(frame, TWO_PANES)

  // ── What is open ──
  // Worked out while rendering, so a decided row is never shown for a frame
  // after it has gone: the next row takes its place in the same render.
  const [sel, setSel] = useState<Selection>({ keys: [], item: asked, asked })
  let next = sel
  if (asked !== next.asked) next = { ...next, asked, item: asked }
  if (keys.join('\n') !== next.keys.join('\n')) {
    let { item, gone } = next
    if (item && !keys.includes(item)) {
      // Decided, or filtered out: the row after it is opened. A link to something long gone opens nothing.
      if (next.keys.includes(item)) {
        gone = item
        item = rowAfter(next.keys, item, keys)
      } else if (next.keys.length > 0 || keys.length > 0) item = undefined
    } else if (gone && keys.includes(gone) && !next.keys.includes(gone)) {
      // Undo put it back.
      item = gone
      gone = undefined
    }
    next = { ...next, keys, item, gone }
  }
  // Beside the list there is always something open: the first row, on arrival.
  if (two && !next.item && keys.length > 0) next = { ...next, item: reachable[0] ?? keys[0] }
  if (next !== sel) setSel(next)
  const selected = rows.find((r) => r.key === next.item)

  // The address follows what is open, so a reload or a link lands on it.
  useEffect(() => {
    if (next.item === asked) return
    const to = new URLSearchParams(params)
    if (next.item) to.set('item', next.item)
    else to.delete('item')
    setParams(to, { replace: true })
  }, [next.item, asked]) // eslint-disable-line react-hooks/exhaustive-deps

  const byKeys = useRef(false)
  const listScroll = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const open = (key: string | undefined, how: 'press' | 'keys' = 'press') => {
    byKeys.current = how === 'keys'
    if (!two && key && !selected) listScroll.current = window.scrollY
    const to = new URLSearchParams(params)
    if (key) to.set('item', key)
    else to.delete('item')
    // On a phone a row is a step forward, so Back returns to the list.
    setParams(to, { replace: two || Boolean(selected && key) })
  }

  // Where there is one column, opening a row starts it at the top, and going back finds the list where it was.
  const alone = !two && Boolean(selected)
  useLayoutEffect(() => {
    if (two) return
    window.scrollTo(0, alone ? 0 : listScroll.current)
  }, [alone, two])

  // Focus goes to the open draft's heading only when the keyboard chose it.
  useEffect(() => {
    if (!byKeys.current) return
    byKeys.current = false
    heading.current?.focus({ preventScroll: true })
    document.querySelector(`[data-inbox-row="${CSS.escape(next.item ?? '')}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [next.item])

  // ── Keys ──
  const pane = useRef<HTMLDivElement>(null)
  const position = reachable.join('\n')
  useEffect(() => {
    if (!two) return
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || document.querySelector('dialog[open]') || e.altKey || e.shiftKey) return
      const press = (action: string) => pane.current?.querySelector<HTMLElement>(`[data-action="${action}"]`)?.click()
      // Plain Enter never approves.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        press('approve')
        return
      }
      if (e.metaKey || e.ctrlKey) return
      const order = position ? position.split('\n') : []
      const step = e.key === 'ArrowDown' || e.key === 'j' ? 1 : e.key === 'ArrowUp' || e.key === 'k' ? -1 : 0
      if (step !== 0) {
        if (order.length === 0) return
        e.preventDefault()
        const at = next.item ? order.indexOf(next.item) : -1
        open(order[Math.min(order.length - 1, Math.max(0, at < 0 ? 0 : at + step))], 'keys')
      } else if (e.key === 'e') {
        e.preventDefault()
        press('edit')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // Subscribed again on every render: the handler reads what is on screen now.

  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Filter by student" className={`${inputBase} min-w-0 flex-1`} value={student?.id ?? ''} onChange={(e) => setFilter('student', e.target.value)}>
        <option value="">All students</option>
        {/* An archived student can still be named in the address. */}
        {student?.archived && <option value={student.id}>{fullName(student)}</option>}
        {students.map((s) => (
          <option key={s.id} value={s.id}>
            {fullName(s)}
          </option>
        ))}
      </select>
      <select aria-label="Filter by kind" className={`${inputBase} min-w-0 flex-1`} value={kind ?? ''} onChange={(e) => setFilter('kind', e.target.value)}>
        <option value="">All kinds</option>
        {KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
      {filtered && count > 0 && (
        <Button variant="quiet" onClick={clearFilters}>
          Clear filters
        </Button>
      )}
    </div>
  )

  const nothing = (
    <Empty title={filtered ? 'Nothing waiting matches these filters.' : 'Nothing waiting for review. Drafts from meetings, reports, reminders and the assistant appear here for you to approve.'}>
      {filtered ? <Button onClick={clearFilters}>Clear filters</Button> : <LinkButton to="/app/today">Back to Today</LinkButton>}
    </Empty>
  )

  const list = (
    <MotionList as="div" stagger label="Waiting for review" itemClassName="border-b border-line last:border-b-0">
      {groups.map((g) => (
        <Group key={g.id} group={g} open={!closed.has(g.id)} onToggle={() => toggle(g.id)} selected={selected?.key} onOpen={open} />
      ))}
    </MotionList>
  )

  const detail = selected && (
    <OpenRow key={selected.key}>
      {/* In two panes the page keeps its own h1; alone, this is the page's heading. */}
      {two ? (
        <h2 ref={heading} tabIndex={-1} className="border-b border-line px-4 py-3 text-base focus:outline-none sm:px-5">
          {selected.label}
        </h2>
      ) : (
        <h1 ref={heading} tabIndex={-1} className="border-b border-line px-4 py-3 text-base focus:outline-none sm:px-5">
          {selected.label}
        </h1>
      )}
      <Detail row={selected} />
    </OpenRow>
  )

  // ── One column, a row open: the draft in place of the list ──
  if (alone && selected) {
    const at = keys.indexOf(selected.key)
    return (
      <div ref={frame} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="quiet" className="-ml-3" onClick={() => open(undefined)}>
            <ChevronLeft size={20} strokeWidth={1.75} aria-hidden />
            Back to Inbox
          </Button>
          <span className="nums text-[13px] text-muted">
            {at + 1} of {keys.length} waiting
          </span>
        </div>
        <OnTheirWay />
        <Card>
          <div ref={pane} role="region" aria-label={selected.label} data-focus-home tabIndex={-1} className="focus:outline-none">
            {detail}
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div ref={frame} className={cx('flex min-w-0 flex-col gap-4', two && 'h-[calc(100dvh-57px-3rem)] min-h-[26rem] lg:h-[calc(100dvh-4rem)]')}>
      <PageHeader title="Inbox" above={student ? `Filtered to ${fullName(student)}` : undefined} sub={count === 0 ? 'Nothing waiting for review.' : `${count} waiting for review`} />
      <OnTheirWay />

      {two ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-4">
          <div className="flex min-h-0 flex-col gap-3">
            {filters}
            <Card className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{count === 0 ? <p className="px-4 py-6 text-center text-sm text-muted">Nothing in the list.</p> : list}</Card>
            <p className="text-xs text-muted">
              <span className="font-semibold">Keys</span> · <Kbd>↑</Kbd> <Kbd>↓</Kbd> or <Kbd>J</Kbd> <Kbd>K</Kbd> move · <Kbd>E</Kbd> edit · <Kbd>⌘</Kbd> or <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> approve
            </p>
          </div>
          <Card className="min-h-0 overflow-y-auto overscroll-contain">
            <div ref={pane} role="region" aria-label={selected ? selected.label : 'Nothing is open'} data-focus-home tabIndex={-1} className="min-h-full focus:outline-none">
              {detail ?? <div className="motion-page flex min-h-full flex-col justify-center">{nothing}</div>}
            </div>
          </Card>
        </div>
      ) : (
        <>
          {/* Stays in view, under the bar at the top. */}
          <div className="sticky top-[57px] z-10 -mx-4 -my-2 bg-canvas px-4 py-2 sm:-mx-6 sm:px-6 lg:top-0 lg:mx-0 lg:px-0">{filters}</div>
          {count === 0 ? <Card className="motion-page">{nothing}</Card> : <Card>{list}</Card>}
        </>
      )}
    </div>
  )
}

/** The open draft. When it is decided while it holds focus, focus stays in its place for the next one. */
function OpenRow({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = root.current
    return () => {
      if (!el?.contains(document.activeElement)) return
      const home = el.closest<HTMLElement>('[data-focus-home]')
      queueMicrotask(() => {
        if (document.activeElement && document.activeElement !== document.body) return
        if (home?.isConnected) home.focus({ preventScroll: true })
        else focusPage()
      })
    }
  }, [])
  return (
    <div ref={root} className="motion-fade">
      {children}
    </div>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line-strong px-1 font-sans text-xs font-semibold text-ink-soft">{children}</kbd>
}

/** One group: its name opens and closes it, and what can be done to all of it stays beside the name. */
function Group({ group, open, onToggle, selected, onOpen }: { group: InboxGroup; open: boolean; onToggle: () => void; selected?: string; onOpen: (key: string) => void }) {
  const bodyId = useId()
  const items = group.rows.flatMap((r) => (r.item ? [r.item] : []))
  const name = group.source ? `${group.name}, ${group.source}` : group.name
  return (
    <div>
      <div className="flex items-center justify-between gap-x-2 bg-canvas px-1">
        <h2 className="min-w-0 flex-1 font-sans text-sm">
          <button type="button" aria-expanded={open} aria-controls={bodyId} aria-label={`${name}, ${group.rows.length}`} onClick={onToggle} className="flex min-h-11 w-full items-center gap-1.5 rounded-control px-2 py-1.5 text-left font-semibold leading-snug text-heading hover:bg-surface-2">
            <ChevronRight size={20} strokeWidth={1.75} className="motion-chevron shrink-0 text-muted" aria-hidden />
            <span className="min-w-0">
              {group.name}
              {group.source && <span className="font-medium text-ink-soft"> · {group.source}</span>}
              <span className="nums font-medium text-muted"> · {group.rows.length}</span>
            </span>
          </button>
        </h2>
        <GroupAction group={group} items={items} />
      </div>
      <Reveal open={open} id={bodyId}>
        <MotionList label={name} itemClassName="border-t border-line">
          {group.rows.map((row) => (
            <RowButton key={row.key} row={row} selected={row.key === selected} onOpen={onOpen} />
          ))}
        </MotionList>
      </Reveal>
    </div>
  )
}

function GroupAction({ group, items }: { group: InboxGroup; items: ApprovalItem[] }) {
  if (group.id === 'files')
    return (
      <Link to="/app/documents" className="inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-semibold text-accent hover:underline">
        Open Documents
      </Link>
    )
  return (
    <span className="shrink-0 px-1 empty:hidden">
      <ApproveAll items={items} />
    </span>
  )
}

function RowButton({ row, selected, onOpen }: { row: InboxRow; selected: boolean; onOpen: (key: string) => void }) {
  return (
    <button
      type="button"
      data-inbox-row={row.key}
      aria-current={selected ? 'true' : undefined}
      aria-label={row.label}
      onClick={() => onOpen(row.key)}
      className={cx('flex min-h-11 w-full items-center border-l-2 py-2.5 pl-3.5 pr-4 text-left', selected ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-surface-2')}
    >
      <InboxLine row={row} className="flex-1" />
    </button>
  )
}

/** The whole of one row: the shared approval card, the filing row, or the way into a list draft. */
function Detail({ row }: { row: InboxRow }) {
  const data = useData()
  const student = row.studentId ? findStudent(data, row.studentId) : undefined
  if (row.item) return <ApprovalCard item={row.item} primary showStudent />
  if (row.toFile)
    return (
      <div className="px-4 py-4 sm:px-5">
        <FilingRow doc={row.toFile} primary />
      </div>
    )
  if (row.toCheck) return <FileRow doc={row.toCheck} showStudent />
  if (row.listDraft && student)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <span className="text-sm">
          <span className="font-semibold">{fullName(student)}</span>
          <span className="text-muted"> · drafted {formatTimestamp(row.listDraft.createdAt)}</span>
        </span>
        <LinkButton variant="primary" to={`/app/students/${student.id}/list-draft`} aria-label={`Open ${fullName(student)}’s college list draft`}>
          Open draft
        </LinkButton>
      </div>
    )
  return null
}
