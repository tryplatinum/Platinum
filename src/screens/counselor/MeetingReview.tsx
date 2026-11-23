// A completed meeting: the AI's notes and everything it drafted from them.
// Each draft is edited, approved or dismissed by the counselor. Approved items
// flow into the real task list, the profile, the parent reports and the
// student's recap; until then nothing leaves this page.

import { Link, Navigate, useParams } from 'react-router-dom'
import { Bilingual, ParentLine } from '../../components/Bilingual'
import {
  AiErrorNote,
  ApprovalNotice,
  ApprovalStamp,
  Button,
  Card,
  Empty,
  OwnerBadge,
  PageHeader,
  Pill,
  PlaceholderNote,
  ReviewTag,
  SourceBadge,
  Thinking,
  cx,
  inputBase, inputClass,
  useAi,
} from '../../components/ui'
import { formatDate, formatDateLong, formatTime } from '../../lib/dates'
import { findParent, findStudent, ownerLabel, pendingInMeeting } from '../../lib/derive'
import { CHANNEL_LABEL } from '../../lib/language'
import { draftFromMeeting } from '../../services/ai'
import { useData, useStore, type Decision } from '../../store/store'
import type { Approval, DraftTask, Meeting, OwnerType, Review, Student } from '../../types'

export default function MeetingReview() {
  const data = useData()
  const { studentId, meetingId } = useParams()
  const student = findStudent(data, studentId)
  const meeting = data.meetings.find((m) => m.id === meetingId && m.studentId === studentId)
  const setMeetingDrafts = useStore((s) => s.setMeetingDrafts)
  const approveAll = useStore((s) => s.approveAllInMeeting)
  const { busy, error, run } = useAi()
  const draft = () => run(async () => setMeetingDrafts(meeting!.id, await draftFromMeeting(data, meeting!, student!)))

  if (!student || !meeting) return <Navigate to="/app/students" replace />
  if (meeting.status === 'scheduled') return <Navigate to={`/app/students/${student.id}/meetings/${meeting.id}/brief`} replace />

  const pending = pendingInMeeting(meeting)
  const hasDrafts = Boolean(meeting.ai || meeting.recap)
  // Redrafting replaces every draft, so it is offered only while none has been reviewed.
  const untouched =
    Boolean(meeting.ai) &&
    meeting.recap?.review === 'pending' &&
    [...meeting.ai!.draftTasks, ...meeting.ai!.parentUpdates, ...meeting.ai!.profileChanges].every((x) => x.review === 'pending')

  return (
    <div className="max-w-5xl">
      <PageHeader
        back={{ to: `/app/students/${student.id}?tab=meetings`, label: `${student.firstName}’s meetings` }}
        title={meeting.title}
        subtitle={`${formatDateLong(meeting.date)}, ${formatTime(meeting.time)} · ${meeting.durationMin} min · ${
          meeting.aiAttended ? 'AI notetaker attended' : 'No AI notetaker'
        }`}
        actions={
          <>
            {untouched && meeting.transcript && (
              <Button onClick={draft} disabled={busy}>
                ✦ Redraft with AI
              </Button>
            )}
            {pending > 0 && (
              <Button variant="approve" onClick={() => approveAll(meeting.id)}>
                Approve all {pending} remaining
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 space-y-3">
        <AiErrorNote message={error} />
        {meeting.transcript && (
          <details className="rounded-xl border border-line bg-surface">
            <summary className="px-4 py-3 text-sm font-medium text-ink">What the AI reads: notes from this meeting</summary>
            <p className="whitespace-pre-wrap border-t border-line px-4 py-3 font-mono text-[13px] leading-relaxed text-muted">{meeting.transcript}</p>
          </details>
        )}
      </div>

      {!hasDrafts && (
        <Card>
          {busy ? (
            <Thinking label="AI is reading the meeting and drafting follow-ups…" />
          ) : meeting.aiAttended ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-ink">The AI notetaker recorded this meeting. Its notes have not been processed yet.</p>
              <Button
                variant="primary"
                className="mt-3"
                onClick={draft}
              >
                ✦ Draft notes and follow-ups
              </Button>
              <p className="mt-2 text-xs text-faint">You will review everything before anyone else sees it.</p>
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-muted">
              {meeting.counselorNotes && <p className="mb-2 italic">“{meeting.counselorNotes}”</p>}
              The AI notetaker did not attend this meeting.{' '}
              <Link to="/app/notes" className="text-accent underline">
                Paste your own notes
              </Link>{' '}
              to turn them into tasks.
            </div>
          )}
        </Card>
      )}

      {hasDrafts && busy && (
        <Card tone="ai" className="mb-6">
          <Thinking label="AI is reading the meeting and drafting follow-ups…" />
        </Card>
      )}

      {hasDrafts && (
        <div className="space-y-6">
          <PlaceholderNote source={meeting.ai?.source} />
          {pending > 0 ? (
            <ApprovalNotice>
              <strong>{pending} drafts are waiting for you.</strong> Nothing on this page has reached {student.firstName} or{' '}
              {student.parents.length > 1 ? 'the parents' : 'the parent'}. Edit anything, then approve or dismiss each item.
            </ApprovalNotice>
          ) : (
            <div className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
              ✓ Everything from this meeting has been reviewed. Approved items are now in {student.firstName}’s tasks, profile, recap and parent reports.
            </div>
          )}

          {meeting.ai && (
            <Card tone="ai" title="Meeting notes" action={
                <span className="flex items-center gap-2">
                  <Pill>Private to you</Pill>
                  <SourceBadge source={meeting.ai.source} />
                </span>
              }>
              <ul className="space-y-2 px-4 py-4">
                {meeting.ai.notes.map((n) => (
                  <li key={n} className="flex gap-2 text-sm leading-relaxed text-ink">
                    <span className="text-ai">•</span>
                    {n}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {meeting.ai && (
            <Card tone="ai" title={`Drafted tasks (${meeting.ai.draftTasks.length})`} action={<SourceBadge source={meeting.ai.source} />}>
              {meeting.ai.draftTasks.length === 0 && <Empty>No tasks drafted.</Empty>}
              <ul>
                {meeting.ai.draftTasks.map((t) => (
                  <DraftTaskRow key={t.id} meeting={meeting} student={student} draft={t} />
                ))}
              </ul>
            </Card>
          )}

          {meeting.recap && <RecapCard meeting={meeting} student={student} />}

          {meeting.ai && meeting.ai.parentUpdates.length > 0 && (
            <Card tone="ai" title="Drafted parent updates" action={<SourceBadge source={meeting.ai.source} />}>
              {meeting.ai.parentUpdates.map((u) => (
                <ParentUpdateRow key={u.id} meeting={meeting} student={student} updateId={u.id} />
              ))}
            </Card>
          )}

          {meeting.ai && meeting.ai.profileChanges.length > 0 && (
            <Card tone="ai" title="Suggested profile changes" action={<SourceBadge source={meeting.ai.source} />}>
              <ul>
                {meeting.ai.profileChanges.map((c) => (
                  <ProfileChangeRow key={c.id} meetingId={meeting.id} change={c} />
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

/** Approve / dismiss buttons while pending; the outcome afterwards. */
function ReviewControls({
  review,
  onDecide,
  approveLabel = 'Approve',
  approvedLabel,
  approval,
}: {
  review: Review
  approval?: Approval
  onDecide: (decision: Decision) => void
  approveLabel?: string
  approvedLabel?: string
}) {
  if (review !== 'pending') {
    return (
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <ApprovalStamp approval={approval} />
        <ReviewTag review={review} approvedLabel={approvedLabel} />
      </span>
    )
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <Button size="sm" variant="approve" onClick={() => onDecide('approved')}>
        {approveLabel}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onDecide('dismissed')}>
        Dismiss
      </Button>
    </span>
  )
}

function DraftTaskRow({ meeting, student, draft }: { meeting: Meeting; student: Student; draft: DraftTask }) {
  const updateDraftTask = useStore((s) => s.updateDraftTask)
  const reviewDraftTask = useStore((s) => s.reviewDraftTask)
  const locked = draft.review !== 'pending'
  const ownerKey = draft.owner === 'parent' ? `parent:${draft.ownerParentId}` : draft.owner
  const patch = (p: Partial<DraftTask>) => updateDraftTask(meeting.id, draft.id, p)

  // Once reviewed, the draft is a record: show it as text, not as form fields.
  if (locked) {
    return (
      <li className={cx('flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0', draft.review === 'dismissed' && 'opacity-50')}>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{draft.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <OwnerBadge owner={draft.owner} label={ownerLabel(draft, student)} />
            Due {formatDate(draft.dueDate)}
          </p>
        </div>
        <ReviewControls review={draft.review} approval={draft.approval} onDecide={() => {}} approvedLabel="Added to tasks" />
      </li>
    )
  }

  return (
    <li className={cx('border-b border-line px-4 py-3 last:border-b-0', draft.review === 'dismissed' && 'opacity-50')}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={cx(inputBase, 'min-w-[16rem] flex-1 font-medium', locked && 'border-transparent bg-transparent px-0')}
          value={draft.title}
          disabled={locked}
          onChange={(e) => patch({ title: e.target.value })}
          aria-label="Task title"
        />
        <select
          className={cx(inputBase, 'w-auto', locked && 'border-transparent bg-transparent')}
          value={ownerKey}
          disabled={locked}
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
          <option value="counselor">Counselor</option>
        </select>
        <input
          type="date"
          className={cx(inputBase, 'w-auto', locked && 'border-transparent bg-transparent')}
          value={draft.dueDate}
          disabled={locked}
          aria-label="Due date"
          onChange={(e) => e.target.value && patch({ dueDate: e.target.value })}
        />
        <ReviewControls review={draft.review} approval={draft.approval} onDecide={(d) => reviewDraftTask(meeting.id, draft.id, d)} approvedLabel="Added to tasks" />
      </div>
      {draft.detail && <p className="mt-1 text-xs text-muted">{draft.detail}</p>}
      {draft.dueDateBasis === 'inferred' && !locked && (
        <p className="mt-1 text-xs text-warn">The notes gave no date for this one, so the AI suggested it. Please check.</p>
      )}
    </li>
  )
}

function RecapCard({ meeting, student }: { meeting: Meeting; student: Student }) {
  const updateRecap = useStore((s) => s.updateRecap)
  const reviewRecap = useStore((s) => s.reviewRecap)
  const recap = meeting.recap!
  const locked = recap.review !== 'pending'

  return (
    <Card
      tone={locked ? undefined : 'ai'}
      title={`Recap for ${student.firstName}`}
      action={
        <span className="flex items-center gap-2">
          {!locked && <SourceBadge source={meeting.ai?.source} />}
          <ReviewControls
            review={recap.review}
            approval={recap.approval}
            onDecide={(d) => reviewRecap(meeting.id, d)}
            approveLabel={`Approve and share with ${student.firstName}`}
            approvedLabel={`Shared with ${student.firstName}`}
          />
        </span>
      }
    >
      <div className="space-y-3 px-4 py-4">
        {locked ? (
          <>
            <p className="text-sm leading-relaxed text-ink">{recap.summary}</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
              {recap.nextSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <textarea
              className={cx(inputClass, 'leading-relaxed')}
              rows={4}
              value={recap.summary}
              onChange={(e) => updateRecap(meeting.id, { summary: e.target.value })}
              aria-label="Recap summary"
            />
            <div>
              <p className="mb-1 text-xs font-medium text-muted">Next steps (one per line)</p>
              <textarea
                className={cx(inputClass, 'leading-relaxed')}
                rows={Math.max(3, recap.nextSteps.length + 1)}
                value={recap.nextSteps.join('\n')}
                onChange={(e) => updateRecap(meeting.id, { nextSteps: e.target.value.split('\n') })}
                onBlur={() => updateRecap(meeting.id, { nextSteps: recap.nextSteps.map((s) => s.trim()).filter(Boolean) })}
                aria-label="Next steps"
              />
            </div>
            <p className="text-xs text-faint">{student.firstName} sees this in the student view only after you approve it.</p>
          </>
        )}
      </div>
    </Card>
  )
}

function ParentUpdateRow({ meeting, student, updateId }: { meeting: Meeting; student: Student; updateId: string }) {
  const updateParentUpdate = useStore((s) => s.updateParentUpdate)
  const reviewParentUpdate = useStore((s) => s.reviewParentUpdate)
  const update = meeting.ai!.parentUpdates.find((u) => u.id === updateId)!
  const parent = findParent(student, update.parentId)
  if (!parent) return null

  return (
    <div className={cx('border-b border-line px-4 py-4 last:border-b-0', update.review === 'dismissed' && 'opacity-50')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <ParentLine parent={parent} />
        <ReviewControls
          review={update.review}
          approval={update.approval}
          onDecide={(d) => reviewParentUpdate(meeting.id, update.id, d)}
          approveLabel={`Approve and send via ${CHANNEL_LABEL[parent.channel]}`}
          approvedLabel={`Sent via ${CHANNEL_LABEL[parent.channel]}`}
        />
      </div>
      <Bilingual
        language={parent.language}
        en={update.bodyEn}
        local={update.bodyLocal}
        editable={update.review === 'pending'}
        onChangeEn={(bodyEn) => updateParentUpdate(meeting.id, update.id, { bodyEn })}
        onChangeLocal={(bodyLocal) => updateParentUpdate(meeting.id, update.id, { bodyLocal })}
      />
    </div>
  )
}

function ProfileChangeRow({ meetingId, change }: { meetingId: string; change: NonNullable<Meeting['ai']>['profileChanges'][number] }) {
  const reviewProfileChange = useStore((s) => s.reviewProfileChange)
  return (
    <li className={cx('flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0', change.review === 'dismissed' && 'opacity-50')}>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted">{change.label}</p>
        <p className="text-sm text-ink">
          <span className="text-muted line-through">{change.from}</span>
          <span className="mx-2 text-faint">→</span>
          <span className="font-medium">{change.to}</span>
        </p>
        <p className="mt-0.5 text-xs italic text-muted">Heard in the meeting: {change.evidence}</p>
      </div>
      <ReviewControls review={change.review} approval={change.approval} onDecide={(d) => reviewProfileChange(meetingId, change.id, d)} approveLabel="Approve change" approvedLabel="Profile updated" />
    </li>
  )
}
