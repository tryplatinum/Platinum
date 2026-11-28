// Messages. Sent: the log of everything that "went out". Weekly texts: the
// week's short text to each student. Scheduled reminders: reminders that are
// due under the firm's rules, which are set in Settings.
// Approved messages wait 10 seconds, then go out through the allowlist, and can
// still be copied and sent by hand; the page says so at the top.

import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { Button, Card, CardHeader, Empty, LinkButton, Pill, TabPanel, Tabs, PageHeader, cx, inputBase, usePageTitle, useTab, useToast, type TabItem } from '../../components/ui'
import { previewStudentLink } from '../../../shared/dispatch'
import { HAND_SENT_NOTE, NOT_CONFIRMED, PHONE_REASON, canSendByHand } from '../../../shared/phoneGateway'
import { OpenInMessages } from '../../components/OpenInMessages'
import { Reveal, useReveal } from '../../components/motion'
import { callPhone, phoneReason } from '../../services/phone'
import { copyText, textWithStudentLink } from '../../lib/studentLinks'
import { UNDO_SECONDS } from '../../../shared/outbox'
import { formatTimestamp } from '../../lib/dates'
import { canDeliver, messageStatusLabel, notConnectedLine } from '../../lib/delivery'
import { activeStudents, findStudent, fullName, weeklyTextRows } from '../../lib/derive'
import { CHANNEL_LABEL, LANGUAGE_LABEL } from '../../lib/language'
import { REMINDER_MODE_LABEL, reminderQueue, type ReminderDraft } from '../../lib/reminders'
import { useData, useStore } from '../../store/store'
import type { OutboxKind, OutboxMessage } from '../../types'
import WeeklyTexts from './WeeklyTexts'

const KIND_LABEL: Record<OutboxKind, string> = {
  parent_report: 'Parent report',
  reminder_upcoming: 'Reminder: due soon',
  reminder_late: 'Reminder: late',
  meeting_recap: 'Meeting recap',
  essay_feedback: 'Essay feedback',
  weekly_text: 'Weekly text',
}

/** `queue` is the key in links made before the tab was called Scheduled reminders. */
type TabKey = 'sent' | 'weekly' | 'queue'

export default function Messages() {
  const data = useData()
  const [params] = useSearchParams()
  const queue = reminderQueue(data)
  const tabs: TabItem<TabKey>[] = [
    { key: 'sent', label: 'Sent' },
    { key: 'weekly', label: 'Weekly texts', count: weeklyTextRows(data).length },
    { key: 'queue', label: 'Scheduled reminders', count: queue.length },
  ]
  const tab = useTab(tabs)
  const how = useReveal()
  usePageTitle('Messages')
  // The rules moved to Settings.
  if (params.get('tab') === 'rules') return <Navigate to="/app/settings#reminder-rules" replace />

  return (
    <>
      <PageHeader
        title="Messages"
        pill={
          <button type="button" {...how.button} className="flex min-h-11 items-center gap-1 rounded-control text-[13px] font-semibold text-accent">
            <ChevronRight size={16} strokeWidth={1.75} className="motion-chevron shrink-0" aria-hidden />
            How sending works
          </button>
        }
      />
      <Reveal open={how.open} id={how.id} className="-mt-3">
        <p className="rounded-card border border-accent-line bg-accent-soft px-4 py-3 text-sm text-ink-soft">
          <strong className="text-ink">Approved messages wait {UNDO_SECONDS} seconds.</strong> Undo is on the toast. After that they are sent through the allowlist. You can still copy a message into email, text, WeChat or LINE yourself. A reminder rule set to “{REMINDER_MODE_LABEL.automatic}” does not send by itself: its reminders wait under Scheduled reminders until you press “Run the daily send now”.
        </p>
      </Reveal>
      <Tabs tabs={tabs} label="Messages" />
      <TabPanel tab={tab} label={tabs.find((t) => t.key === tab)?.label ?? ''}>
        {tab === 'sent' && <Sent />}
        {tab === 'weekly' && <WeeklyTexts />}
        {tab === 'queue' && <Queue queue={queue} />}
      </TabPanel>
    </>
  )
}

// ── Sent ────────────────────────────────────────────────────────────────────

