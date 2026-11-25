// Today: where the day starts. Who am I meeting, what is waiting for me, who is
// slipping. Everything here is worked out from data already loaded (lib/today.ts,
// lib/inbox.ts, lib/derive.ts): opening the page asks nobody for anything. Each
// control is the one used elsewhere, doing the same job.

import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApprovalCard } from '../../components/ApprovalCard'
import { UploadWindow } from '../../components/files/UploadWindow'
import { LogMeetingModal, MeetingFormModal, StudentFormModal } from '../../components/forms'
import { OnTheirWay } from '../../components/OnTheirWay'
import { StudentCards } from '../../components/StudentTable'
import { MotionList } from '../../components/motion'
import { AiErrorNote, Button, Card, CardHeader, Empty, LinkButton, PageHeader, Pill, Thinking, useAi, usePageTitle } from '../../components/ui'
import { formatDateLong, formatRelative, formatTime, todayISO } from '../../lib/dates'
import { approvalGroups, fullName, pendingInMeeting, summarizeAll } from '../../lib/derive'
import { inboxContents, inboxSize } from '../../lib/inbox'
import { meetingsForToday, slippingStudents, type TodayMeeting } from '../../lib/today'
import { prepareBrief } from '../../services/workflows'
import { useData, useStore } from '../../store/store'
import type { ID } from '../../types'

/** Enough to clear a few before the first meeting, and no more than a screen. */
const SHOWN = 3

type Open = { kind: 'log'; studentId?: ID; meetingId?: ID } | { kind: 'schedule'; studentId?: ID } | { kind: 'student' } | { kind: 'upload' }

export default function Today() {
  const data = useData()
  const [open, setOpen] = useState<Open>()
  const all = summarizeAll(data)
  const inbox = inboxContents(data)
  const waiting = inboxSize(inbox)
  const slipping = slippingStudents(all)
  const meetings = meetingsForToday(data)
  usePageTitle('Today')

  const close = () => setOpen(undefined)
  const none = all.length === 0
  const today = meetings.list.filter((m) => m.when === 'today').length
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

  return (
    <>
      <PageHeader
        above={formatDateLong(todayISO())}
        title="Today"
        sub={none ? undefined : `${plural(today, 'meeting')} today · ${waiting} waiting for you · ${plural(slipping.length, 'student')} behind or slipping`}
        actions={
          <>
            <Button variant="primary" disabled={none} onClick={() => setOpen({ kind: 'log' })}>
              Log a meeting
            </Button>
            <Button disabled={none} onClick={() => setOpen({ kind: 'schedule' })}>
              Schedule a meeting
            </Button>
            <Button onClick={() => setOpen({ kind: 'student' })}>Add student</Button>
            <Button onClick={() => setOpen({ kind: 'upload' })}>Upload files</Button>
          </>
        }
      />

      {none ? (
        <NewFirm onAdd={() => setOpen({ kind: 'student' })} />
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-6">
            <MeetingsCard meetings={meetings} onOpen={setOpen} />
            <WaitingCard waiting={waiting} inbox={inbox} />
          </div>
          <Card>
            <CardHeader
              size="section"
              className="px-5 py-4"
              title="Slipping"
              count={slipping.length}
              action={
                <Link to="/app/students" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline">
                  All students
                </Link>
              }
            />
            <div className="border-t border-line">
              {slipping.length === 0 ? <Empty title="Nobody is behind or slipping." /> : <StudentCards rows={slipping} brief />}
            </div>
          </Card>
        </div>
      )}

      {open?.kind === 'log' && <LogMeetingModal studentId={open.studentId} meetingId={open.meetingId} onClose={close} />}
      {open?.kind === 'schedule' && <MeetingFormModal studentId={open.studentId} onClose={close} />}
      {open?.kind === 'student' && <StudentFormModal onClose={close} />}
      {open?.kind === 'upload' && <UploadWindow initialFiles={[]} onClose={close} />}
    </>
  )
}

function NewFirm({ onAdd }: { onAdd: () => void }) {
  const loadSample = useStore((s) => s.loadSample)
  return (
    <Card>
      <Empty title="No students yet. Add your first student to start, or load the invented sample caseload to look around.">
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={onAdd}>
            Add student
          </Button>
          <Button onClick={loadSample}>Load the sample caseload</Button>
        </div>
      </Empty>
    </Card>
  )
}

// ── Meetings ────────────────────────────────────────────────────────────────

