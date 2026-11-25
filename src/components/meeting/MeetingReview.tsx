// Review of everything the AI drafted from one meeting, in numbered sections.
// Each item is approved, edited or discarded on the same card the Inbox uses,
// with more around it: the evidence, the other language, the full notes.
// Approved items flow into the real task list, the profile, the parent reports
// and the student's recap; until then nothing leaves this panel.

import { ChevronRight } from 'lucide-react'
import { createContext, useContext, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatDate, formatDateLong } from '../../lib/dates'
import { findParent, meetingApprovals, ownerLabel, pendingInMeeting, reviewSections, type ApprovalItem, type ReviewSection } from '../../lib/derive'
import { CHANNEL_LABEL } from '../../lib/language'
import { draftMeeting } from '../../services/workflows'
import { useData, useStore } from '../../store/store'
import type { Approval, DraftPersonalNote, DraftTask, Meeting, ProfileChange, Review, Student } from '../../types'
import { sentByHand } from '../../lib/delivery'
import { ApprovalCard, approveItem } from '../ApprovalCard'
import { Reveal } from '../motion'
import { Bilingual, recipientLine } from '../Bilingual'
import {
  AiErrorNote,
  AiTag,
  ApprovalStamp,
  Button,
  Card,
  Disclosure,
  OwnerChip,
  PlaceholderNote,
  ReviewTag,
  SectionLabel,
  SendLabel,
  Thinking,
  cx,
  useAi,
  useToast,
} from '../ui'

