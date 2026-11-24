// Approvals: the counselor's home. Every AI draft and pending send is reviewed
// here — edited, approved or discarded — before anything leaves the firm.

import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { previewStudentLink } from '../../../shared/dispatch'
import { outboxStatusLabel } from '../../../shared/outbox'
import { Button, Card, CardHeader, Empty, Modal, PageHeader, Pill, cx, inputBase, textareaClass, useToast } from '../../components/ui'
import { formatTimestamp } from '../../lib/dates'
import { APPROVAL_TYPE_LABEL, allPendingApprovals, approvalGroups, findStudent, fullName, type ApprovalItem } from '../../lib/derive'
import { CHANNEL_LABEL, LANGUAGE_LABEL } from '../../lib/language'
import { reminderQueue } from '../../lib/reminders'
import { filesWaitingCount } from '../../lib/files'
import { useData, useStore } from '../../store/store'
import type { DraftParentUpdate, DraftTask, OutboxMessage, ProfileChange, ProfilePatch } from '../../types'

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
      <CardHeader size="section" className="border-b border-line px-5 py-4" title="Waiting on other screens" sub="These stay on William’s queues. Open them there to review." />
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
  const data = useData()
  const toast = useToast()
  const student = findStudent(data, studentId)
  const [confirmAll, setConfirmAll] = useState(false)
  const sends = items.filter((i) => i.isSend).length

  if (!student) return null

  const approveAll = () => {
    for (const item of items) approveItem(item)
    toast(sends > 0 ? `Approved ${items.length}. ${sends} ${sends === 1 ? 'message is' : 'messages are'} queued.` : `Approved ${items.length}.`)
    setConfirmAll(false)
  }

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
        action={
          items.length > 1 && (
            <Button variant="primary" onClick={() => setConfirmAll(true)}>
              Approve all
            </Button>
          )
        }
      />
      <ul>
        {items.map((item) => (
          <ApprovalRow key={item.key} item={item} />
        ))}
      </ul>
      {confirmAll && (
        <Modal title="Approve all in this group?" onClose={() => setConfirmAll(false)}>
          <p className="text-sm text-ink-soft">
            {items.length} {items.length === 1 ? 'item' : 'items'}
            {sends > 0 ? `, including ${sends} ${sends === 1 ? 'message' : 'messages'} that will be queued to send.` : '.'} Each send still gets its own 60-second undo window.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={approveAll}>
              Approve {items.length}
            </Button>
            <Button onClick={() => setConfirmAll(false)}>Cancel</Button>
          </div>
        </Modal>
      )}
    </Card>
  )
}

