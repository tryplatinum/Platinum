// One draft or pending send, with everything needed to decide it: the full
// text, who it goes to, why it was drafted, and Approve, Edit and Discard.
// The Inbox, the assistant panel and the student's own tabs all use this
// card, so a draft reads and is edited the same way wherever it is met.

import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { previewStudentLink } from '../../shared/dispatch'
import { outboxStatusLabel } from '../../shared/outbox'
import { deciding, rememberSend, useApprovalSends } from '../lib/approvalSends'
import { APPROVAL_TYPE_LABEL, findStudent, fullName, type ApprovalItem } from '../lib/derive'
import { CHANNEL_LABEL, LANGUAGE_LABEL } from '../lib/language'
import { reminderQueue } from '../lib/reminders'
import { translateProposal } from '../services/agentClient'
import { ProposalNotDecided, useData, useStore } from '../store/store'
import type { DraftParentUpdate, DraftTask, ID, ProfileChange, ProfilePatch } from '../types'
import { WeeklyTextSend, WeeklyTextSendNote, weeklyTextTooLong } from './WeeklyTextSend'
import { Button, Modal, Pill, cx, inputBase, textareaClass, useToast } from './ui'

const reasonOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/**
 * `children` takes the place of the plain preview, for a screen that shows more
 * of the draft. `compact` is the size for the assistant panel. `as` is the
 * element: a row in a list, or a block of its own.
 */
