// Meetings. "By student": a list of every student on the left, grouped by what
// needs doing, and that student's meeting work on the right (review of new
// drafts, or the last meeting's report and the next meeting's brief).
// "Calendar": the week at a glance.

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LogMeetingModal, MeetingFormModal } from '../../components/forms'
import { BriefCard } from '../../components/meeting/BriefCard'
import { MeetingReport, meetingHeading } from '../../components/meeting/MeetingReport'
import { MeetingReview } from '../../components/meeting/MeetingReview'
import { useIsLaptop } from '../../components/motion'
import { Button, Card, CardHeader, Empty, LinkButton, PageHeader, Pill, STATUS_LABEL, SectionLabel, StatusPill, TabPanel, Tabs, cx, inputClass, usePageTitle, useTab, type TabItem } from '../../components/ui'
import { addDays, daysFromToday, formatDate, formatDateLong, formatRelative, formatTime, parseISODate, toISODate, todayISO } from '../../lib/dates'
import { fullName, meetingBuckets, pendingInMeeting, summarizeAll, type StudentSummary } from '../../lib/derive'
import { reminderQueue } from '../../lib/reminders'
import { useData } from '../../store/store'
import type { ID, Meeting } from '../../types'

const VIEWS: TabItem<'students' | 'calendar'>[] = [
  { key: 'students', label: 'By student' },
  { key: 'calendar', label: 'Calendar' },
]

export default function Meetings() {
  const data = useData()
  const view = useTab(VIEWS, 'view')
  usePageTitle('Meetings')
  const [params] = useSearchParams()
  const [modal, setModal] = useState<{ kind: 'schedule' | 'log'; studentId?: ID } | undefined>(params.get('log') ? { kind: 'log' } : undefined)
  const summaries = summarizeAll(data)

  return (
    <>
      <PageHeader
        title="Meetings"
        actions={
          <>
            <Button onClick={() => setModal({ kind: 'log' })} disabled={summaries.length === 0}>
              Log a meeting
            </Button>
            <Button variant="primary" onClick={() => setModal({ kind: 'schedule' })} disabled={summaries.length === 0}>
              Schedule a meeting
            </Button>
          </>
        }
      />
      <Tabs tabs={VIEWS} param="view" label="Meetings view" />

      {summaries.length === 0 ? (
        <Card>
          <Empty title="Meetings appear here once you have students.">
            <LinkButton variant="primary" to="/app/students">
              Add a student
            </LinkButton>
          </Empty>
        </Card>
      ) : (
        <TabPanel tab={view} label={view === 'calendar' ? 'Calendar' : 'By student'}>
          {view === 'calendar' ? <Calendar summaries={summaries} onSchedule={(studentId) => setModal({ kind: 'schedule', studentId })} /> : <ByStudent summaries={summaries} onModal={setModal} />}
        </TabPanel>
      )}

      {modal?.kind === 'schedule' && <MeetingFormModal studentId={modal.studentId} onClose={() => setModal(undefined)} />}
      {modal?.kind === 'log' && <LogMeetingModal studentId={modal.studentId} onClose={() => setModal(undefined)} />}
    </>
  )
}

// ── By student ──────────────────────────────────────────────────────────────

const THIS_WEEK_DAYS = 7
type Group = 'Needs review' | 'Meeting this week' | 'Later' | 'No meeting scheduled'
const GROUPS: Group[] = ['Needs review', 'Meeting this week', 'Later', 'No meeting scheduled']

const when = (m: Meeting) => `${formatDateLong(m.date)}, ${formatTime(m.time)}`

function groupOf(s: StudentSummary): Group {
  if (s.lastMeeting && pendingInMeeting(s.lastMeeting) > 0) return 'Needs review'
  if (!s.nextMeeting) return 'No meeting scheduled'
  return daysFromToday(s.nextMeeting.date) <= THIS_WEEK_DAYS ? 'Meeting this week' : 'Later'
}

