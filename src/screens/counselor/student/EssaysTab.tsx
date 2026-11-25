// A student's essays, grouped by where they are going. Selecting one opens a
// side panel with the draft, its history, and AI feedback for review.
//
// GUARDRAIL: feedback is what works, questions for the student, and what to
// work on. It never contains replacement text (the schema in
// shared/contract.ts has no field for it), and the panel says so.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApprovalCard } from '../../../components/ApprovalCard'
import {
  AiErrorNote,
  AiTag,
  ApprovalStamp,
  Button,
  Card,
  Empty,
  Field,
  FilterChips,
  Pill,
  PlaceholderNote,
  SectionLabel,
  Thinking,
  cx,
  inputBase,
  inputClass,
  textareaClass,
  useAi,
  useConfirm,
} from '../../../components/ui'
import { formatDate } from '../../../lib/dates'
import { ESSAY_STATUS, currentDraft, essayApproval, essayGroups, wordCount, type EssayGroup } from '../../../lib/derive'
import { essayFeedback } from '../../../services/ai'
import { useData, useStore } from '../../../store/store'
import type { EssayFeedback, EssayStatus, Student, StudentDocument } from '../../../types'

type Filter = 'all' | 'college' | 'summer' | 'feedback'

const statusLabel = (status: EssayStatus, student: Student) => (status === 'waiting_on_student' ? `Waiting on ${student.firstName}` : ESSAY_STATUS[status].label)

function draftLine(doc: StudentDocument): { top: string; bottom: string } {
  const draft = currentDraft(doc)
  const limit = doc.wordLimit ? ` of ${doc.wordLimit}` : ''
  if (draft) return { top: `Draft ${draft.n} · ${formatDate(draft.savedOn)}`, bottom: `${wordCount(draft.text)}${limit} words` }
  if (doc.url) return { top: 'Draft in linked document', bottom: doc.wordLimit ? `Limit ${doc.wordLimit} words` : 'Text not pasted here' }
  return { top: 'No draft yet', bottom: doc.wordLimit ? `0 of ${doc.wordLimit} words` : '' }
}

