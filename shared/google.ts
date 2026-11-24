// What the browser and the server agree on about Google: the endpoint, the
// limits, the shape of every request the browser makes to /api/google, the
// shape of what Google answers, and the pure rules of a folder sync (what is
// new, what changed, what is gone). No secrets and no network here.

import { z } from 'zod'

export const GOOGLE_ENDPOINT = '/api/google'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'

/** A linked folder is read at most this many files and this many levels deep. */
export const MAX_FOLDER_FILES = 500
export const MAX_FOLDER_DEPTH = 5
/** Google refuses to export a Doc, Sheet or Slides file larger than this. */
export const MAX_EXPORT_BYTES = 10 * 1024 * 1024
/** A sync call stops taking new files after this long, so it fits a 60-second function. */
export const SYNC_BUDGET_MS = 40_000
/** A student's Documents tab syncs a linked folder again when the last sync is older than this. */
export const SYNC_STALE_MS = 15 * 60_000
/** A sync call holds its folder this long, so two calls never import the same file. */
export const SYNC_LEASE_MS = 75_000

export const GOOGLE_FOLDER = 'application/vnd.google-apps.folder'
export const GOOGLE_SHORTCUT = 'application/vnd.google-apps.shortcut'
/** Google's own formats that can be saved as a PDF. */
export const GOOGLE_EXPORTABLE: readonly string[] = ['application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet', 'application/vnd.google-apps.presentation']

// ── What the browser sends ──────────────────────────────────────────────────

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
/** A Drive id: letters, digits, dash and underscore. Checked before it is put in a URL or a query. */
export const driveId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const connectInput = z.object({ gmail: z.boolean().optional() })

export const browseInput = z.object({
  /** root: My Drive. shared: Shared with me. drives: the list of shared drives. Otherwise a folder's id. */
  parent: z.union([z.literal('root'), z.literal('shared'), z.literal('drives'), driveId]).default('root'),
  /** Name and full-text search across everything the account can read. */
  query: z.string().trim().max(200).optional(),
  pageToken: z.string().max(2000).optional(),
})

export const importInput = z.object({ fileId: driveId, studentId: uuid.optional(), today: day.optional() })
export const linkInput = z.object({ folderId: driveId, studentId: uuid })
export const foldersInput = z.object({ studentId: uuid })
export const folderInput = z.object({ id: uuid })
export const syncInput = z.object({ id: uuid, today: day.optional(), /** Start over from a fresh look at the folder, even if a sync was under way. */ restart: z.boolean().optional() })

// ── What Google sends ───────────────────────────────────────────────────────

export const tokenReply = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
})

export const tokenFailure = z.object({ error: z.string(), error_description: z.string().optional() })

export const aboutReply = z.object({ user: z.object({ emailAddress: z.string().min(3).max(320) }) })

export const driveFile = z.object({
  id: driveId,
  name: z.string().max(2000),
  mimeType: z.string().max(200),
  modifiedTime: z.string().optional(),
  /** Bytes, as a string. Absent on folders and on Google's own formats. */
  size: z.string().regex(/^\d+$/).optional(),
  webViewLink: z.string().url().max(500).optional(),
  trashed: z.boolean().optional(),
  shortcutDetails: z.object({ targetId: driveId, targetMimeType: z.string().max(200).optional() }).optional(),
})
export type DriveFile = z.infer<typeof driveFile>

export const driveList = z.object({ files: z.array(driveFile).default([]), nextPageToken: z.string().optional() })
export const sharedDriveList = z.object({ drives: z.array(z.object({ id: driveId, name: z.string().max(2000) })).default([]), nextPageToken: z.string().optional() })
export const gmailSent = z.object({ id: z.string().min(1) })

// ── What the server answers ─────────────────────────────────────────────────

export interface GoogleStatus {
  /** False when the server has no Google settings: every Google feature is hidden. */
  available: boolean
  connected: boolean
  address?: string
  drive: boolean
  gmail: boolean
  /** Google said the grant is expired or revoked. Everything shows "Reconnect Google". */
  reconnect: boolean
}

