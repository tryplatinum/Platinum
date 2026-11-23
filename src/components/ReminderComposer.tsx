// A reminder about one task, drafted by the AI for one person in their
// language and for their preferred channel. The counselor reads it, edits if
// needed, and sends. "Send" writes to the Messages sent log; nothing is
// delivered in v0, and the confirmation says so.
//
// A reminder to the student can come with a parent copy: a second, separate
// draft to the primary parent, sent (or not) on its own. Whether "Also tell
// parent" starts ticked follows the student's setting (see parentCopyChoice in
// lib/derive.ts).

import { useEffect, useState } from 'react'
import { findParent, parentCopyChoice } from '../lib/derive'
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

type Draft = ReminderMessage & { sent?: boolean }
const sameRecipient = (a: Pick<Draft, 'toKind' | 'parentId'>, b: Pick<Draft, 'toKind' | 'parentId'>) => a.toKind === b.toKind && a.parentId === b.parentId

export function ReminderComposer({ student, task, onDone }: { student: Student; task: Task; onDone: () => void }) {
  const data = useData()
  const sendMessage = useStore((s) => s.sendMessage)
  const toast = useToast()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [loading, setLoading] = useState(0)
  const [error, setError] = useState<string>()
  const [editing, setEditing] = useState(false)
  const to = reminderRecipient(student, task)
  // The parent copy only applies to a reminder that goes to the student.
  const choice = to?.kind === 'student' ? parentCopyChoice(data, student) : { offered: false, ticked: false, parent: undefined }
  const [tellParent, setTellParent] = useState(choice.ticked)
  const parentDraft = drafts.find((d) => d.toKind === 'parent' && to?.kind === 'student')

  const draft = (recipient: ReminderRecipient, { replace = false, useNotes = true } = {}) => {
    setLoading((n) => n + 1)
    setError(undefined)
    reminderDraft(data, student, task, recipient, { useNotes })
      // One draft per recipient, even if the request ran twice. A redraft takes the old one's place.
      .then((message) => setDrafts((d) => (d.some((x) => sameRecipient(x, message)) ? (replace ? d.map((x) => (sameRecipient(x, message) && !x.sent ? message : x)) : d) : [...d, message])))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong.'))
      .finally(() => setLoading((n) => n - 1))
  }

  // Draft once when the composer opens: the reminder, and the parent copy if it starts ticked.
  useEffect(() => {
    if (!to) return
    draft(to)
    if (choice.offered && choice.ticked && choice.parent) draft({ kind: 'parent', parent: choice.parent })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  if (!to) return <p className="text-sm text-muted">This task is yours, so there is nobody to remind.</p>

  const toggleParent = (checked: boolean) => {
    setTellParent(checked)
    if (checked && !parentDraft && choice.parent) draft({ kind: 'parent', parent: choice.parent })
    // A copy already sent is in the log and stays on screen.
    if (!checked) setDrafts((d) => d.filter((x) => x.toKind !== 'parent' || x.sent))
  }

  /** Each message is approved and logged on its own. */
  const send = (i: number) => {
    const d = drafts[i]
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
      note: d.toKind === 'parent' && to.kind === 'student' ? 'Parent copy of a reminder' : undefined,
    })
    toast(`Reminder to ${d.toName} sent. ${SENT_NOTE}`)
    const left = drafts.filter((x, j) => j !== i && !x.sent).length
    if (left === 0 && loading === 0) onDone()
    else setDrafts((all) => all.map((x, j) => (j === i ? { ...x, sent: true } : x)))
  }

  const patch = (i: number, fields: Partial<ReminderMessage>) => setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...fields } : x)))

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-canvas p-4">
      {drafts.map((d, i) => {
        const isCopy = d.toKind === 'parent' && to.kind === 'student'
        return (
          <div key={d.toKind + (d.parentId ?? '')} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <SectionLabel>
                {isCopy ? 'Parent copy' : 'Reminder'} · {CHANNEL_NOUN[d.channel]} to {d.toName}
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
            {editing && !d.sent ? (
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
            {d.usedNote && !d.sent && (
              <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
                <span>
                  <strong>Used:</strong> {d.usedNote.text}
                </span>
                <Button variant="quiet" className="-my-2" disabled={loading > 0} onClick={() => draft({ kind: 'student' }, { replace: true, useNotes: false })}>
                  Redraft without it
                </Button>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {d.sent ? (
                <span className="text-[13px] font-semibold text-good">Sent to {d.toName}. Logged in Messages sent.</span>
              ) : (
                <Button variant="primary" onClick={() => send(i)} disabled={loading > 0 || !d.body.trim()}>
                  Send to {d.toName}
                </Button>
              )}
            </div>
          </div>
        )
      })}

      {loading > 0 && <Thinking label="AI is drafting the reminder…" />}
      <AiErrorNote message={error} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {choice.offered && choice.parent && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={tellParent} disabled={loading > 0 || Boolean(parentDraft?.sent)} onChange={(e) => toggleParent(e.target.checked)} />
            Also tell parent
            <span className="text-[13px] text-muted">
              ({choice.parent.name}, by {CHANNEL_LABEL[choice.parent.channel]})
            </span>
          </label>
        )}
        <Button onClick={() => setEditing(!editing)} disabled={drafts.every((d) => d.sent)}>
          {editing ? 'Done editing' : 'Edit'}
        </Button>
        {error && drafts.length === 0 && <Button onClick={() => draft(to)}>Try again</Button>}
        <Button variant="quiet" onClick={onDone}>
          {drafts.some((d) => d.sent) ? 'Close' : 'Cancel'}
        </Button>
        <span className="text-xs text-muted">
          Goes by {CHANNEL_LABEL[drafts[0]?.channel ?? (to.kind === 'parent' ? to.parent.channel : (student.preferredChannel ?? 'text'))]}. Each message is approved and logged on its own. v0 logs messages; it does not deliver them.
        </span>
      </div>
    </div>
  )
}