export default function EssaysTab({ student }: { student: Student }) {
  const data = useData()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<Filter>('all')
  const [adding, setAdding] = useState(false)
  const { college, summer, counts } = essayGroups(data, student.id)
  const selectedId = params.get('essay')
  const selected = data.documents.find((d) => d.id === selectedId && d.studentId === student.id && d.kind === 'essay')
  const select = (id?: string) => {
    const next = new URLSearchParams(params)
    if (id) next.set('essay', id)
    else next.delete('essay')
    setParams(next, { replace: true })
  }
  const keep = (e: StudentDocument) => filter !== 'feedback' || e.status === 'needs_feedback' || e.feedback?.review === 'pending'
  const visible = (groups: EssayGroup[]) => groups.map((g) => ({ ...g, essays: g.essays.filter(keep) })).filter((g) => g.essays.length > 0)
  const collegeGroups = filter === 'summer' ? [] : visible(college)
  const summerGroups = filter === 'college' ? [] : visible(summer)

  const group = (g: EssayGroup, prefix: string) => (
    <Card key={g.key}>
      <div className="px-5 py-4">
        <h2 className="text-base font-semibold">
          {prefix} · {g.title}
        </h2>
        <p className="text-[13px] text-muted">
          {g.deadline ? `Due ${formatDate(g.deadline)} · ` : ''}
          {g.essays.length} {g.essays.length === 1 ? 'essay' : 'essays'}
        </p>
      </div>
      <ul>
        {g.essays.map((e) => {
          const line = draftLine(e)
          const status = e.status ?? 'not_started'
          return (
            <li key={e.id} className="border-t border-line">
              <button
                type="button"
                aria-current={selected?.id === e.id}
                onClick={() => select(e.id)}
                className={cx('flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left', selected?.id === e.id ? 'bg-accent-soft' : 'hover:bg-surface-2')}
              >
                <span className="min-w-[10rem] flex-1">
                  <span className="block text-sm font-semibold">{e.name}</span>
                  <span className="block text-[13px] text-muted">{e.topic || 'No topic noted'}</span>
                </span>
                <span className="w-44 text-[13px] text-muted">
                  {line.top}
                  <br />
                  {line.bottom}
                </span>
                <Pill tone={ESSAY_STATUS[status].tone}>{statusLabel(status, student)}</Pill>
                {e.feedback?.review === 'pending' && <Pill tone="accent">Feedback to approve</Pill>}
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          label="Filter essays"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'college', label: 'College applications', count: counts.college },
            { value: 'summer', label: 'Summer programs', count: counts.summer },
            { value: 'feedback', label: 'Needs your feedback', count: counts.needsFeedback },
          ]}
        />
        <Button variant="primary" onClick={() => setAdding(true)}>
          Add essay
        </Button>
      </div>

      {adding && <AddEssayForm student={student} onDone={(id) => (setAdding(false), id && select(id))} />}

      <div className={cx('grid grid-cols-1 items-start gap-6', selected && 'xl:grid-cols-[minmax(0,1fr)_420px]')}>
        <div className="flex min-w-0 flex-col gap-6">
          {counts.all === 0 && !adding ? (
            <Card>
              <Empty title={`No essays for ${student.firstName} yet. Add the essays this student has to write, then paste drafts in as they arrive.`}>
                <Button variant="primary" onClick={() => setAdding(true)}>
                  Add essay
                </Button>
              </Empty>
            </Card>
          ) : collegeGroups.length + summerGroups.length === 0 ? (
            <Card>
              <Empty title="No essays match this filter.">
                <Button onClick={() => setFilter('all')}>Show all</Button>
              </Empty>
            </Card>
          ) : (
            <>
              {collegeGroups.map((g) => group(g, 'College applications'))}
              {summerGroups.map((g) => group(g, 'Summer programs'))}
            </>
          )}
        </div>
        {selected && <EssayPanel key={selected.id} doc={selected} student={student} onClose={() => select()} />}
      </div>
    </>
  )
}

// ── Add an essay ────────────────────────────────────────────────────────────

function AddEssayForm({ student, onDone }: { student: Student; onDone: (id?: string) => void }) {
  const addDocument = useStore((s) => s.addDocument)
  const [f, setF] = useState({ name: '', target: '', essayGroup: 'college' as 'college' | 'summer', wordLimit: '', topic: '', essayPrompt: '', url: '' })
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch })
  return (
    <Card className="p-5">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          const id = addDocument({
            studentId: student.id,
            name: f.name.trim(),
            kind: 'essay',
            addedBy: 'counselor',
            essayGroup: f.essayGroup,
            target: f.target.trim(),
            topic: f.topic.trim() || undefined,
            essayPrompt: f.essayPrompt.trim() || undefined,
            wordLimit: Number(f.wordLimit) || undefined,
            url: f.url.trim() || undefined,
          })
          onDone(id)
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Essay">
            <input className={inputClass} required autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. PIQ 2 · Leadership, or Why NYU" />
          </Field>
          <Field label="For" hint="School, system or program. Essays for the same one are grouped.">
            <input className={inputClass} required value={f.target} onChange={(e) => set({ target: e.target.value })} placeholder="e.g. University of California" />
          </Field>
          <Field label="Kind">
            <select className={inputClass} value={f.essayGroup} onChange={(e) => set({ essayGroup: e.target.value as 'college' | 'summer' })}>
              <option value="college">College application</option>
              <option value="summer">Summer program</option>
            </select>
          </Field>
          <Field label="Word limit">
            <input className={inputClass} inputMode="numeric" value={f.wordLimit} onChange={(e) => set({ wordLimit: e.target.value })} placeholder="e.g. 350" />
          </Field>
          <Field label="Topic (optional)">
            <input className={inputClass} value={f.topic} onChange={(e) => set({ topic: e.target.value })} />
          </Field>
          <Field label="Link to the draft (optional)">
            <input className={inputClass} type="url" value={f.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://docs.google.com/…" />
          </Field>
        </div>
        <Field label="Prompt (optional)" hint="The AI checks the draft against this when you ask for feedback.">
          <textarea className={textareaClass} rows={2} value={f.essayPrompt} onChange={(e) => set({ essayPrompt: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={() => onDone()}>Cancel</Button>
          <Button type="submit" variant="primary">
            Add essay
          </Button>
        </div>
      </form>
    </Card>
  )
}

// ── The selected essay ──────────────────────────────────────────────────────

function EssayPanel({ doc, student, onClose }: { doc: StudentDocument; student: Student; onClose: () => void }) {
  const { saveEssayDraft, updateDocument, removeDocument, setEssayFeedback } = useStore.getState()
  const data = useData()
  const confirm = useConfirm()
  const { busy, error, run } = useAi()
  const draft = currentDraft(doc)
  const [text, setText] = useState(draft?.text ?? '')
  const [showDraft, setShowDraft] = useState(!draft)
  const [showHistory, setShowHistory] = useState(false)
  // Keep the editor in step when the saved draft changes underneath it.
  useEffect(() => setText(draft?.text ?? ''), [draft?.n, draft?.text])

  const feedback = doc.feedback
  const pending = feedback?.review === 'pending'
  const dirty = text !== (draft?.text ?? '')
  const status = doc.status ?? 'not_started'
  const stale = feedback && draft && feedback.draftN !== undefined && feedback.draftN !== draft.n
  const getFeedback = () => run(async () => setEssayFeedback(doc.id, await essayFeedback(doc, student)))

  return (
    <aside aria-label="Selected essay" className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-surface p-5 xl:sticky xl:top-6">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <SectionLabel>Selected</SectionLabel>
          <h2 className="text-lg font-bold">{doc.name}</h2>
          <p className="text-[13px] text-muted">
            {doc.target} · {draft ? `Draft ${draft.n} · ${wordCount(draft.text)}${doc.wordLimit ? ` of ${doc.wordLimit}` : ''} words · saved ${formatDate(draft.savedOn)}` : 'no draft pasted yet'}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close essay panel" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl text-muted hover:bg-surface-2">
          ×
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label>
          <SectionLabel className="mb-1">Status</SectionLabel>
          <select className={inputBase} value={status} onChange={(e) => updateDocument(doc.id, { status: e.target.value as EssayStatus })}>
            {(Object.keys(ESSAY_STATUS) as EssayStatus[]).map((s) => (
              <option key={s} value={s}>
                {statusLabel(s, student)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <SectionLabel className="mb-1">Word limit</SectionLabel>
          <input className={cx(inputBase, 'w-24')} inputMode="numeric" defaultValue={doc.wordLimit ?? ''} onBlur={(e) => updateDocument(doc.id, { wordLimit: Number(e.target.value) || undefined })} />
        </label>
        {doc.url && (
          <a href={doc.url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center text-sm font-semibold text-accent underline">
            Open linked document
          </a>
        )}
      </div>

      {doc.essayPrompt && <p className="rounded-lg bg-canvas p-3 text-[13px] leading-relaxed text-ink-soft">{doc.essayPrompt}</p>}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setShowDraft(!showDraft)} aria-expanded={showDraft}>
          {showDraft ? 'Hide draft' : draft ? 'Open draft' : 'Paste a draft'}
        </Button>
        {(doc.drafts?.length ?? 0) > 1 && (
          <Button onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory}>
            Draft history
          </Button>
        )}
      </div>

      {showDraft && (
        <div className="flex flex-col gap-2">
          <textarea
            className={cx(textareaClass, 'font-serif text-[15px] leading-7')}
            rows={14}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={`${student.firstName}’s draft`}
            placeholder={`Paste ${student.firstName}’s draft here. These are the student’s words: Platinum stores them and never changes them.`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => saveEssayDraft(doc.id, text, false)} disabled={!dirty || !draft}>
              Save over draft {draft?.n ?? 1}
            </Button>
            <Button variant="primary" onClick={() => saveEssayDraft(doc.id, text, true)} disabled={!dirty || !text.trim()}>
              Save as draft {(draft?.n ?? 0) + 1}
            </Button>
            <span className="text-[13px] text-muted">
              {wordCount(text)}
              {doc.wordLimit ? ` of ${doc.wordLimit}` : ''} words
            </span>
          </div>
        </div>
      )}

      {showHistory && (
        <ul className="flex flex-col gap-2">
          {[...(doc.drafts ?? [])].reverse().map((d) => (
            <li key={d.n}>
              <details className="rounded-lg border border-line">
                <summary className="flex min-h-11 items-center px-3 text-sm font-semibold">
                  Draft {d.n} · {formatDate(d.savedOn)} · {wordCount(d.text)} words
                </summary>
                <p className="whitespace-pre-wrap border-t border-line p-3 font-serif text-sm leading-relaxed">{d.text}</p>
              </details>
            </li>
          ))}
        </ul>
      )}

      {/* Feedback */}
      <div className="flex flex-col gap-3 rounded-lg border border-accent-line bg-accent-soft p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">{feedback?.review === 'approved' ? 'Feedback sent' : 'Feedback draft'}</span>
          {feedback && (pending ? <AiTag source={feedback.source}>AI draft · not sent</AiTag> : <Pill tone={feedback.review === 'approved' ? 'good' : 'neutral'}>{feedback.review === 'approved' ? `Shared with ${student.firstName}` : 'Discarded'}</Pill>)}
        </div>
        <AiErrorNote message={error} />
        {busy && <Thinking label="AI is reading the draft…" />}

        {!feedback && !busy && <p className="text-sm text-ink-soft">{draft ? 'No feedback yet for this draft.' : 'Paste a draft above, then ask for feedback.'}</p>}

        {feedback && !busy && (
          <>
            <PlaceholderNote source={feedback.source} />
            {stale && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">This feedback was written about draft {feedback.draftN}. The current draft is {draft.n}.</p>}
            {pending ? (
              <ApprovalCard item={essayApproval(data, doc)} as="div" compact>
                <Feedback feedback={feedback} student={student} />
              </ApprovalCard>
            ) : (
              <Feedback feedback={feedback} student={student} />
            )}
            <ApprovalStamp approval={feedback.approval} />
          </>
        )}

        <div className="flex flex-wrap gap-2">
          {!busy && (!feedback || !pending || stale) && (
            <Button variant={feedback ? 'secondary' : 'primary'} onClick={getFeedback} disabled={!draft?.text.trim()}>
              {feedback ? 'Get feedback on the current draft' : 'Get AI feedback'}
            </Button>
          )}
        </div>
      </div>

      <p className="rounded-lg bg-canvas p-3 text-[13px] leading-relaxed text-ink-soft">
        <strong>Feedback only. Platinum never writes or rewrites essay text.</strong> It points out what works, asks questions and flags gaps, and nothing reaches the student until you approve it.
      </p>

      <Button
        variant="danger"
        className="self-start"
        onClick={async () => {
          if (!(await confirm({ title: 'Delete essay', body: `Delete “${doc.name}” and its drafts?`, action: 'Delete essay' }))) return
          removeDocument(doc.id)
          onClose()
        }}
      >
        Delete essay
      </Button>
    </aside>
  )
}

function Feedback({ feedback, student }: { feedback: EssayFeedback; student: Student }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-relaxed">{feedback.overall}</p>
      <div>
        <SectionLabel>What works</SectionLabel>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
          {feedback.strengths.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
      <div>
        <SectionLabel>Questions for {student.firstName}</SectionLabel>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
          {feedback.points.map((p, i) => (
            <li key={i}>{p.question}</li>
          ))}
        </ul>
      </div>
      <div>
        <SectionLabel>To work on</SectionLabel>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
          {feedback.points.map((p, i) => (
            <li key={i}>
              <span className="font-semibold">
                {p.area}
                {p.location && ` · ${p.location}`}:
              </span>{' '}
              {p.observation}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
