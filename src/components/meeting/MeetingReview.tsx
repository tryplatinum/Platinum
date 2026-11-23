// Review of everything the AI drafted from one meeting, in numbered sections.
// Each item is approved, edited or dismissed by the counselor. Approved items
// flow into the real task list, the profile, the parent reports and the
// student's recap; until then nothing leaves this panel.

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatDate } from '../../lib/dates'
import { findParent, ownerLabel, pendingInMeeting, reviewSections, type ReviewSection } from '../../lib/derive'
import { CHANNEL_LABEL } from '../../lib/language'
import { draftMeeting } from '../../services/workflows'
import { useData, useStore, type Decision } from '../../store/store'
import type { Approval, DraftTask, Meeting, OwnerType, ReminderMode, ReminderRule, Review, Student } from '../../types'
import { Bilingual, recipientLine } from '../Bilingual'
import {
  AiErrorNote,
  AiTag,
  ApprovalStamp,
  Button,
  Card,
  OwnerChip,
  PlaceholderNote,
  ReviewTag,
  SENT_NOTE,
  SectionLabel,
  Thinking,
  cx,
  inputBase,
  textareaClass,
  useAi,
  useToast,
} from '../ui'

export function MeetingReview({ meeting, student }: { meeting: Meeting; student: Student }) {
  const approveAll = useStore((s) => s.approveAllInMeeting)
  const toast = useToast()
  const { busy, error, run } = useAi()
  const sections = reviewSections(meeting)
  const settled = sections.filter((s) => s.pending === 0).length
  const pending = pendingInMeeting(meeting)
  const ai = meeting.ai
  const number = (key: ReviewSection['key']) => sections.findIndex((s) => s.key === key) + 1
  const section = (key: ReviewSection['key']) => sections.find((s) => s.key === key)
  // Redrafting replaces every draft, so it is offered only while none has been reviewed.
  const untouched = Boolean(ai) && sections.every((s) => s.pending === s.total)

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
                <Button variant="primary" onClick={() => run(() => draftMeeting(meeting.id, 'full'))}>
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
            <Button onClick={() => run(() => draftMeeting(meeting.id, 'full'))} disabled={busy}>
              Redraft with AI
            </Button>
          )}
          {pending > 0 && (
            <Button
              variant="primary"
              onClick={() => {
                approveAll(meeting.id)
                toast(`Approved everything from this meeting. ${SENT_NOTE}`)
              }}
            >
              Approve everything left
            </Button>
          )}
        </div>
      </div>

      <PlaceholderNote source={ai?.source} />
      <AiErrorNote message={error} />
      {busy && <Thinking label="AI is reading the notes and drafting follow-ups…" />}

      {ai && <NotesSection n={number('notes')} meeting={meeting} />}
      {ai && section('tasks') && <TasksSection n={number('tasks')} meeting={meeting} student={student} />}
      {ai && section('parents') && <ParentsSection n={number('parents')} meeting={meeting} student={student} />}
      {meeting.recap && <RecapSection n={number('recap')} meeting={meeting} student={student} />}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
        {ai && section('profile') && <ProfileSection n={number('profile')} meeting={meeting} />}
        <RemindersSection n={sections.length + 1} student={student} />
      </div>
    </div>
  )
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function Section({ n, title, right, children }: { n: number; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">
          {n}. {title}
        </h3>
        <div className="flex flex-wrap items-center gap-2">{right}</div>
      </div>
      {children}
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
    <details className="w-full text-[13px]">
      <summary className="flex min-h-11 items-center font-semibold text-accent">What the AI read</summary>
      <p className="whitespace-pre-wrap rounded-lg bg-canvas p-3 font-mono text-[13px] leading-relaxed text-ink-soft">{meeting.transcript}</p>
    </details>
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

// ── 1. Notes ────────────────────────────────────────────────────────────────

function NotesSection({ n, meeting }: { n: number; meeting: Meeting }) {
  const reviewNotes = useStore((s) => s.reviewNotes)
  const ai = meeting.ai!
  return (
    <Section n={n} title="Meeting notes" right={<SectionState review={ai.notesReview} approval={ai.notesApproval} />}>
      <SummaryCards ai={ai} />
      {ai.notes.length > 0 && (
        <details className="text-[13px]">
          <summary className="flex min-h-11 items-center font-semibold text-accent">Full notes · private to you</summary>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
            {ai.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      )}
      <SourceNotes meeting={meeting} />
      {ai.notesReview === 'pending' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => reviewNotes(meeting.id, 'approved')}>
            Approve notes
          </Button>
          <Button variant="quiet" onClick={() => reviewNotes(meeting.id, 'dismissed')}>
            Dismiss
          </Button>
          <span className="text-xs text-muted">Approved notes become this meeting’s record. They are never sent to anyone.</span>
        </div>
      )}
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
      n={n}
      title="Tasks from this meeting"
      right={
        <>
          <ReviewTag review={groupReview(tasks)} approvedLabel="Added to tasks" />
          {pending.length > 1 && (
            <Button variant="primary" onClick={() => pending.forEach((t) => reviewDraftTask(meeting.id, t.id, 'approved'))}>
              Add {pending.length} tasks
            </Button>
          )}
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
  const { updateDraftTask, reviewDraftTask } = useStore.getState()
  const [editing, setEditing] = useState(false)
  const pending = draft.review === 'pending'
  const ownerKey = draft.owner === 'parent' ? `parent:${draft.ownerParentId}` : draft.owner
  const patch = (p: Partial<DraftTask>) => updateDraftTask(meeting.id, draft.id, p)

  return (
    <li className={cx('border-t border-line py-3 first:border-t-0', draft.review === 'dismissed' && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-[14rem] flex-1">
          <p className="text-sm font-medium">{draft.title}</p>
          {draft.detail && <p className="text-[13px] text-muted">{draft.detail}</p>}
        </div>
        <OwnerChip owner={draft.owner} label={ownerLabel(draft, student)} />
        <span className="text-[13px] text-muted">
          {formatDate(draft.dueDate)}
          {draft.dueDateBasis === 'inferred' && pending && <span className="text-warn"> · date suggested by AI</span>}
        </span>
        {pending ? (
          <span className="flex flex-wrap gap-1.5">
            <Button variant="primary" onClick={() => reviewDraftTask(meeting.id, draft.id, 'approved')}>
              Approve
            </Button>
            <Button onClick={() => setEditing(!editing)} aria-expanded={editing}>
              {editing ? 'Done' : 'Edit'}
            </Button>
            <Button variant="quiet" onClick={() => reviewDraftTask(meeting.id, draft.id, 'dismissed')}>
              Dismiss
            </Button>
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <SectionState review={draft.review} approval={draft.approval} approvedLabel="Added to tasks" />
          </span>
        )}
      </div>
      {editing && pending && (
        <div className="mt-3 flex flex-wrap gap-2 rounded-lg bg-canvas p-3">
          <input className={cx(inputBase, 'min-w-[14rem] flex-1')} value={draft.title} onChange={(e) => patch({ title: e.target.value })} aria-label="Task" />
          <select
            className={inputBase}
            value={ownerKey}
            aria-label="Owner"
            onChange={(e) => {
              const v = e.target.value
              patch(v.startsWith('parent:') ? { owner: 'parent', ownerParentId: v.slice(7) } : { owner: v as OwnerType, ownerParentId: undefined })
            }}
          >
            <option value="student">{student.firstName}</option>
            {student.parents.map((p) => (
              <option key={p.id} value={`parent:${p.id}`}>
                {p.name} ({p.relationship})
              </option>
            ))}
            <option value="counselor">You</option>
          </select>
          <input type="date" className={inputBase} value={draft.dueDate} aria-label="Due date" onChange={(e) => e.target.value && patch({ dueDate: e.target.value, dueDateBasis: 'stated' })} />
        </div>
      )}
    </li>
  )
}

// ── 3. Parent updates ───────────────────────────────────────────────────────

function ParentsSection({ n, meeting, student }: { n: number; meeting: Meeting; student: Student }) {
  const updates = meeting.ai!.parentUpdates
  return (
    <Section n={n} title={updates.length > 1 ? 'Parent updates' : 'Parent update'} right={<ReviewTag review={groupReview(updates)} approvedLabel="Sent" />}>
      {updates.map((u) => (
        <ParentUpdateRow key={u.id} meeting={meeting} student={student} updateId={u.id} />
      ))}
    </Section>
  )
}

function ParentUpdateRow({ meeting, student, updateId }: { meeting: Meeting; student: Student; updateId: string }) {
  const { updateParentUpdate, reviewParentUpdate } = useStore.getState()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const update = meeting.ai!.parentUpdates.find((u) => u.id === updateId)!
  const parent = findParent(student, update.parentId)
  if (!parent) return null
  const pending = update.review === 'pending'
  const decide = (d: Decision) => {
    reviewParentUpdate(meeting.id, update.id, d)
    if (d === 'approved') toast(`Update to ${parent.name} approved. ${SENT_NOTE}`)
  }

  return (
    <div className={cx('flex flex-col gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0', update.review === 'dismissed' && 'opacity-60')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-soft">{recipientLine(parent)}</span>
        {!pending && (
          <span className="flex flex-wrap items-center gap-2">
            <SectionState review={update.review} approval={update.approval} approvedLabel={`Sent by ${CHANNEL_LABEL[parent.channel]}`} />
          </span>
        )}
      </div>
      <Bilingual
        language={parent.language}
        en={update.bodyEn}
        local={update.bodyLocal}
        recipient={parent.name}
        editable={editing && pending}
        onChangeEn={(bodyEn) => updateParentUpdate(meeting.id, update.id, { bodyEn })}
        onChangeLocal={(bodyLocal) => updateParentUpdate(meeting.id, update.id, { bodyLocal })}
      />
      <div className="flex flex-wrap gap-2">
        {pending && (
          <>
            <Button variant="primary" onClick={() => decide('approved')}>
              Approve and send
            </Button>
            <Button onClick={() => setEditing(!editing)}>{editing ? 'Done editing' : 'Edit'}</Button>
          </>
        )}
        <Button
          onClick={() => {
            void navigator.clipboard?.writeText(update.bodyLocal ?? update.bodyEn)
            toast(`Copied. Paste it into ${CHANNEL_LABEL[parent.channel]} yourself: delivery is not connected in v0.`)
          }}
        >
          Copy for {CHANNEL_LABEL[parent.channel]}
        </Button>
        {pending && (
          <Button variant="quiet" onClick={() => decide('dismissed')}>
            Dismiss
          </Button>
        )}
      </div>
    </div>
  )
}

// ── 4. Recap for the student ────────────────────────────────────────────────

function RecapSection({ n, meeting, student }: { n: number; meeting: Meeting; student: Student }) {
  const { updateRecap, reviewRecap } = useStore.getState()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const recap = meeting.recap!
  const pending = recap.review === 'pending'
  return (
    <Section n={n} title={`Recap for ${student.firstName}`} right={<SectionState review={recap.review} approval={recap.approval} approvedLabel={`Shared with ${student.firstName}`} />}>
      {editing && pending ? (
        <>
          <textarea className={textareaClass} rows={4} value={recap.summary} onChange={(e) => updateRecap(meeting.id, { summary: e.target.value })} aria-label="Recap" />
          <label className="block">
            <SectionLabel className="mb-1">Next steps, one per line</SectionLabel>
            <textarea
              className={textareaClass}
              rows={Math.max(3, recap.nextSteps.length + 1)}
              value={recap.nextSteps.join('\n')}
              onChange={(e) => updateRecap(meeting.id, { nextSteps: e.target.value.split('\n') })}
              onBlur={() => updateRecap(meeting.id, { nextSteps: recap.nextSteps.map((s) => s.trim()).filter(Boolean) })}
            />
          </label>
        </>
      ) : (
        <div className="rounded-lg bg-canvas p-3 text-sm leading-relaxed">
          <p>{recap.summary}</p>
          {recap.nextSteps.length > 0 && (
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              {recap.nextSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
        </div>
      )}
      {pending && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={() => {
              reviewRecap(meeting.id, 'approved')
              toast(`Recap shared with ${student.firstName}. ${SENT_NOTE}`)
            }}
          >
            Approve and share
          </Button>
          <Button onClick={() => setEditing(!editing)}>{editing ? 'Done editing' : 'Edit'}</Button>
          <Button variant="quiet" onClick={() => reviewRecap(meeting.id, 'dismissed')}>
            Dismiss
          </Button>
          <span className="text-xs text-muted">{student.firstName} sees this in the student view only after you approve it.</span>
        </div>
      )}
    </Section>
  )
}

// ── 5. Profile changes ──────────────────────────────────────────────────────

function ProfileSection({ n, meeting }: { n: number; meeting: Meeting }) {
  const reviewProfileChange = useStore((s) => s.reviewProfileChange)
  const changes = meeting.ai!.profileChanges
  return (
    <Section n={n} title="Profile changes" right={<ReviewTag review={groupReview(changes)} approvedLabel="Applied" />}>
      <ul className="flex flex-col">
        {changes.map((c) => (
          <li key={c.id} className={cx('flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 first:border-t-0 first:pt-0', c.review === 'dismissed' && 'opacity-60')}>
            <div className="min-w-0 text-sm">
              <SectionLabel>{c.label}</SectionLabel>
              <p className="mt-0.5">
                <span className="text-muted line-through">{c.from}</span> <span aria-label="changes to">→</span> <span className="font-semibold">{c.to}</span>
              </p>
              <p className="mt-0.5 text-[13px] italic text-muted">From the meeting: {c.evidence}</p>
            </div>
            {c.review === 'pending' ? (
              <span className="flex gap-1.5">
                <Button onClick={() => reviewProfileChange(meeting.id, c.id, 'approved')}>Accept</Button>
                <Button variant="quiet" onClick={() => reviewProfileChange(meeting.id, c.id, 'dismissed')}>
                  Dismiss
                </Button>
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-2">
                <SectionState review={c.review} approval={c.approval} approvedLabel="Applied" />
              </span>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ── 6. Reminders ────────────────────────────────────────────────────────────

/** Toggles for what goes out about tasks. These are the firm-wide rules, shown here because this is where the tasks are created. */
function RemindersSection({ n, student }: { n: number; student: Student }) {
  const rules = useData().reminderRules
  const updateRule = useStore((s) => s.updateRule)
  const rule = (id: ReminderRule['id']) => rules.find((r) => r.id === id)!
  const on = (id: ReminderRule['id']) => rule(id).mode !== 'off'
  const askFirst = rules.filter((r) => r.mode !== 'off').every((r) => r.mode === 'needs_approval')
  const activeMode: ReminderMode = askFirst ? 'needs_approval' : 'automatic'
  const toggle = (ids: ReminderRule['id'][], checked: boolean) => ids.forEach((id) => updateRule(id, { mode: checked ? activeMode : 'off' }))
  const rows: { label: string; ids: ReminderRule['id'][] }[] = [
    { label: `${student.firstName}: ${rule('student_upcoming').days} days before each due date`, ids: ['student_upcoming'] },
    { label: `${student.firstName}: when a task becomes late`, ids: ['student_late'] },
    { label: 'Parents: about tasks that are theirs', ids: ['parent_upcoming', 'parent_late'] },
    { label: `Parents: when ${student.firstName} is ${rule('parent_escalation').days}+ days late`, ids: ['parent_escalation'] },
  ]
  const row = 'flex min-h-11 items-center justify-between gap-3 border-t border-line text-sm first:border-t-0'
  return (
    <Section n={n} title="Reminders">
      <p className="text-[13px] text-muted">What goes out about approved tasks. These rules apply to every student.</p>
      <div>
        {rows.map((r) => (
          <label key={r.label} className={row}>
            {r.label}
            <input type="checkbox" className="h-5 w-5" checked={r.ids.every(on)} onChange={(e) => toggle(r.ids, e.target.checked)} />
          </label>
        ))}
        <label className={row}>
          Ask me before each one goes out
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={askFirst}
            onChange={(e) => rules.filter((r) => r.mode !== 'off').forEach((r) => updateRule(r.id, { mode: e.target.checked ? 'needs_approval' : 'automatic' }))}
          />
        </label>
      </div>
      <p className="text-xs text-muted">
        v0 has no scheduler and does not deliver messages. Due reminders collect in{' '}
        <Link to="/app/messages?tab=queue" className="font-semibold text-accent underline">
          Messages sent, Queue
        </Link>
        .
      </p>
    </Section>
  )
}