export function MeetingReview({ meeting, student }: { meeting: Meeting; student: Student }) {
  const approveAll = useStore((s) => s.approveAllInMeeting)
  const toast = useToast()
  const data = useData()
  const { busy, error, run } = useAi()
  const sections = reviewSections(meeting)
  const settled = sections.filter((s) => s.pending === 0).length
  const pending = pendingInMeeting(meeting)
  const ai = meeting.ai
  /** Parent updates and the recap are queued as messages when they are approved. */
  const waiting = meetingApprovals(data, meeting)
  // A message on a channel that is not connected is copied and sent by hand, so it is left out of "everything".
  const byHand = waiting.filter(sentByHand)
  const sends = waiting.filter((i) => i.isSend && !sentByHand(i)).length
  const number = (key: ReviewSection['key']) => sections.findIndex((s) => s.key === key) + 1
  const section = (key: ReviewSection['key']) => sections.find((s) => s.key === key)
  // Redrafting replaces every draft, so it is offered only while none has been reviewed.
  const untouched = Boolean(ai) && sections.every((s) => s.pending === s.total)
  // One section open by default: the first with something waiting. Deciding it opens the next.
  const [chosen, setChosen] = useState<Partial<Record<SectionKey, boolean>>>({})
  const firstWaiting = sections.find((s) => s.pending > 0)?.key
  const openSections = {
    isOpen: (key: SectionKey) => chosen[key] ?? key === firstWaiting,
    toggle: (key: SectionKey) => setChosen((c) => ({ ...c, [key]: !(c[key] ?? key === firstWaiting) })),
    waiting: (key: SectionKey) => section(key)?.pending ?? 0,
  }

  if (!ai && !meeting.recap) {
    return (
      <Card className="flex flex-col items-start gap-3 p-5">
        <h3 className="text-base font-semibold">No drafts for this meeting yet</h3>
        {meeting.transcript ? (
          <>
            <p className="text-sm text-muted">The notes from this meeting are saved. The AI can read them and draft the follow-through for your review.</p>
            <SourceNotes meeting={meeting} />
            <AiErrorNote message={error} />
            {busy ? (
              <Thinking label="AI is reading the notes and drafting follow-ups…" />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => run(() => draftMeeting(meeting.id, 'full'))}>
                  Draft notes, tasks and parent update
                </Button>
                <Button onClick={() => run(() => draftMeeting(meeting.id, 'tasks'))}>Draft tasks only</Button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">This meeting was logged without notes, so there is nothing for the AI to read. Add tasks by hand on {student.firstName}’s page.</p>
        )}
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-bold">
            {settled} of {sections.length}
          </span>{' '}
          <span className="text-muted">sections approved</span>
          {pending > 0 && <span className="text-muted"> · nothing here has reached {student.firstName} or the family</span>}{' '}
          {ai && pending > 0 && <AiTag source={ai.source} />}
        </div>
        <div className="flex flex-wrap gap-2">
          {untouched && meeting.transcript && (
            <Button onClick={() => run(() => draftMeeting(meeting.id, 'full'))} busy={busy}>
              Redraft with AI
            </Button>
          )}
          {waiting.length > byHand.length && (
            <Button
              onClick={() => {
                if (byHand.length === 0) approveAll(meeting.id)
                else for (const item of waiting) if (!sentByHand(item)) void approveItem(item)
                toast(
                  [
                    byHand.length === 0 ? 'Approved everything from this meeting.' : 'Approved the rest from this meeting.',
                    sends > 0 && `${sends} ${sends === 1 ? 'message is' : 'messages are'} queued.`,
                    byHand.length > 0 && `${byHand.length} ${byHand.length === 1 ? 'is' : 'are'} left for you to copy and send by hand.`,
                  ]
                    .filter(Boolean)
                    .join(' '),
                )
              }}
            >
              {sends > 0 ? <SendLabel>{byHand.length > 0 ? 'Approve and send the rest' : 'Approve and send everything left'}</SendLabel> : byHand.length > 0 ? 'Approve the rest' : 'Approve everything left'}
            </Button>
          )}
        </div>
      </div>

      <PlaceholderNote source={ai?.source} />
      <AiErrorNote message={error} />
      {busy && <Thinking label="AI is reading the notes and drafting follow-ups…" />}

      <OpenSections.Provider value={openSections}>
        {ai && <NotesSection n={number('notes')} meeting={meeting} />}
        {ai && section('tasks') && <TasksSection n={number('tasks')} meeting={meeting} student={student} />}
        {ai && section('parents') && <ParentsSection n={number('parents')} meeting={meeting} student={student} />}
        {meeting.recap && <RecapSection n={number('recap')} meeting={meeting} student={student} />}
        {ai && section('remember') && <RememberSection n={number('remember')} meeting={meeting} student={student} />}
        {ai && section('profile') && <ProfileSection n={number('profile')} meeting={meeting} />}
      </OpenSections.Provider>
      <p className="text-[13px] text-muted">
        Reminders follow the firm’s rules.{' '}
        <Link to="/app/settings#reminder-rules" className="tap-link font-semibold text-accent hover:underline">
          Settings
        </Link>
      </p>
    </div>
  )
}

// ── Shared bits ─────────────────────────────────────────────────────────────

type SectionKey = ReviewSection['key']

/** Which sections of the review are open. The first one with something waiting is; the rest open in place. */
const OpenSections = createContext<{ isOpen: (key: SectionKey) => boolean; toggle: (key: SectionKey) => void; waiting: (key: SectionKey) => number }>({ isOpen: () => true, toggle: () => undefined, waiting: () => 0 })

function Section({ k, n, title, right, children }: { k: SectionKey; n: number; title: string; right?: ReactNode; children: ReactNode }) {
  const { isOpen, toggle, waiting } = useContext(OpenSections)
  const open = isOpen(k)
  const id = useId()
  const left = waiting(k)
  return (
    <Card className="flex flex-col px-3 py-2 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <h3 className="min-w-0 flex-1 basis-56 text-base font-semibold">
          <button type="button" aria-expanded={open} aria-controls={id} onClick={() => toggle(k)} className="flex min-h-11 w-full items-center gap-1.5 rounded-control px-1 text-left hover:bg-surface-2">
            <ChevronRight size={20} strokeWidth={1.75} className="motion-chevron shrink-0 text-muted" aria-hidden />
            <span>
              {n}. {title}
              {!open && left > 0 && <span className="nums font-sans text-sm font-medium text-muted"> · {left} waiting</span>}
            </span>
          </button>
        </h3>
        <div className="flex flex-wrap items-center gap-2 px-1">{right}</div>
      </div>
      <Reveal open={open} id={id}>
        <div className="flex flex-col gap-3 px-1 pb-2 pt-2">{children}</div>
      </Reveal>
    </Card>
  )
}

function SectionState({ review, approval, approvedLabel }: { review: Review; approval?: Approval; approvedLabel?: string }) {
  return (
    <>
      <ApprovalStamp approval={approval} />
      <ReviewTag review={review} approvedLabel={approvedLabel} />
    </>
  )
}

/** The worst state among a list of drafts: pending if any is pending. */
const groupReview = (items: { review: Review }[]): Review =>
  items.some((i) => i.review === 'pending') ? 'pending' : items.some((i) => i.review === 'approved') ? 'approved' : 'dismissed'

function SourceNotes({ meeting }: { meeting: Meeting }) {
  if (!meeting.transcript) return null
  return (
    <Disclosure label="What the AI read" className="w-full">
      <p className="whitespace-pre-wrap break-words rounded-control bg-canvas p-3 font-mono text-[13px] leading-relaxed text-ink-soft">{meeting.transcript}</p>
    </Disclosure>
  )
}

/** Decided / Progress / Watch as three compact cards. Also used by the read-only report. */
export function SummaryCards({ ai }: { ai: Pick<NonNullable<Meeting['ai']>, 'decided' | 'progress' | 'watch'> }) {
  const groups = [
    ['Decided', ai.decided],
    ['Progress', ai.progress],
    ['Watch', ai.watch],
  ] as const
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))]">
      {groups.map(([label, items]) => (
        <div key={label} className="rounded-lg bg-canvas p-3">
          <SectionLabel>{label}</SectionLabel>
          {items.length ? (
            <ul className="mt-1 list-disc space-y-1 pl-4 text-sm leading-relaxed">
              {items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted">Nothing noted.</p>
          )}
        </div>
      ))}
    </div>
  )
}

