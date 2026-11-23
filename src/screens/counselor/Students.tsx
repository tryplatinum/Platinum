// The Students page: the same table as the command center, with search and
// "Add student". Archived students are listed below and can be restored.

import { useState } from 'react'
import { StudentFormModal } from '../../components/forms'
import { StudentTable } from '../../components/StudentTable'
import { Button, Card, Empty, PageHeader, cx, inputBase } from '../../components/ui'
import { classLabel, fullName, summarizeAll } from '../../lib/derive'
import { useData, useStore } from '../../store/store'

export default function Students() {
  const data = useData()
  const { archiveStudent, loadSample } = useStore.getState()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const all = summarizeAll(data)
  const rows = all.filter((s) => `${fullName(s.student)} ${s.student.localName ?? ''} ${s.student.school}`.toLowerCase().includes(query.trim().toLowerCase()))
  const archived = data.students.filter((s) => s.archived)

  return (
    <>
      <PageHeader
        above={`${all.length} ${all.length === 1 ? 'student' : 'students'}, most urgent first`}
        title="Students"
        actions={
          <>
            <input className={cx(inputBase, 'w-56')} type="search" placeholder="Search by name or school" aria-label="Search students" value={query} onChange={(e) => setQuery(e.target.value)} />
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

      {archived.length > 0 && (
        <Card className="p-5">
          <h2 className="text-base font-semibold">Archived · {archived.length}</h2>
          <ul className="mt-2">
            {archived.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-2 first:border-t-0">
                <span className="text-sm">
                  <span className="font-semibold">{fullName(s)}</span> <span className="text-muted">· {classLabel(s.gradYear)}</span>
                </span>
                <Button onClick={() => archiveStudent(s.id, false)}>Restore</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {adding && <StudentFormModal onClose={() => setAdding(false)} />}
    </>
  )
}
