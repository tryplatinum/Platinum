// One line for a document in a list: a filed file, a student's upload still
// being sorted, or an older name-or-link row. Used on a student's Documents tab
// and on the firm-wide Documents screen. Also the preview panel a file opens in.

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDate } from '../../lib/dates'
import { fullName } from '../../lib/derive'
import { canPreview, fileKind, fileTitle, folderById, folderOf, isNewFile, isSorting, isStoredFile, needsCheck, openFolders, uploadedBy } from '../../lib/files'
import { useData, useStore } from '../../store/store'
import type { ID, StudentDocument } from '../../types'
import { Button, Modal, Pill, cx, inputBase, useToast } from '../ui'
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
          <p role="status" className="py-10 text-center text-sm text-muted">
            Opening…
          </p>
        ) : doc.mimeType === 'application/pdf' ? (
          <iframe title={fileTitle(doc)} src={src} className="h-[70vh] w-full rounded-lg border border-line" />
        ) : (
          <img alt={fileTitle(doc)} src={src} className="max-h-[70vh] w-full rounded-lg border border-line object-contain" />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 break-all text-[13px] text-muted">{doc.originalFilename}</span>
          <Button onClick={() => void save()}>Download</Button>
        </div>
      </div>
    </Modal>
  )
}

export function FileRow({ doc, showStudent, showFolder = showStudent }: { doc: StudentDocument; showStudent?: boolean; showFolder?: boolean }) {
  const data = useData()
  const toast = useToast()
  const me = useStore((s) => (s.account.status === 'ready' ? s.account.userId : undefined))
  const { fileDocument, renameFile, deleteFile, openFile, updateDocument, removeDocument } = useStore.getState()
  const [renaming, setRenaming] = useState<string>()
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)

  const stored = isStoredFile(doc)
  const student = data.students.find((s) => s.id === doc.studentId)
  const folder = folderOf(data, doc)
  const title = fileTitle(doc)
  const suggestion = doc.aiSuggestion
  const alternatives = (suggestion ? [suggestion.typeId, ...suggestion.alternatives] : []).filter((id, i, all) => id !== doc.typeId && all.indexOf(id) === i && folderById(data, id) && !folderById(data, id)!.archivedAt)
  const others = openFolders(data).filter((f) => f.id !== doc.typeId && !alternatives.includes(f.id))

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
    } catch (e) {
      toast(reasonOf(e))
    } finally {
      setBusy(false)
    }
  }

  const moveTo = (typeId: ID) => {
    if (!stored) return updateDocument(doc.id, { typeId })
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

  const remove = () => {
    if (!window.confirm(stored ? `Delete “${title}”? The file is removed for good.` : `Remove “${title}”?`)) return
    if (stored) void run(() => deleteFile(doc.id))
    else removeDocument(doc.id)
  }

  if (isSorting(doc)) {
    return (
      <li className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-5 py-3">
        <Pill className="w-14 justify-center rounded-md px-1 text-[11px]">{fileKind(doc)}</Pill>
        <div className="min-w-[12rem] flex-1">
          <span className="break-all text-sm font-semibold">{doc.originalFilename ?? title}</span>
          <div role="status" className="flex items-center gap-2 text-[13px] font-medium text-accent">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Sorting…
          </div>
        </div>
        <div className="text-[13px] text-muted">
          {showStudent && student && `${fullName(student)} · `}
          {uploadedBy(doc, student, me)} · {formatDate(doc.addedOn)}
        </div>
      </li>
    )
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-3">
      <Pill className="w-14 justify-center rounded-md px-1 text-[11px]">{fileKind(doc)}</Pill>
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
              <button type="button" className="text-left text-sm font-semibold text-accent underline" onClick={open} disabled={busy}>
                {title}
              </button>
            ) : doc.url ? (
              <a href={doc.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-accent underline">
                {title}
              </a>
            ) : (
              <span className="text-sm font-semibold">{title}</span>
            )}
            {isNewFile(doc) && <Pill tone="accent">New</Pill>}
            {needsCheck(doc) && <Pill tone="warn">Check this</Pill>}
          </div>
        )}
        <div className="text-[13px] text-muted">
          {showStudent && student && (
            <>
              <Link to={`/app/students/${student.id}?tab=documents`} className="font-medium text-ink-soft underline">
                {fullName(student)}
              </Link>
              {' · '}
            </>
          )}
          {showFolder && folder && `${folder.name}${folder.archivedAt ? ' (archived)' : ''} · `}
          {uploadedBy(doc, student, me)} · {formatDate(doc.addedOn)}
          {stored && doc.sortedBy === 'auto' && (
            <>
              {' · '}
              <span className="cursor-help underline decoration-dotted" title={suggestion?.reason || 'Filed by the AI with no one checking first.'}>
                Sorted automatically
              </span>
            </>
          )}
          {!stored && !doc.url && ' · name only, no file stored'}
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
        <Button variant="quiet" disabled={busy} aria-label={`Delete ${title}`} onClick={remove}>
          Delete
        </Button>
      </div>
      {preview && <FilePreview doc={doc} onClose={() => setPreview(false)} />}
    </li>
  )
}
