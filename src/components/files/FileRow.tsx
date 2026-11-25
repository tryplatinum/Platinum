// One line for a document in a list: a filed file, a student's upload still
// being sorted, or an older name-or-link row. Used on a student's Documents tab
// and on the firm-wide Documents screen. Also the preview panel a file opens in.

import { FileText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDate } from '../../lib/dates'
import { fullName } from '../../lib/derive'
import { canPreview, fileKind, fileTitle, folderById, folderOf, isNewFile, isSorting, isStoredFile, needsCheck, openFolders, uploadedBy } from '../../lib/files'
import { useData, useStore } from '../../store/store'
import type { ID, StudentDocument } from '../../types'
import { Button, Modal, Pill, Skeleton, Thinking, cx, inputBase, useConfirm, useToast } from '../ui'
import { hiddenNote } from './FilingRow'

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong. Please try again.')

/** Starts a download without leaving the page. The link is good for 60 seconds and is used at once. */
function download(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noreferrer'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * A PDF or an image, shown in a panel. The signed URL is made when the panel
 * opens and lives 60 seconds, so the file is fetched once, straight away, and
 * shown from memory.
 */
export function FilePreview({ doc, onClose }: { doc: StudentDocument; onClose: () => void }) {
  const { openFile } = useStore.getState()
  const [src, setSrc] = useState<string>()
  const [error, setError] = useState<string>()
  // One request per opening, even when React runs the effect twice in development: a view is logged once.
  const loading = useRef<Promise<string>>(undefined)

  useEffect(() => {
    let cancelled = false
    loading.current ??= (async () => {
      const res = await fetch(await openFile(doc.id, 'view'))
      if (!res.ok) throw new Error('The file could not be loaded.')
      return URL.createObjectURL(await res.blob())
    })()
    loading.current.then(
      (local) => !cancelled && setSrc(local),
      (e) => !cancelled && setError(reasonOf(e)),
    )
    return () => {
      cancelled = true
    }
  }, [doc.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    void loading.current?.then((local) => URL.revokeObjectURL(local)).catch(() => undefined)
    onClose()
  }

  const save = () =>
    openFile(doc.id, 'download')
      .then(download)
      .catch((e) => setError(reasonOf(e)))

  return (
    <Modal title={fileTitle(doc)} onClose={close} wide>
      <div className="flex flex-col gap-3">
        {error ? (
          <p role="alert" className="rounded-lg border border-bad-line bg-bad-tint px-3 py-2 text-sm text-bad">
            {error}
          </p>
        ) : !src ? (
          <div role="status" aria-label="Opening…">
            <Skeleton className="h-[60dvh] w-full" />
          </div>
        ) : doc.mimeType === 'application/pdf' ? (
          <iframe title={fileTitle(doc)} src={src} className="h-[60dvh] w-full rounded-lg border border-line" />
        ) : (
          <img alt={fileTitle(doc)} src={src} className="h-[60dvh] w-full rounded-lg border border-line object-contain" />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 break-all text-[13px] text-muted">{doc.originalFilename}</span>
          <Button onClick={() => void save()}>Download</Button>
        </div>
      </div>
    </Modal>
  )
}

/** "From Google Drive", with a link that opens the file there. Nothing for a file that did not come from Drive. */
export function FromDrive({ doc }: { doc: StudentDocument }) {
  if (doc.source !== 'google_drive') return null
  return (
    <>
      {' · '}
      {doc.driveUrl ? (
        <a href={doc.driveUrl} target="_blank" rel="noreferrer" className="tap-link font-medium text-ink-soft underline">
          From Google Drive
        </a>
      ) : (
        'From Google Drive'
      )}
    </>
  )
}

export function FileRow({ doc, showStudent, showFolder = showStudent, goneFromDrive }: { doc: StudentDocument; showStudent?: boolean; showFolder?: boolean; /** The Drive file this was copied from is no longer in its linked folder. */ goneFromDrive?: boolean }) {
  const data = useData()
  const toast = useToast()
  const confirm = useConfirm()
  const me = useStore((s) => (s.account.status === 'ready' ? s.account.userId : undefined))
  const owner = useStore((s) => s.account.status === 'ready' && s.account.role === 'owner')
  const { fileDocument, renameFile, deleteFile, openFile, updateDocument, removeDocument } = useStore.getState()
  const [renaming, setRenaming] = useState<string>()
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()

  const stored = isStoredFile(doc)
  const student = data.students.find((s) => s.id === doc.studentId)
  const folder = folderOf(data, doc)
  const title = fileTitle(doc)
  const suggestion = doc.aiSuggestion
  const alternatives = (suggestion ? [suggestion.typeId, ...suggestion.alternatives] : []).filter((id, i, all) => id !== doc.typeId && all.indexOf(id) === i && folderById(data, id) && !folderById(data, id)!.archivedAt)
  const others = openFolders(data).filter((f) => f.id !== doc.typeId && !alternatives.includes(f.id))

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setProblem(undefined)
    try {
      await work()
    } catch (e) {
      setProblem(reasonOf(e))
    } finally {
      setBusy(false)
    }
  }

  const moveTo = (typeId: ID) => {
    if (!stored) {
      // A name or a link under an owner-only folder is the owner's alone, like a stored file there.
      // Only a stored file can be handed over by someone else (the server does that filing).
      const target = folderById(data, typeId)
      if (target && target.sensitivity !== 'standard' && !owner) return toast(`Only the firm’s owner can put a link under “${target.name}”.`)
      return updateDocument(doc.id, { typeId })
    }
    void run(async () => {
      const filed = await fileDocument(doc.id, { typeId, title })
      toast(filed.hidden ? hiddenNote(filed.folderName) : `Moved to ${filed.folderName}.`)
    })
  }

  const open = () => {
    if (canPreview(doc)) return setPreview(true)
    void run(async () => download(await openFile(doc.id, 'download')))
  }

  const saveName = () => {
    const next = renaming?.trim()
    setRenaming(undefined)
    if (!next || next === title) return
    if (stored) void run(() => renameFile(doc.id, next))
    else updateDocument(doc.id, { name: next })
  }

  const remove = async () => {
    const yes = await confirm(stored ? { title: 'Delete file', body: `Delete “${title}”? The file is removed for good.`, action: 'Delete file' } : { title: 'Remove from the list', body: `Remove “${title}”?`, action: 'Remove' })
    if (!yes) return
    if (stored) void run(() => deleteFile(doc.id))
    else removeDocument(doc.id)
  }

  if (isSorting(doc)) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
        <FileText size={20} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden />
        <Pill className="w-14 justify-center rounded-md px-1">{fileKind(doc)}</Pill>
        <div className="min-w-[12rem] flex-1">
          <span className="break-all text-sm font-semibold">{doc.originalFilename ?? title}</span>
          <Thinking inline label="Sorting…" />
        </div>
        <div className="text-[13px] text-muted">
          {showStudent && student && `${fullName(student)} · `}
          {uploadedBy(doc, student, me)} · {formatDate(doc.addedOn)}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 transition-colors hover:bg-surface-2">
      <FileText size={20} strokeWidth={1.75} className="-mr-1 shrink-0 text-muted" aria-hidden />
      <Pill className="w-14 justify-center rounded-md px-1">{fileKind(doc)}</Pill>
      <div className="min-w-[12rem] flex-1">
        {renaming !== undefined ? (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              saveName()
            }}
          >
            <input className={cx(inputBase, 'min-w-[12rem] flex-1')} autoFocus aria-label={`New title for ${title}`} value={renaming} maxLength={200} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(undefined)} />
            <Button type="submit" variant="primary">
              Save
            </Button>
            <Button onClick={() => setRenaming(undefined)}>Cancel</Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {stored ? (
              <button type="button" className="min-h-6 text-left text-sm font-semibold text-accent underline" onClick={open} disabled={busy}>
                {title}
              </button>
            ) : doc.url ? (
              <a href={doc.url} target="_blank" rel="noreferrer" className="tap-link text-sm font-semibold text-accent underline">
                {title}
              </a>
            ) : (
              <span className="text-sm font-semibold">{title}</span>
            )}
            {isNewFile(doc) && <Pill tone="accent">New</Pill>}
            {needsCheck(doc) && <Pill tone="warn">Check this</Pill>}
            {goneFromDrive && <Pill>No longer in Drive</Pill>}
          </div>
        )}
        <div className="text-[13px] text-muted">
          {showStudent && student && (
            <>
              <Link to={`/app/students/${student.id}?tab=documents`} className="tap-link font-medium text-ink-soft underline">
                {fullName(student)}
              </Link>
              {' · '}
            </>
          )}
          {showFolder && folder && `${folder.name}${folder.archivedAt ? ' (archived)' : ''} · `}
          {doc.uploadedByKind === 'student_link' ? `Added through the student link · ${formatDate(doc.addedOn)}` : `${uploadedBy(doc, student, me)} · ${formatDate(doc.addedOn)}`}
          {stored && doc.sortedBy === 'auto' && (
            <>
              {' · '}
              <span className="cursor-help underline decoration-dotted" title={suggestion?.reason || 'Filed by the AI with no one checking first.'}>
                Sorted automatically
              </span>
            </>
          )}
          {!stored && !doc.url && ' · name only, no file stored'}
          <FromDrive doc={doc} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {needsCheck(doc) && folder && (
          <Button disabled={busy} onClick={() => void run(() => fileDocument(doc.id, { typeId: folder.id, title }))}>
            It is in the right place
          </Button>
        )}
        <select aria-label={`Change the folder of ${title}`} className={inputBase} value="" disabled={busy} onChange={(e) => e.target.value && moveTo(e.target.value)}>
          <option value="">Change…</option>
          {alternatives.length > 0 && (
            <optgroup label="The AI’s other suggestions">
              {alternatives.map((id) => (
                <option key={id} value={id}>
                  {folderById(data, id)!.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={alternatives.length ? 'All folders' : 'Move to folder'}>
            {others.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.sensitivity !== 'standard' ? ' (owner only)' : ''}
              </option>
            ))}
          </optgroup>
        </select>
        <Button variant="quiet" disabled={busy} onClick={() => setRenaming(title)}>
          Rename
        </Button>
        <Button variant="quiet" disabled={busy} aria-label={`Delete ${title}`} onClick={() => void remove()}>
          Delete
        </Button>
      </div>
      {problem && (
        <p role="alert" className="basis-full text-[13px] text-bad">
          {problem}
        </p>
      )}
      {preview && <FilePreview doc={doc} onClose={() => setPreview(false)} />}
    </div>
  )
}
