// The counselor's upload window. Opened from a student's Documents tab (the
// student is then already set) or from the firm-wide Documents screen.
//
// Each file goes from the browser straight to storage, with its own progress
// and its own error and retry. Once it has arrived it shows the pickers and,
// when the AI answers, the suggestion (FilingRow). Closing the window with
// files unsaved keeps them under "Waiting for you" on the Documents screen.

import { useEffect, useRef, useState, type DragEvent } from 'react'
import { FILE_ACCEPT, FILE_TYPES_LABEL, formatBytes } from '../../../shared/files'
import { fullName } from '../../lib/derive'
import { duplicateOf, fileTitle, folderById, isWaiting } from '../../lib/files'
import { checkFile, hashFile } from '../../services/files'
import { useData, useStore } from '../../store/store'
import type { ID } from '../../types'
import { Button, Modal, cx } from '../ui'
import { FilingRow } from './FilingRow'

interface Item {
  key: string
  file: File
  /** checking: before anything is sent. duplicate: the student already has it; waiting for Keep both or Skip. */
  stage: 'checking' | 'duplicate' | 'uploading' | 'uploaded' | 'failed' | 'filed'
  progress: number
  error?: string
  /** The title of the file this one duplicates. */
  sameAs?: string
  docId?: ID
  suggesting?: boolean
  note?: string
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Please try again.')

/** Lets a whole area take dropped files. */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false)
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setOver(false)
        onFiles([...e.dataTransfer.files])
      },
    },
  }
}

