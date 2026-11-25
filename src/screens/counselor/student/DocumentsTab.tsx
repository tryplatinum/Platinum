// A student's files, grouped by folder in the firm's order. Files a counselor
// or the student uploaded are stored for real; older rows are a name or a link
// only. Essay drafts are not listed here: they live in the Essays tab.
//
// A counselor's upload appears here only once a person has filed it. Until
// then it waits on the firm-wide Documents screen.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileRow } from '../../../components/files/FileRow'
import { UploadWindow, useFileDrop } from '../../../components/files/UploadWindow'
import { DriveFolders, goneFromDrive, useLinkedFolders } from '../../../components/google/DriveFolders'
import { DrivePicker } from '../../../components/google/DrivePicker'
import { MotionList } from '../../../components/motion'
import { ReminderComposer } from '../../../components/ReminderComposer'
import { Button, Card, CardHeader, Empty, SectionLabel, cx, inputBase } from '../../../components/ui'
import { formatDate } from '../../../lib/dates'
import { daysLate, missingRequestedDocuments, ownerLabel } from '../../../lib/derive'
import { catchAllFolder, folderOf, foldersInOrder, isSorting, isWaiting, needsCheck, openFolders, studentFiles } from '../../../lib/files'
import { driveReady, useGoogleStatus } from '../../../services/google'
import { useData, useStore } from '../../../store/store'
import type { Student } from '../../../types'

