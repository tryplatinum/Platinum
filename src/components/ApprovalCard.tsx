// One draft or pending send, with everything needed to decide it: the full
// text, who it goes to, why it was drafted, and Approve, Edit and Discard.
// The Inbox, the assistant panel and the student's own tabs all use this
// card, so a draft reads and is edited the same way wherever it is met.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { STUDENT_LINK_PLACEHOLDER, STUDENT_LINK_PREVIEW, previewStudentLink } from '../../shared/dispatch'
import { UNDO_SECONDS } from '../../shared/outbox'
import { deciding, rememberSend, useApprovalSends } from '../lib/approvalSends'
import { messageStatusLabel, notConnectedLine, sentByHand } from '../lib/delivery'
import { APPROVAL_TYPE_LABEL, findStudent, fullName, type ApprovalItem } from '../lib/derive'
import { CHANNEL_LABEL, LANGUAGE_LABEL } from '../lib/language'
import { WEEKLY_TEXT_MAX, reminderQueue } from '../lib/reminders'
import { copyText, textWithStudentLink } from '../lib/studentLinks'
import { translateProposal } from '../services/agentClient'
import { ProposalNotDecided, useData, useStore } from '../store/store'
import type { DraftParentUpdate, DraftTask, ID, OwnerType, ProfileChange, ProfilePatch } from '../types'
import { TimeLeft, focusPage, useLeaving } from './motion'
import { WeeklyTextSend, WeeklyTextSendNote, weeklyTextLength, weeklyTextTooLong } from './WeeklyTextSend'
import { Button, Field, Modal, Pill, SendLabel, cx, inputBase, inputClass, textareaClass, useToast } from './ui'

const reasonOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

/** Tall enough to read the whole message while editing it. */
const rowsFor = (text: string) => Math.min(14, Math.max(4, Math.ceil(text.length / 60) + text.split('\n').length - 1))

const TwoSides = () => <p className="text-xs text-muted">The two sides are edited separately. If you change one, change the other to match before you approve.</p>

/**
 * `children` takes the place of the plain preview, for a screen that shows more
 * of the draft. `actions` follow the buttons and `note` is a line under them.
 * `compact` is the size for the assistant panel and for a card inside a card.
 */
