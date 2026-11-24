// Weekly texts: one short text to each student each week, with their next
// meeting, what is late, what is due and their task link. The counselor drafts
// the whole caseload here, then sends each one from their own phone. Nothing is
// texted by Platinum: "Copy" and "Open in Messages" hand the text to the
// counselor, and pressing either is their approval.
//
// Which task a text puts first is the AI's choice of the most urgent one; the
// row says which and why ("Leads with: …"). Every date is still the code's.
//
// A text may draw on one "thing to remember" about the student; the row says
// which ("Used: …") and offers a redraft without it. "Also tell parent" adds a
// separate short draft to the primary parent, approved and logged on its own.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AiErrorNote, AiTag, Button, Card, CardHeader, Empty, LinkButton, Pill, cx, inputBase, textareaClass, useToast } from '../../components/ui'
import { formatTimestamp } from '../../lib/dates'
import { WEEKDAYS, findParent, findStudent, fullName, parentCopyChoice, parentCopyTask, weeklyTextRows, weeklyTextsDone, type WeeklyTextRow } from '../../lib/derive'
import { CHANNEL_LABEL, LANGUAGE_LABEL } from '../../lib/language'
import { WEEKLY_TEXT_MAX, weeklyTextFactLines, weeklyTextFacts } from '../../lib/reminders'
import { draftWeeklyParentCopy, draftWeeklyText, type WeeklyDraftOptions } from '../../services/workflows'
import { useData, useStore } from '../../store/store'
import type { Student, WeeklyText } from '../../types'

const SENT_FROM_PHONE = 'You can undo the queued message for 60 seconds.'

/** What the sms: link needs: digits, with a leading + kept. */
const smsNumber = (phone: string) => phone.trim().replace(/(?!^\+)\D/g, '')