function Sent() {
  const data = useData()
  const [params, setParams] = useSearchParams()
  const student = params.get('student') ?? ''
  const kind = params.get('kind') ?? ''
  const messageId = params.get('message') ?? ''
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const rows = data.outbox.filter((m) => (!student || m.studentId === student) && (!kind || m.kind === kind) && (!messageId || m.id === messageId))

  // While a text waits for the counselor's phone, ask the server how it is going, so the row
  // moves on by itself (to sent, to "phone did not answer") without a page reload.
  const reload = useStore((s) => s.reload)
  const waitingForPhone = data.outbox.some((m) => m.status === 'sending' && m.detail === 'phone_waiting')
  useEffect(() => {
    if (!waitingForPhone) return
    const timer = setInterval(() => {
      void callPhone('status')
        .catch(() => undefined)
        .then(() => reload(true))
    }, 10_000)
    return () => clearInterval(timer)
  }, [waitingForPhone, reload])

  return (
    <Card>
      <CardHeader
        size="section"
        className="px-5 py-4"
        title="Sent"
        count={rows.length}
        action={
          <>
            <select aria-label="Filter by student" className={cx(inputBase, 'min-w-0 max-w-full')} value={student} onChange={(e) => setFilter('student', e.target.value)}>
              <option value="">All students</option>
              {activeStudents(data).map((s) => (
                <option key={s.id} value={s.id}>
                  {fullName(s)}
                </option>
              ))}
            </select>
            <select aria-label="Filter by kind" className={inputBase} value={kind} onChange={(e) => setFilter('kind', e.target.value)}>
              <option value="">All kinds</option>
              {(Object.keys(KIND_LABEL) as OutboxKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </>
        }
      />
      {rows.length === 0 ? (
        <div className="border-t border-line">
          <Empty title={data.outbox.length === 0 ? 'Nothing has been sent yet. Messages appear here when you approve a report, share a recap or send a reminder.' : 'No messages match these filters.'}>
            {data.outbox.length > 0 && (
              <Button
                onClick={() => {
                  setParams({}, { replace: true })
                }}
              >
                Clear filters
              </Button>
            )}
          </Empty>
        </div>
      ) : (
        <ul>
          {rows.map((m) => (
            <LogRow key={m.id} message={m} startOpen={messageId === m.id} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function Recipient({ m }: { m: Pick<OutboxMessage, 'toName' | 'toKind' | 'channel' | 'language' | 'studentId'> }) {
  const student = findStudent(useData(), m.studentId)
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-sm font-semibold">{m.toName}</span>
      <span className="text-[13px] text-muted">
        {m.toKind === 'parent' ? 'Parent of ' : 'Student'}
        {m.toKind === 'parent' && student && (
          <Link to={`/app/students/${student.id}`} className="tap-link font-medium text-accent hover:underline">
            {student.firstName}
          </Link>
        )}
      </span>
      <Pill>{CHANNEL_LABEL[m.channel]}</Pill>
      {m.language !== 'en' && <Pill>{LANGUAGE_LABEL[m.language]}</Pill>}
    </span>
  )
}

function Body({ body, bodyEn, language }: { body: string; bodyEn?: string; language: string }) {
  const shown = previewStudentLink(body)
  const shownEn = bodyEn ? previewStudentLink(bodyEn) : undefined
  return (
    <div className={cx('grid gap-3', shownEn && 'md:grid-cols-2')}>
      <p lang={language} className="whitespace-pre-wrap rounded-lg bg-canvas p-3 text-sm leading-relaxed">
        {shown}
      </p>
      {shownEn && (
        <p className="whitespace-pre-wrap rounded-lg border border-line p-3 text-sm leading-relaxed text-ink-soft">
          <span className="mb-1 block text-xs font-semibold text-muted">English, for you</span>
          {shownEn}
        </p>
      )}
    </div>
  )
}

function OutboxStatus({ message }: { message: OutboxMessage }) {
  const [now, setNow] = useState(() => Date.now())
  const counting = message.status === 'queued' && Date.parse(message.sendAfter) > now
  useEffect(() => {
    if (!counting) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [counting])
  return <span className="text-[13px] font-semibold text-ink">{messageStatusLabel(message, now)}</span>
}

function LogRow({ message: m, startOpen = false }: { message: OutboxMessage; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  const toast = useToast()
  const sendMessage = useStore((s) => s.sendMessage)
  const reload = useStore((s) => s.reload)
  const data = useData()
  const [busy, setBusy] = useState(false)
  const preview = previewStudentLink(m.body)
  const again = (note: string | undefined) =>
    sendMessage({
      studentId: m.studentId,
      toKind: m.toKind,
      toName: m.toName,
      parentId: m.parentId,
      channel: m.channel,
      language: m.language,
      kind: m.kind,
      body: m.body,
      bodyEn: m.bodyEn,
      trigger: 'approved',
      taskId: m.taskId,
      note,
      dedupeKey: m.dedupeKey,
    })
  const retry = () => {
    again(m.note)
    toast('Queued again. Undo is on the toast.')
  }

  // ── A text that went to the counselor's own phone ──
  const waitingForPhone = m.status === 'sending' && m.detail === 'phone_waiting'
  const notConfirmed = m.status === 'sending' && m.detail === 'phone_unknown'
  /** The same text, logged later as sent by hand: this row needs nothing more. */
  const sentByHand =
    m.error === PHONE_REASON.sentAgain || data.outbox.some((o) => o.id !== m.id && o.note === HAND_SENT_NOTE && o.status !== 'cancelled' && o.studentId === m.studentId && o.toName === m.toName && o.body === m.body && o.sentAt > m.sentAt)
  const byHand = canSendByHand(m) && !sentByHand
  const student = findStudent(data, m.studentId)
  const phone = (m.toKind === 'parent' ? student?.parents.find((p) => p.id === m.parentId)?.phone : student?.phone)?.trim()
  /** What went wrong the last time this row was copied or opened in Messages. */
  const [handError, setHandError] = useState<string>()
  /** The text to send by hand. The student's link is filled in here; the stored row keeps the placeholder. */
  const handText = () => (m.toKind === 'student' ? textWithStudentLink(m.studentId, m.body) : m.body)
  const askPhone = async (action: string, body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true)
    setHandError(undefined)
    try {
      await callPhone(action, body)
      return true
    } catch (e) {
      setHandError(phoneReason(e))
      return false
    } finally {
      await reload(true)
      setBusy(false)
    }
  }
  const sendAgain = async () => {
    if (!(await askPhone('resolve', { outboxId: m.id, sent: false, again: true }))) return
    again(m.note)
    toast('Queued again. Undo is on the toast.')
  }
  return (
    <li className="border-t border-line px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Recipient m={m} />
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone={m.kind === 'reminder_late' ? 'bad' : 'neutral'}>{KIND_LABEL[m.kind]}</Pill>
          <Pill tone={m.trigger === 'approved' ? 'good' : 'accent'}>{m.trigger === 'approved' ? 'You approved' : 'Sent by a reminder rule'}</Pill>
          {m.note && <Pill>{m.note.replace('Legacy simulated send.', 'Sample message, not sent.')}</Pill>}
          <OutboxStatus message={m} />
          <span className="text-[13px] text-muted">{formatTimestamp(m.sentAt)}</span>
          {m.status === 'failed' && !sentByHand && canDeliver(m.channel) && (
            <Button variant="quiet" onClick={retry}>
              Retry
            </Button>
          )}
          {waitingForPhone && (
            <Button variant="quiet" busy={busy} onClick={() => void askPhone('cancel', { outboxId: m.id })}>
              Cancel
            </Button>
          )}
          <Button variant="quiet" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${open ? 'Hide' : 'View'} the message to ${m.toName}`}>
            {open ? 'Hide' : 'View'}
          </Button>
        </span>
      </div>
      {notConfirmed && (
        <div role="alert" className="mt-2 flex flex-col gap-2 rounded-lg bg-warn-soft px-3 py-2">
          <p className="text-[13px] text-warn">{NOT_CONFIRMED}</p>
          <div className="flex flex-wrap gap-2">
            <Button busy={busy} onClick={() => void askPhone('resolve', { outboxId: m.id, sent: true })}>
              It was sent
            </Button>
            <Button disabled={busy} onClick={() => void sendAgain()}>
              Send again
            </Button>
          </div>
        </div>
      )}
      {byHand && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
          <p className="min-w-0 flex-1 text-[13px] text-ink-soft">
            {phone ? 'This text did not go out through your phone. You can send it yourself from this device.' : `${m.toName} has no phone number on file, so there is nowhere to send this.`}
          </p>
          {phone && (
            <OpenInMessages
              phone={phone}
              text={handText}
              onError={setHandError}
              onOpen={() => {
                setHandError(undefined)
                again(HAND_SENT_NOTE)
                toast(`Opening your Messages app. You can undo the queued message for ${UNDO_SECONDS} seconds.`)
              }}
            />
          )}
        </div>
      )}
      {handError && (
        <p role="alert" className="mt-2 text-[13px] text-bad">
          {handError}
        </p>
      )}
      {open ? (
        <div className="motion-rise mt-2 flex flex-col gap-2">
          <Body body={m.body} bodyEn={m.bodyEn} language={m.language} />
          {m.status === 'failed' && m.error && canDeliver(m.channel) && <p className="text-[13px] text-ink-soft">Error: {m.error}</p>}
          <Button
            className="self-start"
            onClick={() => {
              setHandError(undefined)
              void copyText(handText())
                .then(() => toast(`Copied. Paste it into ${CHANNEL_LABEL[m.channel]} yourself.`))
                .catch((e: unknown) => setHandError(e instanceof Error ? e.message : 'Nothing was copied. Please try again.'))
            }}
          >
            Copy for {CHANNEL_LABEL[m.channel]}
          </Button>
        </div>
      ) : (
        <p className="mt-1 line-clamp-1 text-[13px] text-muted">{preview}</p>
      )}
    </li>
  )
}

// ── Scheduled reminders ───────────────────────────────────────────────────────────────────

function Queue({ queue }: { queue: ReminderDraft[] }) {
  const sendMessage = useStore((s) => s.sendMessage)
  const toast = useToast()
  const waiting = queue.filter((r) => r.mode === 'needs_approval')
  const automatic = queue.filter((r) => r.mode === 'automatic')
  // Only what Platinum can send itself is queued. The rest stays here to be copied.
  const sendable = automatic.filter((r) => canDeliver(r.message.channel))
  const byHand = automatic.length - sendable.length
  const runDailySend = () => {
    sendable.forEach((r) => sendMessage({ ...r.message, trigger: 'automatic' }))
    toast(`${sendable.length} ${sendable.length === 1 ? 'reminder is' : 'reminders are'} queued.${byHand > 0 ? ` ${byHand} ${byHand === 1 ? 'is' : 'are'} left for you to copy and send by hand.` : ''}`)
  }
  const copy = (r: ReminderDraft) =>
    void copyText(r.message.toKind === 'student' ? textWithStudentLink(r.studentId, r.message.body) : r.message.body)
      .then(() => {
        sendMessage({ ...r.message, trigger: 'approved' })
        toast(`Copied. Paste it into ${CHANNEL_LABEL[r.message.channel]} to ${r.message.toName}.`)
      })
      .catch((e: unknown) => toast(`${e instanceof Error ? e.message : 'Nothing was copied.'} This reminder is not marked approved.`))

  if (queue.length === 0) {
    return (
      <Card>
        <Empty title="No reminders are due. They appear here when a task is close to its due date or late, according to your rules.">
          <Link to="/app/settings#reminder-rules" className="tap-link font-semibold text-accent underline">
            See the rules
          </Link>
        </Empty>
      </Card>
    )
  }

  return (
    <>
      {/* Approval lives in the Inbox. Here it is a count and the way there. */}
      <Card>
        <CardHeader
          size="section"
          className="px-5 py-4"
          title="To review"
          count={waiting.length}
          sub={
            waiting.length === 0
              ? 'No reminder is waiting for your approval. Rules set to “Ask me first” put theirs in the Inbox.'
              : `${waiting.length} ${waiting.length === 1 ? 'reminder is' : 'reminders are'} in the Inbox for you to approve, from rules set to “Ask me first”.`
          }
          action={
            waiting.length > 0 && (
              <LinkButton to="/app?kind=reminder" aria-label="Review reminders in the Inbox">
                Review in the Inbox
              </LinkButton>
            )
          }
        />
      </Card>
      <Card>
        <CardHeader
          size="section"
          className="px-5 py-4"
          title={REMINDER_MODE_LABEL.automatic}
          count={automatic.length}
          sub={`Rules set to “${REMINDER_MODE_LABEL.automatic}”. These wait here until you press the button. Nothing goes out on a timer.`}
          action={sendable.length > 0 && <Button onClick={runDailySend}>{byHand > 0 ? `Run the daily send now · ${sendable.length} of ${automatic.length}` : 'Run the daily send now'}</Button>}
        />
        {automatic.length === 0 ? (
          <p className="border-t border-line px-5 py-4 text-sm text-muted">Nothing is scheduled.</p>
        ) : (
          <ul>
            {automatic.map((r) => (
              <QueueRow
                key={r.key}
                reminder={r}
                action={canDeliver(r.message.channel) ? <Pill tone="accent">Next daily send</Pill> : <Button onClick={() => copy(r)}>Copy for {CHANNEL_LABEL[r.message.channel]}</Button>}
                note={canDeliver(r.message.channel) ? undefined : notConnectedLine(r.message.channel)}
              />
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

function QueueRow({ reminder, action, note }: { reminder: ReminderDraft; action: React.ReactNode; note?: string }) {
  const m = reminder.message
  return (
    <li className="flex flex-col gap-2 border-t border-line px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Recipient m={m} />
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone={m.kind === 'reminder_late' ? 'bad' : 'warn'}>{KIND_LABEL[m.kind]}</Pill>
          {action}
        </span>
      </div>
      {note && <p className="text-[13px] font-medium text-warn">{note}</p>}
      <Body body={m.body} bodyEn={m.bodyEn} language={m.language} />
    </li>
  )
}