export function ApprovalCard({
  item,
  compact,
  showStudent,
  hideKind,
  className,
  children,
  actions,
  note,
  primary,
  onDecide,
}: {
  item: ApprovalItem
  /** Told how the draft was decided, in the same press, for a screen that shows it somewhere else as it leaves. */
  onDecide?: (how: 'approved' | 'copied' | 'discarded' | 'skipped') => void
  /** The one filled button of the view it is in. Everywhere else the decision is an outlined button. */
  primary?: boolean
  compact?: boolean
  showStudent?: boolean
  /** The heading around the card already says what it is. */
  hideKind?: boolean
  className?: string
  children?: ReactNode
  actions?: ReactNode
  note?: ReactNode
}) {
  const data = useData()
  const toast = useToast()
  const leaving = useLeaving()
  const [editing, setEditing] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const [settled, setSettled] = useState<'approved' | 'discarded' | 'skipped'>()
  const [error, setError] = useState<string>()
  const root = useRef<HTMLDivElement>(null)
  const student = findStudent(data, item.studentId)
  const busy = useApprovalSends((s) => Boolean(item.proposalId && s.deciding[item.proposalId]))

  // Where the card is replaced by its outcome rather than leaving a list, focus stays in that place.
  useLayoutEffect(() => {
    const el = root.current
    return () => {
      if (!el?.contains(document.activeElement)) return
      const home = el.closest<HTMLElement>('[data-focus-home]')
      queueMicrotask(() => {
        if (el.isConnected || (document.activeElement && document.activeElement !== document.body)) return
        if (home?.isConnected) home.focus({ preventScroll: true })
        else focusPage()
      })
    }
  }, [])
  const messageId = useApprovalSends((s) => (item.proposalId ? s.messageOf[item.proposalId] : undefined))
  // A draft whose message is already on its way is not offered for approval again.
  const sending = data.outbox.some((m) => m.id === messageId && m.status !== 'cancelled') ? messageId : undefined
  const weekly = item.kind === 'weekly_text' ? data.weeklyTexts.find((w) => w.id === item.weeklyTextId) : undefined
  const meeting = item.meetingId ? data.meetings.find((m) => m.id === item.meetingId) : undefined
  const profile = item.kind === 'profile' ? meeting?.ai?.profileChanges.find((c) => c.id === item.draftId) : undefined
  const recap = item.kind === 'recap' ? meeting?.recap : undefined
  // Nothing to send or save: the database would refuse it.
  const blank = (!item.preview.trim() && (item.isSend || item.kind === 'remember' || item.kind === 'task')) || Boolean(item.problem)
  // A channel Platinum cannot send on: the counselor copies the text and sends it themselves.
  const byHand = sentByHand(item) && !weekly
  const [copying, setCopying] = useState(false)

  const run = (work: () => void | Promise<void>, outcome: 'approved' | 'discarded', fallback: string) => {
    setError(undefined)
    setSettled(outcome)
    onDecide?.(outcome === 'discarded' ? (weekly ? 'skipped' : 'discarded') : byHand ? 'copied' : 'approved')
    return Promise.resolve()
      .then(work)
      .catch((e: unknown) => {
        setSettled(undefined)
        setError(reasonOf(e, fallback))
        throw e
      })
  }

  const onApprove = (copied = false) => {
    // Decided at once, in the same press: the card only shows it afterwards.
    let work: void | Promise<void>
    try {
      work = approveItem(item)
    } catch (e) {
      setError(reasonOf(e, 'Could not approve.'))
      return
    }
    void run(() => work, 'approved', 'Could not approve.')
      .then(() => toast(copied && item.channel ? `Copied. Paste it into ${CHANNEL_LABEL[item.channel]}${item.toName ? ` to ${item.toName}` : ''}.` : item.isSend ? `Approved. Sending in ${UNDO_SECONDS} seconds.` : 'Approved.'))
      .catch(() => undefined)
  }

  /** By hand: nothing is approved or logged unless the text reached the clipboard. */
  const onCopy = async () => {
    setCopying(true)
    setError(undefined)
    try {
      await copyText(textWithStudentLink(item.studentId, item.preview))
    } catch (e) {
      setError(`${reasonOf(e, 'Nothing was copied. Please try again.')} This message is not marked approved.`)
      return
    } finally {
      setCopying(false)
    }
    onApprove(true)
  }

  const onDiscard = () => {
    setDiscarding(false)
    void run(() => discardItem(item), 'discarded', weekly ? 'Could not skip the text.' : 'Could not discard.')
      .then(() => toast(weekly ? 'Skipped this week.' : 'Discarded.'))
      .catch(() => undefined)
  }

  const onSkip = async (mode: 'once' | 'until_on') => {
    if (!item.reminderKey) return
    const draft = reminderQueue(data).find((r) => r.key === item.reminderKey)
    setSkipping(false)
    setError(undefined)
    try {
      setSettled('skipped')
      onDecide?.('skipped')
      await useStore.getState().skipReminder(item.reminderKey, mode, item.studentId, draft?.taskTitle ?? 'task')
    } catch (e) {
      setSettled(undefined)
      setError(reasonOf(e, 'Could not skip the reminder.'))
    }
  }

  return (
    <div ref={root} className={cx('flex flex-col gap-3', compact ? 'w-full' : 'px-4 py-3 sm:px-5', className)} data-settled={leaving ? settled : undefined}>
      <div className={cx('flex gap-x-6 gap-y-3', compact ? 'flex-col' : 'flex-wrap items-start justify-between')}>
        <div className={cx('min-w-0', !compact && 'max-w-full flex-1 basis-80')}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {!hideKind && <Pill>{APPROVAL_TYPE_LABEL[item.kind]}</Pill>}
            {showStudent && student && (
              <Link to={`/app/students/${student.id}`} className="tap-link text-[13px] font-semibold text-accent hover:underline">
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
          {byHand && item.channel && !leaving && <p className="mt-1 text-[13px] font-medium text-warn">{notConnectedLine(item.channel)}</p>}
          {item.problem && !leaving && (
            <p role="alert" className="mt-1 text-[13px] font-semibold text-bad">
              {item.problem} It cannot be approved until then.
            </p>
          )}
          {item.caution && !leaving && <p className="mt-1 text-[13px] font-medium text-warn">{item.caution}</p>}
          {children ? (
            <div className="mt-3">{children}</div>
          ) : profile ? (
            <div className="mt-2 text-sm leading-relaxed">
              <p className="font-medium">{profile.label}</p>
              <p className="mt-0.5">
                <span className="text-muted line-through">{profile.from}</span> <span aria-label="changes to">→</span> <span className="font-semibold">{profile.to}</span>
              </p>
            </div>
          ) : (
            <>
              <p lang={item.language} className="mt-2 max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">
                {previewStudentLink(item.preview)}
              </p>
              {/* What the student will see behind the message, so it can all be read before it is approved. */}
              {recap && recap.nextSteps.length > 0 && (
                <ol className="mt-1 max-w-prose list-decimal space-y-1 pl-5 text-sm leading-relaxed" aria-label="Next steps">
                  {recap.nextSteps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              )}
            </>
          )}
          {/* The assistant's source line is its reason, which the panel shows once, below. */}
          {!children && !(compact && item.rationale) && <p className="mt-1 text-[13px] text-muted">{item.sourceLine}</p>}
          {(item.kind === 'agent_message' || item.kind === 'agent_parent_update') && item.language && item.language !== 'en' && item.proposalId && <ShowInEnglish proposalId={item.proposalId} />}
          {item.rationale && item.kind.startsWith('agent_') && <p className="mt-1 text-[13px] text-ink-soft">Why: {item.rationale}</p>}
          {item.sourcesLine && <p className="mt-0.5 text-[13px] text-muted">Sources: {item.sourcesLine}</p>}
          {weekly && student && !leaving && <WeeklyTextSendNote student={student} />}
          {weekly && !leaving && weeklyTextTooLong(weekly.body) && <p className="text-[13px] font-semibold text-bad">Too long for one text: shorten it.</p>}
        </div>

        <div className="flex min-h-11 flex-wrap items-center gap-2">
          {leaving ? (
            <span className="motion-fade inline-flex min-h-11 items-center">
              {settled === 'approved' || (weekly && !settled) ? (
                <Pill tone="good">{byHand ? 'Copied' : 'Approved'}</Pill>
              ) : (
                settled && <Pill>{settled === 'skipped' || weekly ? 'Skipped' : 'Discarded'}</Pill>
              )}
            </span>
          ) : sending ? (
            <SendState messageId={sending} />
          ) : weekly ? (
            student && <WeeklyTextSend draft={weekly} student={student} text={weekly.body} primary={primary} />
          ) : byHand && item.channel ? (
            <Button variant={primary ? 'primary' : 'secondary'} data-action="approve" onClick={() => void onCopy()} disabled={blank} busy={busy || copying}>
              Copy for {CHANNEL_LABEL[item.channel]}
            </Button>
          ) : (
            <Button variant={primary ? 'primary' : 'secondary'} data-action="approve" onClick={() => onApprove()} disabled={blank} busy={busy}>
              {item.isSend ? <SendLabel>Approve and send</SendLabel> : 'Approve'}
            </Button>
          )}
          {!leaving && (
            <>
              {canEdit(item) && !sending && (
                <Button data-action="edit" onClick={() => setEditing(!editing)} aria-expanded={editing} disabled={busy}>
                  {editing ? 'Done' : 'Edit'}
                </Button>
              )}
              {item.kind === 'reminder' && <Button onClick={() => setSkipping(true)}>Skip</Button>}
              {actions}
              {canDiscard(item) && (
                <Button variant="quiet" onClick={() => setDiscarding(true)} disabled={busy}>
                  {weekly ? 'Skip' : 'Discard'}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {editing && !sending && !leaving && student && (
        <div className="motion-rise">
          <EditPanel item={item} onClose={() => setEditing(false)} />
        </div>
      )}
      {note && !leaving && <p className="text-xs text-muted">{note}</p>}
      {error && !leaving && (
        <p role="alert" className="text-[13px] text-bad">
          {error}
        </p>
      )}

      {discarding && (
        <Modal title={weekly ? 'Skip this week’s text?' : 'Discard this draft?'} onClose={() => setDiscarding(false)}>
          <p className="text-sm text-ink-soft">{weekly ? 'It will not be sent this week. You can take it back under “Done this week” in Weekly texts.' : 'It leaves the Inbox and will not be sent or saved.'}</p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button data-autofocus onClick={() => setDiscarding(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={onDiscard}>
              {weekly ? 'Skip this week' : 'Discard'}
            </Button>
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
    </div>
  )
}

/**
 * Where a message approved on this card stands: counting down with Undo, then
 * Sent or Cancelled. Undo cancels the same queued message the toast would.
 */
export function SendState({ messageId }: { messageId: ID }) {
  const message = useData().outbox.find((m) => m.id === messageId)
  const confirmed = useApprovalSends((s) => Boolean(s.confirmed[messageId]))
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string>()
  const [now, setNow] = useState(() => Date.now())
  const left = message?.status === 'queued' ? Math.ceil((Date.parse(message.sendAfter) - now) / 1000) : 0
  const counting = left > 0
  useEffect(() => {
    if (!counting) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [counting])

  if (!message) return <span className="text-[13px] font-semibold text-bad">Not queued. Nothing was sent.</span>
  const byHand = sentByHand({ isSend: true, channel: message.channel })
  if (!counting) return <span className="text-[13px] font-semibold text-ink">{message.status === 'queued' && !byHand ? 'Approved. Sending now.' : messageStatusLabel(message, now)}</span>
  return (
    <span className="motion-fade flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="flex flex-col gap-1">
        <span className="nums text-[13px] font-semibold text-ink">
          {byHand ? 'Copied and approved. Undo for' : 'Approved. Sending in'} {left} {left === 1 ? 'second' : 'seconds'}.
        </span>
        <TimeLeft from={message.approvedAt ?? message.sentAt} until={message.sendAfter} className="text-accent" />
      </span>
      <Button
        // The database has to have queued it before it can be cancelled.
        disabled={!confirmed}
        busy={busy}
        onClick={() => {
          setBusy(true)
          setFailed(undefined)
          void useStore
            .getState()
            .cancelQueued(messageId)
            .catch((error: unknown) => setFailed(reasonOf(error, 'Could not undo the message.')))
            .finally(() => setBusy(false))
        }}
      >
        Undo
      </Button>
      {failed && (
        <span role="alert" className="basis-full text-[13px] text-bad">
          {failed}
        </span>
      )}
    </span>
  )
}

/** "Approve all" for a group, with the confirmation that says how many items and how many messages. */
export function ApproveAll({ items, title = 'Approve all in this group?' }: { items: ApprovalItem[]; title?: string }) {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  // A weekly text, and a message on a channel that is not connected, are sent by hand: they cannot be approved along with the rest.
  // A draft with a blank still in it cannot be approved at all, alone or with the rest.
  const blocked = items.filter((i) => i.problem).length
  const approvable = items.filter((i) => i.kind !== 'weekly_text' && !sentByHand(i) && !i.problem)
  const left = items.length - approvable.length
  const sends = approvable.filter((i) => i.isSend).length
  // What "Approve 11 of 13" leaves behind, by name.
  const byHand = items.filter((i) => i.kind !== 'weekly_text' && sentByHand(i) && !i.problem).length
  const weeklyLeft = left - byHand - blocked
  const leftLine = [
    byHand > 0 && `${byHand} ${byHand === 1 ? 'is' : 'are'} for WeChat or LINE and ${byHand === 1 ? 'stays' : 'stay'} here for you to copy.`,
    blocked > 0 && `${blocked} ${blocked === 1 ? 'has' : 'have'} a blank still in the text and ${blocked === 1 ? 'stays' : 'stay'} here until it is filled in.`,
    weeklyLeft > 0 && `${weeklyLeft} weekly ${weeklyLeft === 1 ? 'text stays' : 'texts stay'} here for you to send by hand.`,
  ]
    .filter(Boolean)
    .join(' ')
  if (items.length < 2 || approvable.length === 0) return null

  const approveAll = async () => {
    setConfirming(false)
    setWorking(true)
    const results = await Promise.allSettled(approvable.map(async (item) => approveItem(item)))
    setWorking(false)
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
      {/* Secondary: the filled button is the decision on one draft. */}
      <Button onClick={() => setConfirming(true)} busy={working}>
        {left > 0 ? `Approve ${approvable.length} of ${items.length}` : 'Approve all'}
      </Button>
      {confirming && (
        <Modal title={title} onClose={() => setConfirming(false)}>
          <p className="text-sm text-ink-soft">
            {approvable.length} {approvable.length === 1 ? 'item' : 'items'}
            {sends > 0 ? `, including ${sends} ${sends === 1 ? 'message' : 'messages'} that will be queued to send. Each message keeps its own ${UNDO_SECONDS}-second Undo.` : '. No messages will be queued.'}
            {left > 0 && ` ${leftLine}`}
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button data-autofocus onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void approveAll()}>
              {sends > 0 ? <SendLabel>Approve and send {approvable.length}</SendLabel> : `Approve ${approvable.length}`}
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}

function ShowInEnglish({ proposalId }: { proposalId: string }) {
  const data = useData()
  const proposal = data.agentProposals.find((row) => row.id === proposalId)
  const stored = typeof proposal?.payload.bodyEn === 'string' ? proposal.payload.bodyEn.trim() : ''
  const [english, setEnglish] = useState(stored)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string>()
  if (english) return <p className="motion-fade mt-2 max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{english}</p>
  return (
    <>
      <Button
        className="mt-2 self-start"
        busy={busy}
        onClick={() => {
          setBusy(true)
          setFailed(undefined)
          void translateProposal(proposalId)
            .then((bodyEn) => {
              setEnglish(bodyEn)
              if (proposal) useStore.getState().updateAgentProposal(proposal.id, { ...proposal.payload, bodyEn })
            })
            .catch((error: unknown) => setFailed(reasonOf(error, 'Could not show the English.')))
            .finally(() => setBusy(false))
        }}
      >
        {busy ? 'Translating…' : 'Show in English'}
      </Button>
      {failed && (
        <p role="alert" className="mt-1 text-[13px] text-bad">
          {failed}
        </p>
      )}
    </>
  )
}

function canEdit(item: ApprovalItem): boolean {
  // Reminders use fixed wording — Skip instead of edit.
  return item.kind !== 'reminder'
}

function canDiscard(item: ApprovalItem): boolean {
  return item.kind !== 'reminder'
}

/** The box every edit form sits in. What is typed is kept as it is typed; Done only closes the box. */
function EditBox({ onClose, children, row }: { onClose: () => void; children: ReactNode; row?: boolean }) {
  return (
    <div className={cx('flex gap-3 rounded-control bg-canvas p-3', row ? 'flex-wrap items-end' : 'flex-col')}>
      {children}
      <Button className="self-start" onClick={onClose}>
        Done
      </Button>
    </div>
  )
}

function EditPanel({ item, onClose }: { item: ApprovalItem; onClose: () => void }) {
  const data = useData()
  const store = useStore.getState()
  const student = findStudent(data, item.studentId)
  const meeting = item.meetingId ? data.meetings.find((m) => m.id === item.meetingId) : undefined
  const local = item.language && item.language !== 'en' ? LANGUAGE_LABEL[item.language] : 'Their language'

  if (item.kind === 'notes' && meeting) {
    const ai = meeting.ai
    if (!ai) return null
    const lines = (xs: string[]) => xs.join('\n')
    const parse = (raw: string) => raw.split('\n').map((s) => s.trim()).filter(Boolean)
    const fields = [
      ['Decided', 'decided', 3],
      ['Progress', 'progress', 3],
      ['Watch', 'watch', 3],
      ['Full notes · private', 'notes', 4],
    ] as const
    return (
      <EditBox onClose={onClose}>
        {fields.map(([label, key, rows]) => (
          <Field key={key} label={label}>
            <textarea className={textareaClass} rows={rows} value={lines(ai[key])} onChange={(e) => store.updateMeetingNotes(meeting.id, { [key]: parse(e.target.value) })} />
          </Field>
        ))}
      </EditBox>
    )
  }

  if (item.kind === 'profile' && meeting) {
    const change = meeting.ai?.profileChanges.find((c) => c.id === item.draftId)
    if (!change) return null
    return <ProfileChangeEditor meetingId={meeting.id} change={change} onClose={onClose} />
  }

  if (item.kind === 'task' && meeting && item.draftId) {
    const draft = meeting.ai?.draftTasks.find((t) => t.id === item.draftId)
    if (!draft) return null
    const patch = (p: Partial<DraftTask>) => store.updateDraftTask(meeting.id, draft.id, p)
    return (
      <EditBox onClose={onClose} row>
        <Field label="Task" className="min-w-[14rem] flex-1">
          <input className={inputClass} value={draft.title} onChange={(e) => patch({ title: e.target.value })} />
        </Field>
        <Field label="Owner">
          <select
            className={inputBase}
            value={draft.owner === 'parent' ? `parent:${draft.ownerParentId}` : draft.owner}
            onChange={(e) => {
              const v = e.target.value
              patch(v.startsWith('parent:') ? { owner: 'parent', ownerParentId: v.slice(7) } : { owner: v as OwnerType, ownerParentId: undefined })
            }}
          >
            <option value="student">{student?.firstName ?? 'Student'}</option>
            {student?.parents.map((p) => (
              <option key={p.id} value={`parent:${p.id}`}>
                {p.name} ({p.relationship})
              </option>
            ))}
            <option value="counselor">You</option>
          </select>
        </Field>
        <Field label="Due date">
          <input className={inputBase} type="date" value={draft.dueDate} onChange={(e) => e.target.value && patch({ dueDate: e.target.value, dueDateBasis: 'stated' })} />
        </Field>
        <Field label="Detail" className="w-full">
          <textarea className={textareaClass} rows={2} value={draft.detail ?? ''} onChange={(e) => patch({ detail: e.target.value })} />
        </Field>
      </EditBox>
    )
  }

  if (item.kind === 'parent_update' && meeting && item.draftId) {
    const draft = meeting.ai?.parentUpdates.find((u) => u.id === item.draftId)
    if (!draft) return null
    const patch = (p: Partial<DraftParentUpdate>) => store.updateParentUpdate(meeting.id, draft.id, p)
    return (
      <EditBox onClose={onClose}>
        {draft.bodyLocal !== undefined && (
          <Field label={`${local}, as ${item.toName ?? 'the parent'} will receive it`}>
            <textarea lang={item.language} className={textareaClass} rows={rowsFor(draft.bodyLocal)} value={draft.bodyLocal} onChange={(e) => patch({ bodyLocal: e.target.value })} />
          </Field>
        )}
        <Field label={draft.bodyLocal === undefined ? 'Message' : 'English, for your records'}>
          <textarea className={textareaClass} rows={rowsFor(draft.bodyEn)} value={draft.bodyEn} onChange={(e) => patch({ bodyEn: e.target.value })} />
        </Field>
        {draft.bodyLocal !== undefined && <TwoSides />}
      </EditBox>
    )
  }

  if (item.kind === 'recap' && meeting?.recap) {
    const recap = meeting.recap
    return (
      <EditBox onClose={onClose}>
        <Field label="Recap">
          <textarea className={textareaClass} rows={4} value={recap.summary} onChange={(e) => store.updateRecap(meeting.id, { summary: e.target.value })} />
        </Field>
        <Field label="Next steps, one per line">
          <textarea
            className={textareaClass}
            rows={Math.max(3, recap.nextSteps.length + 1)}
            value={recap.nextSteps.join('\n')}
            onChange={(e) => store.updateRecap(meeting.id, { nextSteps: e.target.value.split('\n') })}
            onBlur={() => store.updateRecap(meeting.id, { nextSteps: recap.nextSteps.map((s) => s.trim()).filter(Boolean) })}
          />
        </Field>
      </EditBox>
    )
  }

  if (item.kind === 'remember' && meeting && item.draftId) {
    const note = meeting.ai?.personalNotes?.find((n) => n.id === item.draftId)
    if (!note) return null
    return (
      <EditBox onClose={onClose} row>
        <Field label="Note to self" className="min-w-[14rem] flex-1">
          <input className={inputClass} maxLength={300} value={note.text} onChange={(e) => store.updateDraftNote(meeting.id, note.id, { text: e.target.value })} />
        </Field>
        <Field label="Date of the event, if there is one">
          <input type="date" className={inputBase} value={note.eventDate ?? ''} onChange={(e) => store.updateDraftNote(meeting.id, note.id, { eventDate: e.target.value || undefined, eventDateApprox: undefined })} />
        </Field>
      </EditBox>
    )
  }

  if (item.kind === 'report' && item.reportId) {
    const report = data.reports.find((r) => r.id === item.reportId)
    if (!report) return null
    return (
      <EditBox onClose={onClose}>
        <Field label="Subject">
          <input className={inputClass} value={report.subject} onChange={(e) => store.updateReport(report.id, { subject: e.target.value })} />
        </Field>
        {report.bodyLocal !== undefined && (
          <Field label={`${local}, as ${item.toName ?? 'the parent'} will receive it`}>
            <textarea lang={item.language} className={textareaClass} rows={rowsFor(report.bodyLocal)} value={report.bodyLocal} onChange={(e) => store.updateReport(report.id, { bodyLocal: e.target.value })} />
          </Field>
        )}
        <Field label={report.bodyLocal === undefined ? 'Message' : 'English, for your records'}>
          <textarea className={textareaClass} rows={rowsFor(report.bodyEn)} value={report.bodyEn} onChange={(e) => store.updateReport(report.id, { bodyEn: e.target.value })} />
        </Field>
        {report.bodyLocal !== undefined && <TwoSides />}
      </EditBox>
    )
  }

  if (item.kind === 'essay' && item.docId) {
    const doc = data.documents.find((d) => d.id === item.docId)
    const feedback = doc?.feedback
    if (!feedback) return null
    const patchPoint = (i: number, fields: { observation?: string; question?: string }) =>
      store.updateEssayFeedback(doc.id, { points: feedback.points.map((p, j) => (j === i ? { ...p, ...fields } : p)) })
    return (
      <EditBox onClose={onClose}>
        <Field label="Overall">
          <textarea className={textareaClass} rows={4} value={feedback.overall} onChange={(e) => store.updateEssayFeedback(doc.id, { overall: e.target.value })} />
        </Field>
        <Field label="What works, one per line">
          <textarea
            className={textareaClass}
            rows={Math.max(2, feedback.strengths.length + 1)}
            value={feedback.strengths.join('\n')}
            onChange={(e) => store.updateEssayFeedback(doc.id, { strengths: e.target.value.split('\n') })}
            onBlur={() => store.updateEssayFeedback(doc.id, { strengths: feedback.strengths.map((s) => s.trim()).filter(Boolean) })}
          />
        </Field>
        {feedback.points.map((p, i) => (
          <fieldset key={i} className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-semibold text-muted">
              {p.area}
              {p.location && ` · ${p.location}`}
            </legend>
            <Field label={`Question ${i + 1}`}>
              <textarea className={textareaClass} rows={2} value={p.question} onChange={(e) => patchPoint(i, { question: e.target.value })} />
            </Field>
            <Field label={`Observation ${i + 1}`}>
              <textarea className={textareaClass} rows={2} value={p.observation} onChange={(e) => patchPoint(i, { observation: e.target.value })} />
            </Field>
          </fieldset>
        ))}
      </EditBox>
    )
  }

  if (item.kind === 'weekly_text' && item.weeklyTextId) {
    const text = data.weeklyTexts.find((w) => w.id === item.weeklyTextId)
    if (!text) return null
    return (
      <EditBox onClose={onClose}>
        <Field label={`Text to ${student?.firstName ?? 'the student'}`} hint={`${weeklyTextLength(text.body)} of ${WEEKLY_TEXT_MAX} characters.`}>
          <textarea
            className={textareaClass}
            rows={4}
            value={previewStudentLink(text.body)}
            onChange={(e) => store.updateWeeklyText(text.id, e.target.value.split(STUDENT_LINK_PREVIEW).join(STUDENT_LINK_PLACEHOLDER))}
          />
        </Field>
      </EditBox>
    )
  }

  if (item.kind === 'weekly_parent' && item.weeklyTextId) {
    const text = data.weeklyTexts.find((w) => w.id === item.weeklyTextId)
    const copy = text?.parentCopy
    if (!copy) return null
    return (
      <EditBox onClose={onClose}>
        <Field label={copy.bodyEn === undefined ? 'Message' : `${local}, as ${item.toName ?? 'the parent'} will receive it`}>
          <textarea lang={copy.language} className={textareaClass} rows={rowsFor(copy.body)} value={copy.body} onChange={(e) => store.updateWeeklyParentCopy(text.id, { body: e.target.value })} />
        </Field>
        {copy.bodyEn !== undefined && (
          <Field label="English, for your records">
            <textarea className={textareaClass} rows={rowsFor(copy.bodyEn)} value={copy.bodyEn} onChange={(e) => store.updateWeeklyParentCopy(text.id, { bodyEn: e.target.value })} />
          </Field>
        )}
      </EditBox>
    )
  }

  if (item.kind === 'template_message' && item.messageDraftId) {
    const draft = data.messageDrafts.find((d) => d.id === item.messageDraftId)
    if (!draft) return null
    return (
      <EditBox onClose={onClose}>
        {draft.subject !== undefined && (
          <Field label="Subject">
            <input className={inputClass} value={draft.subject} onChange={(e) => store.updateMessageDraft(draft.id, { subject: e.target.value })} />
          </Field>
        )}
        <Field label={`Message, as ${item.toName ?? 'they'} will receive it`}>
          <textarea lang={draft.language} className={textareaClass} rows={rowsFor(draft.body)} value={draft.body} onChange={(e) => store.updateMessageDraft(draft.id, { body: e.target.value })} />
        </Field>
      </EditBox>
    )
  }

  if (item.proposalId && item.kind.startsWith('agent_')) {
    const proposal = data.agentProposals.find((p) => p.id === item.proposalId)
    if (!proposal) return null
    const payload = proposal.payload
    const save = (next: Record<string, unknown>) => store.updateAgentProposal(proposal.id, next)
    if (item.kind === 'agent_message' || item.kind === 'agent_parent_update') {
      return (
        <EditBox onClose={onClose}>
          <Field label={typeof payload.bodyEn === 'string' ? `${local}, as ${item.toName ?? 'they'} will receive it` : 'Message'}>
            <textarea lang={item.language} className={textareaClass} rows={rowsFor(String(payload.body ?? ''))} value={String(payload.body ?? '')} onChange={(e) => save({ ...payload, body: e.target.value })} />
          </Field>
          {typeof payload.bodyEn === 'string' && (
            <Field label="English, for your records">
              <textarea className={textareaClass} rows={rowsFor(payload.bodyEn)} value={payload.bodyEn} onChange={(e) => save({ ...payload, bodyEn: e.target.value })} />
            </Field>
          )}
        </EditBox>
      )
    }
    if (item.kind === 'agent_task') {
      return (
        <EditBox onClose={onClose} row>
          <Field label="Task" className="min-w-[14rem] flex-1">
            <input className={inputClass} value={String(payload.title ?? '')} onChange={(e) => save({ ...payload, title: e.target.value })} />
          </Field>
          <Field label="Due date">
            <input className={inputBase} type="date" value={String(payload.dueDate ?? '')} onChange={(e) => save({ ...payload, dueDate: e.target.value })} />
          </Field>
          <Field label="Detail" className="w-full">
            <textarea className={textareaClass} rows={2} value={String(payload.detail ?? '')} onChange={(e) => save({ ...payload, detail: e.target.value })} />
          </Field>
        </EditBox>
      )
    }
    if (item.kind === 'agent_profile_change') {
      return (
        <EditBox onClose={onClose}>
          <Field label={`Proposed value (was ${String(payload.from ?? '')})`}>
            <input
              className={inputClass}
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
          </Field>
        </EditBox>
      )
    }
    if (item.kind === 'agent_meeting_times') {
      const slots = Array.isArray(payload.slots) ? (payload.slots as { when: string; reason: string }[]) : []
      return (
        <EditBox onClose={onClose}>
          {slots.map((slot, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-2">
              <Field label={`Time ${i + 1}`}>
                <input className={inputClass} value={slot.when} onChange={(e) => save({ ...payload, slots: slots.map((s, j) => (j === i ? { ...s, when: e.target.value } : s)) })} />
              </Field>
              <Field label="Why this time">
                <input className={inputClass} value={slot.reason} onChange={(e) => save({ ...payload, slots: slots.map((s, j) => (j === i ? { ...s, reason: e.target.value } : s)) })} />
              </Field>
            </div>
          ))}
        </EditBox>
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
      <EditBox onClose={onClose} row>
        <Field label={`${change.label} (was ${change.from})`}>
          <input
            className={inputBase}
            inputMode="decimal"
            value={change.to}
            onChange={(e) => {
              const value = Number(e.target.value)
              if (!Number.isFinite(value)) return
              save({ to: e.target.value, patch: { kind: 'score', field: patch.field, value } })
            }}
          />
        </Field>
      </EditBox>
    )
  }

  if (patch.kind === 'setMajors') {
    return (
      <EditBox onClose={onClose}>
        <Field label={`Intended majors (was ${change.from})`}>
          <input
            className={inputClass}
            value={change.to}
            onChange={(e) => {
              const value = e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
              save({ to: e.target.value, patch: { kind: 'setMajors', value } })
            }}
          />
        </Field>
      </EditBox>
    )
  }

  if (patch.kind === 'addInterest') {
    return (
      <EditBox onClose={onClose}>
        <Field label="Interest to add">
          <input className={inputClass} value={change.to} onChange={(e) => save({ to: e.target.value, patch: { kind: 'addInterest', value: e.target.value.trim() } })} />
        </Field>
      </EditBox>
    )
  }

  // addActivity
  const activity = patch.activity
  return (
    <EditBox onClose={onClose} row>
      <Field label="Activity" className="min-w-[10rem] flex-1">
        <input
          className={inputClass}
          value={activity.name}
          onChange={(e) => {
            const next = { ...activity, name: e.target.value }
            save({ to: `${next.name}${next.role ? ` · ${next.role}` : ''}`, patch: { kind: 'addActivity', activity: next } })
          }}
        />
      </Field>
      <Field label="Role" className="min-w-[8rem] flex-1">
        <input
          className={inputClass}
          value={activity.role}
          onChange={(e) => {
            const next = { ...activity, role: e.target.value }
            save({ to: `${next.name}${next.role ? ` · ${next.role}` : ''}`, patch: { kind: 'addActivity', activity: next } })
          }}
        />
      </Field>
      <Field label="Detail (optional)" className="min-w-[10rem] flex-[2]">
        <input
          className={inputClass}
          value={activity.detail ?? ''}
          onChange={(e) => {
            const next = { ...activity, detail: e.target.value || undefined }
            save({ to: `${next.name}${next.role ? ` · ${next.role}` : ''}`, patch: { kind: 'addActivity', activity: next } })
          }}
        />
      </Field>
    </EditBox>
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
    case 'template_message':
      // Throws when a blank is still in the text; otherwise queues through sendMessage like any approved send.
      if (item.messageDraftId) s.approveMessageDraft(item.messageDraftId)
      break
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
    case 'template_message':
      if (item.messageDraftId) s.discardMessageDraft(item.messageDraftId)
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