export function UploadWindow({ studentId, initialFiles, onClose }: { studentId?: ID; initialFiles?: File[]; onClose: () => void }) {
  const data = useData()
  const { uploadFile, suggestFile, fileDocument } = useStore.getState()
  const [items, setItems] = useState<Item[]>([])
  const [busyAll, setBusyAll] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const student = data.students.find((s) => s.id === studentId)
  const patch = (key: string, change: Partial<Item>) => setItems((all) => all.map((i) => (i.key === key ? { ...i, ...change } : i)))

  const send = async (key: string, file: File) => {
    patch(key, { stage: 'uploading', progress: 0, error: undefined })
    try {
      const doc = await uploadFile(file, { studentId, onProgress: (progress) => patch(key, { progress }) })
      patch(key, { stage: 'uploaded', docId: doc.id, suggesting: true })
      // The pickers are usable now. The suggestion arrives when the AI answers.
      void suggestFile(doc.id).then(() => patch(key, { suggesting: false }))
    } catch (e) {
      patch(key, { stage: 'failed', error: reasonOf(e) })
    }
  }

  const add = (files: File[]) => {
    for (const file of files) {
      const key = crypto.randomUUID()
      setItems((all) => [...all, { key, file, stage: 'checking', progress: 0 }])
      void (async () => {
        try {
          checkFile(file)
          // The same file again for the same student: say so before sending anything.
          const again = studentId ? duplicateOf(useStore.getState().data, studentId, await hashFile(file)) : undefined
          if (again) return patch(key, { stage: 'duplicate', sameAs: fileTitle(again) })
          await send(key, file)
        } catch (e) {
          patch(key, { stage: 'failed', error: reasonOf(e) })
        }
      })()
    }
  }

  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (initialFiles?.length) add(initialFiles)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const drop = useFileDrop(add)
  const docOf = (item: Item) => data.documents.find((d) => d.id === item.docId)
  const open = items.filter((i) => i.stage !== 'filed')
  // Suggestions that can be accepted as they stand: the AI named a folder and a student is known.
  const ready = items.flatMap((i) => {
    const doc = i.stage === 'uploaded' ? docOf(i) : undefined
    return doc && isWaiting(doc) && doc.aiSuggestion && doc.studentId && folderById(data, doc.aiSuggestion.typeId) ? [{ item: i, doc }] : []
  })
  const unsaved = items.filter((i) => i.stage === 'uploaded' && docOf(i) && isWaiting(docOf(i)!)).length
  const sending = items.some((i) => i.stage === 'uploading' || i.stage === 'checking')

  const yesToAll = async () => {
    setBusyAll(true)
    for (const { item, doc } of ready) {
      try {
        const filed = await fileDocument(doc.id, { typeId: doc.aiSuggestion!.typeId, title: doc.aiSuggestion!.title, studentId: doc.studentId })
        patch(item.key, { stage: 'filed', note: `Filed under ${filed.folderName}.` })
      } catch (e) {
        patch(item.key, { error: reasonOf(e) })
      }
    }
    setBusyAll(false)
  }

  return (
    <Modal title={student ? `Upload files for ${fullName(student)}` : 'Upload files'} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <div {...drop.handlers} className={cx('flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 text-center', drop.over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-canvas')}>
          <p className="text-sm text-ink-soft">Drop files here, or</p>
          <Button variant="primary" onClick={() => input.current?.click()}>
            Choose files
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            accept={FILE_ACCEPT}
            className="sr-only"
            aria-label="Choose files to upload"
            onChange={(e) => {
              add([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
          <p className="text-xs text-muted">{FILE_TYPES_LABEL}. Up to 25 MB each.</p>
        </div>

        {ready.length > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-soft">{ready.length} files have a suggestion you can accept as it stands.</p>
            <Button variant="primary" disabled={busyAll} onClick={() => void yesToAll()}>
              Yes to all suggestions
            </Button>
          </div>
        )}

        {items.length > 0 && (
          <ul className="flex flex-col gap-3">
            {items.map((item) => {
              const doc = docOf(item)
              return (
                <li key={item.key} className="rounded-lg border border-line p-4">
                  {item.stage === 'uploaded' && doc && isWaiting(doc) ? (
                    <FilingRow doc={doc} lockStudent={Boolean(studentId)} suggesting={item.suggesting} onFiled={(note) => patch(item.key, { stage: 'filed', note })} />
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 break-all text-sm font-semibold">{item.file.name}</span>
                        <span className="text-[13px] text-muted">{formatBytes(item.file.size)}</span>
                      </div>
                      {item.stage === 'checking' && <p className="text-[13px] text-muted">Checking…</p>}
                      {item.stage === 'uploading' && (
                        <div>
                          <div role="progressbar" aria-label={`Uploading ${item.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)} className="h-2 overflow-hidden rounded-full bg-track">
                            <div className="h-2 bg-accent transition-[width]" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                          </div>
                          <p className="mt-1 text-[13px] text-muted">{item.progress >= 1 ? 'Checking the file…' : `Uploading… ${Math.round(item.progress * 100)}%`}</p>
                        </div>
                      )}
                      {item.stage === 'duplicate' && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warn-soft px-3 py-2">
                          <p className="min-w-0 flex-1 text-[13px] text-warn">
                            {student?.firstName ?? 'This student'} already has this exact file: “{item.sameAs}”.
                          </p>
                          <div className="flex gap-2">
                            <Button onClick={() => void send(item.key, item.file)}>Keep both</Button>
                            <Button onClick={() => setItems((all) => all.filter((i) => i.key !== item.key))}>Skip</Button>
                          </div>
                        </div>
                      )}
                      {item.stage === 'failed' && (
                        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bad-line bg-bad-tint px-3 py-2">
                          <p className="min-w-0 flex-1 text-[13px] text-bad">
                            <strong>Not uploaded.</strong> {item.error}
                          </p>
                          <div className="flex gap-2">
                            <Button onClick={() => void send(item.key, item.file)}>Retry</Button>
                            <Button variant="quiet" onClick={() => setItems((all) => all.filter((i) => i.key !== item.key))}>
                              Remove
                            </Button>
                          </div>
                        </div>
                      )}
                      {(item.stage === 'filed' || (item.stage === 'uploaded' && (!doc || !isWaiting(doc)))) && <p className="text-[13px] font-medium text-good">{item.note ?? (doc ? 'Filed.' : 'Removed.')}</p>}
                      {item.stage !== 'failed' && item.error && <p className="text-[13px] text-bad">{item.error}</p>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-[13px] text-muted">
            {sending
              ? 'Files still uploading carry on if you close this window.'
              : unsaved > 0
                ? `${unsaved} ${unsaved === 1 ? 'file is' : 'files are'} not filed yet. If you close now, ${unsaved === 1 ? 'it waits' : 'they wait'} under “Waiting for you” on the Documents screen, not on any student’s page.`
                : open.length === 0 && items.length > 0
                  ? 'Everything here is filed.'
                  : 'Nothing is shown on a student’s page until you file it.'}
          </p>
          <Button onClick={onClose}>{unsaved > 0 || sending ? 'Close' : 'Done'}</Button>
        </div>
      </div>
    </Modal>
  )
}