export default function DocumentsTab({ student }: { student: Student }) {
  const data = useData()
  const { addDocument, refreshFiles } = useStore.getState()
  const [uploading, setUploading] = useState<File[]>()
  const [linking, setLinking] = useState(false)
  const [reminding, setReminding] = useState<string>()
  const [f, setF] = useState({ name: '', url: '', typeId: '' })
  const docs = studentFiles(data, student.id)
  const missing = missingRequestedDocuments(data, student.id)
  const sorting = docs.filter(isSorting)
  const toCheck = docs.filter(needsCheck)
  const other = catchAllFolder(data)
  const waiting = data.documents.filter((d) => isWaiting(d) && d.studentId === student.id).length
  const drop = useFileDrop((files) => setUploading(files))
  // Google Drive: shown only when the server has Google settings and this person has connected.
  const google = useGoogleStatus()
  const linked = useLinkedFolders(student.id, Boolean(google?.available))
  const gone = goneFromDrive(linked.folders)
  const [drive, setDrive] = useState<'files' | 'folder'>()
  const isGone = (d: { driveFileId?: string }) => Boolean(d.driveFileId && gone.has(d.driveFileId))

  // A student's upload shows as "Sorting…" until the AI has filed it: look again every few seconds while one is.
  useEffect(() => {
    if (sorting.length === 0) return
    const timer = setInterval(() => void refreshFiles(), 4000)
    return () => clearInterval(timer)
  }, [sorting.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Every folder that holds something, in the firm's order. An older row with no folder goes by its category.
  const filed = docs.filter((d) => !isSorting(d) && !needsCheck(d))
  const groups = foldersInOrder(data)
    .map((folder) => ({ folder, docs: filed.filter((d) => folderOf(data, d)?.id === folder.id) }))
    .filter((g) => g.docs.length > 0)

  return (
    <div {...drop.handlers} className={cx('flex flex-col gap-6 rounded-xl', drop.over && 'outline-2 outline-dashed outline-offset-4 outline-accent')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Drop files anywhere on this tab, or use the button.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setLinking(!linking)} aria-expanded={linking}>
            Add a link
          </Button>
          {driveReady(google) && (
            <>
              <Button onClick={() => setDrive('folder')}>Link a Drive folder</Button>
              <Button onClick={() => setDrive('files')}>Add from Google Drive</Button>
            </>
          )}
          <Button onClick={() => setUploading([])}>
            Upload files
          </Button>
        </div>
      </div>
      {google?.available && google.connected && google.reconnect && (
        <p role="status" className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Reconnect Google in <Link to="/app/settings#google" className="tap-link font-semibold underline">Settings</Link> to add from Drive and to sync linked folders. Files already imported are not affected.
        </p>
      )}

      {uploading && <UploadWindow studentId={student.id} initialFiles={uploading} onClose={() => setUploading(undefined)} />}
      {drive && <DrivePicker mode={drive} student={student} onClose={() => setDrive(undefined)} onLinked={linked.linked} />}
      <DriveFolders student={student} linked={linked} onLink={() => setDrive('folder')} />

      {linking && (
        <form
          className="flex flex-wrap items-end gap-3 rounded-lg bg-canvas p-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!f.name.trim()) return
            addDocument({ studentId: student.id, name: f.name.trim(), kind: 'other', category: 'other', addedBy: 'counselor', url: f.url.trim() || undefined, typeId: f.typeId || other?.id })
            setF({ name: '', url: '', typeId: '' })
            setLinking(false)
          }}
        >
          <label className="min-w-[12rem] flex-1">
            <SectionLabel className="mb-1">Name</SectionLabel>
            <input className={cx(inputBase, 'w-full')} autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Common App essay (Google Doc)" />
          </label>
          <label className="min-w-[12rem] flex-1">
            <SectionLabel className="mb-1">Link</SectionLabel>
            <input className={cx(inputBase, 'w-full')} type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…" />
          </label>
          <label>
            <SectionLabel className="mb-1">Folder</SectionLabel>
            <select className={inputBase} value={f.typeId || other?.id || ''} onChange={(e) => setF({ ...f, typeId: e.target.value })}>
              {openFolders(data).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={() => setLinking(false)}>Cancel</Button>
          <Button type="submit" variant="primary">
            Add
          </Button>
          <p className="w-full text-xs text-muted">A link is recorded as it is; nothing is copied from it. To store a file, use “Upload files”.</p>
        </form>
      )}

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

      {waiting > 0 && (
        <Card tone="accent" className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">
            {waiting} uploaded {waiting === 1 ? 'file is' : 'files are'} waiting to be filed for {student.firstName}. {waiting === 1 ? 'It shows' : 'They show'} here once filed.
          </p>
          <Link to={`/app/documents?student=${student.id}`} className="tap-link text-sm font-semibold text-accent underline">
            Open “Waiting for you”
          </Link>
        </Card>
      )}

      {toCheck.length > 0 && (
        <Card>
          <CardHeader className="px-5 py-4" title="Check these" count={toCheck.length} sub="Filed by the AI when it was not sure, or put under a catch-all folder. Move each one, or say it is in the right place." />
          <MotionList itemClassName="border-t border-line">
            {toCheck.map((d) => (
              <FileRow key={d.id} doc={d} showFolder goneFromDrive={isGone(d)} />
            ))}
          </MotionList>
        </Card>
      )}

      {sorting.length > 0 && (
        <Card>
          <CardHeader className="px-5 py-4" title={`Just added by ${student.firstName}`} count={sorting.length} />
          <MotionList itemClassName="border-t border-line">
            {sorting.map((d) => (
              <FileRow key={d.id} doc={d} />
            ))}
          </MotionList>
        </Card>
      )}

      {docs.length === 0 ? (
        <Card>
          <Empty title={`No documents for ${student.firstName} yet. Upload a transcript or a score report, or add a link. Files ${student.firstName} adds from their own link are sorted into folders here.`}>
            <Button onClick={() => setUploading([])}>
              Upload files
            </Button>
          </Empty>
        </Card>
      ) : (
        groups.map((g) => (
          <Card key={g.folder.id}>
            <CardHeader
              className="px-5 py-4"
              title={g.folder.name}
              count={g.docs.length}
              sub={[g.folder.archivedAt && 'Archived folder: it takes no new files.', g.folder.sensitivity !== 'standard' && 'Only the firm’s owner can open files in this folder.'].filter(Boolean).join(' ') || undefined}
            />
            <MotionList itemClassName="border-t border-line">
              {g.docs.map((d) => (
                <FileRow key={d.id} doc={d} goneFromDrive={isGone(d)} />
              ))}
            </MotionList>
          </Card>
        ))
      )}

      <p className="text-[13px] text-muted">
        Essay drafts live in the{' '}
        <Link to="?tab=essays" className="tap-link font-semibold text-accent underline">
          Essays tab
        </Link>
        . A link a student attaches to a task is listed here too.
      </p>
    </div>
  )
}