function ByStudent({ summaries, onModal }: { summaries: StudentSummary[]; onModal: (m: { kind: 'schedule' | 'log'; studentId?: ID }) => void }) {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const sorted = [...summaries].sort((a, b) => (a.nextMeeting?.date ?? '9999').localeCompare(b.nextMeeting?.date ?? '9999'))
  const shown = sorted.filter((s) => fullName(s.student).toLowerCase().includes(query.trim().toLowerCase()))
  const firstByGroup = GROUPS.flatMap((g) => sorted.filter((s) => groupOf(s) === g))[0]
  const asked = summaries.find((s) => s.student.id === params.get('student'))
  const laptop = useIsLaptop()
  // On a laptop the list and one student are side by side, so one is always chosen.
  const selected = asked ?? (laptop ? firstByGroup : undefined)
  // On anything narrower the list gives way to the chosen student, and comes back when asked for.
  const [changing, setChanging] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const changeButton = useRef<HTMLButtonElement>(null)
  const select = (id: ID) => {
    const next = new URLSearchParams(params)
    next.set('student', id)
    setParams(next, { replace: true })
    setChanging(false)
    if (!laptop) {
      // The list this was pressed in is gone: go to the student it opened.
      window.scrollTo(0, 0)
      requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }))
    }
  }
  const showList = laptop || !selected || changing

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      {!laptop && selected && (
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-card border border-line bg-surface py-1 pl-4 pr-1">
          <span className="min-w-0 text-sm font-semibold">{fullName(selected.student)}</span>
          <Button
            ref={changeButton}
            variant="quiet"
            aria-expanded={changing}
            aria-controls="meeting-students"
            onClick={() => {
              setChanging(!changing)
              if (!changing) requestAnimationFrame(() => search.current?.focus())
            }}
          >
            {changing ? 'Close the list' : 'Change student'}
          </Button>
        </div>
      )}
      {showList && (
      <Card className="motion-page overflow-hidden">
        <section aria-label="Students" id="meeting-students">
          <div className="border-b border-line p-3">
            <input ref={search} className={inputClass} type="search" placeholder="Search students" aria-label="Search students" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="lg:max-h-[70dvh] lg:overflow-y-auto">
            {GROUPS.map((g) => {
              const rows = shown.filter((s) => groupOf(s) === g)
              if (rows.length === 0) return null
              return (
                <div key={g}>
                  <div className="bg-canvas px-4 py-2 text-xs font-semibold text-muted">{g}</div>
                  {rows.map((s) => {
                    const active = selected?.student.id === s.student.id
                    return (
                      <button
                        key={s.student.id}
                        type="button"
                        aria-current={active}
                        onClick={() => select(s.student.id)}
                        className={cx('block w-full border-l-[3px] px-4 py-3 text-left', active ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-surface-2')}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold">{fullName(s.student)}</span>
                          {g === 'Needs review' ? (
                            <span className="text-xs font-semibold text-accent">Review ready</span>
                          ) : (
                            (s.status === 'behind' || s.status === 'slipping') && <span className={cx('text-xs font-semibold', s.status === 'behind' ? 'text-bad' : 'text-warn')}>{STATUS_LABEL[s.status]}</span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {g === 'Needs review' && s.lastMeeting && `Met ${formatRelative(s.lastMeeting.date)} · `}
                          {s.nextMeeting ? `Next ${when(s.nextMeeting)}` : s.lastMeeting ? `Last met ${formatDate(s.lastMeeting.date)}` : 'No meeting yet'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
            {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No student matches “{query}”.</p>}
          </div>
        </section>
      </Card>
      )}

      {selected && !(changing && !laptop) && (
        <div ref={panel} tabIndex={-1} className="min-w-0 focus:outline-none">
          <div key={selected.student.id} className="motion-page">
            <StudentMeetingPanel summary={selected} onModal={onModal} />
          </div>
        </div>
      )}
    </div>
  )
}

function StudentMeetingPanel({ summary, onModal }: { summary: StudentSummary; onModal: (m: { kind: 'schedule' | 'log'; studentId?: ID }) => void }) {
  const data = useData()
  const student = summary.student
  const { upcoming, recent } = meetingBuckets(data, student.id)
  const reviewing = recent && pendingInMeeting(recent) > 0
  const reminders = reminderQueue(data).filter((r) => r.studentId === student.id)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">
              <Link to={`/app/students/${student.id}`} className="tap-link hover:text-accent hover:underline">
                {fullName(student)}
              </Link>
            </h2>
            <StatusPill status={summary.status} />
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {recent ? `Last meeting ${formatDateLong(recent.date)} · ${recent.durationMin} min${recent.location ? ` on ${recent.location}` : ''}` : 'No meetings yet'}
            {' · '}
            {upcoming ? `Next ${when(upcoming)}` : 'Nothing scheduled'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onModal({ kind: 'log', studentId: student.id })}>Log a meeting</Button>
          {!upcoming && (
            <Button variant="primary" onClick={() => onModal({ kind: 'schedule', studentId: student.id })}>
              Schedule
            </Button>
          )}
        </div>
      </div>

      {reviewing ? (
        <>
          <p className="text-sm font-semibold">Review: {meetingHeading(recent)}</p>
          <MeetingReview meeting={recent} student={student} />
        </>
      ) : (
        <>
          {upcoming && <BriefCard meeting={upcoming} student={student} heading="Next meeting" />}
          {recent ? (
            <Card className="flex flex-col gap-4 p-5">
              <div>
                <SectionLabel>Most recent meeting</SectionLabel>
                <h3 className="mt-0.5 text-base font-semibold">{meetingHeading(recent)}</h3>
              </div>
              {!recent.ai && !recent.recap && recent.transcript ? <MeetingReview meeting={recent} student={student} /> : <MeetingReport meeting={recent} student={student} />}
            </Card>
          ) : (
            <Card>
              <Empty title={`No meetings with ${student.firstName} yet. Schedule one, or log one that already happened.`}>
                <div className="flex flex-wrap justify-center gap-2">
                  {!upcoming && (
                    <Button variant="primary" onClick={() => onModal({ kind: 'schedule', studentId: student.id })}>
                      Schedule a meeting
                    </Button>
                  )}
                  <Button onClick={() => onModal({ kind: 'log', studentId: student.id })}>Log a meeting</Button>
                </div>
              </Empty>
            </Card>
          )}
          <Card className="flex flex-col gap-2 p-5">
            <CardHeader title="Reminders for this student" count={reminders.length} action={reminders.length > 0 && <LinkButton to="/app/messages?tab=queue">Open scheduled reminders</LinkButton>} />
            {reminders.length === 0 ? (
              <p className="text-sm text-muted">No reminders are due for {student.firstName}’s tasks.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {reminders.slice(0, 5).map((r) => (
                  <li key={r.key}>
                    To {r.message.toName}: {r.taskTitle} <span className="text-muted">· {r.mode === 'automatic' ? 'automatic' : 'waits for you'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

// ── Calendar ────────────────────────────────────────────────────────────────

const TINT = { behind: 'bg-bad-soft text-bad', slipping: 'bg-warn-soft text-warn', on_track: 'bg-good-soft text-good', new: 'bg-chip text-ink-soft' } as const

/** The Monday of the week containing `iso`. */
function weekStart(iso: string): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return toISODate(d)
}

function Calendar({ summaries, onSchedule }: { summaries: StudentSummary[]; onSchedule: (studentId: ID) => void }) {
  const data = useData()
  const today = todayISO()
  const [offset, setOffset] = useState(0)
  const start = addDays(weekStart(today), offset * 7)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const byStudent = new Map(summaries.map((s) => [s.student.id, s]))
  const meetings = data.meetings
    .filter((m) => byStudent.has(m.studentId) && m.date >= days[0] && m.date <= days[6])
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  const briefs = meetings.filter((m) => m.status === 'scheduled' && m.brief).length
  const unscheduled = summaries.filter((s) => !s.nextMeeting)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button aria-label="Previous week" className="w-11 px-0!" onClick={() => setOffset(offset - 1)}>
            <ChevronLeft size={20} strokeWidth={1.75} aria-hidden />
          </Button>
          <Button aria-label="Next week" className="w-11 px-0!" onClick={() => setOffset(offset + 1)}>
            <ChevronRight size={20} strokeWidth={1.75} aria-hidden />
          </Button>
          <h2 aria-live="polite" className="nums ml-1 text-lg font-semibold">
            {formatDate(days[0])} to {formatDate(days[6])}
          </h2>
          {offset !== 0 && (
            <Button variant="quiet" onClick={() => setOffset(0)}>
              This week
            </Button>
          )}
        </div>
        <p className="text-[13px] text-muted">
          {meetings.length} {meetings.length === 1 ? 'meeting' : 'meetings'} this week · {briefs} {briefs === 1 ? 'brief' : 'briefs'} ready
        </p>
      </div>

      {/* Seven columns where there is room for them, and one day under another where there is not. */}
      <Card className="@container overflow-hidden">
        <div key={start} className="motion-page grid grid-cols-1 divide-y divide-line @min-[52rem]:grid-cols-7 @min-[52rem]:divide-x @min-[52rem]:divide-y-0">
          {days.map((day) => {
            const isToday = day === today
            const list = meetings.filter((m) => m.date === day)
            return (
              <div key={day} className={cx('flex min-w-0 flex-col gap-2 p-3 @min-[52rem]:min-h-[260px] @min-[52rem]:p-2', isToday && 'outline outline-2 -outline-offset-2 outline-accent')}>
                <div className={cx('px-1 text-xs font-semibold uppercase', isToday ? 'text-accent' : 'text-muted')}>
                  {parseISODate(day).toLocaleDateString('en-US', { weekday: 'short' })} {parseISODate(day).getDate()}
                  {isToday && ' · today'}
                </div>
                {list.length === 0 && <p className="px-1 text-[13px] text-muted">No meetings</p>}
                {list.map((m) => {
                  const s = byStudent.get(m.studentId)!
                  return (
                    <Link key={m.id} to={`/app/meetings?student=${m.studentId}`} className={cx('block min-h-11 rounded-control p-2 hover:brightness-95', TINT[s.status])}>
                      <span className="block text-xs font-semibold">
                        {formatTime(m.time)} · {STATUS_LABEL[s.status]}
                      </span>
                      <span className="block text-sm font-semibold text-ink">{fullName(s.student)}</span>
                      <span className="block text-xs text-ink-soft">{m.title}</span>
                      {m.status === 'completed' ? (
                        <span className="mt-1 block text-xs font-semibold text-ink-soft">{pendingInMeeting(m) > 0 ? 'Held · review ready' : 'Held'}</span>
                      ) : (
                        m.brief && <span className="mt-1 block text-xs font-semibold text-accent-hover">Brief ready</span>
                      )}
                    </Link>
                  )
                })}
              </div>
            )
          })}
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <CardHeader title={unscheduled.length === 0 ? 'Every student has a meeting scheduled' : `${unscheduled.length} ${unscheduled.length === 1 ? 'student has' : 'students have'} no meeting scheduled`} />
        {unscheduled.length > 0 && (
          <ul className="flex flex-col">
            {unscheduled.map((s) => (
              <li key={s.student.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
                <span className="text-sm">
                  <Link to={`/app/meetings?student=${s.student.id}`} className="tap-link font-semibold hover:text-accent hover:underline">
                    {fullName(s.student)}
                  </Link>{' '}
                  <span className="text-muted">{s.lastMeeting ? `last met ${formatDate(s.lastMeeting.date)}` : 'has not met yet'}</span>
                  {s.status !== 'on_track' && <Pill tone={s.status === 'behind' ? 'bad' : s.status === 'slipping' ? 'warn' : 'neutral'} className="ml-2">{STATUS_LABEL[s.status]}</Pill>}
                </span>
                <Button aria-label={`Schedule a meeting with ${fullName(s.student)}`} onClick={() => onSchedule(s.student.id)}>Schedule</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
