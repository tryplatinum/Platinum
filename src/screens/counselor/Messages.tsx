// Messages sent. Sent: the log of everything that "went out". Queue: reminders
// that are due under the rules. Rules: what is automatic and what waits.
// v0 logs messages and does not deliver them; the page says so at the top.

import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Card, CardHeader, Empty, Pill, SENT_NOTE, SegmentedControl, Tabs, PageHeader, cx, inputBase, useTab, useToast, type TabItem } from '../../components/ui'
import { formatTimestamp } from '../../lib/dates'
import { activeStudents, findStudent, fullName } from '../../lib/derive'
import { CHANNEL_LABEL, LANGUAGE_LABEL } from '../../lib/language'
import { reminderQueue, type ReminderDraft } from '../../lib/reminders'
import { useData, useStore } from '../../store/store'
import type { OutboxKind, OutboxMessage, ReminderMode } from '../../types'

const KIND_LABEL: Record<OutboxKind, string> = {
  parent_report: 'Parent report',
  reminder_upcoming: 'Reminder: due soon',
  reminder_late: 'Reminder: late',
  meeting_recap: 'Meeting recap',
  essay_feedback: 'Essay feedback',
}

const MODES: { value: ReminderMode; label: string }[] = [
  { value: 'automatic', label: 'Automatic' },
  { value: 'needs_approval', label: 'Ask me first' },
  { value: 'off', label: 'Off' },
]

type TabKey = 'sent' | 'queue' | 'rules'

export default function Messages() {
  const data = useData()
  const queue = reminderQueue(data)
  const tabs: TabItem<TabKey>[] = [
    { key: 'sent', label: 'Sent' },
    { key: 'queue', label: 'Queue', count: queue.length },
    { key: 'rules', label: 'Rules' },
  ]
  const tab = useTab(tabs)

  return (
    <>
      <PageHeader title="Messages sent" />
      <p className="rounded-lg border border-accent-line bg-accent-soft px-4 py-3 text-sm text-ink-soft">
        <strong className="text-ink">v0 logs messages. It does not deliver them.</strong> Every reminder, report, recap and piece of feedback you send is recorded here so you can see exactly what would go out. Use “Copy” to paste a
        message into email, text, WeChat or LINE yourself.
      </p>
      <Tabs tabs={tabs} label="Messages" />
      {tab === 'sent' && <Sent />}
      {tab === 'queue' && <Queue queue={queue} />}
      {tab === 'rules' && <Rules />}
    </>
  )
}

// ── Sent ────────────────────────────────────────────────────────────────────