function ApprovalRow({ item }: { item: ApprovalItem }) {
  const data = useData()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const student = findStudent(data, item.studentId)
  const profile = item.kind === 'profile' && item.meetingId && item.draftId
    ? data.meetings.find((m) => m.id === item.meetingId)?.ai?.profileChanges.find((c) => c.id === item.draftId)
    : undefined

  const onApprove = () => {
    void Promise.resolve(approveItem(item))
      .then(() => toast(item.isSend ? `Approved. Undo is on the toast.` : `Approved.`))
      .catch((error: unknown) => toast(error instanceof Error ? error.message : 'Could not approve.'))
  }

  const onDiscard = () => {
    void Promise.resolve(discardItem(item))
      .then(() => {
        setDiscarding(false)
        toast('Discarded.')
      })
      .catch((error: unknown) => toast(error instanceof Error ? error.message : 'Could not discard.'))
  }

  const onSkip = async (mode: 'once' | 'until_on') => {
    if (!item.reminderKey) return
    const draft = reminderQueue(data).find((r) => r.key === item.reminderKey)
    setSkipping(false)
    try {
      await useStore.getState().skipReminder(item.reminderKey, mode, item.studentId, draft?.taskTitle ?? 'task')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not skip the reminder.')
    }
  }

  return (
    <li className="flex flex-col gap-2 border-t border-line px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill>{APPROVAL_TYPE_LABEL[item.kind]}</Pill>
            {item.toName && (
              <span className="text-[13px] text-muted">
                To {item.toName}
                {item.channel && ` · ${CHANNEL_LABEL[item.channel]}`}
                {item.language && item.language !== 'en' && ` · ${LANGUAGE_LABEL[item.language]}`}
              </span>
            )}
          </div>
          {profile ? (
            <div className="mt-1 text-sm leading-relaxed">
              <p className="font-medium">{profile.label}</p>
              <p className="mt-0.5">
                <span className="text-muted line-through">{profile.from}</span> → <span className="font-semibold">{profile.to}</span>
              </p>
            </div>
          ) : (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{previewStudentLink(item.preview)}</p>
          )}
          <p className="mt-1 text-[13px] text-muted">{item.sourceLine}</p>
          {item.rationale && item.kind.startsWith('agent_') && (
            <p className="mt-1 text-[13px] text-ink-soft">Why: {item.rationale}</p>
          )}
          {item.sourcesLine && (
            <p className="mt-0.5 text-[13px] text-muted">Sources: {item.sourcesLine}</p>
          )}
        </div>
        <span className="flex flex-wrap gap-1.5">
          <Button variant="primary" onClick={onApprove}>
            Approve
          </Button>
          {canEdit(item) && (
            <Button onClick={() => setEditing(!editing)} aria-expanded={editing}>
              {editing ? 'Done' : 'Edit'}
            </Button>
          )}
          {item.kind === 'reminder' && (
            <Button onClick={() => setSkipping(true)}>Skip</Button>
          )}
          {canDiscard(item) && (
            <Button variant="quiet" onClick={() => setDiscarding(true)}>
              Discard
            </Button>
          )}
        </span>
      </div>
      {editing && student && <EditPanel item={item} onClose={() => setEditing(false)} />}
      {discarding && (
        <Modal title="Discard this draft?" onClose={() => setDiscarding(false)}>
          <p className="text-sm text-ink-soft">It will leave the queue and will not be sent or saved.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={onDiscard}>
              Discard
            </Button>
            <Button onClick={() => setDiscarding(false)}>Keep it</Button>
          </div>
        </Modal>
      )}
      {skipping && (
        <Modal title="Skip this reminder?" onClose={() => setSkipping(false)}>
          <p className="text-sm text-ink-soft">It leaves the Approvals queue. You can undo from the toast.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button variant="primary" onClick={() => void onSkip('once')}>
              Skip this time
            </Button>
            <Button onClick={() => void onSkip('until_on')}>Skip until I turn it back on</Button>
            <Button variant="quiet" onClick={() => setSkipping(false)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </li>
  )
}

function canEdit(item: ApprovalItem): boolean {
  // Reminders use fixed wording — Skip instead of edit.
  return item.kind !== 'reminder'
}

function canDiscard(item: ApprovalItem): boolean {
  return item.kind !== 'reminder'
}

function EditPanel({ item, onClose }: { item: ApprovalItem; onClose: () => void }) {
  const data = useData()
  const store = useStore.getState()

  if (item.kind === 'notes' && item.meetingId) {
    const ai = data.meetings.find((m) => m.id === item.meetingId)?.ai
    if (!ai) return null
    const lines = (xs: string[]) => xs.join('\n')
    const parse = (raw: string) => raw.split('\n').map((s) => s.trim()).filter(Boolean)
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
        <label className="block text-[13px] font-semibold text-muted">
          Decided
          <textarea className={cx(textareaClass, 'mt-1')} rows={3} value={lines(ai.decided)} onChange={(e) => store.updateMeetingNotes(item.meetingId!, { decided: parse(e.target.value) })} />
        </label>
        <label className="block text-[13px] font-semibold text-muted">
          Progress
          <textarea className={cx(textareaClass, 'mt-1')} rows={3} value={lines(ai.progress)} onChange={(e) => store.updateMeetingNotes(item.meetingId!, { progress: parse(e.target.value) })} />
        </label>
        <label className="block text-[13px] font-semibold text-muted">
          Watch
          <textarea className={cx(textareaClass, 'mt-1')} rows={3} value={lines(ai.watch)} onChange={(e) => store.updateMeetingNotes(item.meetingId!, { watch: parse(e.target.value) })} />
        </label>
        <label className="block text-[13px] font-semibold text-muted">
          Full notes (private)
          <textarea className={cx(textareaClass, 'mt-1')} rows={4} value={lines(ai.notes)} onChange={(e) => store.updateMeetingNotes(item.meetingId!, { notes: parse(e.target.value) })} />
        </label>
        <Button className="self-start" onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  if (item.kind === 'profile' && item.meetingId && item.draftId) {
    const change = data.meetings.find((m) => m.id === item.meetingId)?.ai?.profileChanges.find((c) => c.id === item.draftId)
    if (!change) return null
    return <ProfileChangeEditor meetingId={item.meetingId} change={change} onClose={onClose} />
  }

  if (item.kind === 'task' && item.meetingId && item.draftId) {
    const draft = data.meetings.find((m) => m.id === item.meetingId)?.ai?.draftTasks.find((t) => t.id === item.draftId)
    if (!draft) return null
    const patch = (p: Partial<DraftTask>) => store.updateDraftTask(item.meetingId!, item.draftId!, p)
    return (
      <div className="flex flex-wrap gap-2 rounded-lg bg-canvas p-3">
        <input className={cx(inputBase, 'min-w-[14rem] flex-1')} value={draft.title} onChange={(e) => patch({ title: e.target.value })} aria-label="Task" />
        <input className={inputBase} type="date" value={draft.dueDate} onChange={(e) => patch({ dueDate: e.target.value, dueDateBasis: 'stated' })} aria-label="Due date" />
        <textarea className={cx(textareaClass, 'w-full')} rows={2} value={draft.detail ?? ''} onChange={(e) => patch({ detail: e.target.value })} aria-label="Detail" />
        <Button onClick={onClose}>Done</Button>
      </div>
    )
  }

  if (item.kind === 'parent_update' && item.meetingId && item.draftId) {
    const draft = data.meetings.find((m) => m.id === item.meetingId)?.ai?.parentUpdates.find((u) => u.id === item.draftId)
    if (!draft) return null
    const patch = (p: Partial<DraftParentUpdate>) => store.updateParentUpdate(item.meetingId!, item.draftId!, p)
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
        <textarea className={textareaClass} rows={4} value={draft.bodyEn} onChange={(e) => patch({ bodyEn: e.target.value })} aria-label="English body" />
        {draft.bodyLocal !== undefined && (
          <textarea className={textareaClass} rows={4} value={draft.bodyLocal} onChange={(e) => patch({ bodyLocal: e.target.value })} aria-label="Local body" />
        )}
        <Button className="self-start" onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  if (item.kind === 'recap' && item.meetingId) {
    const recap = data.meetings.find((m) => m.id === item.meetingId)?.recap
    if (!recap) return null
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
        <textarea className={textareaClass} rows={4} value={recap.summary} onChange={(e) => store.updateRecap(item.meetingId!, { summary: e.target.value })} aria-label="Recap" />
        <label className="block text-[13px] font-semibold text-muted">
          Next steps, one per line
          <textarea
            className={cx(textareaClass, 'mt-1')}
            rows={Math.max(3, recap.nextSteps.length + 1)}
            value={recap.nextSteps.join('\n')}
            onChange={(e) => store.updateRecap(item.meetingId!, { nextSteps: e.target.value.split('\n') })}
            onBlur={() => store.updateRecap(item.meetingId!, { nextSteps: recap.nextSteps.map((s) => s.trim()).filter(Boolean) })}
          />
        </label>
        <Button className="self-start" onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  if (item.kind === 'remember' && item.meetingId && item.draftId) {
    const note = data.meetings.find((m) => m.id === item.meetingId)?.ai?.personalNotes?.find((n) => n.id === item.draftId)
    if (!note) return null
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
        <textarea className={textareaClass} rows={2} value={note.text} onChange={(e) => store.updateDraftNote(item.meetingId!, item.draftId!, { text: e.target.value })} aria-label="Note" />
        <Button className="self-start" onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  if (item.kind === 'report' && item.reportId) {
    const report = data.reports.find((r) => r.id === item.reportId)
    if (!report) return null
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
        <input className={inputBase} value={report.subject} onChange={(e) => store.updateReport(report.id, { subject: e.target.value })} aria-label="Subject" />
        <textarea className={textareaClass} rows={5} value={report.bodyEn} onChange={(e) => store.updateReport(report.id, { bodyEn: e.target.value })} aria-label="English body" />
        {report.bodyLocal !== undefined && (
          <textarea className={textareaClass} rows={5} value={report.bodyLocal} onChange={(e) => store.updateReport(report.id, { bodyLocal: e.target.value })} aria-label="Local body" />
        )}
        <Button className="self-start" onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  if (item.kind === 'essay' && item.docId) {
    const doc = data.documents.find((d) => d.id === item.docId)
    if (!doc?.feedback) return null
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
        <textarea className={textareaClass} rows={4} value={doc.feedback.overall} onChange={(e) => store.updateEssayFeedback(doc.id, { overall: e.target.value })} aria-label="Feedback" />
        <Button className="self-start" onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  if (item.kind === 'weekly_text' && item.weeklyTextId) {
    const text = data.weeklyTexts.find((w) => w.id === item.weeklyTextId)
    if (!text) return null
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
        <textarea className={textareaClass} rows={4} value={text.body} onChange={(e) => store.updateWeeklyText(text.id, e.target.value)} aria-label="Weekly text" />
        <Button className="self-start" onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  if (item.kind === 'weekly_parent' && item.weeklyTextId) {
    const text = data.weeklyTexts.find((w) => w.id === item.weeklyTextId)
    const copy = text?.parentCopy
    if (!copy) return null
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
        <textarea className={textareaClass} rows={4} value={copy.body} onChange={(e) => store.updateWeeklyParentCopy(text.id, { body: e.target.value })} aria-label="Parent copy" />
        <Button className="self-start" onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  if (item.proposalId && item.kind.startsWith('agent_')) {
    const proposal = data.agentProposals.find((p) => p.id === item.proposalId)
    if (!proposal) return null
    const payload = proposal.payload
    const save = (next: Record<string, unknown>) => store.updateAgentProposal(proposal.id, next)
    if (item.kind === 'agent_message' || item.kind === 'agent_parent_update') {
      return (
        <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
          <textarea
            className={textareaClass}
            rows={4}
            value={String(payload.body ?? '')}
            onChange={(e) => save({ ...payload, body: e.target.value })}
            aria-label="Message body"
          />
          {typeof payload.bodyEn === 'string' && (
            <textarea
              className={textareaClass}
              rows={4}
              value={payload.bodyEn}
              onChange={(e) => save({ ...payload, bodyEn: e.target.value })}
              aria-label="English body"
            />
          )}
          <Button className="self-start" onClick={onClose}>
            Done
          </Button>
        </div>
      )
    }
    if (item.kind === 'agent_task') {
      return (
        <div className="flex flex-wrap gap-2 rounded-lg bg-canvas p-3">
          <input className={cx(inputBase, 'min-w-[14rem] flex-1')} value={String(payload.title ?? '')} onChange={(e) => save({ ...payload, title: e.target.value })} aria-label="Task" />
          <input className={inputBase} type="date" value={String(payload.dueDate ?? '')} onChange={(e) => save({ ...payload, dueDate: e.target.value })} aria-label="Due date" />
          <textarea className={cx(textareaClass, 'w-full')} rows={2} value={String(payload.detail ?? '')} onChange={(e) => save({ ...payload, detail: e.target.value })} aria-label="Detail" />
          <Button onClick={onClose}>Done</Button>
        </div>
      )
    }
    if (item.kind === 'agent_profile_change') {
      return (
        <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
          <label className="text-[13px] font-semibold text-muted">
            Proposed value (was {String(payload.from ?? '')})
            <input
              className={cx(inputBase, 'mt-1 w-full')}
              value={String(payload.to ?? '')}
              onChange={(e) => {
                const to = e.target.value
                const patch = payload.patch as { kind?: string; field?: string; value?: unknown } | undefined
                if (patch?.kind === 'score' && patch.field) {
                  const value = Number(to)
                  if (Number.isFinite(value)) save({ ...payload, to, patch: { ...patch, value } })
                  else save({ ...payload, to })
                } else if (patch?.kind === 'setMajors') {
                  save({ ...payload, to, patch: { kind: 'setMajors', value: to.split(',').map((s) => s.trim()).filter(Boolean) } })
                } else if (patch?.kind === 'addInterest') {
                  save({ ...payload, to, patch: { kind: 'addInterest', value: to.trim() } })
                } else {
                  save({ ...payload, to })
                }
              }}
            />
          </label>
          <Button className="self-start" onClick={onClose}>
            Done
          </Button>
        </div>
      )
    }
    if (item.kind === 'agent_meeting_times') {
      const slots = Array.isArray(payload.slots) ? (payload.slots as { when: string; reason: string }[]) : []
      return (
        <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
          {slots.map((slot, i) => (
            <div key={i} className="flex flex-col gap-1">
              <input
                className={inputBase}
                value={slot.when}
                onChange={(e) => {
                  const next = slots.map((s, j) => (j === i ? { ...s, when: e.target.value } : s))
                  save({ ...payload, slots: next })
                }}
                aria-label={`Slot ${i + 1} when`}
              />
              <input
                className={inputBase}
                value={slot.reason}
                onChange={(e) => {
                  const next = slots.map((s, j) => (j === i ? { ...s, reason: e.target.value } : s))
                  save({ ...payload, slots: next })
                }}
                aria-label={`Slot ${i + 1} reason`}
              />
            </div>
          ))}
          <Button className="self-start" onClick={onClose}>
            Done
          </Button>
        </div>
      )
    }
  }

  return null
}

/** Proposed-value editor matching ProfileTab field kinds (score, majors, interest, activity). */
function ProfileChangeEditor({ meetingId, change, onClose }: { meetingId: string; change: ProfileChange; onClose: () => void }) {
  const update = useStore((s) => s.updateProfileChange)
  const patch = change.patch

  const save = (next: { to: string; patch: ProfilePatch }) => update(meetingId, change.id, next)

  if (patch.kind === 'score') {
    return (
      <div className="flex flex-wrap items-end gap-2 rounded-lg bg-canvas p-3">
        <label className="text-[13px] font-semibold text-muted">
          {change.label} (was {change.from})
          <input
            className={cx(inputBase, 'mt-1 block')}
            inputMode="decimal"
            value={change.to}
            onChange={(e) => {
              const value = Number(e.target.value)
              if (!Number.isFinite(value)) return
              save({ to: e.target.value, patch: { kind: 'score', field: patch.field, value } })
            }}
            aria-label="Proposed value"
          />
        </label>
        <Button onClick={onClose}>Done</Button>
      </div>
    )
  }

  if (patch.kind === 'setMajors') {
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
        <label className="text-[13px] font-semibold text-muted">
          Intended majors (was {change.from})
          <input
            className={cx(inputBase, 'mt-1 w-full')}
            value={change.to}
            onChange={(e) => {
              const value = e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
              save({ to: e.target.value, patch: { kind: 'setMajors', value } })
            }}
          />
        </label>
        <Button className="self-start" onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  if (patch.kind === 'addInterest') {
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
        <label className="text-[13px] font-semibold text-muted">
          Interest to add
          <input
            className={cx(inputBase, 'mt-1 w-full')}
            value={change.to}
            onChange={(e) => save({ to: e.target.value, patch: { kind: 'addInterest', value: e.target.value.trim() } })}
          />
        </label>
        <Button className="self-start" onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  // addActivity
  const activity = patch.activity
  return (
    <div className="flex flex-wrap gap-2 rounded-lg bg-canvas p-3">
      <input
        className={cx(inputBase, 'min-w-[10rem] flex-1')}
        placeholder="Activity"
        aria-label="Activity"
        value={activity.name}
        onChange={(e) => {
          const next = { ...activity, name: e.target.value }
          save({ to: `${next.name}${next.role ? ` · ${next.role}` : ''}`, patch: { kind: 'addActivity', activity: next } })
        }}
      />
      <input
        className={cx(inputBase, 'min-w-[8rem] flex-1')}
        placeholder="Role"
        aria-label="Role"
        value={activity.role}
        onChange={(e) => {
          const next = { ...activity, role: e.target.value }
          save({ to: `${next.name}${next.role ? ` · ${next.role}` : ''}`, patch: { kind: 'addActivity', activity: next } })
        }}
      />
      <input
        className={cx(inputBase, 'min-w-[10rem] flex-[2]')}
        placeholder="Detail (optional)"
        aria-label="Detail"
        value={activity.detail ?? ''}
        onChange={(e) => {
          const next = { ...activity, detail: e.target.value || undefined }
          save({ to: `${next.name}${next.role ? ` · ${next.role}` : ''}`, patch: { kind: 'addActivity', activity: next } })
        }}
      />
      <Button onClick={onClose}>Done</Button>
    </div>
  )
}

function approveItem(item: ApprovalItem): void | Promise<void> {
  const s = useStore.getState()
  const data = s.data
  switch (item.kind) {
    case 'notes':
      if (item.meetingId) s.reviewNotes(item.meetingId, 'approved')
      break
    case 'task':
      if (item.meetingId && item.draftId) s.reviewDraftTask(item.meetingId, item.draftId, 'approved')
      break
    case 'parent_update':
      if (item.meetingId && item.draftId) s.reviewParentUpdate(item.meetingId, item.draftId, 'approved')
      break
    case 'recap':
      if (item.meetingId) s.reviewRecap(item.meetingId, 'approved')
      break
    case 'profile':
      if (item.meetingId && item.draftId) s.reviewProfileChange(item.meetingId, item.draftId, 'approved')
      break
    case 'remember':
      if (item.meetingId && item.draftId) s.reviewDraftNote(item.meetingId, item.draftId, 'approved')
      break
    case 'report':
      if (item.reportId) s.approveReport(item.reportId)
      break
    case 'essay':
      if (item.docId) s.reviewEssayFeedback(item.docId, 'approved')
      break
    case 'weekly_text':
      if (item.weeklyTextId) s.sendWeeklyText(item.weeklyTextId, 'copy')
      break
    case 'weekly_parent':
      if (item.weeklyTextId) s.sendWeeklyParentCopy(item.weeklyTextId)
      break
    case 'reminder': {
      const draft = reminderQueue(data).find((r) => r.key === item.reminderKey)
      if (draft) s.sendMessage({ ...draft.message, trigger: 'approved' })
      break
    }
    case 'agent_message':
    case 'agent_parent_update':
    case 'agent_task':
    case 'agent_profile_change':
    case 'agent_meeting_times':
      if (item.proposalId) return s.approveAgentProposal(item.proposalId)
      break
  }
}

function discardItem(item: ApprovalItem): void | Promise<void> {
  const s = useStore.getState()
  switch (item.kind) {
    case 'notes':
      if (item.meetingId) s.reviewNotes(item.meetingId, 'dismissed')
      break
    case 'task':
      if (item.meetingId && item.draftId) s.reviewDraftTask(item.meetingId, item.draftId, 'dismissed')
      break
    case 'parent_update':
      if (item.meetingId && item.draftId) s.reviewParentUpdate(item.meetingId, item.draftId, 'dismissed')
      break
    case 'recap':
      if (item.meetingId) s.reviewRecap(item.meetingId, 'dismissed')
      break
    case 'profile':
      if (item.meetingId && item.draftId) s.reviewProfileChange(item.meetingId, item.draftId, 'dismissed')
      break
    case 'remember':
      if (item.meetingId && item.draftId) s.reviewDraftNote(item.meetingId, item.draftId, 'dismissed')
      break
    case 'report':
      if (item.reportId) s.discardReport(item.reportId)
      break
    case 'essay':
      if (item.docId) s.reviewEssayFeedback(item.docId, 'dismissed')
      break
    case 'weekly_text': {
      const text = s.data.weeklyTexts.find((w) => w.id === item.weeklyTextId)
      if (text) s.skipWeeklyText(text.studentId, text.weekStart)
      break
    }
    case 'weekly_parent': {
      const text = s.data.weeklyTexts.find((w) => w.id === item.weeklyTextId)
      if (text) s.setWeeklyParentCopy(text.studentId, text.weekStart, undefined)
      break
    }
    case 'reminder':
      break
    case 'agent_message':
    case 'agent_parent_update':
    case 'agent_task':
    case 'agent_profile_change':
    case 'agent_meeting_times':
      if (item.proposalId) return s.discardAgentProposal(item.proposalId)
      break
  }
}