/** One line of the Drive panel. */
export interface DriveEntry {
  id: string
  name: string
  kind: 'folder' | 'file' | 'drive'
  /** PDF, Photo, Google Doc… in a word or two. */
  label: string
  modified?: string
  size?: number
  url?: string
  /** Why this file cannot be imported, when it cannot. */
  blocked?: string
}

export interface DriveListing {
  entries: DriveEntry[]
  nextPageToken?: string
}

export interface SkippedFile {
  name: string
  reason: string
}

/** A linked folder as the browser sees it. Never the server's working state. */
export interface LinkedFolder {
  id: string
  studentId: string
  name: string
  url?: string
  status: 'idle' | 'syncing' | 'reconnect' | 'error'
  lastSyncedAt?: string
  lastError?: string
  done: number
  total: number
  skipped: SkippedFile[]
  missingFileIds: string[]
  removedHere: number
  /** True when the signed-in person linked it (their Google connection is the one it syncs with). */
  mine: boolean
}

// ── Which files can be stored ───────────────────────────────────────────────

/** What a Drive file is to us, from its Google type and name alone. */
export type DriveKind =
  | { kind: 'folder' }
  | { kind: 'shortcut' }
  /** Saved as a PDF by Google. */
  | { kind: 'export' }
  | { kind: 'download'; mime: string }
  /** Google Forms, Sites, Maps and the like: nothing to store. Left out without a word. */
  | { kind: 'ignore' }
  | { kind: 'unsupported' }

const STORED_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heic',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
const STORED_MIME = new Set(Object.values(STORED_BY_EXTENSION))

export function driveKind(file: Pick<DriveFile, 'mimeType' | 'name'>): DriveKind {
  if (file.mimeType === GOOGLE_FOLDER) return { kind: 'folder' }
  if (file.mimeType === GOOGLE_SHORTCUT) return { kind: 'shortcut' }
  if (GOOGLE_EXPORTABLE.includes(file.mimeType)) return { kind: 'export' }
  if (file.mimeType.startsWith('application/vnd.google-apps.')) return { kind: 'ignore' }
  const type = file.mimeType === 'image/heif' ? 'image/heic' : file.mimeType
  const mime = STORED_MIME.has(type) ? type : STORED_BY_EXTENSION[file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? '']
  return mime ? { kind: 'download', mime } : { kind: 'unsupported' }
}

export const REASON = {
  tooLarge: 'Larger than 25 MB.',
  exportTooLarge: 'Too large for Google to save as a PDF (over 10 MB).',
  unsupported: 'Not a kind of file that can be stored (PDF, JPEG, PNG, HEIC, Word or Excel, or a Google Doc, Sheet or Slides file).',
  duplicate: 'The same file is already stored for this student.',
  notReadable: 'Google would not let this file be read.',
  wrongContents: 'The file is not what its name says it is.',
  empty: 'The file is empty.',
  tooMany: `A linked folder takes at most ${MAX_FOLDER_FILES} files. The rest were left out.`,
  tooDeep: `Folders more than ${MAX_FOLDER_DEPTH} levels down are not read.`,
} as const

/** The name a stored copy gets: Google's own formats are saved as PDFs. */
export const storedName = (file: Pick<DriveFile, 'name' | 'mimeType'>): string => (driveKind(file).kind === 'export' && !/\.pdf$/i.test(file.name) ? `${file.name}.pdf` : file.name)

// ── The sync decision ───────────────────────────────────────────────────────

/** A file found in the linked folder, with the subfolder it sits in. */
export interface ListedFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  size?: number
  url?: string
  /** The Drive subfolder path under the linked folder, e.g. "Testing / SAT". Empty at the top. */
  hint: string
}

/** What we already hold of a Drive file for this student. */
export interface KnownFile {
  driveFileId: string
  documentId: string
  driveModifiedAt?: string | null
  fileStatus?: string | null
}

export interface QueueItem extends ListedFile {
  /** `changed` replaces the stored copy of `documentId`. */
  change: 'new' | 'changed'
  documentId?: string
}