function Sent() {
  const data = useData()
  const [params, setParams] = useSearchParams()
  const student = params.get('student') ?? ''
  const kind = params.get('kind') ?? ''
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const rows = data.outbox.filter((m) => (!student || m.studentId === student) && (!kind || m.kind === kind))

  return (
    <Card>
      <CardHeader
        size="section"
        className="px-5 py-4"
        title="Sent"
        count={rows.length}
        action={
          <>
            <select aria-label="Filter by student" className={inputBase} value={student} onChange={(e) => setFilter('student', e.target.value)}>
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
            <LogRow key={m.id} message={m} />
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
        {m.toKind === 'parent' ? 'parent of ' : 'student'}
        {m.toKind === 'parent' && student && (
          <Link to={`/app/students/${student.id}`} className="font-medium text-accent hover:underline">
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
  return (
    <div className={cx('grid gap-3', bodyEn && 'md:grid-cols-2')}>
      <p lang={language} className="whitespace-pre-wrap rounded-lg bg-canvas p-3 text-sm leading-relaxed">
        {body}
      </p>
      {bodyEn && (
        <p className="whitespace-pre-wrap rounded-lg border border-line p-3 text-sm leading-relaxed text-ink-soft">
          <span className="mb-1 block text-xs font-semibold text-muted">English, for you</span>
          {bodyEn}
        </p>
      )}
    </div>
  )
}

function LogRow({ message: m }: { message: OutboxMessage }) {
  const [open, setOpen] = useState(false)
  const toast = useToast()
  return (
    <li className="border-t border-line px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Recipient m={m} />
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone={m.kind === 'reminder_late' ? 'bad' : 'neutral'}>{KIND_LABEL[m.kind]}</Pill>
          <Pill tone={m.trigger === 'approved' ? 'good' : 'accent'}>{m.trigger === 'approved' ? 'You approved' : 'Automatic rule'}</Pill>
          <span className="text-[13px] text-muted">{formatTimestamp(m.sentAt)}</span>
          <Button variant="quiet" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide' : 'View'}
          </Button>
        </span>
      </div>
      {open ? (
        <div className="mt-2 flex flex-col gap-2">
          <Body body={m.body} bodyEn={m.bodyEn} language={m.language} />
          <Button
            className="self-start"
            onClick={() => {
              void navigator.clipboard?.writeText(m.body)
              toast(`Copied. Paste it into ${CHANNEL_LABEL[m.channel]} yourself.`)
            }}
          >
            Copy for {CHANNEL_LABEL[m.channel]}
          </Button>
        </div>
      ) : (
        <p className="mt-1 line-clamp-1 text-[13px] text-muted">{m.body}</p>
      )}
    </li>
  )
}

// ── Queue ───────────────────────────────────────────────────────────────────

function Queue({ queue }: { queue: ReminderDraft[] }) {
  const sendMessage = useStore((s) => s.sendMessage)
  const toast = useToast()
  const waiting = queue.filter((r) => r.mode === 'needs_approval')
  const automatic = queue.filter((r) => r.mode === 'automatic')
  const send = (items: ReminderDraft[], trigger: 'approved' | 'automatic') => {
    items.forEach((r) => sendMessage({ ...r.message, trigger }))
    toast(`${items.length} ${items.length === 1 ? 'reminder' : 'reminders'} sent. ${SENT_NOTE}`)
  }

  if (queue.length === 0) {
    return (
      <Card>
        <Empty title="No reminders are due. They appear here when a task is close to its due date or late, according to your rules.">
          <Link to="?tab=rules" className="font-semibold text-accent underline">
            See the rules
          </Link>
        </Empty>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader size="section" className="px-5 py-4" title="Waiting for you" count={waiting.length} sub="Rules set to “Ask me first”. Fixed wording, in each person’s language." />
        {waiting.length === 0 ? (
          <p className="border-t border-line px-5 py-4 text-sm text-muted">Nothing is waiting for your approval.</p>
        ) : (
          <ul>
            {waiting.map((r) => (
              <QueueRow key={r.key} reminder={r} action={<Button variant="primary" onClick={() => send([r], 'approved')}>Approve and send</Button>} />
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader
          size="section"
          className="px-5 py-4"
          title="Automatic"
          count={automatic.length}
          sub="Rules set to “Automatic”. v0 has no scheduler, so the daily send is a button."
          action={automatic.length > 0 && <Button onClick={() => send(automatic, 'automatic')}>Run the daily send now</Button>}
        />
        {automatic.length === 0 ? (
          <p className="border-t border-line px-5 py-4 text-sm text-muted">Nothing is scheduled.</p>
        ) : (
          <ul>
            {automatic.map((r) => (
              <QueueRow key={r.key} reminder={r} action={<Pill tone="accent">Next daily send</Pill>} />
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

function QueueRow({ reminder, action }: { reminder: ReminderDraft; action: React.ReactNode }) {
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
      <Body body={m.body} bodyEn={m.bodyEn} language={m.language} />
    </li>
  )
}

// ── Rules ───────────────────────────────────────────────────────────────────

function Rules() {
  const rules = useData().reminderRules
  const updateRule = useStore((s) => s.updateRule)
  return (
    <Card>
      <CardHeader size="section" className="px-5 py-4" title="Reminder rules" sub="These decide which reminders appear in the queue, and whether they wait for you." />
      <ul>
        {rules.map((rule) => (
          <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
            <div className="min-w-[14rem] flex-1">
              <p className="text-sm font-semibold">{rule.label}</p>
              <p className="text-[13px] text-muted">{rule.description}</p>
            </div>
            {rule.id !== 'student_late' && rule.id !== 'parent_late' && (
              <label className="flex items-center gap-2 text-[13px] text-muted">
                <input type="number" min={1} max={14} className={cx(inputBase, 'w-16 text-center')} value={rule.days} onChange={(e) => updateRule(rule.id, { days: Math.max(1, Number(e.target.value) || 1) })} aria-label={`Days for: ${rule.label}`} />
                {rule.id === 'parent_escalation' ? 'days late' : 'days before'}
              </label>
            )}
            <SegmentedControl label={`Mode for: ${rule.label}`} value={rule.mode} onChange={(mode) => updateRule(rule.id, { mode })} options={MODES} />
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
        Queue reminders use fixed wording. Reminders you start with a “Remind” button are drafted by the AI and always wait for you. Anything else the AI writes (reports, recaps, feedback) always waits for your approval, whatever these are set
        to.
      </p>
    </Card>
  )
}
