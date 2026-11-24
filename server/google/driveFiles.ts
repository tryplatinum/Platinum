// Files from Google Drive, into the same pipeline as uploads.
//
//   * importDriveFile   one file a counselor picked. Done as that counselor, so
//                       row level security applies. It then waits for them like
//                       any upload: the browser asks for a suggestion next.
//   * linkFolder        ties a Drive folder to a student.
//   * syncFolder        one bounded batch of a linked folder's sync. The browser
//                       calls again until nothing is left.
//   * unlinkFolder, listFolders, importRemovedAgain
//
// There is no second pipeline. A file is copied into the `documents` bucket and
// then goes through documentSorting.ts: confirmUpload (the real type, the
// size), the content hash, and the same sorting. A file from a linked folder is
// filed automatically like a student's own upload (sortStudentDrop), because
// the person who linked the folder chose the student; unsure ones are marked
// "Check these".
//
// Who acts in a sync: whoever opened the page may not be the person who linked
// the folder, and a synced file may land in a folder only the owner can open.
// So a sync runs with the service role, always filtered by the caller's firm,
// uses the Google connection of the person who linked the folder, and hands
// back only the rows the caller can read (read again as the caller).
//
// Nothing here logs a file name, a folder name or a token.

import { DOCUMENTS_BUCKET, MAX_FILE_BYTES, sniffMime } from '../../shared/files.js'
import {
  GOOGLE_FOLDER,
  REASON,
  SYNC_BUDGET_MS,
  SYNC_LEASE_MS,
  planSync,
  storedName,
  takeBatch,
  type LinkedFolder,
  type QueueItem,
  type SkippedFile,
  type SyncState,
} from '../../shared/google.js'
import type { Database, Json } from '../../src/lib/database.types.js'
import { FileError, bucket, confirmUpload, finishCounselorUpload, logEvent, plausibleDay, removeObjects, sha256, sortStudentDrop, uploadingRow, type DocumentRow } from '../documentSorting.js'
import { serviceClient, type Caller } from '../supabase.js'
import { syncBatchLimit } from './config.js'
import { GoogleError } from './connection.js'
import { downloadDriveFile, getDriveFile, listFolderTree } from './drive.js'

type SignedIn = Extract<Caller, { ok: true }>
type FolderRow = Database['public']['Tables']['student_drive_folders']['Row']

/** The columns a signed-in person may read. sync_state and lease_until are the server's alone. */
const PUBLIC_COLUMNS = 'id, firm_id, student_id, linked_by, drive_folder_id, folder_name, drive_url, status, last_synced_at, last_error, progress_done, progress_total, skipped, missing_file_ids, removed_here_count'

type PublicFolderRow = Pick<FolderRow, 'id' | 'student_id' | 'linked_by' | 'folder_name' | 'drive_url' | 'status' | 'last_synced_at' | 'last_error' | 'progress_done' | 'progress_total' | 'skipped' | 'missing_file_ids' | 'removed_here_count'>

const folderFor = (row: PublicFolderRow, caller: SignedIn): LinkedFolder => ({
  id: row.id,
  studentId: row.student_id,
  name: row.folder_name,
  url: row.drive_url ?? undefined,
  status: row.status as LinkedFolder['status'],
  lastSyncedAt: row.last_synced_at ?? undefined,
  lastError: row.last_error ?? undefined,
  done: row.progress_done,
  total: row.progress_total,
  skipped: (row.skipped as unknown as SkippedFile[]) ?? [],
  missingFileIds: row.missing_file_ids,
  removedHere: row.removed_here_count,
  mine: row.linked_by === caller.userId,
})

const failed = (doing: string, error: { message: string }) => new Error(`${doing}: ${error.message}`)
const folders = () => serviceClient().from('student_drive_folders')

const driveColumns = (file: { id: string; modifiedTime?: string; webViewLink?: string; url?: string }) => ({
  source: 'google_drive',
  drive_file_id: file.id,
  drive_url: file.webViewLink ?? file.url ?? `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`,
  drive_modified_at: file.modifiedTime ?? null,
})

// ── One picked file ─────────────────────────────────────────────────────────

export interface Imported {
  document: DocumentRow
  /** True when this Drive file was already here and nothing new was stored. */
  already: boolean
  /** The title of a file with the very same contents that this student already has. */
  sameAs?: string
}

/**
 * Copies one Drive file into storage for the caller, who then files it like any
 * upload. With a student (from a student's page) the student is set; without
 * one the file waits for a student and a folder on the Documents screen.
 */
