// Files across the whole firm: uploads waiting for a counselor to file them,
// files to check, and everything new. Nothing but files appears here.
//
// "Waiting for you" is where a counselor's upload sits until a person files
// it. It is not shown on any student's page before that.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileRow } from '../../components/files/FileRow'
import { FilingRow } from '../../components/files/FilingRow'
import { UploadWindow, useFileDrop } from '../../components/files/UploadWindow'
import { DrivePicker } from '../../components/google/DrivePicker'
import { Button, Card, CardHeader, Empty, PageHeader, cx, inputBase } from '../../components/ui'
import { activeStudents, fullName } from '../../lib/derive'
import { filesToCheck, folderOf, foldersInOrder, isSorting, newFiles, waitingFiles } from '../../lib/files'
import { driveReady, useGoogleStatus } from '../../services/google'
import { useData, useStore } from '../../store/store'
import type { StudentDocument } from '../../types'

export default function Documents() {
  const data = useData()
  const { refreshFiles } = useStore.getState()
  const [params, setParams] = useSearchParams()
  const [uploading, setUploading] = useState<File[]>()
  const [drive, setDrive] = useState(false)
  const google = useGoogleStatus()
  const studentId = params.get('student') ?? ''
  const folderId = params.get('folder') ?? ''
  const setFilter = (key: 'student' | 'folder', value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  // A file with no student or no folder yet still shows when that filter is not in use.
  const matches = (d: StudentDocument) => (!studentId || d.studentId === studentId) && (!folderId || (d.typeId ?? d.aiSuggestion?.typeId ?? folderOf(data, d)?.id) === folderId)
  const waiting = waitingFiles(data).filter(matches)
  const toCheck = filesToCheck(data).filter(matches)
  const fresh = newFiles(data).filter(matches)
  const filtered = Boolean(studentId || folderId)
  const sortingCount = data.documents.filter(isSorting).length
  const drop = useFileDrop((files) => setUploading(files))

  useEffect(() => {
    if (sortingCount === 0) return
    const timer = setInterval(() => void refreshFiles(), 4000)
    return () => clearInterval(timer)
  }, [sortingCount]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div {...drop.handlers} className={cx('flex flex-col gap-6 rounded-xl', drop.over && 'outline-2 outline-dashed outline-offset-4 outline-accent')}>
      <PageHeader
        title="Documents"
        sub="Files waiting for you, files to check, and everything new across your students."
        actions={
          <div className="flex flex-wrap gap-2">
            {driveReady(google) && <Button onClick={() => setDrive(true)}>Add from Google Drive</Button>}
            <Button variant="primary" onClick={() => setUploading([])}>
              Upload files
            </Button>
          </div>
        }
      />
      {google?.available && google.connected && google.reconnect && (
        <p role="status" className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Reconnect Google in Firm settings to add from Drive. Files already imported are not affected.
        </p>
      )}
      {drive && <DrivePicker mode="files" onClose={() => setDrive(false)} />}

      {uploading && <UploadWindow initialFiles={uploading} onClose={() => setUploading(undefined)} />}

      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className="mb-1 block text-xs font-semibold text-muted">Student</span>
          <select className={inputBase} value={studentId} onChange={(e) => setFilter('student', e.target.value)}>
            <option value="">All students</option>
            {activeStudents(data).map((s) => (
              <option key={s.id} value={s.id}>
                {fullName(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-muted">Folder</span>
          <select className={inputBase} value={folderId} onChange={(e) => setFilter('folder', e.target.value)}>
            <option value="">All folders</option>
            {foldersInOrder(data).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.archivedAt ? ' (archived)' : ''}
              </option>
            ))}
          </select>
        </label>
        {filtered && (
          <Button variant="quiet" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            Clear filters
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="px-5 py-4" title="Waiting for you" count={waiting.length} sub="Files you or a colleague uploaded that nobody has filed yet. They are on no student’s page until someone does." />
        {waiting.length === 0 ? (
          <p className="border-t border-line px-5 py-4 text-sm text-muted">{filtered ? 'Nothing waiting matches these filters.' : 'Nothing is waiting. Uploads you have not filed yet appear here.'}</p>
        ) : (
          <ul>
            {waiting.map((d) => (
              <li key={d.id} className="border-t border-line px-5 py-4">
                <FilingRow doc={d} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader className="px-5 py-4" title="Check these" count={toCheck.length} sub="Filed without a person choosing the folder: the AI was not sure, could not be reached, or sorting is switched off." />
        {toCheck.length === 0 ? (
          <p className="border-t border-line px-5 py-4 text-sm text-muted">Nothing to check.</p>
        ) : (
          <ul>
            {toCheck.map((d) => (
              <FileRow key={d.id} doc={d} showStudent />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader className="px-5 py-4" title="New" count={fresh.length} sub="Filed and not opened yet. Opening a file takes it off this list." />
        {fresh.length === 0 ? (
          <Empty title={filtered ? 'Nothing new matches these filters.' : 'Nothing new. Files your students add from their links, and files you upload, show here until someone opens them.'} />
        ) : (
          <ul>
            {fresh.map((d) => (
              <FileRow key={d.id} doc={d} showStudent />
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