/** What was decided, and by whom, once a draft is no longer waiting. Fades in when it was decided on this screen. */
function Settled({ here, review, approval, approvedLabel }: { here: boolean; review: Review; approval?: Approval; approvedLabel?: string }) {
  return (
    <span className={cx('flex min-h-11 flex-wrap items-center gap-2', here && 'motion-fade')}>
      <SectionState review={review} approval={approval} approvedLabel={approvedLabel} />
    </span>
  )
}

/** Whether a draft was waiting when this row first appeared. */
function useStartedPending(pending: boolean): boolean {
  const [first] = useState(pending)
  return first
}

/** Focus comes here when the buttons inside are gone. */
const HOME = { tabIndex: -1, 'data-focus-home': true } as const
const ROW = 'border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0 focus:outline-none'

/** The approval for one draft of a meeting, or undefined once it is decided. */
function useApproval(meeting: Meeting, kind: ApprovalItem['kind'], draftId?: string): ApprovalItem | undefined {
  const data = useData()
  return meetingApprovals(data, meeting).find((i) => i.kind === kind && i.draftId === draftId)
}

// ── 1. Notes ────────────────────────────────────────────────────────────────

function NotesSection({ n, meeting }: { n: number; meeting: Meeting }) {
  const ai = meeting.ai!
  const item = useApproval(meeting, 'notes')
  const summary = (
    <>
      <SummaryCards ai={ai} />
      {ai.notes.length > 0 && (
        <Disclosure label="Full notes · private to you" className="mt-1">
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
            {ai.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Disclosure>
      )}
      <SourceNotes meeting={meeting} />
    </>
  )
  return (
    <Section k="notes" n={n} title="Meeting notes" right={<SectionState review={ai.notesReview} approval={ai.notesApproval} />}>
      <div {...HOME} className="focus:outline-none">
        {item ? (
          <ApprovalCard item={item} compact hideKind note="Approved notes become this meeting’s record. They are never sent to anyone.">
            {summary}
          </ApprovalCard>
        ) : (
          summary
        )}
      </div>
    </Section>
  )
}

// ── 2. Tasks ────────────────────────────────────────────────────────────────

function TasksSection({ n, meeting, student }: { n: number; meeting: Meeting; student: Student }) {
  const reviewDraftTask = useStore((s) => s.reviewDraftTask)
  const tasks = meeting.ai!.draftTasks
  const pending = tasks.filter((t) => t.review === 'pending')
  return (
    <Section
      k="tasks"
      n={n}
      title="Tasks from this meeting"
      right={
        <>
          <ReviewTag review={groupReview(tasks)} approvedLabel="Added to tasks" />
          {pending.length > 1 && <Button onClick={() => pending.forEach((t) => reviewDraftTask(meeting.id, t.id, 'approved'))}>Approve {pending.length} tasks</Button>}
        </>
      }
    >
      <ul className="flex flex-col">
        {tasks.map((t) => (
          <DraftTaskRow key={t.id} meeting={meeting} student={student} draft={t} />
        ))}
      </ul>
    </Section>
  )
}

function DraftTaskRow({ meeting, student, draft }: { meeting: Meeting; student: Student; draft: DraftTask }) {
  const item = useApproval(meeting, 'task', draft.id)
  const started = useStartedPending(Boolean(item))
  const body = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="min-w-[14rem] flex-1">
        <p className="text-sm font-medium">{draft.title}</p>
        {draft.detail && <p className="text-[13px] text-muted">{draft.detail}</p>}
      </div>
      <OwnerChip owner={draft.owner} label={ownerLabel(draft, student)} />
      <span className="text-[13px] text-muted">
        {formatDate(draft.dueDate)}
        {draft.dueDateBasis === 'inferred' && item && <span className="text-warn"> · date suggested by AI</span>}
      </span>
    </div>
  )
  return (
    <li {...HOME} className={cx(ROW, draft.review === 'dismissed' && 'opacity-60')}>
      {item ? (
        <ApprovalCard item={item} compact hideKind>
          {body}
        </ApprovalCard>
      ) : (
        <>
          {body}
          <Settled here={started} review={draft.review} approval={draft.approval} approvedLabel="Added to tasks" />
        </>
      )}
    </li>
  )
}

