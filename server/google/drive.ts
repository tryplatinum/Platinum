// Reading a counselor's Google Drive. Read only: every request here is a GET,
// and the only scope ever asked for is drive.readonly. Nothing in a Drive is
// changed, moved or deleted.
//
// Listings are passed to the browser as they come and are not saved. Everything
// Google answers is checked with the Zod shapes in shared/google.ts before it
// is used. Nothing here logs a file name, a folder name or a token.

import { MAX_FILE_BYTES } from '../../shared/files.js'
import {
  DRIVE_SCOPE,
  GOOGLE_FOLDER,
  GOOGLE_SHORTCUT,
  MAX_FOLDER_DEPTH,
  MAX_FOLDER_FILES,
  REASON,
  driveFile,
  driveKind,
  driveList,
  sharedDriveList,
  type DriveEntry,
  type DriveFile,
  type DriveListing,
  type ListedFile,
} from '../../shared/google.js'
import { DRIVE_API, google } from './config.js'
import { GoogleError, RECONNECT_MESSAGE, accessTokenFor, dropAccessToken } from './connection.js'

const FIELDS = 'id,name,mimeType,modifiedTime,size,webViewLink,trashed,shortcutDetails(targetId,targetMimeType)'
const ALL_DRIVES = { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }

/** One GET to the Drive API as this user. A token Google no longer takes is asked for again, once. */
async function driveGet(userId: string, path: string, params: Record<string, string>): Promise<Response> {
  const url = `${DRIVE_API}${path}?${new URLSearchParams(params)}`
  for (let attempt = 0; ; attempt++) {
    const token = await accessTokenFor(userId, DRIVE_SCOPE)
    let res: Response
    try {
      res = await google.fetch(url, { headers: { authorization: `Bearer ${token}` } })
    } catch {
      throw new GoogleError('google', 'Google Drive could not be reached. Try again in a moment.', 502)
    }
    if (res.status !== 401) return res
    dropAccessToken(userId)
    if (attempt > 0) throw new GoogleError('reconnect', RECONNECT_MESSAGE, 409)
  }
}

async function driveJson(userId: string, path: string, params: Record<string, string>): Promise<unknown> {
  const res = await driveGet(userId, path, params)
  if (res.status === 404) throw new GoogleError('refused', 'That is no longer in Google Drive, or this Google account cannot open it.', 404)
  if (res.status === 403) throw new GoogleError('refused', 'Google would not let that be read.', 403)
  if (res.status === 429 || res.status >= 500) throw new GoogleError('google', 'Google Drive is busy. Try again in a moment.', 502)
  if (!res.ok) throw new GoogleError('google', 'Google Drive gave an answer that could not be used.', 502)
  return res.json().catch(() => undefined)
}

function parsed<T>(shape: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }, value: unknown): T {
  const result = shape.safeParse(value)
  if (!result.success) throw new GoogleError('google', 'Google Drive gave an answer that could not be read.', 502)
  return result.data
}

// ── Browse and search ───────────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  'application/vnd.google-apps.document': 'Google Doc',
  'application/vnd.google-apps.spreadsheet': 'Google Sheet',
  'application/vnd.google-apps.presentation': 'Google Slides',
  'application/vnd.google-apps.form': 'Google Form',
  'application/pdf': 'PDF',
  'image/jpeg': 'Photo',
  'image/png': 'Photo',
  'image/heic': 'Photo',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
}

