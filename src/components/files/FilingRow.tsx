// One uploaded file that is waiting for a person to file it. Used in the upload
// window and under "Waiting for you" on the Documents screen.
//
// Two parts. The pickers (Student, Folder, title, Save) work at once, without
// waiting for the AI. The suggestion line appears above them as soon as the AI
// answers, with "Yes, put it there". Either way a person files it; the AI never
// files a counselor's upload on its own.

import { useEffect, useId, useState } from 'react'
import { formatBytes } from '../../../shared/files'
import { activeStudents, fullName } from '../../lib/derive'
import { catchAllFolder, duplicateOf, fileKind, fileTitle, folderById, openFolders, suggestionLine } from '../../lib/files'
import { useData, useStore } from '../../store/store'
import type { ID, StudentDocument } from '../../types'
import { Button, Pill, Thinking, cx, inputBase, useToast } from '../ui'

/** What the owner-only folders mean for someone who is not the owner. */
export const hiddenNote = (folderName: string) => `Filed under ${folderName}. Only the firm’s owner can open files in that folder, so it has left your lists.`

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Please try again.')

/** A searchable student picker: type part of a name, pick from the list. */
export function StudentPicker({ value, onChange, disabled, label = 'Student' }: { value: ID | undefined; onChange: (id: ID | undefined) => void; disabled?: boolean; label?: string }) {
  const data = useData()
  const listId = useId()
  const students = activeStudents(data)
  const labelOf = (id: ID | undefined) => {
    const s = data.students.find((x) => x.id === id)
    return s ? `${fullName(s)} (${s.gradYear})` : ''
  }
  const [text, setText] = useState(labelOf(value))
  // The value can change from outside (the name on the file matched a student).
  useEffect(() => setText(labelOf(value)), [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="min-w-[13rem] flex-1">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      <input
        className={cx(inputBase, 'w-full')}
        list={listId}
        value={text}
        disabled={disabled}
        placeholder="Type a name…"
        onChange={(e) => {
          setText(e.target.value)
          const typed = e.target.value.trim().toLowerCase()
          const exact = students.filter((s) => labelOf(s.id).toLowerCase() === typed || fullName(s).toLowerCase() === typed)
          onChange(exact.length === 1 ? exact[0].id : undefined)
        }}
        onBlur={() => setText(labelOf(value))}
      />
      <datalist id={listId}>
        {students.map((s) => (
          <option key={s.id} value={labelOf(s.id)} />
        ))}
      </datalist>
    </label>
  )
}

export function FilingRow({ doc, lockStudent, suggesting, onFiled }: { doc: StudentDocument; lockStudent?: boolean; suggesting?: boolean; onFiled?: (note: string) => void }) {
  const data = useData()
  const toast = useToast()
  const { fileDocument, deleteFile } = useStore.getState()
  const suggestion = doc.aiSuggestion && folderById(data, doc.aiSuggestion.typeId) ? doc.aiSuggestion : undefined
  const [studentId, setStudentId] = useState<ID | undefined>(doc.studentId || undefined)
  const [typeId, setTypeId] = useState<ID | undefined>(suggestion?.typeId ?? doc.typeId)
  const [title, setTitle] = useState(suggestion?.title ?? fileTitle(doc))
  const [touched, setTouched] = useState({ student: false, folder: false, title: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  // When the AI answers, its suggestion fills whatever the counselor has not set themselves.
  useEffect(() => {
    if (!touched.student && doc.studentId) setStudentId(doc.studentId)
    if (!touched.folder) setTypeId(suggestion?.typeId ?? doc.typeId ?? undefined)
    if (!touched.title) setTitle(suggestion?.title ?? fileTitle(doc))
  }, [doc.aiSuggestion, doc.studentId, doc.typeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const folders = openFolders(data)
  const folder = folderById(data, typeId) ?? (typeId ? undefined : catchAllFolder(data))
  const again = duplicateOf(data, studentId, doc.contentHash, doc.id)
  const line = suggestionLine(data, doc)

  const file = async (where: { typeId: ID; title: string; studentId?: ID }) => {
    setBusy(true)
    setError(undefined)
    try {
      const filed = await fileDocument(doc.id, where)
      const student = data.students.find((s) => s.id === where.studentId)
      const note = filed.hidden ? hiddenNote(filed.folderName) : `Filed under ${student ? `${fullName(student)}, ` : ''}${filed.folderName}.`
      toast(note)
      onFiled?.(note)
    } catch (e) {
      setError(reasonOf(e))
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!window.confirm(`Delete “${fileTitle(doc)}”? The file is removed for good.`)) return
    setBusy(true)
    try {
      await deleteFile(doc.id)
    } catch (e) {
      setError(reasonOf(e))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Pill className="rounded-md">{fileKind(doc)}</Pill>
        <span className="min-w-0 break-all text-sm font-semibold">{doc.originalFilename ?? doc.name}</span>
        {doc.sizeBytes !== undefined && <span className="text-[13px] text-muted">{formatBytes(doc.sizeBytes)}</span>}
        {doc.source === 'google_drive' &&
          (doc.driveUrl ? (
            <a href={doc.driveUrl} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-ink-soft underline">
              From Google Drive
            </a>
          ) : (
            <span className="text-[13px] text-muted">From Google Drive</span>
          ))}
      </div>

      {line && suggestion ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-line bg-accent-soft px-3 py-2">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">{line}</span>
            {suggestion.reason && <span className="block text-[13px] text-ink-soft">{suggestion.reason}</span>}
            {!suggestion.sure && <span className="block text-[13px] text-warn">The AI was not sure about this one.</span>}
            {!doc.studentId && !studentId && <span className="block text-[13px] text-muted">Choose a student below first: the AI never picks one.</span>}
          </p>
          <Button variant="primary" disabled={busy || !(doc.studentId || studentId)} onClick={() => void file({ typeId: suggestion.typeId, title: suggestion.title, studentId: doc.studentId || studentId })}>
            Yes, put it there
          </Button>
        </div>
      ) : suggesting ? (
        <Thinking inline label="The AI is reading it. You do not have to wait: choose below and save." />
      ) : (
        <p className="text-[13px] text-muted">{data.firm.sortFilesAutomatically ? 'No suggestion for this file. Choose where it goes.' : '“Sort files automatically” is off, so there is no suggestion. Choose where it goes.'}</p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <StudentPicker
          value={studentId}
          disabled={lockStudent || busy}
          onChange={(id) => {
            setStudentId(id)
            setTouched((t) => ({ ...t, student: true }))
          }}
        />
        <label>
          <span className="mb-1 block text-xs font-semibold text-muted">Folder</span>
          <select
            className={inputBase}
            value={folder?.id ?? ''}
            disabled={busy}
            onChange={(e) => {
              setTypeId(e.target.value)
              setTouched((t) => ({ ...t, folder: true }))
            }}
          >
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.sensitivity !== 'standard' ? ' (owner only)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[13rem] flex-[2]">
          <span className="mb-1 block text-xs font-semibold text-muted">Title</span>
          <input
            className={cx(inputBase, 'w-full')}
            value={title}
            maxLength={200}
            disabled={busy}
            onChange={(e) => {
              setTitle(e.target.value)
              setTouched((t) => ({ ...t, title: true }))
            }}
          />
        </label>
        <Button variant={line ? 'secondary' : 'primary'} disabled={busy || !studentId || !folder || !title.trim()} onClick={() => folder && void file({ typeId: folder.id, title: title.trim(), studentId })}>
          Save
        </Button>
        <Button variant="quiet" disabled={busy} onClick={() => void remove()} aria-label={`Delete ${fileTitle(doc)}`}>
          Delete
        </Button>
      </div>

      {again && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          This student already has the same file: “{fileTitle(again)}”. Save to keep both, or Delete to skip this one.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-bad-line bg-bad-tint px-3 py-2 text-[13px] text-bad">
          {error}
        </p>
      )}
    </div>
  )
}