export async function importDriveFile(caller: SignedIn, input: { fileId: string; studentId?: string; today?: string }): Promise<Imported> {
  const db = caller.client
  const file = await getDriveFile(caller.userId, input.fileId)
  if (file.mimeType === GOOGLE_FOLDER) throw new GoogleError('refused', 'That is a folder. Open it and choose files, or link it to a student.', 400)

  // The same Drive file again: the copy already here is the answer.
  let existing = db.from('documents').select('*').eq('firm_id', caller.firmId).eq('drive_file_id', file.id).neq('file_status', 'uploading').limit(1)
  existing = input.studentId ? existing.eq('student_id', input.studentId) : existing.is('student_id', null)
  const found = await existing
  if (found.error) throw failed('looking for an earlier copy failed', found.error)
  if (found.data[0]) return { document: found.data[0], already: true }

  const got = await downloadDriveFile(caller.userId, file)
  if (!got.ok) throw new GoogleError('refused', got.reason, 400)
  if (sniffMime(got.bytes) !== got.mime) throw new GoogleError('refused', REASON.wrongContents, 415)

  const row = { ...uploadingRow({ firmId: caller.firmId, studentId: input.studentId, filename: storedName(file), size: got.bytes.length, mime: got.mime, by: 'counselor', userId: caller.userId, today: plausibleDay(input.today) }), ...driveColumns(file) }
  const inserted = await db.from('documents').insert(row).select('*').single()
  if (inserted.error) {
    if (inserted.error.code === '23503') throw new FileError('That student was not found.', 404)
    // A copy exists that this person cannot see (filed where only the owner can open it), or another request got there first.
    if (inserted.error.code === '23505') throw new FileError('This student already has that file from Google Drive.', 409)
    throw failed('creating the imported file failed', inserted.error)
  }
  // As the caller: storage lets a member write only to the exact path of a row that is waiting for its file.
  const stored = await bucket(db).upload(row.storage_path, got.bytes, { contentType: got.mime, upsert: false })
  if (stored.error) {
    await db.from('documents').delete().eq('id', row.id).eq('firm_id', caller.firmId)
    throw failed('storing the imported file failed', stored.error)
  }
  // The same step an upload goes through: the stored object is read back and checked, its hash recorded.
  const document = await finishCounselorUpload(caller, row.id)

  let sameAs: string | undefined
  if (input.studentId && document.content_hash) {
    const twin = await db.from('documents').select('title, name').eq('firm_id', caller.firmId).eq('student_id', input.studentId).eq('content_hash', document.content_hash).neq('id', document.id).neq('file_status', 'uploading').limit(1)
    sameAs = twin.data?.[0] ? (twin.data[0].title ?? twin.data[0].name) : undefined
  }
  return { document, already: false, sameAs }
}

// ── Linked folders ──────────────────────────────────────────────────────────

export async function listFolders(caller: SignedIn, studentId: string): Promise<LinkedFolder[]> {
  // Read as the caller: the policy on the table decides, and only the public columns are asked for.
  const { data, error } = await caller.client.from('student_drive_folders').select(PUBLIC_COLUMNS).eq('firm_id', caller.firmId).eq('student_id', studentId).order('created_at')
  if (error) throw failed('reading linked folders failed', error)
  return data.map((row) => folderFor(row, caller))
}

/** Ties a Drive folder to a student. The first sync is the browser's next call. */
export async function linkFolder(caller: SignedIn, input: { folderId: string; studentId: string }): Promise<LinkedFolder> {
  const student = await caller.client.from('students').select('id').eq('id', input.studentId).eq('firm_id', caller.firmId).maybeSingle()
  if (student.error) throw failed('reading the student failed', student.error)
  if (!student.data) throw new FileError('That student was not found.', 404)
  const folder = await getDriveFile(caller.userId, input.folderId)
  if (folder.mimeType !== GOOGLE_FOLDER) throw new GoogleError('refused', 'Choose a folder to link, not a file.', 400)

  const { data, error } = await folders()
    .insert({ firm_id: caller.firmId, student_id: input.studentId, linked_by: caller.userId, drive_folder_id: folder.id, folder_name: folder.name.slice(0, 300) || 'Folder', drive_url: folder.webViewLink ?? null, status: 'syncing' })
    .select(PUBLIC_COLUMNS)
    .single()
  if (error) throw error.code === '23505' ? new FileError('That folder is already linked to this student.', 409) : failed('linking the folder failed', error)
  return folderFor(data, caller)
}

