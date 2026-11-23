// Essay feedback with guardrails. The AI writes margin notes: where an issue
// is, what it sees there, and a question for the student. It never writes or
// rewrites the essay. The result has no field that could hold replacement
// text (see OUTPUTS.essayFeedback in shared/contract.ts), and the page says so.
// The counselor approves before the student sees anything.

import { Navigate, useParams } from 'react-router-dom'
import {
  AiErrorNote,
  ApprovalStamp,
  Button,
  Card,
  PageHeader,
  Pill,
  PlaceholderNote,
  ReviewTag,
  SourceBadge,
  Thinking,
  cx,
  inputClass,
  useAi,
} from '../../components/ui'
import { formatDate } from '../../lib/dates'
import { findStudent } from '../../lib/derive'
import { essayFeedback } from '../../services/ai'
import { useData, useStore } from '../../store/store'

export default function EssayFeedback() {
  const data = useData()
  const { studentId, docId } = useParams()
  const student = findStudent(data, studentId)
  const doc = data.documents.find((d) => d.id === docId && d.studentId === studentId)
  const updateDocument = useStore((s) => s.updateDocument)
  const setEssayFeedback = useStore((s) => s.setEssayFeedback)
  const updateEssayFeedback = useStore((s) => s.updateEssayFeedback)
  const reviewEssayFeedback = useStore((s) => s.reviewEssayFeedback)
  const { busy, error, run } = useAi()

  if (!student || !doc) return <Navigate to="/app/students" replace />
  const feedback = doc.feedback
  const pending = feedback?.review === 'pending'
  // The draft can be edited here until feedback has been shared with the student.
  const canEditDraft = feedback?.review !== 'approved'
  const getFeedback = () => run(async () => setEssayFeedback(doc.id, await essayFeedback(doc, student)))

  return (
    <div className="max-w-6xl">
      <PageHeader
        back={{ to: `/app/students/${student.id}?tab=documents`, label: `${student.firstName}’s documents` }}
        title={doc.name}
        subtitle={`Added ${formatDate(doc.addedOn)}`}
      />

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-ai/25 bg-ai-soft px-4 py-3">
        <span className="text-lg" aria-hidden>
          🛡
        </span>
        <div className="text-sm text-ai">
          <p className="font-semibold">Feedback only. We never write or rewrite essays.</p>
          <p className="mt-0.5">
            The AI works like an editor writing in the margin: it points at a place in the draft, says what it sees, and asks a question. Colleges expect
            the student’s own writing, so there is nowhere in this feature for suggested wording to go. This cannot be switched off.
          </p>
        </div>
      </div>

      <div className="mb-4">
        <AiErrorNote message={error} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="The draft" action={<Pill>{student.firstName}’s words</Pill>}>
          <div className="space-y-3 px-4 py-4">
            {canEditDraft ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted">Essay prompt</span>
                  <textarea
                    className={cx(inputClass, 'text-xs leading-relaxed')}
                    rows={3}
                    value={doc.essayPrompt ?? ''}
                    onChange={(e) => updateDocument(doc.id, { essayPrompt: e.target.value })}
                    placeholder="Paste the prompt the essay answers"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted">Draft text (paste from the student’s document)</span>
                  <textarea
                    className={cx(inputClass, 'font-serif text-[15px] leading-7')}
                    rows={18}
                    value={doc.essayText ?? ''}
                    onChange={(e) => updateDocument(doc.id, { essayText: e.target.value })}
                    placeholder="Paste the student’s draft here. The AI reads only what is in this box."
                  />
                </label>
                {/* TODO: read the linked Google Doc directly instead of pasting. */}
                {doc.url && (
                  <a className="text-xs text-accent underline" href={doc.url} target="_blank" rel="noreferrer">
                    Open the linked document
                  </a>
                )}
              </>
            ) : (
              <>
                {doc.essayPrompt && <p className="rounded-lg bg-canvas px-3 py-2 text-xs leading-relaxed text-muted">{doc.essayPrompt}</p>}
                <p className="whitespace-pre-wrap font-serif text-[15px] leading-7 text-ink">{doc.essayText}</p>
              </>
            )}
          </div>
        </Card>

        <Card
          tone="ai"
          title="Margin notes"
          action={
            feedback && (
              <span className="flex flex-wrap items-center justify-end gap-2">
                <SourceBadge source={feedback.source} />
                <ReviewTag review={feedback.review} approvedLabel={`Shared with ${student.firstName}`} />
              </span>
            )
          }
        >
          {busy && <Thinking label="AI is reading the draft…" />}
          {!busy && !feedback && (
            <div className="px-4 py-8 text-center">
              <Button variant="primary" onClick={getFeedback} disabled={!doc.essayText?.trim()}>
                ✦ Get feedback on this draft
              </Button>
              <p className="mt-2 text-xs text-faint">
                {doc.essayText?.trim() ? 'Structure, clarity, and whether it answers the prompt.' : 'Paste the draft text on the left first.'}
              </p>
            </div>
          )}
          {!busy && feedback && (
            <div className="space-y-4 px-4 py-4">
              <PlaceholderNote source={feedback.source} />
              {pending ? (
                <textarea
                  className={cx(inputClass, 'leading-relaxed')}
                  rows={4}
                  value={feedback.overall}
                  onChange={(e) => updateEssayFeedback(doc.id, { overall: e.target.value })}
                  aria-label="Overall feedback"
                />
              ) : (
                <p className="text-sm leading-relaxed text-ink">{feedback.overall}</p>
              )}

              <div>
                <p className="mb-1 text-xs font-medium text-muted">What is working</p>
                <ul className="space-y-1">
                  {feedback.strengths.map((s) => (
                    <li key={s} className="flex gap-2 text-sm text-ink">
                      <span className="text-good">✓</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>

              {feedback.points.map((p, i) => (
                <div key={i} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="ai">{p.area}</Pill>
                    {p.location && <span className="text-xs text-muted">Where: {p.location}</span>}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-ink">{p.observation}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    <span className="font-medium text-ink">A question for {student.firstName}:</span> {p.question}
                  </p>
                </div>
              ))}

              <div className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-xs text-muted">
                <span aria-hidden>🚫</span> No rewritten sentences, no suggested wording, no “improved” version. By design.
              </div>

              {pending && (
                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                  <Button variant="approve" onClick={() => reviewEssayFeedback(doc.id, 'approved')}>
                    Approve and share with {student.firstName}
                  </Button>
                  <Button variant="ghost" onClick={() => reviewEssayFeedback(doc.id, 'dismissed')}>
                    Dismiss
                  </Button>
                  <Button variant="ghost" onClick={getFeedback}>
                    Redo
                  </Button>
                  <span className="text-xs text-faint">{student.firstName} cannot see this yet.</span>
                </div>
              )}
              <ApprovalStamp approval={feedback.approval} />
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
