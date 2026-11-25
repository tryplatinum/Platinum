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
import { MotionList } from '../../components/motion'
import { AiErrorNote, AiTag, Button, Card, CardHeader, CheckRow, Disclosure, Empty, Note, Pill, ProgressBar, cx, textareaClass, useToast } from '../../components/ui'
import { WeeklyTextSend, WeeklyTextSendNote, weeklyTextLength, weeklyTextTooLong } from '../../components/WeeklyTextSend'
import { formatTimestamp } from '../../lib/dates'
import { WEEKDAYS, findParent, findStudent, fullName, parentCopyChoice, parentCopyTask, weeklyTextRows, weeklyTextsDone, type WeeklyTextRow } from '../../lib/derive'
import { CHANNEL_LABEL, LANGUAGE_LABEL } from '../../lib/language'
import { STUDENT_LINK_PLACEHOLDER, STUDENT_LINK_PREVIEW, previewStudentLink } from '../../../shared/dispatch'
import { WEEKLY_TEXT_MAX, weeklyTextFactLines, weeklyTextFacts } from '../../lib/reminders'
import { draftWeeklyParentCopy, draftWeeklyText, type WeeklyDraftOptions } from '../../services/workflows'
import { useData, useStore } from '../../store/store'
import type { Student, WeeklyText } from '../../types'

export default function WeeklyTexts() {
  const data = useData()
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
              // Secondary: each draft is still read and sent on its own.
              <Button onClick={() => void draftAll()} busy={Boolean(progress)} disabled={undrafted === 0}>
                {progress ? `Drafting ${progress.done} of ${progress.total}…` : undrafted ? `Draft all (${undrafted})` : 'All drafted'}
              </Button>
          }
        />
        {progress && (
          <div className="flex flex-col gap-2 border-t border-line px-5 py-3">
            <p role="status" className="text-sm text-ink-soft">
              Drafted {progress.done} of {progress.total}
              {progress.failed > 0 && `, ${progress.failed} could not be drafted`}. You can read the ones that are ready while the rest are prepared.
            </p>
            <ProgressBar label="Drafting the weekly texts" done={progress.done} total={progress.total} />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-4 border-t border-line px-5 py-1 text-[13px] text-muted">
          <p>
            Each week starts on {WEEKDAYS[data.firm.weeklyTextDay]} (
            <Link to="/app/settings#reminder-rules" className="inline-flex min-h-6 items-center font-medium text-accent hover:underline">
              change the day
            </Link>
            ). Nothing is texted automatically.
          </p>
          <Disclosure label="How this works" className="basis-full">
            <p className="max-w-prose pb-3 leading-relaxed">
              A student appears here when they have a late task, a task due in the next 7 days, or a meeting in the next 7 days, until you send or skip their text. Where “Also tell parent” is ticked, a separate short message to the parent is drafted as well,
              for you to approve on its own. The student link is added when the text is sent (shown as “[student link added when sent]” in the draft).
            </p>
          </Disclosure>
        </div>
        {rows.length === 0 ? (
          <div className="border-t border-line">
            <Empty title={done.length ? 'All of this week’s texts are sent or skipped.' : 'No student needs a text this week. They appear here when something is late, due in the next 7 days, or a meeting is coming up.'} />
          </div>
        ) : (
          <MotionList itemClassName="border-t border-line">
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
          </MotionList>
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
  const { updateWeeklyText, skipWeeklyText } = useStore.getState()
  const [text, setText] = useState(draft?.body ?? '')
  // A new or redrafted text replaces what is in the box.
  useEffect(() => setText(draft?.body ?? ''), [draft?.id, draft?.body])

  // Before a draft exists, show the facts it would be built from (link filled at send).
  const facts = draft?.facts ?? weeklyTextFactLines(weeklyTextFacts(student, firm.counselorFirstName, row.items, STUDENT_LINK_PLACEHOLDER))
  const phone = student.phone?.trim()
  const over = weeklyTextTooLong(text)

  const name = (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <Link to={`/app/students/${student.id}`} className="inline-flex min-h-6 items-center text-sm font-semibold text-accent hover:underline">
        {fullName(student)}
      </Link>
      <span className="text-[13px] text-muted">{phone || 'no phone number'}</span>
      {draft?.source && <AiTag source={draft.source} />}
    </span>
  )
  const skip = (
    <Button variant="quiet" aria-label={`Skip ${student.firstName} this week`} onClick={() => skipWeeklyText(student.id, row.weekStart)}>
      Skip this week
    </Button>
  )
  const tell = parent.offered && parent.parent && (
    <CheckRow
      className={draft ? undefined : 'w-56'}
      checked={parent.ticked}
      disabled={busy || draft?.parentCopy?.status === 'sent'}
      onChange={onTellParent}
      hint={draft ? `${parent.parent.name}, by ${CHANNEL_LABEL[parent.parent.channel]}. A separate short message, approved on its own.` : `${parent.parent.name}, by ${CHANNEL_LABEL[parent.parent.channel]}`}
    >
      Also tell parent
    </CheckRow>
  )
  const factsUsed = (
    <Disclosure label="Facts used, computed by Platinum" count={facts.length}>
      <ul className="space-y-0.5 rounded-control border border-line p-3 text-[13px] leading-relaxed text-ink-soft">
        {facts.map((line) => (
          <li key={line} className="break-words">
            {line}
          </li>
        ))}
      </ul>
    </Disclosure>
  )

  // Nothing to read yet: one line a student, with the facts a press away.
  if (!draft) {
    return (
      <div className="flex flex-col px-4 py-2 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className="min-w-[12rem] flex-1">{name}</span>
          {tell}
          <span className="flex flex-wrap items-center gap-1">
            <Button onClick={() => onDraft()} busy={busy} aria-label={`Draft the text to ${student.firstName}`}>
              {busy ? 'Drafting…' : 'Draft'}
            </Button>
            {skip}
          </span>
        </div>
        {factsUsed}
        <AiErrorNote message={error} />
      </div>
    )
  }

  return (
    <div className="motion-fade flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {name}
        {skip}
      </div>
      {factsUsed}

      <div className="flex flex-col gap-2">
        <textarea
          className={cx(textareaClass, 'min-h-32')}
          aria-label={`Text to ${student.firstName}`}
          value={previewStudentLink(text)}
          onChange={(e) => setText(e.target.value.split(STUDENT_LINK_PREVIEW).join(STUDENT_LINK_PLACEHOLDER))}
          onBlur={() => updateWeeklyText(draft.id, text)}
        />
        <p className={cx('nums text-[13px]', over ? 'font-semibold text-bad' : 'text-muted')} aria-live="polite">
          {weeklyTextLength(text)} of {WEEKLY_TEXT_MAX} characters{over && '. Too long for one text: shorten it.'}
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
          <Note tone="warn">
            <strong>Fixed template, not AI wording.</strong> {draft.source.reason}
          </Note>
        )}
        <AiErrorNote message={error} />
        <div className="flex flex-wrap items-center gap-2">
          <WeeklyTextSend draft={draft} student={student} text={text}>
            <Button variant="quiet" onClick={() => onDraft()} busy={busy}>
              {busy ? 'Drafting…' : 'Draft again'}
            </Button>
          </WeeklyTextSend>
        </div>
        <WeeklyTextSendNote student={student} />
      </div>

      {tell}
      {draft.parentCopy && <ParentCopyBlock text={draft} student={student} />}
    </div>
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
                    <Button variant="quiet" aria-label={`Undo skipping ${student?.firstName ?? 'this student'}`} onClick={() => unskip(w.id)}>
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