/** A Drive file as one line of the panel. A shortcut shows as the thing it points to. */
function entryOf(file: DriveFile): DriveEntry {
  const target = file.mimeType === GOOGLE_SHORTCUT && file.shortcutDetails ? { ...file, id: file.shortcutDetails.targetId, mimeType: file.shortcutDetails.targetMimeType ?? '', size: undefined } : file
  const type = driveKind(target)
  if (type.kind === 'folder') return { id: target.id, name: file.name, kind: 'folder', label: 'Folder', url: file.webViewLink }
  const size = target.size ? Number(target.size) : undefined
  const blocked =
    type.kind === 'ignore' || type.kind === 'unsupported' || type.kind === 'shortcut'
      ? 'This kind of file cannot be stored.'
      : type.kind === 'download' && size !== undefined && size > MAX_FILE_BYTES
        ? REASON.tooLarge
        : undefined
  return { id: target.id, name: file.name, kind: 'file', label: LABELS[type.kind === 'download' ? type.mime : target.mimeType] ?? 'File', modified: file.modifiedTime, size, url: file.webViewLink, blocked }
}

const quoted = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/**
 * One page of the Drive panel: My Drive, Shared with me, the shared drives, a
 * folder, or a search by name and contents (Drive's own search).
 */
export async function browseDrive(userId: string, input: { parent: string; query?: string; pageToken?: string }): Promise<DriveListing> {
  if (!input.query && input.parent === 'drives') {
    const page = parsed(sharedDriveList, await driveJson(userId, '/drives', { pageSize: '100', ...(input.pageToken ? { pageToken: input.pageToken } : {}) }))
    return { entries: page.drives.map((d) => ({ id: d.id, name: d.name, kind: 'drive', label: 'Shared drive' })), nextPageToken: page.nextPageToken }
  }
  const q = input.query
    ? `(name contains ${quoted(input.query)} or fullText contains ${quoted(input.query)}) and trashed = false`
    : input.parent === 'shared'
      ? 'sharedWithMe = true and trashed = false'
      : `${quoted(input.parent)} in parents and trashed = false`
  const page = parsed(
    driveList,
    await driveJson(userId, '/files', {
      q,
      fields: `nextPageToken,files(${FIELDS})`,
      pageSize: '100',
      ...ALL_DRIVES,
      // Drive does not sort a full-text search.
      ...(input.query ? { corpora: 'allDrives' } : { orderBy: 'folder,name' }),
      ...(input.pageToken ? { pageToken: input.pageToken } : {}),
    }),
  )
  return { entries: page.files.filter((f) => !f.trashed).map(entryOf), nextPageToken: page.nextPageToken }
}

// ── One file ────────────────────────────────────────────────────────────────

const metadata = async (userId: string, id: string) => parsed(driveFile, await driveJson(userId, `/files/${encodeURIComponent(id)}`, { fields: FIELDS, supportsAllDrives: 'true' }))

/** A file's details. A shortcut is followed to its target, once: a shortcut to a shortcut is refused. */
export async function getDriveFile(userId: string, id: string): Promise<DriveFile> {
  const file = await metadata(userId, id)
  if (file.mimeType !== GOOGLE_SHORTCUT) return file
  if (!file.shortcutDetails) throw new GoogleError('refused', 'That shortcut points nowhere.', 404)
  const target = await metadata(userId, file.shortcutDetails.targetId)
  if (target.mimeType === GOOGLE_SHORTCUT) throw new GoogleError('refused', 'That shortcut points to another shortcut.', 400)
  return target
}

export type Downloaded = { ok: true; bytes: Uint8Array; mime: string } | { ok: false; reason: string }

/** Reads a response body, giving up as soon as it passes the limit. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | undefined> {
  const reader = res.body?.getReader()
  if (!reader) {
    const all = new Uint8Array(await res.arrayBuffer())
    return all.length > max ? undefined : all
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      return undefined
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/**
 * The bytes to store for one Drive file. A Google Doc, Sheet or Slides file is
 * saved as a PDF by Google (files.export); anything else is downloaded as it
 * is. A file that cannot be taken comes back with the reason, never an error.
 */
