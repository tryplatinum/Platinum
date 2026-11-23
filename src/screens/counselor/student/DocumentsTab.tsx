// A student's files and links, filed by category. Essay drafts are not listed
// here: they live in the Essays tab. v0 records names and links only; no file
// is stored.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ReminderComposer } from '../../../components/ReminderComposer'
import { Button, Card, CardHeader, Empty, FilterChips, Pill, SectionLabel, cx, inputBase } from '../../../components/ui'
import { formatDate } from '../../../lib/dates'
import { DOC_CATEGORIES, daysLate, documentsByCategory, documentsFor, fileType, missingRequestedDocuments, ownerLabel } from '../../../lib/derive'
import { useData, useStore } from '../../../store/store'
import type { Actor, DocCategory, Student } from '../../../types'

type Filter = DocCategory | 'all'

export default function DocumentsTab({ student }: { student: Student }) {
  const data = useData()
  const { addDocument, removeDocument, updateDocument } = useStore.getState()
  const [filter, setFilter] = useState<Filter>('all')
  const [adding, setAdding] = useState<DocCategory>()
  const [reminding, setReminding] = useState<string>()
  const [f, setF] = useState({ name: '', url: '' })
  const docs = documentsFor(data, student.id)
  const groups = documentsByCategory(docs)
  const missing = missingRequestedDocuments(data, student.id)
  const who = (by: Actor) => (by === 'student' ? student.firstName : by === 'parent' ? 'Parent' : 'You')
  const taskTitle = (id?: string) => data.tasks.find((t) => t.id === id)?.title

  const addForm = (category: DocCategory) => (
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg bg-canvas p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!f.name.trim()) return
        addDocument({ studentId: student.id, name: f.name.trim(), kind: 'other', category, addedBy: 'counselor', url: f.url.trim() || undefined })
        setF({ name: '', url: '' })
        setAdding(undefined)
      }}
    >
      <label className="min-w-[12rem] flex-1">
        <SectionLabel className="mb-1">Name</SectionLabel>
        <input className={cx(inputBase, 'w-full')} autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Transcript, grades 9 to 11.pdf" />
      </label>
      <label className="min-w-[12rem] flex-1">
        <SectionLabel className="mb-1">Link (optional)</SectionLabel>
        <input className={cx(inputBase, 'w-full')} type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" />
      </label>
      <label>
        <SectionLabel className="mb-1">Category</SectionLabel>
        <select className={inputBase} value={category} onChange={(e) => setAdding(e.target.value as DocCategory)}>
          {DOC_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-canvas">
        <input
          type="file"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) setF({ ...f, name: file.name })
            e.target.value = ''
          }}
        />
        Choose a file
      </label>
      <Button onClick={() => setAdding(undefined)}>Cancel</Button>
      <Button type="submit" variant="primary">
        Add
      </Button>
      <p className="w-full text-xs text-muted">v0 records the file’s name only. The file itself is not uploaded or stored.</p>
    </form>
  )

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          label="Filter by category"
          value={filter}
          onChange={setFilter}
          options={[{ value: 'all' as Filter, label: 'All', count: docs.length }, ...groups.map((g) => ({ value: g.category as Filter, label: g.label, count: g.docs.length }))]}
        />
        <Button variant="primary" onClick={() => setAdding(filter === 'all' ? 'academic' : filter)}>
          Upload or add a link
        </Button>
      </div>

      {adding && addForm(adding)}

      {missing.length > 0 && (
        <Card tone="bad" className="flex flex-col gap-3 p-5">
          <h2 className="text-[15px] font-semibold">
            {missing.length} {missing.length === 1 ? 'document' : 'documents'} requested and not received
          </h2>
          <ul className="flex flex-col gap-2">
            {missing.map((t) => {
              const late = daysLate(t)
              return (
                <li key={t.id} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">{t.title}</span>{' '}
                      <span className="text-ink-soft">
                        ({ownerLabel(t, student)}, {late > 0 ? `${late} ${late === 1 ? 'day' : 'days'} late` : `due ${formatDate(t.dueDate)}`})
                      </span>
                    </span>
                    {t.owner !== 'counselor' && (
                      <Button variant="remind" onClick={() => setReminding(reminding === t.id ? undefined : t.id)} aria-expanded={reminding === t.id}>
                        Remind {t.owner === 'student' ? student.firstName : 'parent'}
                      </Button>
                    )}
                  </div>
                  {reminding === t.id && <ReminderComposer student={student} task={t} onDone={() => setReminding(undefined)} />}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {docs.length === 0 && !adding ? (
        <Card>
          <Empty title={`No documents for ${student.firstName} yet. Add a transcript, a score report or a link. Files a student attaches to a task are filed here too.`}>
            <Button variant="primary" onClick={() => setAdding('academic')}>
              Upload or add a link
            </Button>
          </Empty>
        </Card>
      ) : (
        groups
          .filter((g) => (filter === 'all' ? g.docs.length > 0 : g.category === filter))
          .map((g) => (
            <Card key={g.category}>
              <CardHeader className="px-5 py-4" title={g.label} count={g.docs.length} action={<Button onClick={() => setAdding(g.category)}>Add</Button>} />
              {g.docs.length === 0 ? (
                <p className="border-t border-line px-5 py-4 text-sm text-muted">Nothing filed under {g.label.toLowerCase()} yet.</p>
              ) : (
                <ul>
                  {g.docs.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-5 py-3">
                      <Pill className="w-12 justify-center rounded-md px-1 text-[11px]">{fileType(d)}</Pill>
                      <div className="min-w-[12rem] flex-1">
                        {d.url ? (
                          <a href={d.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-accent underline">
                            {d.name}
                          </a>
                        ) : (
                          <span className="text-sm font-semibold">{d.name}</span>
                        )}
                        <div className="text-[13px] text-muted">{taskTitle(d.taskId) ? `From the task: ${taskTitle(d.taskId)}` : 'No task'}</div>
                      </div>
                      <div className="text-[13px] text-muted">
                        {who(d.addedBy)} · {formatDate(d.addedOn)}
                      </div>
                      <select aria-label={`Category of ${d.name}`} className={inputBase} value={d.category} onChange={(e) => updateDocument(d.id, { category: e.target.value as DocCategory })}>
                        {DOC_CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <Button variant="quiet" aria-label={`Remove ${d.name}`} onClick={() => window.confirm(`Remove “${d.name}”?`) && removeDocument(d.id)}>
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))
      )}

      <p className="text-[13px] text-muted">
        Essay drafts live in the{' '}
        <Link to="?tab=essays" className="font-semibold text-accent underline">
          Essays tab
        </Link>
        . Anything a student attaches to a task is filed here under the matching category.
      </p>
    </>
  )
}
