// Drive folders linked to one student: what is linked, how the sync is going,
// "Sync now" and "Unlink". Shown on the student's Documents tab.
//
// A sync is a run of short calls. Each call imports a batch and says whether
// more remains; this keeps calling until it does not, showing "Imported 12 of
// 87" as it goes. Leaving the page stops the calls; the next visit carries on
// where it stopped. A sync starts when a folder is linked, when "Sync now" is
// pressed, and when this tab opens with a folder last synced over 15 minutes ago.

import { FolderSync } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SYNC_STALE_MS, type LinkedFolder } from '../../../shared/google'
import { todayISO } from '../../lib/dates'
import { GoogleFailure, callGoogle, driveReady, useGoogleStatus } from '../../services/google'
import type { DocumentRow } from '../../services/files'
import { useStore } from '../../store/store'
import type { ID, Student } from '../../types'
import { Button, Card, CardHeader, Pill, useToast } from '../ui'

interface SyncAnswer {
  folder: LinkedFolder
  more: boolean
  busy: boolean
  documents: DocumentRow[]
}

const reasonOf = (error: unknown) => (error instanceof GoogleFailure ? error.message : 'Something went wrong. Please try again.')

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** A student's linked folders, kept up to date, with the actions on them. */
export function useLinkedFolders(studentId: ID, enabled: boolean) {
  const { takeFiles } = useStore.getState()
  const [folders, setFolders] = useState<LinkedFolder[]>([])
  const [error, setError] = useState<string>()
  /** Folders with a run of sync calls under way in this tab. */
  const running = useRef(new Set<string>())
  const [active, setActive] = useState<string[]>([])
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const put = (folder: LinkedFolder) => setFolders((all) => (all.some((f) => f.id === folder.id) ? all.map((f) => (f.id === folder.id ? folder : f)) : [...all, folder]))

  const sync = useCallback(
    async (id: string, restart = false) => {
      if (running.current.has(id)) return
      running.current.add(id)
      setActive([...running.current])
      setError(undefined)
      try {
        // A run ends when nothing remains, when Google needs reconnecting, or when the page is left.
        for (let calls = 0, waits = 0; alive.current && calls < 200; calls++) {
          const answer = await callGoogle<SyncAnswer>('sync', { id, today: todayISO(), ...(restart && calls === 0 ? { restart: true } : {}) }, 75_000)
          if (!alive.current) return
          takeFiles(answer.documents)
          put(answer.folder)
          if (answer.busy) {
            // Someone else's call is syncing this folder. Look again shortly, a few times.
            if (++waits > 10) break
            await new Promise((resolve) => setTimeout(resolve, 4000))
            continue
          }
          if (!answer.more) break
        }
      } catch (e) {
        if (alive.current) setError(reasonOf(e))
      } finally {
        running.current.delete(id)
        if (alive.current) setActive([...running.current])
      }
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setFolders([])
    callGoogle<LinkedFolder[]>('folders', { studentId }).then(
      (found) => {
        if (cancelled) return
        setFolders(found)
        for (const folder of found) {
          const stale = !folder.lastSyncedAt || Date.now() - Date.parse(folder.lastSyncedAt) > SYNC_STALE_MS
          // Carry on a sync that was cut off, or start one when the last is old. A folder waiting for a reconnect is left alone.
          if (folder.status === 'syncing' || (stale && folder.status !== 'reconnect')) void sync(folder.id)
        }
      },
      (e) => !cancelled && setError(reasonOf(e)),
    )
    return () => {
      cancelled = true
    }
  }, [studentId, enabled, sync])

  return {
    folders,
    error,
    syncing: (id: string) => active.includes(id),
    sync,
    /** A folder just linked: shown at once, and its first sync started. */
    linked: (folder: LinkedFolder) => {
      put(folder)
      void sync(folder.id)
    },
    unlink: async (id: string) => {
      await callGoogle('unlink', { id })
      setFolders((all) => all.filter((f) => f.id !== id))
    },
    importRemoved: async (id: string) => {
      put(await callGoogle<LinkedFolder>('import_removed', { id }))
      void sync(id, true)
    },
  }
}

export type LinkedFolders = ReturnType<typeof useLinkedFolders>

/** Drive ids of this student's files that are no longer in their linked folder. */
export const goneFromDrive = (folders: LinkedFolder[]) => new Set(folders.flatMap((f) => f.missingFileIds))