export async function downloadDriveFile(userId: string, file: { id: string; name: string; mimeType: string; size?: string | number }): Promise<Downloaded> {
  const type = driveKind(file)
  if (type.kind !== 'export' && type.kind !== 'download') return { ok: false, reason: REASON.unsupported }
  if (type.kind === 'download' && file.size && Number(file.size) > MAX_FILE_BYTES) return { ok: false, reason: REASON.tooLarge }
  const res =
    type.kind === 'export'
      ? await driveGet(userId, `/files/${encodeURIComponent(file.id)}/export`, { mimeType: 'application/pdf' })
      : await driveGet(userId, `/files/${encodeURIComponent(file.id)}`, { alt: 'media', supportsAllDrives: 'true' })
  if (res.status === 403 && type.kind === 'export') {
    const text = await res.text().catch(() => '')
    return { ok: false, reason: /exportSizeLimitExceeded|too large/i.test(text) ? REASON.exportTooLarge : REASON.notReadable }
  }
  if (res.status === 403 || res.status === 404) return { ok: false, reason: REASON.notReadable }
  if (!res.ok) throw new GoogleError('google', 'Google Drive is busy. Try again in a moment.', 502)
  const bytes = await readCapped(res, MAX_FILE_BYTES)
  if (!bytes) return { ok: false, reason: REASON.tooLarge }
  if (bytes.length === 0) return { ok: false, reason: REASON.empty }
  return { ok: true, bytes, mime: type.kind === 'export' ? 'application/pdf' : type.mime }
}

// ── A whole folder ──────────────────────────────────────────────────────────

export interface FolderContents {
  listed: ListedFile[]
  /** More than 500 files: the rest were not read. */
  truncated: boolean
  /** Names of folders too far down to be read. */
  tooDeep: string[]
}

/**
 * Every file under a folder, subfolders included: at most 500 files and five
 * levels (the linked folder itself is level one). A shortcut is followed to its
 * target once. A folder is never read twice, so a loop of shortcuts ends.
 */
export async function listFolderTree(userId: string, folderId: string): Promise<FolderContents> {
  const listed: ListedFile[] = []
  const tooDeep: string[] = []
  const visited = new Set<string>([folderId])
  let truncated = false
  let level: { id: string; hint: string }[] = [{ id: folderId, hint: '' }]

  for (let depth = 1; level.length && !truncated; depth++) {
    const next: typeof level = []
    for (const folder of level) {
      let pageToken: string | undefined
      do {
        const page: { files: DriveFile[]; nextPageToken?: string } = parsed(
          driveList,
          await driveJson(userId, '/files', { q: `${quoted(folder.id)} in parents and trashed = false`, fields: `nextPageToken,files(${FIELDS})`, pageSize: '200', orderBy: 'folder,name', ...ALL_DRIVES, ...(pageToken ? { pageToken } : {}) }),
        )
        for (const found of page.files) {
          let file = found
          if (file.mimeType === GOOGLE_SHORTCUT) {
            if (!file.shortcutDetails) continue
            if (file.shortcutDetails.targetMimeType === GOOGLE_FOLDER) file = { ...file, id: file.shortcutDetails.targetId, mimeType: GOOGLE_FOLDER }
            else {
              // The shortcut's own line has no size or modified time: the target's details are read once.
              const target = await metadata(userId, file.shortcutDetails.targetId).catch(() => undefined)
              if (!target || target.mimeType === GOOGLE_SHORTCUT || target.trashed) continue
              file = target
            }
          }
          if (file.mimeType === GOOGLE_FOLDER) {
            if (visited.has(file.id)) continue
            visited.add(file.id)
            if (depth >= MAX_FOLDER_DEPTH) tooDeep.push(file.name)
            else next.push({ id: file.id, hint: folder.hint ? `${folder.hint} / ${file.name}` : file.name })
            continue
          }
          if (listed.length >= MAX_FOLDER_FILES) {
            truncated = true
            break
          }
          listed.push({ id: file.id, name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime, size: file.size ? Number(file.size) : undefined, url: file.webViewLink, hint: folder.hint })
        }
        pageToken = truncated ? undefined : page.nextPageToken
      } while (pageToken)
      if (truncated) break
    }
    level = next
  }
  return { listed, truncated, tooDeep }
}
