// The Google Drive panel: My Drive, Shared with me and shared drives, folder by
// folder, with Drive's own search. Listings come live from Google through
// /api/google and are not saved anywhere.
//
// Two uses. "files": tick one or more files and add them; each is copied into
// storage and then waits to be filed like an upload. "folder": choose one
// folder to link to a student.

import { ChevronRight, FileText, Folder, HardDrive, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatBytes } from '../../../shared/files'
import type { DriveEntry, DriveListing, LinkedFolder } from '../../../shared/google'
import { todayISO } from '../../lib/dates'
import { fullName } from '../../lib/derive'
import { GoogleFailure, callGoogle } from '../../services/google'
import type { DocumentRow } from '../../services/files'
import { useStore } from '../../store/store'
import type { Student } from '../../types'
import { Button, Modal, Pill, SegmentedControl, cx, inputBase } from '../ui'

type Root = 'root' | 'shared' | 'drives'
const ROOTS: { value: Root; label: string }[] = [
  { value: 'root', label: 'My Drive' },
  { value: 'shared', label: 'Shared with me' },
  { value: 'drives', label: 'Shared drives' },
]

interface Result {
  id: string
  name: string
  state: 'waiting' | 'working' | 'added' | 'already' | 'failed'
  note?: string
}

const reasonOf = (error: unknown) => (error instanceof GoogleFailure ? error.message : 'Something went wrong. Please try again.')
const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const