// ── 3. Parent updates ───────────────────────────────────────────────────────

function ParentsSection({ n, meeting, student }: { n: number; meeting: Meeting; student: Student }) {
  const updates = meeting.ai!.parentUpdates
  return (
    <Section k="parents" n={n} title={updates.length > 1 ? 'Parent updates' : 'Parent update'} right={<ReviewTag review={groupReview(updates)} approvedLabel="Sent" />}>
      <ul>
        {updates.map((u) => (
          <ParentUpdateRow key={u.id} meeting={meeting} student={student} updateId={u.id} />
        ))}
      </ul>
    </Section>
  )
}

function ParentUpdateRow({ meeting, student, updateId }: { meeting: Meeting; student: Student; updateId: string }) {
  const toast = useToast()
  const update = meeting.ai!.parentUpdates.find((u) => u.id === updateId)!
  const item = useApproval(meeting, 'parent_update', updateId)
  const started = useStartedPending(Boolean(item))
  const parent = findParent(student, update.parentId)
  if (!parent) return null
  const body = <Bilingual language={parent.language} en={update.bodyEn} local={update.bodyLocal} recipient={parent.name} />
  const copy = (
    <Button
      onClick={() => {
        void navigator.clipboard?.writeText(update.bodyLocal ?? update.bodyEn)
        toast(`Copied. Paste it into ${CHANNEL_LABEL[parent.channel]} yourself.`)
      }}
    >
      Copy for {CHANNEL_LABEL[parent.channel]}
    </Button>
  )
  return (
    <li {...HOME} className={cx(ROW, update.review === 'dismissed' && 'opacity-60')}>
      {item ? (
        <ApprovalCard item={item} compact hideKind actions={copy}>
          {body}
        </ApprovalCard>
      ) : (
        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-medium text-ink-soft">{recipientLine(parent)}</span>
          {body}
          <span className="flex flex-wrap items-center gap-2">
            <Settled here={started} review={update.review} approval={update.approval} approvedLabel={`Sent by ${CHANNEL_LABEL[parent.channel]}`} />
            {copy}
          </span>
        </div>
      )}
    </li>
  )
}

// ── 4. Recap for the student ────────────────────────────────────────────────