/** Removes the link. Files already imported stay exactly as they are. */
export async function unlinkFolder(caller: SignedIn, id: string): Promise<{ removed: string }> {
  const { data, error } = await folders().delete().eq('id', id).eq('firm_id', caller.firmId).select('id')
  if (error) throw failed('unlinking the folder failed', error)
  if (data.length === 0) throw new FileError('That linked folder was not found.', 404)
  return { removed: id }
}

/** "Unless they ask": forgets which files were deleted here, so the next sync brings them back. */
export async function importRemovedAgain(caller: SignedIn, id: string): Promise<LinkedFolder> {
  const row = await folderRow(caller, id)
  const state = (row.sync_state ?? {}) as SyncState
  const { data, error } = await folders()
    .update({ sync_state: { ...state, removedHere: [], queue: [] } as unknown as Json, removed_here_count: 0 })
    .eq('id', id)
    .eq('firm_id', caller.firmId)
    .select(PUBLIC_COLUMNS)
    .single()
  if (error) throw failed('saving the folder failed', error)
  return folderFor(data, caller)
}

async function folderRow(caller: SignedIn, id: string): Promise<FolderRow> {
  const { data, error } = await folders().select('*').eq('id', id).eq('firm_id', caller.firmId).maybeSingle()
  if (error) throw failed('reading the linked folder failed', error)
  if (!data) throw new FileError('That linked folder was not found.', 404)
  return data
}

// ── Sync ────────────────────────────────────────────────────────────────────

export interface SyncResult {
  folder: LinkedFolder
  /** True when there is more to do: the browser calls again. */
  more: boolean
  /** True when another call is syncing this folder right now. Nothing was done by this one. */
  busy: boolean
  /** Rows imported or replaced by this call, as the caller may read them. */
  documents: DocumentRow[]
}

/** For tests: the clock a sync measures its time with. */
export const syncClock = { now: () => Date.now() }

/**
 * One batch of a linked folder's sync, made to fit a 60-second function.
 *
 * The first call looks at the whole folder and decides what to do (planSync):
 * what is new, what changed, what is gone. That list is saved on the folder.
 * This call and the ones after it work through it, a file at a time, saving
 * after each, and stop taking new files after about 40 seconds. A call that is
 * cut off loses nothing: the next one carries on from what was saved, and a
 * file already imported is never imported twice (the Drive id is unique per
 * student, and a row left half-made is removed and done again).
 */