export function DriveFolders({ student, linked, onLink }: { student: Student; linked: LinkedFolders; onLink: () => void }) {
  const status = useGoogleStatus()
  const toast = useToast()
  const [open, setOpen] = useState<string>()
  if (!status?.available || linked.folders.length === 0) return null
  const ready = driveReady(status)

  return (
    <Card>
      <CardHeader className="px-5 py-4" title="Linked Drive folders" count={linked.folders.length} sub={`Every file in a linked folder is imported for ${student.firstName} and kept in sync. Nothing in Drive is changed.`} />
      {linked.error && (
        <p role="alert" className="border-t border-line px-5 py-3 text-sm text-bad">
          {linked.error}
        </p>
      )}
      <ul>
        {linked.folders.map((folder) => {
          const busy = linked.syncing(folder.id)
          const working = busy || folder.status === 'syncing'
          const named = folder.skipped.filter((s) => s.name)
          const notes = folder.skipped.filter((s) => !s.name)
          return (
            <li key={folder.id} className="flex flex-col gap-2 border-t border-line px-5 py-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <FolderSync size={20} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden />
                <div className="min-w-[12rem] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all text-sm font-semibold">{folder.name}</span>
                    {folder.status === 'reconnect' && <Pill tone="warn">Reconnect Google to sync</Pill>}
                    {folder.status === 'error' && !busy && <Pill tone="bad">Sync stopped</Pill>}
                  </div>
                  <p role="status" className="text-[13px] text-muted">
                    {working && folder.total > 0
                      ? `Imported ${folder.done} of ${folder.total}…`
                      : working
                        ? 'Reading the folder…'
                        : folder.status === 'reconnect'
                          ? folder.mine
                            ? 'Your Google connection has ended. Reconnect it in Firm settings. Files already imported are not affected.'
                            : 'The colleague who linked this folder needs to reconnect Google. Files already imported are not affected.'
                          : folder.status === 'error'
                            ? (folder.lastError ?? 'The last sync stopped.')
                            : folder.lastSyncedAt
                              ? `Last synced ${when(folder.lastSyncedAt)}`
                              : 'Not synced yet'}
                    {!folder.mine && folder.status !== 'reconnect' && ' · linked by a colleague'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {folder.url && (
                    <a href={folder.url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center px-2 text-sm font-semibold text-accent underline">
                      Open in Drive
                    </a>
                  )}
                  <Button disabled={working || folder.status === 'reconnect'} onClick={() => void linked.sync(folder.id, true)}>
                    {working ? 'Syncing…' : 'Sync now'}
                  </Button>
                  <Button
                    variant="quiet"
                    disabled={busy}
                    aria-label={`Unlink the folder ${folder.name}`}
                    onClick={() => {
                      if (!window.confirm(`Unlink “${folder.name}”? Files already imported stay. New files in the folder are no longer imported.`)) return
                      linked.unlink(folder.id).then(
                        () => toast('Folder unlinked. The files already imported are still here.'),
                        (e) => toast(reasonOf(e)),
                      )
                    }}
                  >
                    Unlink
                  </Button>
                </div>
              </div>

              {working && folder.total > 0 && (
                <div role="progressbar" aria-label={`Importing from ${folder.name}`} aria-valuemin={0} aria-valuemax={folder.total} aria-valuenow={folder.done} className="h-2 overflow-hidden rounded-full bg-track">
                  <div className="motion-progress h-2 bg-accent" style={{ width: `${Math.round((folder.done / folder.total) * 100)}%` }} />
                </div>
              )}

              {(folder.skipped.length > 0 || folder.removedHere > 0 || folder.missingFileIds.length > 0) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-soft">
                  {folder.skipped.length > 0 && (
                    <button type="button" className="min-h-11 font-semibold text-accent underline" aria-expanded={open === folder.id} onClick={() => setOpen(open === folder.id ? undefined : folder.id)}>
                      {named.length > 0 ? `${named.length} ${named.length === 1 ? 'file was' : 'files were'} not imported` : 'Some of the folder was not read'}
                    </button>
                  )}
                  {folder.missingFileIds.length > 0 && (
                    <span>
                      {folder.missingFileIds.length} {folder.missingFileIds.length === 1 ? 'file is' : 'files are'} no longer in Drive. The stored {folder.missingFileIds.length === 1 ? 'copy is' : 'copies are'} kept.
                    </span>
                  )}
                  {folder.removedHere > 0 && (
                    <span className="flex flex-wrap items-center gap-2">
                      {folder.removedHere} deleted here {folder.removedHere === 1 ? 'is' : 'are'} not imported again.
                      <button type="button" className="min-h-11 font-semibold text-accent underline" disabled={working || !ready} onClick={() => void linked.importRemoved(folder.id).catch((e) => toast(reasonOf(e)))}>
                        Import {folder.removedHere === 1 ? 'it' : 'them'} again
                      </button>
                    </span>
                  )}
                </div>
              )}
              {open === folder.id && folder.skipped.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-lg bg-surface-2 px-3 py-2 text-[13px]">
                  {notes.map((s, i) => (
                    <li key={`note-${i}`} className="text-ink-soft">
                      {s.reason}
                    </li>
                  ))}
                  {named.map((s, i) => (
                    <li key={i}>
                      <span className="break-all font-medium">{s.name}</span> <span className="text-muted">{s.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {ready && (
        <div className="border-t border-line px-5 py-3">
          <Button onClick={onLink}>Link another Drive folder</Button>
        </div>
      )}
    </Card>
  )
}
