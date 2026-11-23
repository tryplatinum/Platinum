// A reminder about one task, drafted by the AI for one person in their
// language and for their preferred channel. The counselor reads it, edits if
// needed, and sends. "Send" writes to the Messages sent log; nothing is
// delivered in v0, and the confirmation says so.

import { useEffect, useState } from 'react'
import { daysLate, findParent, primaryParent } from '../lib/derive'
import { CHANNEL_LABEL, LANGUAGE_LABEL } from '../lib/language'
import { reminderDraft, type ReminderMessage, type ReminderRecipient } from '../services/ai'
import { useData, useStore } from '../store/store'
import type { Student, Task } from '../types'
import { AiErrorNote, AiTag, Button, PlaceholderNote, SENT_NOTE, SectionLabel, Thinking, textareaClass, useToast } from './ui'

const CHANNEL_NOUN = { text: 'text message', email: 'email', wechat: 'WeChat message', line: 'LINE message' } as const

/** Who a reminder about this task goes to: its owner. Counselor-owned tasks have nobody to remind. */
export function reminderRecipient(student: Student, task: Task): ReminderRecipient | undefined {
  if (task.owner === 'student') return { kind: 'student' }
  if (task.owner === 'parent') {
    const parent = findParent(student, task.ownerParentId)
    return parent && { kind: 'parent', parent }
  }
  return undefined
}

export function ReminderComposer({ student, task, onDone }: { student: Student; task: Task; onDone: () => void }) {
  const data = useData()
  const sendMessage = useStore((s) => s.sendMessage)
  const toast = useToast()
  const [drafts, setDrafts] = useState<ReminderMessage[]>([])
  const [loading, setLoading] = useState(0)
  const [error, setError] = useState<string>()
  const [editing, setEditing] = useState(false)
  const to = reminderRecipient(student, task)
  const parent = primaryParent(student)
  const canAddParent = to?.kind === 'student' && parent && daysLate(task) > 0 && !drafts.some((d) => d.toKind === 'parent')

  const draft = (recipient: ReminderRecipient) => {
    setLoading((n) => n + 1)
    setError(undefined)
    reminderDraft(data, student, task, recipient)
      // One draft per recipient, even if the request ran twice.
      .then((message) => setDrafts((d) => (d.some((x) => x.toKind === message.toKind && x.parentId === message.parentId) ? d : [...d, message])))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong.'))
      .finally(() => setLoading((n) => n - 1))
  }

  // Draft once when the composer opens.
  useEffect(() => {
    if (to) draft(to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  if (!to) return <p className="text-sm text-muted">This task is yours, so there is nobody to remind.</p>

  const send = () => {
    for (const d of drafts) {
      sendMessage({
        studentId: student.id,
        toKind: d.toKind,
        toName: d.toName,
        parentId: d.parentId,
        channel: d.channel,
        language: d.language,
        kind: d.kind,
        body: d.body,
        bodyEn: d.bodyEn,
        trigger: 'approved',
        taskId: task.id,
      })
    }
    toast(`${drafts.length === 1 ? 'Reminder' : `${drafts.length} reminders`} sent. ${SENT_NOTE}`)
    onDone()
  }

  const patch = (i: number, fields: Partial<ReminderMessage>) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...fields } : x)))

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-canvas p-4">
      {drafts.map((d, i) => (
        <div key={d.toKind + (d.parentId ?? '')} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <SectionLabel>
              Reminder · {CHANNEL_NOUN[d.channel]} to {d.toName}
              {d.language !== 'en' && ` · ${LANGUAGE_LABEL[d.language]}`}
            </SectionLabel>
            <AiTag source={d.source} />
          </div>
          <PlaceholderNote source={d.source} />
          {d.warnings.map((w) => (
            <p key={w} role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
              Check before sending: {w}
            </p>
          ))}
          {editing ? (
            <>
              <textarea aria-label={`Message to ${d.toName}`} lang={d.language} className={textareaClass} rows={4} value={d.body} onChange={(e) => patch(i, { body: e.target.value })} />
              {d.bodyEn !== undefined && (
                <textarea aria-label="English version, for your records" className={textareaClass} rows={3} value={d.bodyEn} onChange={(e) => patch(i, { bodyEn: e.target.value })} />
              )}
            </>
          ) : (
            <>
              <p lang={d.language} className="whitespace-pre-wrap rounded-lg bg-surface px-3 py-2.5 text-sm leading-relaxed">
                {d.body}
              </p>
              {d.bodyEn && <p className="whitespace-pre-wrap px-1 text-[13px] leading-relaxed text-muted">English: {d.bodyEn}</p>}
            </>
          )}
        </div>
      ))}

      {loading > 0 && <Thinking label="AI is drafting the reminder…" />}
      <AiErrorNote message={error} />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={send} disabled={drafts.length === 0 || loading > 0}>
          Send{drafts.length > 1 ? ` ${drafts.length}` : ''}
        </Button>
        <Button onClick={() => setEditing(!editing)} disabled={drafts.length === 0}>
          {editing ? 'Done editing' : 'Edit'}
        </Button>
        {canAddParent && (
          <Button onClick={() => draft({ kind: 'parent', parent })} disabled={loading > 0}>
            Also tell parent
          </Button>
        )}
        {error && drafts.length === 0 && <Button onClick={() => draft(to)}>Try again</Button>}
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <span className="text-xs text-muted">
          Goes by {CHANNEL_LABEL[drafts[0]?.channel ?? (to.kind === 'parent' ? to.parent.channel : (student.preferredChannel ?? 'text'))]}. v0 logs messages; it does not deliver them.
        </span>
      </div>
    </div>
  )
}