function RecapSection({ n, meeting, student }: { n: number; meeting: Meeting; student: Student }) {
  const recap = meeting.recap!
  const item = useApproval(meeting, 'recap')
  const body = (
    <div className="rounded-control bg-canvas p-3 text-sm leading-relaxed">
      <p className="max-w-prose">{recap.summary}</p>
      {recap.nextSteps.length > 0 && (
        <ol className="mt-2 max-w-prose list-decimal space-y-1 pl-5">
          {recap.nextSteps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  )
  return (
    <Section k="recap" n={n} title={`Recap for ${student.firstName}`} right={<SectionState review={recap.review} approval={recap.approval} approvedLabel={`Shared with ${student.firstName}`} />}>
      <div {...HOME} className="focus:outline-none">
        {item ? (
          <ApprovalCard item={item} compact hideKind note={`${student.firstName} sees this in the student view only after you approve it.`}>
            {body}
          </ApprovalCard>
        ) : (
          body
        )}
      </div>
    </Section>
  )
}

// ── 5. Things to remember ───────────────────────────────────────────────────

/**
 * Personal details the student mentioned, picked out by the AI. Reviewed like
 * profile changes: approve, edit or discard. Only approved ones are saved, and
 * they are used only in texts to the student.
 */
function RememberSection({ n, meeting, student }: { n: number; meeting: Meeting; student: Student }) {
  const notes = meeting.ai!.personalNotes ?? []
  return (
    <Section k="remember" n={n} title="Things to remember" right={<ReviewTag review={groupReview(notes)} approvedLabel="Saved" />}>
      <p className="text-[13px] text-muted">
        Things {student.firstName} mentioned in passing. A saved one is brought up in a text to {student.firstName}: good luck beforehand, “how did it go?” afterwards, then never again. One with a date is kept until it has happened; one without is dropped at the next meeting. They are never used in anything a parent reads, and {student.firstName} cannot see this list.
      </p>
      <ul className="flex flex-col">
        {notes.map((note) => (
          <DraftNoteRow key={note.id} meeting={meeting} note={note} />
        ))}
      </ul>
    </Section>
  )
}

function DraftNoteRow({ meeting, note }: { meeting: Meeting; note: DraftPersonalNote }) {
  const item = useApproval(meeting, 'remember', note.id)
  const started = useStartedPending(Boolean(item))
  const body = (
    <div className="text-sm">
      <p className="font-medium">
        {note.text}
        {note.eventDate && <span className="font-normal text-muted"> · {note.eventDateApprox ? `around ${formatDate(note.eventDate)} (estimated: no exact day was given)` : formatDateLong(note.eventDate)}</span>}
        {!note.eventDate && item && <span className="font-normal text-muted"> · no date, so it is dropped at the next meeting</span>}
      </p>
      <p className="mt-0.5 text-[13px] italic text-muted">From the meeting: {note.evidence}</p>
    </div>
  )
  return (
    <li {...HOME} className={cx(ROW, note.review === 'dismissed' && 'opacity-60')}>
      {item ? (
        <ApprovalCard item={item} compact hideKind>
          {body}
        </ApprovalCard>
      ) : (
        <>
          {body}
          <Settled here={started} review={note.review} approval={note.approval} approvedLabel="Saved" />
        </>
      )}
    </li>
  )
}

// ── 6. Profile changes ──────────────────────────────────────────────────────

function ProfileSection({ n, meeting }: { n: number; meeting: Meeting }) {
  const changes = meeting.ai!.profileChanges
  return (
    <Section k="profile" n={n} title="Profile changes" right={<ReviewTag review={groupReview(changes)} approvedLabel="Applied" />}>
      <ul className="flex flex-col">
        {changes.map((c) => (
          <ProfileChangeRow key={c.id} meeting={meeting} change={c} />
        ))}
      </ul>
    </Section>
  )
}

function ProfileChangeRow({ meeting, change: c }: { meeting: Meeting; change: ProfileChange }) {
  const item = useApproval(meeting, 'profile', c.id)
  const started = useStartedPending(Boolean(item))
  const body = (
    <div className="min-w-0 text-sm">
      <SectionLabel>{c.label}</SectionLabel>
      <p className="mt-0.5">
        <span className="text-muted line-through">{c.from}</span> <span aria-label="changes to">→</span> <span className="font-semibold">{c.to}</span>
      </p>
      <p className="mt-0.5 text-[13px] italic text-muted">From the meeting: {c.evidence}</p>
    </div>
  )
  return (
    <li {...HOME} className={cx(ROW, c.review === 'dismissed' && 'opacity-60')}>
      {item ? (
        <ApprovalCard item={item} compact hideKind>
          {body}
        </ApprovalCard>
      ) : (
        <>
          {body}
          <Settled here={started} review={c.review} approval={c.approval} approvedLabel="Applied" />
        </>
      )}
    </li>
  )
}