export function ApprovalCard({ item, as: Tag = 'li', compact, showStudent, className, children }: { item: ApprovalItem; as?: 'li' | 'div'; compact?: boolean; showStudent?: boolean; className?: string; children?: ReactNode }) {
  const data = useData()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const student = findStudent(data, item.studentId)
  const busy = useApprovalSends((s) => Boolean(item.proposalId && s.deciding[item.proposalId]))
  const messageId = useApprovalSends((s) => (item.proposalId ? s.messageOf[item.proposalId] : undefined))
  // A draft whose message is already on its way is not offered for approval again.
  const sending = data.outbox.some((m) => m.id === messageId && m.status !== 'cancelled') ? messageId : undefined
  const weekly = item.kind === 'weekly_text' ? data.weeklyTexts.find((w) => w.id === item.weeklyTextId) : undefined
  const profile = item.kind === 'profile' && item.meetingId && item.draftId
    ? data.meetings.find((m) => m.id === item.meetingId)?.ai?.profileChanges.find((c) => c.id === item.draftId)
    : undefined

  const onApprove = () => {
    void Promise.resolve(approveItem(item))
      .then(() => toast(item.isSend ? 'Approved. Sending in 60 seconds.' : 'Approved.'))
      .catch((error: unknown) => toast(reasonOf(error, 'Could not approve.')))
  }

  const onDiscard = () => {
    void Promise.resolve(discardItem(item))
      .then(() => {
        setDiscarding(false)
        toast(weekly ? 'Skipped this week.' : 'Discarded.')
      })
      .catch((error: unknown) => toast(reasonOf(error, weekly ? 'Could not skip the text.' : 'Could not discard.')))
  }

  const onSkip = async (mode: 'once' | 'until_on') => {
    if (!item.reminderKey) return
    const draft = reminderQueue(data).find((r) => r.key === item.reminderKey)
    setSkipping(false)
    try {
      await useStore.getState().skipReminder(item.reminderKey, mode, item.studentId, draft?.taskTitle ?? 'task')
    } catch (error) {
      toast(reasonOf(error, 'Could not skip the reminder.'))
    }
  }

  return (
    <Tag className={cx('flex flex-col gap-2', compact ? 'w-full' : 'px-5 py-4', Tag === 'li' && 'border-t border-line', className)}>
      <div className={cx('flex gap-2', compact ? 'flex-col' : 'flex-wrap items-start justify-between')}>
        <div className={cx('min-w-0', !compact && 'flex-1 basis-64')}>
          <div className="flex flex-wrap items-center gap-2">
            <Pill>{APPROVAL_TYPE_LABEL[item.kind]}</Pill>
            {showStudent && student && (
              <Link to={`/app/students/${student.id}`} className="text-[13px] font-semibold text-accent hover:underline">
                {fullName(student)}
              </Link>
            )}
            {item.toName && (
              <span className="text-[13px] text-muted">
                To {item.toName}
                {item.channel && ` · ${CHANNEL_LABEL[item.channel]}`}
                {item.language && item.language !== 'en' && ` · ${LANGUAGE_LABEL[item.language]}`}
              </span>
            )}
          </div>
          {children ? (
            <div className="mt-3">{children}</div>
          ) : profile ? (
            <div className="mt-1 text-sm leading-relaxed">
              <p className="font-medium">{profile.label}</p>
              <p className="mt-0.5">
                <span className="text-muted line-through">{profile.from}</span> → <span className="font-semibold">{profile.to}</span>
              </p>
            </div>
          ) : (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{previewStudentLink(item.preview)}</p>
          )}
          {/* The assistant's source line is its reason, which the panel shows once, below. */}
          {!children && !(compact && item.rationale) && <p className="mt-1 text-[13px] text-muted">{item.sourceLine}</p>}
          {(item.kind === 'agent_message' || item.kind === 'agent_parent_update') && item.language && item.language !== 'en' && item.proposalId && (
            <ShowInEnglish proposalId={item.proposalId} />
          )}
          {item.rationale && item.kind.startsWith('agent_') && (
            <p className="mt-1 text-[13px] text-ink-soft">Why: {item.rationale}</p>
          )}
          {item.sourcesLine && (
            <p className="mt-0.5 text-[13px] text-muted">Sources: {item.sourcesLine}</p>
          )}
          {weekly && student && <WeeklyTextSendNote student={student} />}
          {weekly && weeklyTextTooLong(weekly.body) && <p className="text-[13px] font-semibold text-bad">Too long for one text: shorten it.</p>}
        </div>
        <span className="flex flex-wrap items-center gap-1.5">
          {sending ? (
            <SendState messageId={sending} />
          ) : weekly ? (
            student && <WeeklyTextSend draft={weekly} student={student} text={weekly.body} />
          ) : (
            <Button variant="primary" onClick={onApprove} disabled={busy}>
              {item.isSend ? 'Approve and send' : 'Approve'}
            </Button>
          )}
          {canEdit(item) && !sending && (
            <Button onClick={() => setEditing(!editing)} aria-expanded={editing} disabled={busy}>
              {editing ? 'Done' : 'Edit'}
            </Button>
          )}
          {item.kind === 'reminder' && (
            <Button onClick={() => setSkipping(true)}>Skip</Button>
          )}
          {canDiscard(item) && (
            <Button variant="quiet" onClick={() => setDiscarding(true)} disabled={busy}>
              {weekly ? 'Skip' : 'Discard'}
            </Button>
          )}
        </span>
      </div>
      {editing && !sending && student && <EditPanel item={item} onClose={() => setEditing(false)} />}
      {discarding && (
        <Modal title={weekly ? 'Skip this week’s text?' : 'Discard this draft?'} onClose={() => setDiscarding(false)}>
          <p className="text-sm text-ink-soft">{weekly ? 'It will not be sent this week. You can take it back under “Done this week” in Weekly texts.' : 'It leaves the Inbox and will not be sent or saved.'}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={onDiscard}>
              {weekly ? 'Skip this week' : 'Discard'}
            </Button>
            <Button onClick={() => setDiscarding(false)}>Keep it</Button>
          </div>
        </Modal>
      )}
      {skipping && (
        <Modal title="Skip this reminder?" onClose={() => setSkipping(false)}>
          <p className="text-sm text-ink-soft">It leaves the Inbox. You can undo from the toast.</p>
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
    </Tag>
  )
}

/**
 * Where a message approved on this card stands: counting down with Undo, then
 * Sent or Cancelled. Undo cancels the same queued message the toast would.
 */
export function SendState({ messageId }: { messageId: ID }) {
  const message = useData().outbox.find((m) => m.id === messageId)
  const confirmed = useApprovalSends((s) => Boolean(s.confirmed[messageId]))
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const left = message?.status === 'queued' ? Math.ceil((Date.parse(message.sendAfter) - now) / 1000) : 0
  const counting = left > 0
  useEffect(() => {
    if (!counting) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [counting])

  if (!message) return <span className="text-[13px] font-semibold text-bad">Not queued. Nothing was sent.</span>
  if (!counting) return <span className="text-[13px] font-semibold text-ink">{message.status === 'queued' ? 'Approved. Sending now.' : outboxStatusLabel(message, now)}</span>
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="nums text-[13px] font-semibold text-ink">
        Approved. Sending in {left} {left === 1 ? 'second' : 'seconds'}.
      </span>
      <Button
        // The database has to have queued it before it can be cancelled.
        disabled={busy || !confirmed}
        onClick={() => {
          setBusy(true)
          void useStore
            .getState()
            .cancelQueued(messageId)
            .catch((error: unknown) => toast(reasonOf(error, 'Could not undo the message.')))
            .finally(() => setBusy(false))
        }}
      >
        Undo
      </Button>
    </span>
  )
}

/** "Approve all" for a group, with the confirmation that says how many items and how many messages. */
export function ApproveAll({ items, title = 'Approve all in this group?' }: { items: ApprovalItem[]; title?: string }) {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  // A weekly text is sent by hand, so it cannot be approved along with the rest.
  const approvable = items.filter((i) => i.kind !== 'weekly_text')
  const left = items.length - approvable.length
  const sends = approvable.filter((i) => i.isSend).length
  const leftLine = `${left} weekly ${left === 1 ? 'text is' : 'texts are'} left for you to send by hand.`
  if (items.length < 2 || approvable.length === 0) return null

  const approveAll = async () => {
    setConfirming(false)
    const results = await Promise.allSettled(approvable.map(async (item) => approveItem(item)))
    const failed = results.filter((r) => r.status === 'rejected')
    const sent = approvable.filter((item, i) => item.isSend && results[i]?.status === 'fulfilled').length
    toast(
      [
        `Approved ${approvable.length - failed.length}.`,
        sent > 0 && `${sent} ${sent === 1 ? 'message is' : 'messages are'} queued.`,
        left > 0 && leftLine,
        failed.length > 0 && `${failed.length} could not be approved. ${reasonOf(failed[0]?.reason, '')}`,
      ]
        .filter(Boolean)
        .join(' ')
        .trim(),
    )
  }

  return (
    <>
      <Button variant="primary" onClick={() => setConfirming(true)}>
        Approve all
      </Button>
      {confirming && (
        <Modal title={title} onClose={() => setConfirming(false)}>
          <p className="text-sm text-ink-soft">
            {approvable.length} {approvable.length === 1 ? 'item' : 'items'}
            {sends > 0 ? `, including ${sends} ${sends === 1 ? 'message' : 'messages'} that will be queued to send. Each message keeps its own 60-second Undo.` : '. No messages will be queued.'}
            {left > 0 && ` ${leftLine}`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void approveAll()}>
              {sends > 0 ? 'Approve and send' : 'Approve'} {approvable.length}
            </Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </Modal>
      )}
    </>
  )
}

function ShowInEnglish({ proposalId }: { proposalId: string }) {
  const data = useData()
  const toast = useToast()
  const proposal = data.agentProposals.find((row) => row.id === proposalId)
  const stored = typeof proposal?.payload.bodyEn === 'string' ? proposal.payload.bodyEn.trim() : ''
  const [english, setEnglish] = useState(stored)
  const [busy, setBusy] = useState(false)
  if (english) return <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{english}</p>
  return (
    <Button
      className="mt-2 self-start"
      disabled={busy}
      onClick={() => {
        setBusy(true)
        void translateProposal(proposalId)
          .then((bodyEn) => {
            setEnglish(bodyEn)
            if (proposal) useStore.getState().updateAgentProposal(proposal.id, { ...proposal.payload, bodyEn })
          })
          .catch((error: unknown) => toast(error instanceof Error ? error.message : 'Could not show the English.'))
          .finally(() => setBusy(false))
      }}
    >
      {busy ? 'Translating…' : 'Show in English'}
    </Button>
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
    const feedback = doc?.feedback
    if (!feedback) return null
    const patchPoint = (i: number, fields: { observation?: string; question?: string }) =>
      store.updateEssayFeedback(doc.id, { points: feedback.points.map((p, j) => (j === i ? { ...p, ...fields } : p)) })
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
        <label className="block text-[13px] font-semibold text-muted">
          Overall
          <textarea className={cx(textareaClass, 'mt-1 font-normal')} rows={4} value={feedback.overall} onChange={(e) => store.updateEssayFeedback(doc.id, { overall: e.target.value })} />
        </label>
        <label className="block text-[13px] font-semibold text-muted">
          What works, one per line
          <textarea
            className={cx(textareaClass, 'mt-1 font-normal')}
            rows={Math.max(2, feedback.strengths.length + 1)}
            value={feedback.strengths.join('\n')}
            onChange={(e) => store.updateEssayFeedback(doc.id, { strengths: e.target.value.split('\n') })}
            onBlur={() => store.updateEssayFeedback(doc.id, { strengths: feedback.strengths.map((s) => s.trim()).filter(Boolean) })}
          />
        </label>
        {feedback.points.map((p, i) => (
          <fieldset key={i} className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-semibold text-muted">
              {p.area}
              {p.location && ` · ${p.location}`}
            </legend>
            <textarea className={textareaClass} rows={2} aria-label={`Question ${i + 1}`} value={p.question} onChange={(e) => patchPoint(i, { question: e.target.value })} />
            <textarea className={textareaClass} rows={2} aria-label={`Observation ${i + 1}`} value={p.observation} onChange={(e) => patchPoint(i, { observation: e.target.value })} />
          </fieldset>
        ))}
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

/**
 * Approves an assistant draft through the store, and notes which message it
 * queued. If the message was queued but the decision was not saved, the card
 * still offers Undo for it, and no second approval.
 */
async function approveProposal(id: ID): Promise<void> {
  return deciding(id, async () => {
    const outbox = useStore.getState().data.outbox
    const earlier = useApprovalSends.getState().messageOf[id]
    if (earlier && outbox.some((m) => m.id === earlier && m.status !== 'cancelled')) throw new Error('This message is already queued.')
    try {
      const messageId = await useStore.getState().approveAgentProposal(id)
      if (messageId) rememberSend(id, messageId)
    } catch (error) {
      if (error instanceof ProposalNotDecided) rememberSend(id, error.messageId)
      throw error
    }
  })
}

export function approveItem(item: ApprovalItem): void | Promise<void> {
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
      // Sent by hand with Copy or Open in Messages (WeeklyTextSend), never from here.
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
      if (item.proposalId) return approveProposal(item.proposalId)
      break
  }
}

export function discardItem(item: ApprovalItem): void | Promise<void> {
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
      if (item.proposalId) {
        const id = item.proposalId
        return deciding(id, () => s.discardAgentProposal(id))
      }
      break
  }
}
