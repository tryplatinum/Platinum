// The Students page: a line about the whole caseload, then the student table
// with search and "Add student". Archived students are listed below and can be
// restored.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { StudentFormModal } from '../../components/forms'
import { StudentTable } from '../../components/StudentTable'
import { Button, Card, Empty, PageHeader, cx, inputBase, usePageTitle } from '../../components/ui'
import { formatDateLong, todayISO } from '../../lib/dates'
import { classLabel, fullName, summarizeAll } from '../../lib/derive'
import { inboxCount } from '../../lib/inbox'
import { useData, useStore } from '../../store/store'

export default function Students() {
  const data = useData()
  usePageTitle('Students')
  const { archiveStudent, loadSample } = useStore.getState()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const all = summarizeAll(data)
  const rows = all.filter((s) => `${fullName(s.student)} ${s.student.localName ?? ''} ${s.student.school}`.toLowerCase().includes(query.trim().toLowerCase()))
  const behind = all.filter((s) => s.status === 'behind').length
  const late = all.reduce((n, s) => n + s.progress.late, 0)
  const waiting = inboxCount(data)
  const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`
  const archived = data.students.filter((s) => s.archived)

  return (
    <>
      <PageHeader
        above={
          <>
            {formatDateLong(todayISO())} · {plural(all.length, 'student')} · {behind} behind · {plural(late, 'late task')} ·{' '}
            <Link to="/app" className="tap-link font-medium text-accent hover:underline">
              {waiting} waiting
            </Link>
          </>
        }
        title="Students"
        sub={all.length > 0 ? 'Most urgent first: behind, then by next deadline.' : undefined}
        actions={
          <>
            <input className={cx(inputBase, 'min-w-0 flex-1 sm:w-56 sm:flex-none')} type="search" placeholder="Search by name or school" aria-label="Search students" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add student
            </Button>
          </>
        }
      />

      <Card>
        {all.length === 0 ? (
          <Empty title="No students yet. Add your first student to start, or load the invented sample caseload to look around.">
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add student
              </Button>
              <Button onClick={loadSample}>Load the sample caseload</Button>
            </div>
          </Empty>
        ) : rows.length === 0 ? (
          <Empty title={`No student matches “${query}”.`}>
            <Button onClick={() => setQuery('')}>Clear search</Button>
          </Empty>
        ) : (
          <StudentTable rows={rows} />
        )}
      </Card>
      {/* Read out as the list narrows; the rows themselves are on screen. */}
      <p role="status" className="sr-only">
        {query.trim() ? `${plural(rows.length, 'student')} found` : ''}
      </p>

      {archived.length > 0 && (
        <Card className="p-5">
          <h2 className="text-base font-semibold">Archived · {archived.length}</h2>
          <ul className="mt-2">
            {archived.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
                <span className="text-sm">
                  <span className="font-semibold">{fullName(s)}</span> <span className="text-muted">· {classLabel(s.gradYear)}</span>
                </span>
                <Button aria-label={`Restore ${fullName(s)}`} onClick={() => archiveStudent(s.id, false)}>Restore</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {adding && <StudentFormModal onClose={() => setAdding(false)} />}
    </>
  )
}
