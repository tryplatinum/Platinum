// Reminders and the log of everything that "went out". The counselor decides,
// rule by rule, what is automatic and what waits for approval. Nothing is
// really sent: sending writes an entry to the log below.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Empty, PageHeader, Pill, cx, inputBase } from '../../components/ui'
import { formatTimestamp } from '../../lib/dates'
import { findStudent } from '../../lib/derive'
import { CHANNEL_LABEL, LANGUAGE_LABEL } from '../../lib/language'
import { reminderQueue, type ReminderDraft } from '../../lib/reminders'
import { useData, useStore } from '../../store/store'
import type { OutboxKind, OutboxMessage, ReminderMode } from '../../types'

const MODES: { value: ReminderMode; label: string }[] = [
  { value: 'automatic', label: 'Automatic' },
  { value: 'needs_approval', label: 'Ask me first' },
  { value: 'off', label: 'Off' },
]

const KIND_LABEL: Record<OutboxKind, string> = {
  parent_report: 'Parent report',
  reminder_upcoming: 'Reminder: due soon',
  reminder_late: 'Reminder: late',
  meeting_recap: 'Meeting recap',
  essay_feedback: 'Essay feedback',
}

export default function Notifications() {
  const data = useData()
  const updateRule = useStore((s) => s.updateRule)
  const sendReminder = useStore((s) => s.sendReminder)
  const queue = reminderQueue(data)
  const needApproval = queue.filter((r) => r.mode === 'needs_approval')
  const automatic = queue.filter((r) => r.mode === 'automatic')

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Reminders"
        subtitle="Reminders to students and parents before tasks are due and when they are late. You control what is automatic."
      />

      <div className="space-y-6">
        <Card title="Your rules">
          <ul>
            {data.reminderRules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <div className="min-w-[14rem] flex-1">
                  <p className="text-sm font-medium text-ink">{rule.label}</p>
                  <p className="text-xs text-muted">{rule.description}</p>
                </div>
                {rule.id !== 'student_late' && rule.id !== 'parent_late' && (
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input
                      type="number"
                      min={1}
                      max={14}
                      className={cx(inputBase, 'w-14 px-2 py-1 text-center')}
                      value={rule.days}
                      onChange={(e) => updateRule(rule.id, { days: Math.max(1, Number(e.target.value) || 1) })}
                      aria-label="Days"
                    />
                    {rule.id === 'parent_escalation' ? 'days late' : 'days before'}
                  </label>
                )}
                <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5">
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => updateRule(rule.id, { mode: m.value })}
                      className={cx(
                        'rounded-md px-2.5 py-1 text-xs font-medium',
                        rule.mode === m.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2.5 text-xs text-faint">
            Reminders use fixed wording you can see below, in each family’s language. Anything written by AI always waits for your approval, whatever these are set to.
          </p>
        </Card>

        <Card title={`Waiting for your approval (${needApproval.length})`}>
          {needApproval.length === 0 && <Empty>No reminders are waiting for you.</Empty>}
          <ul>
            {needApproval.map((r) => (
              <QueueRow key={r.key} reminder={r} action={<Button size="sm" variant="approve" onClick={() => sendReminder(r, 'approved')}>Approve and send</Button>} />
            ))}
          </ul>
        </Card>

        <Card
          title={`Going out automatically (${automatic.length})`}
          action={
            automatic.length > 0 && (
              <Button size="sm" onClick={() => automatic.forEach((r) => sendReminder(r, 'automatic'))}>
                Run the 8:00 AM send now
              </Button>
            )
          }
        >
          {automatic.length === 0 && <Empty>Nothing is scheduled.</Empty>}
          <ul>
            {automatic.map((r) => (
              <QueueRow key={r.key} reminder={r} action={<Pill tone="info">Tomorrow, 8:00 AM</Pill>} />
            ))}
          </ul>
          {/* TODO: there is no scheduler in v0. The button above stands in for the daily send. */}
        </Card>

        <Card title="What went out" action={<Pill>Demo: nothing is really sent</Pill>}>
          {data.outbox.length === 0 && <Empty>Nothing has gone out yet.</Empty>}
          <ul>
            {data.outbox.map((m) => (
              <LogRow key={m.id} message={m} />
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

function Recipient({ m }: { m: Pick<OutboxMessage, 'toName' | 'toKind' | 'channel' | 'language' | 'studentId'> }) {
  const data = useData()
  const student = findStudent(data, m.studentId)
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm font-medium text-ink">{m.toName}</span>
      <span className="text-xs text-muted">
        {m.toKind === 'parent' ? (
          <>
            parent of{' '}
            <Link to={`/app/students/${m.studentId}`} className="hover:underline">
              {student?.firstName}
            </Link>
          </>
        ) : (
          'student'
        )}
      </span>
      <Pill>via {CHANNEL_LABEL[m.channel]}</Pill>
      {m.language !== 'en' && <Pill>{LANGUAGE_LABEL[m.language]}</Pill>}
    </span>
  )
}

function Body({ body, bodyEn, language }: { body: string; bodyEn?: string; language: string }) {
  return (
    <div className={cx('mt-2 grid gap-2', bodyEn && 'md:grid-cols-2')}>
      <p lang={language} className="whitespace-pre-wrap rounded-lg bg-canvas px-3 py-2 text-sm leading-relaxed text-ink">
        {body}
      </p>
      {bodyEn && (
        <p className="whitespace-pre-wrap rounded-lg border border-dashed border-line px-3 py-2 text-sm leading-relaxed text-muted">
          <span className="mb-1 block text-xs font-medium text-faint">English, for you</span>
          {bodyEn}
        </p>
      )}
    </div>
  )
}

function QueueRow({ reminder, action }: { reminder: ReminderDraft; action: React.ReactNode }) {
  const m = reminder.message
  return (
    <li className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Recipient m={m} />
        <span className="flex items-center gap-2">
          <Pill tone={m.kind === 'reminder_late' ? 'bad' : 'warn'}>{KIND_LABEL[m.kind]}</Pill>
          {action}
        </span>
      </div>
      <Body body={m.body} bodyEn={m.bodyEn} language={m.language} />
    </li>
  )
}

function LogRow({ message: m }: { message: OutboxMessage }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="border-b border-line px-4 py-3 last:border-b-0">
      <button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Recipient m={m} />
        <span className="flex items-center gap-2">
          <Pill>{KIND_LABEL[m.kind]}</Pill>
          <Pill tone={m.trigger === 'approved' ? 'good' : 'info'}>{m.trigger === 'approved' ? '✓ You approved' : 'Automatic rule'}</Pill>
          <span className="text-xs text-faint">{formatTimestamp(m.sentAt)}</span>
          <span className="text-faint">{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open ? <Body body={m.body} bodyEn={m.bodyEn} language={m.language} /> : <p className="mt-1 truncate text-sm text-muted">{m.body}</p>}
    </li>
  )
}
