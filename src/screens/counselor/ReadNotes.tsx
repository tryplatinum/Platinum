// Reading the counselor's own notes. Paste or upload notes; the AI proposes
// assignments with owners and due dates; the counselor corrects and approves.
// Nothing becomes a task until the counselor approves it.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { sampleCounselorNote } from '../../data/fixtures'
import { AiErrorNote, ApprovalNotice, Button, Card, PageHeader, PlaceholderNote, SourceBadge, Thinking, cx, inputBase, inputClass, useAi } from '../../components/ui'
import { findStudent, fullName } from '../../lib/derive'
import { readNotes, type NotesResult } from '../../services/ai'
import { useData, useStore } from '../../store/store'
import type { DraftTask, OwnerType } from '../../types'

const SAMPLE_STUDENT = 's-sophia'

export default function ReadNotes() {
  const data = useData()
  const addTasksFromNotes = useStore((s) => s.addTasksFromNotes)
  const [studentId, setStudentId] = useState(SAMPLE_STUDENT)
  const [text, setText] = useState('')
  const [result, setResult] = useState<NotesResult>()
  const [added, setAdded] = useState(0)
  const { busy, error, run } = useAi()
  const student = findStudent(data, studentId)!

  const patch = (id: string, p: Partial<DraftTask>) =>
    setResult((r) => r && { ...r, tasks: r.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) })
  const kept = result?.tasks.filter((t) => t.review !== 'dismissed') ?? []

  const read = () =>
    run(async () => {
      setAdded(0)
      setResult(undefined)
      setResult(await readNotes(data, text, student))
    })

  return (
    <div className="max-w-5xl">
      <PageHeader title="Read my notes" subtitle="Paste or upload your own meeting notes. The AI pulls out the assignments, who owns each one, and when it is due." />

      <div className="space-y-6">
        <Card>
          <div className="space-y-3 px-4 py-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Student</span>
                <select className={cx(inputBase, 'w-auto')} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                  {data.students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {fullName(s)}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                onClick={() => {
                  setStudentId(SAMPLE_STUDENT)
                  setText(sampleCounselorNote())
                  setResult(undefined)
                }}
              >
                Use the sample note
              </Button>
              <label className="cursor-pointer rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-canvas">
                <input
                  type="file"
                  accept=".txt,.md,text/plain"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    // Read in the browser only; the file is not uploaded anywhere.
                    if (file) setText(await file.text())
                    e.target.value = ''
                  }}
                />
                Upload a text file
              </label>
            </div>
            <textarea
              className={cx(inputClass, 'font-mono text-[13px] leading-relaxed')}
              rows={9}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste your notes here, one action item per line starting with a dash…"
              aria-label="Meeting notes"
            />
            <div className="flex items-center gap-3">
              <Button variant="primary" onClick={read} disabled={busy || !text.trim()}>
                ✦ Read notes
              </Button>
              <span className="text-xs text-faint">Use invented notes only. Do not paste real student information.</span>
            </div>
          </div>
        </Card>

        <AiErrorNote message={error} />

        {busy && (
          <Card tone="ai">
            <Thinking label="AI is reading your notes…" />
          </Card>
        )}

        {added > 0 && (
          <div className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
            ✓ {added} tasks added for {student.firstName}.{' '}
            <Link to={`/app/students/${student.id}?tab=tasks`} className="font-medium underline">
              Open the task list
            </Link>
          </div>
        )}

        {result && !busy && (
          <Card tone="ai" title={`Proposed assignments for ${student.firstName}`} action={<SourceBadge source={result.source} />}>
            <div className="space-y-3 border-b border-line px-4 py-3">
              <PlaceholderNote source={result.source} />
              <p className="text-sm text-ink">{result.summary}</p>
              <ApprovalNotice>These are proposals. They become real tasks only when you approve them.</ApprovalNotice>
            </div>
            <ul>
              {result.tasks.map((t) => {
                const ownerKey = t.owner === 'parent' ? `parent:${t.ownerParentId}` : t.owner
                const off = t.review === 'dismissed'
                return (
                  <li key={t.id} className={cx('flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 last:border-b-0', off && 'opacity-40')}>
                    <input className={cx(inputBase, 'min-w-[16rem] flex-1')} value={t.title} disabled={off} onChange={(e) => patch(t.id, { title: e.target.value })} aria-label="Task title" />
                    <select
                      className={cx(inputBase, 'w-auto')}
                      value={ownerKey}
                      disabled={off}
                      aria-label="Owner"
                      onChange={(e) => {
                        const v = e.target.value
                        patch(t.id, v.startsWith('parent:') ? { owner: 'parent', ownerParentId: v.slice(7) } : { owner: v as OwnerType, ownerParentId: undefined })
                      }}
                    >
                      <option value="student">{student.firstName}</option>
                      {student.parents.map((p) => (
                        <option key={p.id} value={`parent:${p.id}`}>
                          {p.name} ({p.relationship})
                        </option>
                      ))}
                      <option value="counselor">Counselor</option>
                    </select>
                    <input type="date" className={cx(inputBase, 'w-auto')} value={t.dueDate} disabled={off} onChange={(e) => e.target.value && patch(t.id, { dueDate: e.target.value })} aria-label="Due date" />
                    {t.dueDateBasis === 'inferred' && !off && (
                      <span className="text-xs text-warn" title="The notes gave no date. The AI suggested this one.">
                        date suggested
                      </span>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => patch(t.id, { review: off ? 'pending' : 'dismissed' })}>
                      {off ? 'Restore' : 'Remove'}
                    </Button>
                  </li>
                )
              })}
            </ul>
            {result.tasks.length > 0 && (
              <div className="flex items-center gap-3 border-t border-line px-4 py-3">
                <Button
                  variant="approve"
                  disabled={kept.length === 0}
                  onClick={() => {
                    addTasksFromNotes(student.id, kept)
                    setAdded(kept.length)
                    setResult(undefined)
                    setText('')
                  }}
                >
                  Approve {kept.length} {kept.length === 1 ? 'task' : 'tasks'}
                </Button>
                <span className="text-xs text-faint">Adds them to {student.firstName}’s task list.</span>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