function MeetingsCard({ meetings, onOpen }: { meetings: ReturnType<typeof meetingsForToday>; onOpen: (open: Open) => void }) {
  const { list, next } = meetings
  const heading = (m: TodayMeeting, i: number) => (i === 0 || list[i - 1].when !== m.when ? { earlier: 'Not logged yet', today: 'Today', tomorrow: 'Tomorrow' }[m.when] : undefined)
  return (
    <Card>
      <CardHeader
        size="section"
        className="px-5 py-4"
        title="Meetings"
        action={
          <Link to="/app/meetings?view=calendar" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline">
            Calendar
          </Link>
        }
      />
      {list.length === 0 && (
        <p className="border-t border-line px-5 py-4 text-sm text-muted">
          No meetings today or tomorrow.{' '}
          {next ? (
            <>
              Next is{' '}
              <Link to={`/app/meetings?student=${next.student.id}`} className="font-semibold text-accent hover:underline">
                {fullName(next.student)}
              </Link>
              , {formatDateLong(next.meeting.date)} at {formatTime(next.meeting.time)} ({formatRelative(next.meeting.date)}).
            </>
          ) : (
            'Nothing is scheduled.'
          )}
        </p>
      )}
      {list.length > 0 && (
        <MotionList itemClassName="border-t border-line">
          {list.map((m, i) => (
            <MeetingRow key={m.meeting.id} item={m} heading={heading(m, i)} onOpen={onOpen} />
          ))}
        </MotionList>
      )}
    </Card>
  )
}

function MeetingRow({ item, heading, onOpen }: { item: TodayMeeting; heading?: string; onOpen: (open: Open) => void }) {
  const { meeting: m, student, when, over } = item
  const { busy, error, run } = useAi()
  const navigate = useNavigate()
  const page = `/app/meetings?student=${student.id}`
  const held = m.status === 'completed'
  const drafts = pendingInMeeting(m)
  /** Held, or its time has passed, and nothing was written down. */
  const unlogged = !m.transcript && (held || over)

  const state: ReactNode = held ? (
    drafts > 0 ? (
      <Pill tone="accent">Held · review ready</Pill>
    ) : m.transcript ? (
      <Pill tone="good">Held</Pill>
    ) : (
      <Pill tone="warn">Held · no notes</Pill>
    )
  ) : over ? (
    <Pill tone="warn">Not logged</Pill>
  ) : m.brief ? (
    <Pill tone="good">Brief ready</Pill>
  ) : (
    <Pill>No brief yet</Pill>
  )

  return (
    <div>
      {heading && <p className="bg-canvas px-5 py-2 text-xs font-semibold text-muted">{heading}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
        <div className="nums w-20 shrink-0 text-sm font-semibold">
          {formatTime(m.time)}
          {when === 'earlier' && <span className="block text-xs font-normal text-muted">{formatRelative(m.date)}</span>}
        </div>
        <div className="min-w-[12rem] flex-1">
          <Link to={`/app/students/${student.id}`} className="inline-flex min-h-6 items-center text-sm font-semibold text-heading hover:text-accent hover:underline">
            {fullName(student)}
          </Link>
          <p className="text-[13px] text-muted">
            {m.title}
            {m.location && ` · ${m.location}`}
          </p>
        </div>
        {state}
        <div className="flex flex-wrap gap-2">
          {unlogged ? (
            <Button variant="remind" onClick={() => onOpen({ kind: 'log', studentId: student.id, meetingId: m.id })}>
              Log this meeting
            </Button>
          ) : held ? (
            <LinkButton to={page}>{drafts > 0 ? 'Review' : 'Open'}</LinkButton>
          ) : m.brief ? (
            <LinkButton to={page}>Open brief</LinkButton>
          ) : (
            <Button
              busy={busy}
              onClick={() =>
                void run(async () => {
                  await prepareBrief(m.id)
                  navigate(page)
                })
              }
            >
              Prepare AI brief
            </Button>
          )}
        </div>
        {(busy || error) && (
          <div className="basis-full">
            {busy && <Thinking inline label="AI is preparing the brief…" />}
            <AiErrorNote message={error} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Waiting ─────────────────────────────────────────────────────────────────

function WaitingCard({ waiting, inbox }: { waiting: number; inbox: ReturnType<typeof inboxContents> }) {
  const items = approvalGroups(inbox.approvals).flatMap((g) => g.items)
  const shown = items.slice(0, SHOWN)
  const files = inbox.toFile.length + inbox.toCheck.length
  const lists = inbox.listDrafts.length
  const rest = [files > 0 && `${files} ${files === 1 ? 'file' : 'files'} to file or check`, lists > 0 && `${lists} college list ${lists === 1 ? 'draft' : 'drafts'}`].filter(Boolean)
  return (
    <Card>
      <CardHeader
        size="section"
        className="px-5 py-4"
        title="Waiting for you"
        count={waiting}
        sub={waiting > shown.length && shown.length > 0 ? `The ${shown.length === 1 ? 'most urgent one' : `${shown.length} most urgent`}. The rest are in the Inbox.` : undefined}
        action={
          <Link to="/app" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline">
            Open the Inbox
          </Link>
        }
      />
      <OnTheirWay className="border-t border-line px-5 py-3" />
      {waiting === 0 && (
        <div className="border-t border-line">
          <Empty title="Nothing is waiting for you." />
        </div>
      )}
      <MotionList itemClassName="border-t border-line" label="The most urgent drafts">
        {shown.map((item) => (
          <ApprovalCard key={item.key} item={item} showStudent />
        ))}
      </MotionList>
      {rest.length > 0 && (
        <p className="border-t border-line px-5 py-3 text-sm text-muted">
          Also waiting: {rest.join(' and ')}.{' '}
          <Link to="/app" className="font-semibold text-accent hover:underline">
            See them in the Inbox
          </Link>
        </p>
      )}
    </Card>
  )
}
