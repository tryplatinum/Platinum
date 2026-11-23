// Essay feedback with guardrails. The AI comments on structure, clarity and
// whether the draft answers the prompt. It never writes or rewrites the essay,
// and the page says so. The counselor approves before the student sees it.

import { Navigate, useParams } from 'react-router-dom'
import { AiBadge, Button, Card, PageHeader, Pill, ReviewTag, Thinking, cx, inputClass, useBusy } from '../../components/ui'
import { formatDate } from '../../lib/dates'
import { findStudent } from '../../lib/derive'
import { essayFeedback } from '../../services/ai'
import { useData, useStore } from '../../store/store'

export default function EssayFeedback() {
  const data = useData()
  const { studentId, docId } = useParams()
  const student = findStudent(data, studentId)
  const doc = data.documents.find((d) => d.id === docId && d.studentId === studentId)
  const setEssayFeedback = useStore((s) => s.setEssayFeedback)
  const updateEssayFeedback = useStore((s) => s.updateEssayFeedback)
  const reviewEssayFeedback = useStore((s) => s.reviewEssayFeedback)
  const [busy, run] = useBusy()

  if (!student || !doc) return <Navigate to="/app/students" replace />
  const feedback = doc.feedback
  const pending = feedback?.review === 'pending'

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
          <p className="font-semibold">Feedback only. Platinum never writes or rewrites a student’s essay.</p>
          <p className="mt-0.5">
            The AI points at what it sees and asks questions. Every word of the essay stays the student’s own. This cannot be switched off.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="The draft" action={<Pill>Read-only</Pill>}>
          <div className="space-y-3 px-4 py-4">
            {doc.essayPrompt && <p className="rounded-lg bg-canvas px-3 py-2 text-xs leading-relaxed text-muted">{doc.essayPrompt}</p>}
            {doc.essayText ? (
              <p className="whitespace-pre-wrap font-serif text-[15px] leading-7 text-ink">{doc.essayText}</p>
            ) : (
              // TODO: only two seed essays carry their text. Others would be read from the linked doc.
              <p className="text-sm text-muted">
                The text of this draft is not in the demo data.{' '}
                {doc.url && (
                  <a className="text-accent underline" href={doc.url} target="_blank" rel="noreferrer">
                    Open the linked document
                  </a>
                )}
              </p>
            )}
          </div>
        </Card>

        <Card
          tone="ai"
          title="Feedback"
          action={
            feedback && (
              <span className="flex items-center gap-2">
                <AiBadge />
                <ReviewTag review={feedback.review} approvedLabel={`Shared with ${student.firstName}`} />
              </span>
            )
          }
        >
          {busy && <Thinking label="AI is reading the draft…" />}
          {!busy && !feedback && (
            <div className="px-4 py-8 text-center">
              <Button variant="primary" onClick={() => run(async () => setEssayFeedback(doc.id, await essayFeedback(doc)))}>
                ✦ Get feedback on this draft
              </Button>
              <p className="mt-2 text-xs text-faint">Structure, clarity, and whether it answers the prompt.</p>
            </div>
          )}
          {!busy && feedback && (
            <div className="space-y-4 px-4 py-4">
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

              {feedback.points.map((p) => (
                <div key={p.area} className="rounded-lg border border-line p-3">
                  <Pill tone="ai">{p.area}</Pill>
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
                  <span className="text-xs text-faint">{student.firstName} cannot see this yet.</span>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