export async function syncFolder(caller: SignedIn, input: { id: string; today?: string; restart?: boolean }): Promise<SyncResult> {
  const startedAt = syncClock.now()
  const before = await folderRow(caller, input.id)

  // One sync at a time. The lease runs out by itself if this call dies.
  const nowIso = new Date(startedAt).toISOString()
  const leased = await folders()
    .update({ lease_until: new Date(startedAt + SYNC_LEASE_MS).toISOString() })
    .eq('id', before.id)
    .eq('firm_id', caller.firmId)
    .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .select('*')
  if (leased.error) throw failed('starting the sync failed', leased.error)
  const row = leased.data[0]
  if (!row) return { folder: folderFor(before, caller), more: true, busy: true, documents: [] }

  const touched: string[] = []
  let state = (row.sync_state ?? {}) as SyncState
  let patch: Database['public']['Tables']['student_drive_folders']['Update'] = {}
  const save = async (change: Database['public']['Tables']['student_drive_folders']['Update']) => {
    patch = { ...patch, ...change }
    // A file deleted here while this sync runs was written by another request: keep it.
    const fresh = await folders().select('sync_state').eq('id', row.id).maybeSingle()
    const removedHere = [...new Set([...(state.removedHere ?? []), ...(((fresh.data?.sync_state ?? {}) as SyncState).removedHere ?? [])])]
    state = { ...state, removedHere, queue: state.queue?.filter((q) => !removedHere.includes(q.id)) }
    const { error } = await folders().update({ ...change, sync_state: state as unknown as Json, removed_here_count: removedHere.length }).eq('id', row.id).eq('firm_id', caller.firmId)
    if (error) throw failed('saving the sync failed', error)
  }

  try {
    if (!row.linked_by) throw new GoogleError('reconnect', 'The person who linked this folder has left the firm. Unlink it and link it again.', 409)
    const linker = row.linked_by

    // ── Decide what to do, unless a sync is already part-way ──
    if (input.restart || row.status !== 'syncing' || !state.queue?.length) {
      const tree = await listFolderTree(linker, row.drive_folder_id)
      const held = await serviceClient().from('documents').select('id, drive_file_id, drive_modified_at, file_status, storage_path').eq('firm_id', row.firm_id).eq('student_id', row.student_id).not('drive_file_id', 'is', null)
      if (held.error) throw failed('reading the stored Drive files failed', held.error)
      const plan = planSync({
        listed: tree.listed,
        known: held.data.map((d) => ({ driveFileId: d.drive_file_id!, documentId: d.id, driveModifiedAt: d.drive_modified_at, fileStatus: d.file_status })),
        state,
        truncated: tree.truncated,
        tooDeep: tree.tooDeep,
        maxBytes: MAX_FILE_BYTES,
      })
      // Rows an interrupted import left half-made go, with whatever part of the object arrived. They are in the queue again.
      const unfinished = held.data.filter((d) => plan.unfinished.includes(d.id))
      if (unfinished.length) {
        await removeObjects(serviceClient(), unfinished.flatMap((d) => (d.storage_path ? [d.storage_path] : []))).catch(() => undefined)
        await serviceClient().from('documents').delete().eq('firm_id', row.firm_id).eq('file_status', 'uploading').in('id', unfinished.map((d) => d.id))
      }
      state = { ...state, queue: plan.queue, known: plan.known }
      await save({ status: 'syncing', last_error: null, skipped: plan.skipped as unknown as Json, missing_file_ids: plan.missing, progress_done: 0, progress_total: plan.queue.length })
    }

    // ── Work through the list until the time is up ──
    const queue = state.queue ?? []
    const goOn = takeBatch(queue, startedAt, syncClock.now, SYNC_BUDGET_MS, syncBatchLimit())
    let taken = 0
    let done = patch.progress_done ?? row.progress_done
    const skipped = [...((patch.skipped ?? row.skipped) as unknown as SkippedFile[])]
    while (goOn(taken)) {
      const item = queue[taken++]
      const outcome = await importQueued(row, linker, item, input.today)
      done++
      if (outcome.documentId) touched.push(outcome.documentId)
      if (outcome.skipped) skipped.push({ name: item.name, reason: outcome.skipped })
      state = {
        ...state,
        queue: queue.slice(taken),
        known: outcome.documentId ? [...new Set([...(state.known ?? []), item.id])] : state.known,
        // Left out for a reason found only by reading it: not read again until Drive says it changed.
        settled: outcome.skipped ? { ...state.settled, [item.id]: item.modifiedTime ?? '' } : state.settled,
      }
      await save({ progress_done: done, skipped: skipped as unknown as Json })
    }
    if ((state.queue ?? []).length === 0) await save({ status: 'idle', last_synced_at: new Date(syncClock.now()).toISOString(), last_error: null })
  } catch (error) {
    if (error instanceof GoogleError && (error.code === 'reconnect' || error.code === 'not_connected')) {
      await save({ status: 'reconnect', last_error: 'Reconnect Google to sync.' }).catch(() => undefined)
    } else {
      // What was saved stays, so the next call carries on from there.
      if (!(error instanceof GoogleError)) console.error('[google] a sync stopped:', error instanceof Error ? error.message : 'unknown')
      await save({ status: 'error', last_error: error instanceof GoogleError || error instanceof FileError ? error.message.slice(0, 300) : 'The sync stopped. Try “Sync now” again.' }).catch(() => undefined)
    }
  } finally {
    await folders().update({ lease_until: null }).eq('id', row.id).eq('firm_id', caller.firmId)
  }

  const after = await folders().select(PUBLIC_COLUMNS).eq('id', row.id).eq('firm_id', caller.firmId).maybeSingle()
  const folder = folderFor(after.data ?? row, caller)
  // Read as the caller: a file that went where only the owner can open it is not handed to anyone else.
  const documents = touched.length ? ((await caller.client.from('documents').select('*').eq('firm_id', caller.firmId).in('id', touched)).data ?? []) : []
  return { folder, more: folder.status === 'syncing' && folder.done < folder.total, busy: false, documents }
}

/** The same contents already stored for this student: stored once. */
export const isDuplicate = (hash: string, held: { content_hash: string | null; drive_file_id: string | null; file_status: string | null }[], driveFileId: string) =>
  held.some((d) => d.content_hash === hash && d.drive_file_id !== driveFileId && d.file_status !== 'uploading')

/**
 * One file of a sync: a new file is stored, checked and filed; a changed one
 * replaces the stored copy and keeps its folder and title. Returns the document
 * it wrote, or why the file was left out.
 */
