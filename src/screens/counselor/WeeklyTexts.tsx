// Weekly texts: one short text to each student each week, with their next
// meeting, what is late, what is due and their task link. The counselor drafts
// the whole caseload here, then sends each one from their own phone. Nothing is
// texted by Platinum: "Copy" and "Open in Messages" hand the text to the
// counselor, and pressing either is their approval.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AiErrorNote, AiTag, Button, Card, CardHeader, Empty, LinkButton, Pill, cx, inputBase, textareaClass, useToast } from '../../components/ui'
import { formatTimestamp } from '../../lib/dates'
import { WEEKDAYS, findStudent, fullName, weeklyTextRows, weeklyTextsDone, type WeeklyTextRow } from '../../lib/derive'
import { WEEKLY_TEXT_MAX, weeklyTextFactLines, weeklyTextFacts } from '../../lib/reminders'
import { draftWeeklyText, publicOrigin } from '../../services/workflows'
import { useData, useStore } from '../../store/store'

const SENT_FROM_PHONE = 'Logged in Messages sent as sent from your own phone.'

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
  const hasLink = Boolean(publicOrigin())

  const draft = async (studentId: string): Promise<boolean> => {
    setBusy((b) => ({ ...b, [studentId]: true }))
    setErrors(({ [studentId]: _cleared, ...rest }) => rest)
    try {
      await draftWeeklyText(studentId)
      return true
    } catch (error) {
      setErrors((e) => ({ ...e, [studentId]: error instanceof Error ? error.message : 'The draft could not be prepared. Try again.' }))
      return false
    } finally {
      setBusy((b) => ({ ...b, [studentId]: false }))
    }
  }

  /** One at a time, so the count is honest and one failure does not stop the rest. */
  const draftAll = async () => {
    const todo = rows.filter((r) => !r.draft)
    let failed = 0
    setProgress({ done: 0, total: todo.length, failed })
    for (const [i, row] of todo.entries()) {
      if (!(await draft(row.student.id))) failed++
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
          texted automatically.
          {!hasLink && ' Links are left out of these texts because this address only works on your own computer.'}
        </p>
        {rows.length === 0 ? (
          <div className="border-t border-line">
            <Empty title={done.length ? 'All of this week’s texts are sent or skipped.' : 'No student needs a text this week. They appear here when something is late, due in the next 7 days, or a meeting is coming up.'} />
          </div>
        ) : (
          <ul>
            {rows.map((row) => (
              <Row key={row.student.id} row={row} error={errors[row.student.id]} busy={Boolean(busy[row.student.id])} onDraft={() => void draft(row.student.id)} />
            ))}
          </ul>
        )}
      </Card>

      {done.length > 0 && <Done />}
    </>
  )
}

function Row({ row, error, busy, onDraft }: { row: WeeklyTextRow; error?: string; busy: boolean; onDraft: () => void }) {
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
              <Button onClick={onDraft} disabled={busy}>
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
                <Button variant="quiet" onClick={onDraft} disabled={busy}>
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
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 text-sm">
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
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