/** The server's working state for one linked folder. Kept in sync_state; never sent to the browser. */
export interface SyncState {
  queue?: QueueItem[]
  /** Drive files imported from this folder at some point. */
  known?: string[]
  /** Drive files a person deleted here. Not imported again unless they ask. */
  removedHere?: string[]
  /** Files left out for a reason found only by reading them, by Drive id, with the modified time they had: not read again until they change. */
  settled?: Record<string, { at: string; reason: string }>
}

export interface SyncPlan {
  queue: QueueItem[]
  skipped: SkippedFile[]
  /** Stored copies whose Drive file is no longer in the folder. */
  missing: string[]
  /** Rows left half-made by an interrupted import: removed, then imported again. */
  unfinished: string[]
  known: string[]
}

const later = (a: string | undefined, b: string | null | undefined) => Boolean(a && (!b || Date.parse(a) > Date.parse(b) + 1000))

/**
 * Decides what one sync does, from what is in the folder now and what we hold.
 *
 *   new            in the folder, not stored, not deleted here  → imported
 *   changed        stored, and Drive's modified time is later   → the stored copy is replaced
 *   unchanged      stored, same modified time                   → nothing
 *   removed        stored, no longer in the folder              → kept, marked "No longer in Drive"
 *   deleted here   a person deleted the stored copy             → not imported again
 *
 * A file that cannot be stored is listed with the reason, except Google's own
 * formats with nothing to save (Forms, Sites, Maps), which are left out quietly.
 */
export function planSync(input: { listed: ListedFile[]; known: KnownFile[]; state: SyncState; truncated?: boolean; tooDeep?: string[]; maxBytes: number }): SyncPlan {
  const removedHere = new Set(input.state.removedHere ?? [])
  const settled = input.state.settled ?? {}
  const stored = new Map(input.known.map((k) => [k.driveFileId, k]))
  const queue: QueueItem[] = []
  const skipped: SkippedFile[] = []
  const unfinished: string[] = []
  const seen = new Set<string>()

  for (const file of input.listed) {
    // The same file reached twice (a shortcut beside its target) is taken once.
    if (seen.has(file.id)) continue
    seen.add(file.id)
    const type = driveKind(file)
    if (type.kind === 'ignore' || type.kind === 'folder' || type.kind === 'shortcut') continue
    const have = stored.get(file.id)
    if (!have && removedHere.has(file.id)) continue
    if (type.kind === 'unsupported') {
      skipped.push({ name: file.name, reason: REASON.unsupported })
      continue
    }
    if (type.kind === 'download' && file.size !== undefined && file.size > input.maxBytes) {
      skipped.push({ name: file.name, reason: REASON.tooLarge })
      continue
    }
    if (have?.fileStatus === 'uploading') {
      unfinished.push(have.documentId)
      queue.push({ ...file, change: 'new' })
      continue
    }
    if (!have) {
      // Left out before for a reason found only by reading it (a duplicate, an export too large): not read again until it changes.
      if (settled[file.id] && settled[file.id].at === (file.modifiedTime ?? '')) {
        skipped.push({ name: file.name, reason: settled[file.id].reason })
        continue
      }
      queue.push({ ...file, change: 'new' })
    } else if (later(file.modifiedTime, have.driveModifiedAt)) {
      queue.push({ ...file, change: 'changed', documentId: have.documentId })
    }
  }

  if (input.truncated) skipped.push({ name: '', reason: REASON.tooMany })
  for (const name of input.tooDeep ?? []) skipped.push({ name, reason: REASON.tooDeep })

  const known = [...new Set([...(input.state.known ?? []), ...input.known.filter((k) => seen.has(k.driveFileId)).map((k) => k.driveFileId)])]
  const missing = known.filter((id) => !seen.has(id) && stored.has(id))
  return { queue, skipped, missing, unfinished, known }
}

/** How many of the queue one call takes: files are taken until the time is up, and always at least one. */
export function takeBatch<T>(queue: T[], startedAt: number, now: () => number, budgetMs: number, maxFiles = Infinity): (taken: number) => boolean {
  return (taken) => taken < queue.length && taken < maxFiles && (taken === 0 || now() - startedAt < budgetMs)
}