async function importQueued(folder: FolderRow, linker: string, item: QueueItem, today?: string): Promise<{ documentId?: string; skipped?: string }> {
  const db = serviceClient()
  const got = await downloadDriveFile(linker, item)
  if (!got.ok) return { skipped: got.reason }
  if (sniffMime(got.bytes) !== got.mime) return { skipped: REASON.wrongContents }
  const hash = sha256(got.bytes)

  if (item.change === 'changed' && item.documentId) {
    const current = await db.from('documents').select('*').eq('id', item.documentId).eq('firm_id', folder.firm_id).maybeSingle()
    if (current.error) throw failed('reading the stored copy failed', current.error)
    const doc = current.data
    // Deleted here in the meantime: it stays deleted.
    if (!doc || !doc.storage_path) return {}
    if (doc.content_hash !== hash) {
      const stored = await db.storage.from(DOCUMENTS_BUCKET).upload(doc.storage_path, got.bytes, { contentType: got.mime, upsert: true })
      if (stored.error) throw failed('replacing the stored copy failed', stored.error)
    }
    // A replaced copy shows as new again, in the folder and under the title it already had.
    const changed = doc.content_hash !== hash
    const updated = await db
      .from('documents')
      .update({ drive_modified_at: item.modifiedTime ?? null, ...(changed ? { size_bytes: got.bytes.length, content_hash: hash, mime_type: got.mime, opened_at: null } : {}) })
      .eq('id', doc.id)
      .eq('firm_id', folder.firm_id)
    if (updated.error) throw failed('saving the replaced copy failed', updated.error)
    if (changed) await logEvent(db, doc, { kind: 'system' }, 'uploaded', { source: 'google_drive', replaced: true })
    return { documentId: doc.id }
  }

  const held = await db.from('documents').select('content_hash, drive_file_id, file_status').eq('firm_id', folder.firm_id).eq('student_id', folder.student_id).eq('content_hash', hash)
  if (held.error) throw failed('checking for the same file failed', held.error)
  if (isDuplicate(hash, held.data, item.id)) return { skipped: REASON.duplicate }

  const row = { ...uploadingRow({ firmId: folder.firm_id, studentId: folder.student_id, filename: storedName(item), size: got.bytes.length, mime: got.mime, by: 'counselor', userId: linker, today: plausibleDay(today) }), ...driveColumns(item) }
  let inserted = await db.from('documents').insert(row).select('*').single()
  if (inserted.error?.code === '23505') {
    // A row for this Drive file is already there. If a call that died left it half-made, it goes
    // (with whatever part of the object arrived) and the file is done again. Otherwise it is already imported.
    const there = await db.from('documents').select('id, storage_path, file_status').eq('firm_id', folder.firm_id).eq('student_id', folder.student_id).eq('drive_file_id', item.id).maybeSingle()
    if (there.error) throw failed('reading the earlier copy failed', there.error)
    if (there.data?.file_status !== 'uploading') return {}
    if (there.data.storage_path) await removeObjects(db, [there.data.storage_path]).catch(() => undefined)
    await db.from('documents').delete().eq('id', there.data.id).eq('firm_id', folder.firm_id).eq('file_status', 'uploading')
    inserted = await db.from('documents').insert(row).select('*').single()
  }
  if (inserted.error) throw failed('creating the imported file failed', inserted.error)
  const stored = await db.storage.from(DOCUMENTS_BUCKET).upload(row.storage_path, got.bytes, { contentType: got.mime, upsert: false })
  if (stored.error) {
    await db.from('documents').delete().eq('id', row.id).eq('firm_id', folder.firm_id)
    throw failed('storing the imported file failed', stored.error)
  }
  try {
    // The checks every upload gets, on the bytes just stored.
    await confirmUpload(db, inserted.data, got.bytes)
  } catch (error) {
    if (error instanceof FileError) return { skipped: error.message }
    throw error
  }
  const sorting = await db.from('documents').update({ size_bytes: got.bytes.length, content_hash: hash, file_status: 'sorting' }).eq('id', row.id).eq('file_status', 'uploading')
  if (sorting.error) throw failed('saving the imported file failed', sorting.error)
  await logEvent(db, inserted.data, { kind: 'counselor', user: linker }, 'uploaded', { by: 'counselor', source: 'google_drive' })
  // Filed with nobody watching, like a student's own upload. If the sorter is cut off, the row is settled the next time documents load.
  await sortStudentDrop(folder.firm_id, row.id, got.bytes, item.hint).catch((error) => console.error('[google] sorting an imported file failed:', error instanceof Error ? error.message : 'unknown'))
  return { documentId: row.id }
}