export function DrivePicker({ mode, student, onClose, onLinked }: { mode: 'files' | 'folder'; student?: Student; onClose: () => void; onLinked?: (folder: LinkedFolder) => void }) {
  const { takeFiles, suggestFile } = useStore.getState()
  const [root, setRoot] = useState<Root>('root')
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([])
  const [typed, setTyped] = useState('')
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<DriveEntry[]>([])
  const [next, setNext] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [selected, setSelected] = useState<Map<string, DriveEntry>>(new Map())
  const [results, setResults] = useState<Result[]>()
  const [linking, setLinking] = useState(false)
  const request = useRef(0)

  const here = trail.at(-1)
  const parent = here?.id ?? root

  const load = async (pageToken?: string) => {
    const mine = ++request.current
    setLoading(true)
    setError(undefined)
    try {
      const page = await callGoogle<DriveListing>('browse', { parent, ...(query ? { query } : {}), ...(pageToken ? { pageToken } : {}) })
      // An answer to a question no longer being asked is dropped.
      if (mine !== request.current) return
      setEntries((all) => (pageToken ? [...all, ...page.entries] : page.entries))
      setNext(page.nextPageToken)
    } catch (e) {
      if (mine !== request.current) return
      if (!pageToken) setEntries([])
      setNext(undefined)
      setError(reasonOf(e))
    } finally {
      if (mine === request.current) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [parent, query]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = (entry: DriveEntry) => {
    setQuery('')
    setTyped('')
    setTrail((t) => [...t, { id: entry.id, name: entry.name }])
  }
  const toggle = (entry: DriveEntry) =>
    setSelected((all) => {
      const nextAll = new Map(all)
      if (nextAll.has(entry.id)) nextAll.delete(entry.id)
      else nextAll.set(entry.id, entry)
      return nextAll
    })

  const add = async () => {
    const chosen = [...selected.values()]
    const list: Result[] = chosen.map((e) => ({ id: e.id, name: e.name, state: 'waiting' }))
    setResults(list)
    const set = (id: string, change: Partial<Result>) => setResults((all) => all?.map((r) => (r.id === id ? { ...r, ...change } : r)))
    // One at a time: each is a download from Google and a copy into storage.
    for (const entry of chosen) {
      set(entry.id, { state: 'working' })
      try {
        const done = await callGoogle<{ document: DocumentRow; already: boolean; sameAs?: string }>('import', { fileId: entry.id, ...(student ? { studentId: student.id } : {}), today: todayISO() }, 75_000)
        takeFiles([done.document])
        if (done.already) set(entry.id, { state: 'already', note: 'Already imported.' })
        else {
          set(entry.id, { state: 'added', note: done.sameAs ? `Added. ${student?.firstName ?? 'This student'} already has a file with the same contents: “${done.sameAs}”.` : 'Added.' })
          // Like an upload: the AI's suggestion arrives while the file waits for a person.
          void suggestFile(done.document.id)
        }
      } catch (e) {
        set(entry.id, { state: 'failed', note: reasonOf(e) })
      }
    }
    setSelected(new Map())
  }

  const link = async (folder: { id: string; name: string }) => {
    if (!student) return
    setLinking(true)
    setError(undefined)
    try {
      onLinked?.(await callGoogle<LinkedFolder>('link', { folderId: folder.id, studentId: student.id }))
      onClose()
    } catch (e) {
      setError(reasonOf(e))
      setLinking(false)
    }
  }

  const title = mode === 'folder' ? `Link a Drive folder to ${student ? fullName(student) : 'a student'}` : student ? `Add from Google Drive for ${fullName(student)}` : 'Add from Google Drive'

  if (results) {
    const working = results.some((r) => r.state === 'waiting' || r.state === 'working')
    const finished = results.filter((r) => r.state !== 'waiting' && r.state !== 'working').length
    const added = results.filter((r) => r.state === 'added').length
    return (
      <Modal title={title} onClose={onClose} wide>
        <div className="flex flex-col gap-4">
          <p role="status" className="text-sm font-semibold">
            {working ? `Imported ${finished} of ${results.length}…` : `Imported ${added} of ${results.length}.`}
          </p>
          <ul className="flex flex-col gap-2">
            {results.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <span className="min-w-0 break-all text-sm font-medium">{r.name}</span>
                <span className={cx('text-[13px]', r.state === 'failed' ? 'text-bad' : r.state === 'added' ? 'text-good' : 'text-muted')}>
                  {r.state === 'waiting' ? 'Waiting…' : r.state === 'working' ? 'Copying from Drive…' : r.state === 'failed' ? `Not added. ${r.note}` : r.note}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-[13px] text-muted">
              {working ? 'Keep this window open until every file is copied.' : added > 0 ? 'Added files wait under “Waiting for you” on the Documents screen until you file them. Nothing in Drive was changed.' : 'Nothing in Drive was changed.'}
            </p>
            <div className="flex gap-2">
              {!working && <Button onClick={() => setResults(undefined)}>Add more</Button>}
              <Button variant="primary" disabled={working} onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            label="Where to look"
            options={ROOTS}
            value={root}
            onChange={(value) => {
              setRoot(value)
              setTrail([])
              setQuery('')
              setTyped('')
            }}
          />
          <form
            role="search"
            className="flex min-w-[14rem] flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setQuery(typed.trim())
            }}
          >
            <input className={cx(inputBase, 'min-w-0 flex-1')} type="search" aria-label="Search Google Drive" placeholder="Search Drive by name or contents" value={typed} maxLength={200} onChange={(e) => setTyped(e.target.value)} />
            <Button type="submit">
              <Search size={16} strokeWidth={1.75} aria-hidden /> Search
            </Button>
          </form>
        </div>

        {query ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              Results for “{query}” across your Drive.
            </span>
            <button
              type="button"
              className="font-semibold text-accent underline"
              onClick={() => {
                setQuery('')
                setTyped('')
              }}
            >
              Clear search
            </button>
          </p>
        ) : (
          <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-sm">
            <button type="button" className={cx('rounded-control px-1 underline', trail.length === 0 ? 'font-semibold text-heading no-underline' : 'text-accent')} onClick={() => setTrail([])} aria-current={trail.length === 0 ? 'page' : undefined}>
              {ROOTS.find((r) => r.value === root)!.label}
            </button>
            {trail.map((step, i) => (
              <span key={step.id} className="flex items-center gap-1">
                <ChevronRight size={14} aria-hidden className="text-muted" />
                <button type="button" className={cx('rounded-control px-1 underline', i === trail.length - 1 ? 'font-semibold text-heading no-underline' : 'text-accent')} onClick={() => setTrail(trail.slice(0, i + 1))} aria-current={i === trail.length - 1 ? 'page' : undefined}>
                  {step.name}
                </button>
              </span>
            ))}
          </nav>
        )}

        {mode === 'folder' && here && !query && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent-soft px-3 py-2">
            <p className="min-w-0 flex-1 text-sm">
              Link <span className="font-semibold">“{here.name}”</span>? Every file in it, subfolders included, is imported for {student?.firstName ?? 'this student'} and kept in sync.
            </p>
            <Button variant="primary" disabled={linking} onClick={() => void link(here)}>
              Link this folder
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-bad-line bg-bad-tint px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}

        <ul className="max-h-[50vh] overflow-y-auto rounded-lg border border-line" aria-busy={loading}>
          {entries.map((entry) => {
            const container = entry.kind !== 'file'
            const checked = selected.has(entry.id)
            return (
              <li key={`${entry.kind}:${entry.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-b-0">
                {container ? (
                  <>
                    {entry.kind === 'drive' ? <HardDrive {...ICON} className="shrink-0 text-muted" /> : <Folder {...ICON} className="shrink-0 text-muted" />}
                    <button type="button" className="min-h-11 min-w-0 flex-1 break-all text-left text-sm font-semibold text-accent underline" onClick={() => open(entry)}>
                      {entry.name}
                    </button>
                    <span className="text-[13px] text-muted">{entry.label}</span>
                    {mode === 'folder' && entry.kind === 'folder' && (
                      <Button disabled={linking} aria-label={`Link the folder ${entry.name}`} onClick={() => void link(entry)}>
                        Link
                      </Button>
                    )}
                  </>
                ) : (
                  <label className={cx('flex min-h-11 min-w-0 flex-1 items-center gap-3', mode === 'files' && !entry.blocked && 'cursor-pointer')}>
                    {mode === 'files' ? <input type="checkbox" className="h-5 w-5 shrink-0" checked={checked} disabled={Boolean(entry.blocked)} onChange={() => toggle(entry)} /> : <FileText {...ICON} className="shrink-0 text-muted" />}
                    <span className="min-w-0 flex-1">
                      <span className={cx('block break-all text-sm font-medium', entry.blocked && 'text-muted')}>{entry.name}</span>
                      <span className="block text-[13px] text-muted">
                        {[entry.label, entry.size !== undefined ? formatBytes(entry.size) : undefined, entry.modified ? `changed ${new Date(entry.modified).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : undefined].filter(Boolean).join(' · ')}
                        {entry.blocked && mode === 'files' ? ` · ${entry.blocked}` : ''}
                      </span>
                    </span>
                    {entry.label.startsWith('Google ') && !entry.blocked && <Pill>Saved as PDF</Pill>}
                  </label>
                )}
              </li>
            )
          })}
          {loading && (
            <li role="status" className="px-3 py-4 text-center text-sm text-muted">
              Reading from Google Drive…
            </li>
          )}
          {!loading && !error && entries.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{query ? 'Nothing in your Drive matches that.' : 'Nothing here.'}</li>}
          {!loading && next && (
            <li className="px-3 py-2 text-center">
              <Button variant="quiet" onClick={() => void load(next)}>
                Show more
              </Button>
            </li>
          )}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-[13px] text-muted">
            {mode === 'folder'
              ? 'Open a folder, then link it. Platinum reads the folder and never changes anything in Drive.'
              : `PDF, JPEG, PNG, HEIC, Word and Excel up to 25 MB. Google Docs, Sheets and Slides are saved as PDFs. Nothing in Drive is changed.`}
          </p>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            {mode === 'files' && (
              <Button variant="primary" disabled={selected.size === 0} onClick={() => void add()}>
                {selected.size === 0 ? 'Add files' : `Add ${selected.size} ${selected.size === 1 ? 'file' : 'files'}`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