export default function WeeklyTexts() {
  const data = useData()
  const updateFirm = useStore((s) => s.updateFirm)
  const toast = useToast()
  const rows = weeklyTextRows(data)
  const done = weeklyTextsDone(data)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number }>()
  /** "Also tell parent" where the counselor changed it from how it started. */
  const [tell, setTell] = useState<Record<string, boolean>>({})

  /**
   * Whether "Also tell parent" is offered for a row, and ticked. Before a draft
   * exists it follows the student's setting; after, it shows whether there is a copy.
   */
  const parentChoice = (row: WeeklyTextRow) => {
    const choice = parentCopyChoice(data, row.student)
    const offered = choice.offered && Boolean(parentCopyTask(row.items))
    const ticked = offered && (row.draft?.parentCopy ? true : (tell[row.student.id] ?? (row.draft ? false : choice.ticked)))
    return { offered, ticked, parent: choice.parent }
  }

  /** Runs one piece of drafting for a row, showing its progress and any failure on that row. */
  const work = async (studentId: string, job: () => Promise<void>): Promise<boolean> => {
    setBusy((b) => ({ ...b, [studentId]: true }))
    setErrors(({ [studentId]: _cleared, ...rest }) => rest)
    try {
      await job()
      return true
    } catch (error) {
      setErrors((e) => ({ ...e, [studentId]: error instanceof Error ? error.message : 'The draft could not be prepared. Try again.' }))
      return false
    } finally {
      setBusy((b) => ({ ...b, [studentId]: false }))
    }
  }

  const draft = (row: WeeklyTextRow, options: WeeklyDraftOptions = {}) => work(row.student.id, () => draftWeeklyText(row.student.id, { tellParent: parentChoice(row).ticked, ...options }))

  const setTellParent = (row: WeeklyTextRow, checked: boolean) => {
    setTell((t) => ({ ...t, [row.student.id]: checked }))
    if (!row.draft) return
    if (checked) void work(row.student.id, () => draftWeeklyParentCopy(row.student.id))
    else useStore.getState().setWeeklyParentCopy(row.student.id, row.weekStart, undefined)
  }

  /** One at a time, so the count is honest and one failure does not stop the rest. */
  const draftAll = async () => {
    const todo = rows.filter((r) => !r.draft)
    let failed = 0
    setProgress({ done: 0, total: todo.length, failed })
    for (const [i, row] of todo.entries()) {
      if (!(await draft(row))) failed++
      setProgress({ done: i + 1, total: todo.length, failed })
    }
    setProgress(undefined)
    toast(failed ? `${todo.length - failed} drafted, ${failed} could not be. Those rows say why.` : `${todo.length} ${todo.length === 1 ? 'draft is' : 'drafts are'} ready to read.`)
  }

  const undrafted = rows.filter((r) => !r.draft).length

  return (
    <>
      <Card>
        <CardHeader
          size="section"
          className="px-5 py-4"
          title="Weekly texts"
          count={rows.length}
          sub="One short text per student: next meeting, late tasks, what is due, and their task link. You send each one from your own phone."
          action={
            <>
              <label className="flex items-center gap-2 text-[13px] text-muted">
                Weekly text day
                <select className={inputBase} value={data.firm.weeklyTextDay} onChange={(e) => updateFirm({ weeklyTextDay: Number(e.target.value) })}>
                  {WEEKDAYS.map((name, day) => (
                    <option key={name} value={day}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="primary" onClick={() => void draftAll()} disabled={Boolean(progress) || undrafted === 0}>
                {progress ? `Drafting ${progress.done} of ${progress.total}…` : undrafted ? `Draft all (${undrafted})` : 'All drafted'}
              </Button>
            </>
          }
        />
        {progress && (
          <p role="status" className="border-t border-line px-5 py-3 text-sm text-ink-soft">
            Drafted {progress.done} of {progress.total}
            {progress.failed > 0 && `, ${progress.failed} could not be drafted`}. You can read the ones that are ready while the rest are prepared.
          </p>
        )}
        <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
          Each week starts on {WEEKDAYS[data.firm.weeklyTextDay]}. A student appears here when they have a late task, a task due in the next 7 days, or a meeting in the next 7 days, until you send or skip their text. Nothing is
          texted automatically. Where “Also tell parent” is ticked, a separate short message to the parent is drafted as well, for you to approve on its own.
          {' The student link is not included. Copy it from their page right after you generate it. A new link stops the old one.'}
        </p>
        {rows.length === 0 ? (
          <div className="border-t border-line">
            <Empty title={done.length ? 'All of this week’s texts are sent or skipped.' : 'No student needs a text this week. They appear here when something is late, due in the next 7 days, or a meeting is coming up.'} />
          </div>
        ) : (
          <ul>
            {rows.map((row) => (
              <Row
                key={row.student.id}
                row={row}
                error={errors[row.student.id]}
                busy={Boolean(busy[row.student.id])}
                parent={parentChoice(row)}
                onTellParent={(checked) => setTellParent(row, checked)}
                onDraft={(options) => void draft(row, options)}
              />
            ))}
          </ul>
        )}
      </Card>

      {done.length > 0 && <Done />}
    </>
  )
}

function Row({
  row,
  error,
  busy,
  parent,
  onTellParent,
  onDraft,
}: {
  row: WeeklyTextRow
  error?: string
  busy: boolean
  parent: { offered: boolean; ticked: boolean; parent?: { name: string; channel: keyof typeof CHANNEL_LABEL } }
  onTellParent: (checked: boolean) => void
  onDraft: (options?: WeeklyDraftOptions) => void
}) {
  const { student, draft } = row
  const firm = useData().firm
  const { updateWeeklyText, sendWeeklyText, skipWeeklyText } = useStore.getState()
  const toast = useToast()
  const [text, setText] = useState(draft?.body ?? '')
  // A new or redrafted text replaces what is in the box.
  useEffect(() => setText(draft?.body ?? ''), [draft?.id, draft?.body])

  // Before a draft exists, show the facts it would be built from (without creating a link yet).
  const facts = draft?.facts ?? weeklyTextFactLines(weeklyTextFacts(student, firm.counselorFirstName, row.items)).slice(0, -1)
  const phone = student.phone?.trim()
  const ready = Boolean(draft && text.trim())
  const over = text.length > WEEKLY_TEXT_MAX

  /** Pressing Copy or Open in Messages is the counselor's approval of the text as it stands in the box. */
  const approve = (via: 'copy' | 'sms') => {
    if (!draft) return
    updateWeeklyText(draft.id, text)
    sendWeeklyText(draft.id, via)
  }

  return (
    <li className="flex flex-col gap-3 border-t border-line px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link to={`/app/students/${student.id}`} className="text-sm font-semibold text-accent hover:underline">
            {fullName(student)}
          </Link>
          <span className="text-[13px] text-muted">{phone || 'no phone number'}</span>
          {draft?.source && <AiTag source={draft.source} />}
        </span>
        <Button variant="quiet" onClick={() => skipWeeklyText(student.id, row.weekStart)}>
          Skip this week
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="rounded-lg border border-line p-3">
          <p className="text-xs font-semibold text-muted">Facts used, computed by Platinum</p>
          <ul className="mt-1 space-y-0.5 text-[13px] leading-relaxed text-ink-soft">
            {facts.map((line) => (
              <li key={line} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          {draft ? (
            <>
              <textarea
                className={cx(textareaClass, 'min-h-32')}
                aria-label={`Text to ${student.firstName}`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => updateWeeklyText(draft.id, text)}
              />
              <p className={cx('text-[13px]', over ? 'font-semibold text-bad' : 'text-muted')} aria-live="polite">
                {text.length} of {WEEKLY_TEXT_MAX} characters{over && '. Too long for one text: shorten it.'}
              </p>
              {draft.lead && (
                <p className="text-[13px] text-ink-soft">
                  <strong>Leads with:</strong> {draft.lead.title}
                  <span className="text-muted">
                    {' '}
                    · the AI’s choice of the most urgent task{draft.lead.changedOrder ? ', ahead of one that is more overdue' : ', which is also the most overdue'}
                    {draft.lead.reason && `. Its reason: ${draft.lead.reason}`}
                  </span>
                </p>
              )}
              {draft.usedNote && (
                <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
                  <span>
                    <strong>Used:</strong> {draft.usedNote.text}
                  </span>
                  <Button variant="quiet" className="-my-2" disabled={busy} onClick={() => onDraft({ useNotes: false })}>
                    Redraft without it
                  </Button>
                </p>
              )}
              {draft.source?.kind === 'placeholder' && (
                <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
                  <strong>Fixed template, not AI wording.</strong> {draft.source.reason}
                </p>
              )}
            </>
          ) : (
            <p className="rounded-lg bg-canvas px-3 py-4 text-sm text-muted">{busy ? 'Drafting…' : 'No draft yet.'}</p>
          )}
          <AiErrorNote message={error} />

          <div className="flex flex-wrap items-center gap-2">
            {!draft ? (
              <Button onClick={() => onDraft()} disabled={busy}>
                {busy ? 'Drafting…' : 'Draft'}
              </Button>
            ) : !phone ? (
              <LinkButton to={`/app/students/${student.id}?tab=profile`}>Add a phone number</LinkButton>
            ) : (
              <>
                <Button
                  variant="primary"
                  disabled={!ready || over}
                  onClick={() => {
                    void navigator.clipboard?.writeText(text)
                    approve('copy')
                    toast(`Copied. Paste it into a text to ${student.firstName}. ${SENT_FROM_PHONE}`)
                  }}
                >
                  Copy
                </Button>
                <a
                  href={ready && !over ? `sms:${smsNumber(phone)}?&body=${encodeURIComponent(text)}` : undefined}
                  aria-disabled={!ready || over}
                  className={cx(
                    'inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-canvas',
                    (!ready || over) && 'pointer-events-none opacity-50',
                  )}
                  onClick={() => {
                    approve('sms')
                    toast(`Opening your Messages app. ${SENT_FROM_PHONE}`)
                  }}
                >
                  Open in Messages
                </a>
                <Button variant="quiet" onClick={() => onDraft()} disabled={busy}>
                  {busy ? 'Drafting…' : 'Draft again'}
                </Button>
              </>
            )}
          </div>
          {draft && phone && (
            <p className="text-[13px] text-muted">“Open in Messages” needs a messaging app on this device. If nothing opens, use Copy. Either one counts as your approval and marks this text sent.</p>
          )}
          {draft && !phone && <p className="text-[13px] text-muted">{student.firstName} has no phone number on file, so there is nowhere to send this.</p>}
        </div>
      </div>

      {parent.offered && parent.parent && (
        <label className="flex min-h-11 flex-wrap items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={parent.ticked} disabled={busy || draft?.parentCopy?.status === 'sent'} onChange={(e) => onTellParent(e.target.checked)} />
          Also tell parent
          <span className="text-[13px] text-muted">
            ({parent.parent.name}, by {CHANNEL_LABEL[parent.parent.channel]}. A separate short message, approved on its own.)
          </span>
        </label>
      )}
      {draft?.parentCopy && <ParentCopyBlock text={draft} student={student} />}
    </li>
  )
}

/** This week's texts that are finished with, so a skip can be taken back. */
function Done() {
  const data = useData()
  const unskip = useStore((s) => s.unskipWeeklyText)
  return (
    <Card>
      <CardHeader size="section" className="px-5 py-4" title="Done this week" count={weeklyTextsDone(data).length} />
      <ul>
        {weeklyTextsDone(data).map((w) => {
          const student = findStudent(data, w.studentId)
          return (
            <li key={w.id} className="flex flex-col gap-3 border-t border-line px-5 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{student ? fullName(student) : 'Removed student'}</span>
              <span className="flex flex-wrap items-center gap-2">
                {w.status === 'sent' ? (
                  <>
                    <Pill tone="good">Sent from your phone</Pill>
                    <span className="text-[13px] text-muted">
                      {w.approval && `Approved by ${w.approval.by}, ${formatTimestamp(w.approval.at)}`}
                    </span>
                  </>
                ) : (
                  <>
                    <Pill>Skipped</Pill>
                    <Button variant="quiet" onClick={() => unskip(w.id)}>
                      Undo
                    </Button>
                  </>
                )}
              </span>
              </div>
              {/* A parent copy still waiting for approval stays within reach after the student's text is done. */}
              {student && w.parentCopy && <ParentCopyBlock text={w} student={student} />}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/**
 * The parent copy that goes with a weekly text: its own short draft to the
 * primary parent about one task, in their language and for their channel.
 * "Copy" is the counselor's approval of this message alone; it is logged
 * separately from the student's text. It never contains a "thing to remember".
 */
function ParentCopyBlock({ text, student }: { text: WeeklyText; student: Student }) {
  const data = useData()
  const { updateWeeklyParentCopy, sendWeeklyParentCopy } = useStore.getState()
  const toast = useToast()
  const copy = text.parentCopy!
  const parent = findParent(student, copy.parentId)
  const task = data.tasks.find((t) => t.id === copy.taskId)
  const [body, setBody] = useState(copy.body)
  const [bodyEn, setBodyEn] = useState(copy.bodyEn)
  useEffect(() => {
    setBody(copy.body)
    setBodyEn(copy.bodyEn)
  }, [copy.body, copy.bodyEn])
  if (!parent) return null
  const sent = copy.status === 'sent'
  const channel = CHANNEL_LABEL[copy.channel]

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted">
          Parent copy · {channel} to {parent.name}
          {copy.language !== 'en' && ` · ${LANGUAGE_LABEL[copy.language]}`}
        </span>
        <AiTag source={copy.source} />
        {sent && <Pill tone="good">Logged as sent</Pill>}
        {sent && copy.approval && (
          <span className="text-[13px] text-muted">
            Approved by {copy.approval.by}, {formatTimestamp(copy.approval.at)}
          </span>
        )}
      </div>
      {task && <p className="text-[13px] text-muted">About: {task.title}</p>}
      {!sent && copy.source.kind === 'placeholder' && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          <strong>Fixed template, not AI wording.</strong> {copy.source.reason}
        </p>
      )}
      {!sent &&
        copy.warnings?.map((w) => (
          <p key={w} role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
            Check before sending: {w}
          </p>
        ))}
      {sent ? (
        <>
          <p lang={copy.language} className="whitespace-pre-wrap rounded-lg bg-surface px-3 py-2.5 text-sm leading-relaxed">
            {copy.body}
          </p>
          {copy.bodyEn && <p className="whitespace-pre-wrap px-1 text-[13px] leading-relaxed text-muted">English: {copy.bodyEn}</p>}
        </>
      ) : (
        <>
          <textarea
            className={cx(textareaClass, 'min-h-24')}
            lang={copy.language}
            aria-label={`Message to ${parent.name}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => updateWeeklyParentCopy(text.id, { body })}
          />
          {bodyEn !== undefined && (
            <textarea className={textareaClass} rows={3} aria-label="English version, for your records" value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} onBlur={() => updateWeeklyParentCopy(text.id, { bodyEn })} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={!body.trim()}
              onClick={() => {
                void navigator.clipboard?.writeText(body)
                updateWeeklyParentCopy(text.id, { body, bodyEn })
                sendWeeklyParentCopy(text.id)
                toast(`Copied. Paste it into ${channel} to ${parent.name}.`)
              }}
            >
              Copy for {channel}
            </Button>
            <span className="text-[13px] text-muted">Copying is your approval of this message on its own. Untick “Also tell parent” to drop it.</span>
          </div>
        </>
      )}
    </div>
  )
}
