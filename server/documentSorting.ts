// Stored files on the server: everything that decides or records where a file
// goes. Plain exported functions, so api/documents.ts (a signed-in counselor),
// api/student.ts (a student link) and, later, the central AI can all call them.
//
//   * classifyDocument     reads the file from storage and asks the model for a folder and a title
//   * matchRoster          matches the name the model read to the firm's students, in code
//   * recentCorrections    the correction log: times a person chose another folder than the AI
//   * suggestForCounselor  records a suggestion on a counselor's upload (it waits for them)
//   * sortStudentDrop      files a student's upload with nobody watching
//   * fileDocument         a person files, re-files or approves
//   * deleteStoredFiles    THE one path that removes stored files: objects first, then rows
//   * settleFiles          finishes rows whose background work was cut off
//
// Who acts: a counselor's work is done with their own client, so row level
// security applies. The service role is used only where there is no signed-in
// person (a student link, system events, the background retry) and for removing
// every file of a student or firm, always filtered by the caller's firm, and
// only after checking that no owner-only file is in a non-owner's way.
//
// Nothing here logs file contents, signed URLs or keys.

import { createHash, randomUUID } from 'node:crypto'
import { waitUntil } from '@vercel/functions'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fileClassification, type FileClassification } from '../shared/contract.js'
import {
  ABANDONED_UPLOAD_MS,
  ALLOWED_MIME_TYPES,
  DOCUMENTS_BUCKET,
  FILE_TYPES_LABEL,
  MAX_FILE_BYTES,
  MIME,
  SIGNED_URL_SECONDS,
  STUCK_SORTING_MS,
  declaredMime,
  sniffMime,
  storagePathFor,
  titleFromFilename,
} from '../shared/files.js'
import type { Database, Json } from '../src/lib/database.types.js'
import type { DocumentAction, FileSuggestion } from '../src/types.js'
import { AiError, hasAnthropicKey, runWithFile, type FileContent } from './claude.js'
import { firstPages, officeText, reducedPhoto } from './fileText.js'
import { SORT_PROMPT, type SortPromptInput } from './prompts.js'
import { rememberRemovedHere } from './google/removedHere.js'
import { serviceClient, serviceConfigured, type Caller } from './supabase.js'

type Db = SupabaseClient<Database>
export type DocumentRow = Database['public']['Tables']['documents']['Row']
type SignedIn = Extract<Caller, { ok: true }>

/** Something the person should simply be told. The message is safe to show. */
export class FileError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

const failed = (doing: string, error: { message: string }) => new Error(`${doing}: ${error.message}`)

// ── Work after the response ─────────────────────────────────────────────────
// On Vercel a function may be frozen once it has answered, so work that should
// outlive the response is handed to waitUntil. In `npm run dev` and in the test
// scripts there is no such limit and the promise simply runs. If the work is cut
// off anyway, settleFiles() finishes the row the next time documents are loaded.

const pending = new Set<Promise<unknown>>()

export function inBackground(work: Promise<unknown>): void {
  const safe = work.catch((error) => console.error('[documents] background work failed:', error instanceof Error ? error.message : 'unknown'))
  pending.add(safe)
  void safe.finally(() => pending.delete(safe))
  try {
    waitUntil(safe)
  } catch {
    // Not on Vercel: the promise runs on its own.
  }
}

/** Resolves when all background work started so far has finished. For scripts and tests. */
export async function backgroundIdle(): Promise<void> {
  while (pending.size) await Promise.all([...pending])
}

// ── Storage ─────────────────────────────────────────────────────────────────

export const bucket = (db: Db) => db.storage.from(DOCUMENTS_BUCKET)

async function download(db: Db, path: string): Promise<Uint8Array | undefined> {
  const { data, error } = await bucket(db).download(path)
  if (error || !data) return undefined
  return new Uint8Array(await data.arrayBuffer())
}

/** Removes objects by their exact paths. Throws if storage refuses, so the caller keeps the rows. */
export async function removeObjects(db: Db, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await bucket(db).remove(paths.slice(i, i + 100))
    if (error) throw failed('removing stored files failed', error)
  }
}

// ── Events ──────────────────────────────────────────────────────────────────

export async function logEvent(db: Db, row: Pick<DocumentRow, 'id' | 'firm_id'>, actor: { kind: 'counselor' | 'student_link' | 'system'; user?: string }, action: DocumentAction, detail: Record<string, unknown> = {}): Promise<void> {
  const { error } = await db.from('document_events').insert({ firm_id: row.firm_id, document_id: row.id, actor_kind: actor.kind, actor_user: actor.user ?? null, action, detail: detail as Json })
  // The log never blocks the work it describes.
  if (error) console.error('[documents] event not written:', action, error.message)
}

/** An event with no signed-in person behind it. Needs the service role; without it the event is skipped. */
const logSystemEvent = (row: Pick<DocumentRow, 'id' | 'firm_id'>, action: DocumentAction, detail: Record<string, unknown> = {}) =>
  serviceConfigured() ? logEvent(serviceClient(), row, { kind: 'system' }, action, detail) : Promise.resolve()

// ── Folders ─────────────────────────────────────────────────────────────────

interface Folder {
  id: string
  name: string
  description: string
  sensitivity: string
  archived_at: string | null
}

async function foldersOf(db: Db, firmId: string): Promise<Folder[]> {
  const { data, error } = await db.from('document_types').select('id, name, description, sensitivity, archived_at').eq('firm_id', firmId).order('position').order('name')
  if (error) throw failed('reading folders failed', error)
  return data
}

/** Where a file goes when nothing better is known: "Other", or else the firm's last open, standard folder. */
function catchAll(folders: Folder[]): Folder {
  const open = folders.filter((f) => !f.archived_at)
  const folder = open.find((f) => f.name === 'Other') ?? open.filter((f) => f.sensitivity === 'standard').at(-1) ?? open.at(-1) ?? folders.at(-1)
  if (!folder) throw new FileError('This firm has no folders. Add one in Firm settings.', 409)
  return folder
}

// ── Checking an upload ──────────────────────────────────────────────────────

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** A row that is waiting for its file, as inserted. */
export function uploadingRow(input: { firmId: string; studentId?: string; filename: string; size: number; mime: string; by: 'counselor' | 'student_link'; userId?: string; today: string }) {
  const id = randomUUID()
  const filename = input.filename.slice(0, 300)
  const title = titleFromFilename(filename)
  return {
    id,
    firm_id: input.firmId,
    student_id: input.studentId ?? null,
    name: title,
    title,
    kind: 'other',
    category: 'other',
    added_on: input.today,
    added_by: input.by === 'counselor' ? 'counselor' : 'student',
    storage_path: storagePathFor(input.firmId, input.studentId, id, filename),
    original_filename: filename,
    size_bytes: input.size,
    mime_type: input.mime,
    uploaded_by_kind: input.by,
    uploaded_by_user: input.userId ?? null,
    file_status: 'uploading',
  }
}

/** The declared name, size and type of a file about to be uploaded, or the reason it cannot be. */
export function checkDeclared(filename: unknown, size: unknown, type: unknown): { filename: string; size: number; mime: string } {
  if (typeof filename !== 'string' || !filename.trim()) throw new FileError('That file has no name.')
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) throw new FileError('That file is empty.')
  if (size > MAX_FILE_BYTES) throw new FileError('That file is larger than 25 MB.', 413)
  const mime = declaredMime(filename, typeof type === 'string' ? type : undefined)
  if (!mime) throw new FileError(`That kind of file cannot be added. Use ${FILE_TYPES_LABEL}.`, 415)
  return { filename: filename.trim(), size, mime }
}

export const plausibleDay = (value: unknown): string => {
  const now = Date.now()
  const days = [-1, 0, 1].map((d) => new Date(now + d * 86_400_000).toISOString().slice(0, 10))
  return typeof value === 'string' && days.includes(value) ? value : days[1]
}

/**
 * Confirms the object behind an uploading row really is what the row says:
 * it exists, it is within the size limit, and its first bytes are the declared
 * type. If any check fails the object and the row are removed and a FileError
 * says why. Returns the bytes so the caller need not download them again.
 * `given` is for a caller that put the object there itself a moment ago (a file
 * copied from Google Drive) and so already holds the bytes: the checks are the same.
 */
export async function confirmUpload(db: Db, row: DocumentRow, given?: Uint8Array): Promise<{ bytes: Uint8Array; hash: string }> {
  const path = row.storage_path!
  const reject = async (message: string, status = 400): Promise<never> => {
    await removeObjects(db, [path]).catch(() => undefined)
    await db.from('documents').delete().eq('id', row.id).eq('firm_id', row.firm_id)
    throw new FileError(message, status)
  }
  const bytes = given ?? (await download(db, path))
  if (!bytes) return reject('The file did not arrive. Please add it again.', 409)
  if (bytes.length === 0) return reject('That file is empty.')
  if (bytes.length > MAX_FILE_BYTES) return reject('That file is larger than 25 MB.', 413)
  const real = sniffMime(bytes)
  if (!real || !ALLOWED_MIME_TYPES.includes(real)) return reject(`That file is not what its name says. Use ${FILE_TYPES_LABEL}.`, 415)
  if (real !== row.mime_type) return reject('That file is not the kind its name says it is. Save it again in the right format and add it once more.', 415)
  return { bytes, hash: sha256(bytes) }
}

// ── The correction log and the roster match ─────────────────────────────────

/** How many corrections the model is shown. */
const CORRECTIONS = 20

/**
 * The firm's latest corrections: files a person filed under a different folder
 * from the one the AI proposed. They are read from the documents themselves
 * (the AI's suggestion is kept on the row after filing), newest first.
 */
export async function recentCorrections(db: Db, firmId: string, folders: Folder[]): Promise<SortPromptInput['corrections']> {
  const { data, error } = await db
    .from('documents')
    .select('title, name, type_id, ai_suggestion')
    .eq('firm_id', firmId)
    .eq('file_status', 'filed')
    .eq('sorted_by', 'person')
    .not('ai_suggestion', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(CORRECTIONS * 5)
  if (error) throw failed('reading corrections failed', error)
  const name = new Map(folders.map((f) => [f.id, f.name]))
  return data
    .map((d) => ({ title: d.title ?? d.name, ai: (d.ai_suggestion as unknown as FileSuggestion).typeId, chosen: d.type_id }))
    .filter((c) => c.chosen && c.ai !== c.chosen && name.has(c.ai) && name.has(c.chosen))
    .slice(0, CORRECTIONS)
    .map((c) => ({ title: c.title, aiFolder: name.get(c.ai)!, chosenFolder: name.get(c.chosen!)! }))
}

const nameKey = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .sort()
    .join(' ')

/**
 * The student a printed name belongs to, or undefined. Exact first ("Maya Chen"),
 * then ignoring case and order ("CHEN, Maya"). Never a guess: two students who
 * match equally well means no match. The model is never shown the roster.
 */
export function matchRoster(printed: string | undefined | null, students: { id: string; first_name: string; last_name: string; local_name?: string | null }[]): string | undefined {
  const name = printed?.trim().replace(/\s+/g, ' ')
  if (!name) return undefined
  const one = (found: typeof students) => (found.length === 1 ? found[0].id : undefined)
  const exact = students.filter((s) => `${s.first_name} ${s.last_name}`.trim() === name || (s.local_name && s.local_name.trim() === name))
  if (exact.length) return one(exact)
  const key = nameKey(name)
  return key ? one(students.filter((s) => nameKey(`${s.first_name} ${s.last_name}`) === key)) : undefined
}

async function rosterMatch(db: Db, firmId: string, printed: string | undefined): Promise<string | undefined> {
  if (!printed) return undefined
  const { data, error } = await db.from('students').select('id, first_name, last_name, local_name').eq('firm_id', firmId).eq('archived', false)
  if (error) throw failed('reading the roster failed', error)
  return matchRoster(printed, data)
}

// ── Asking the model ────────────────────────────────────────────────────────

/** Images above this cannot be sent as they are (the API's limit is 5 MB once encoded): a reduced copy is sent. */
const MAX_IMAGE_BYTES = 3_500_000
/** A PDF that cannot be cut to two pages is sent whole only when it is small. */
const MAX_WHOLE_PDF_BYTES = 3_000_000

/**
 * The one place a request to the model is made. Tests replace `classify` to
 * count calls or to answer without the network.
 */
export const sorter = {
  async classify(input: SortPromptInput, file: FileContent | undefined, typeIds: [string, ...string[]]): Promise<{ output: FileClassification; model: string }> {
    if (!hasAnthropicKey()) throw new AiError('no_key', 'The server has no Anthropic API key.', 503)
    return runWithFile({ system: SORT_PROMPT.system, text: SORT_PROMPT.user(input), file, schema: fileClassification(typeIds), effort: SORT_PROMPT.effort })
  },
}

/**
 * What of the file the model is shown: two PDF pages, the image, or the opening
 * text of a Word or Excel file. A photo too large to send, and any HEIC photo,
 * is shown as a reduced copy made here in memory; the stored file is untouched.
 * `nameOnly` is set when a photo could not be shown at all, so the model has
 * only the file name: the caller then marks the file to be checked.
 */
export async function contentFor(bytes: Uint8Array, mime: string | null): Promise<{ file?: FileContent; text?: string; nameOnly?: boolean }> {
  const base64 = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64')
  if (mime === MIME.pdf) {
    const pages = (await firstPages(bytes)) ?? (bytes.length <= MAX_WHOLE_PDF_BYTES ? bytes : undefined)
    return pages ? { file: { kind: 'pdf', base64: base64(pages) } } : {}
  }
  if ((mime === MIME.jpeg || mime === MIME.png) && bytes.length <= MAX_IMAGE_BYTES) return { file: { kind: 'image', mediaType: mime, base64: base64(bytes) } }
  if (mime === MIME.jpeg || mime === MIME.png || mime === MIME.heic) {
    const copy = await reducedPhoto(bytes, mime)
    // The reduced copy could not be made: the file name is all the model gets.
    return copy && copy.length <= MAX_IMAGE_BYTES ? { file: { kind: 'image', mediaType: MIME.jpeg, base64: base64(copy) } } : { nameOnly: true }
  }
  if (mime === MIME.docx || mime === MIME.xlsx) return { text: officeText(bytes, mime) }
  return {}
}

/**
 * Reads a stored file and asks the model which folder it belongs in. The input
 * is the first two pages (or the image), the firm's open folders with their
 * descriptions, and the firm's last 20 corrections. Throws when the model
 * cannot be asked or does not answer; the callers below decide what happens then.
 */
export async function classifyDocument(db: Db, row: DocumentRow, given?: Uint8Array, driveFolder?: string): Promise<FileSuggestion> {
  const bytes = given ?? (await download(db, row.storage_path!))
  if (!bytes) throw new FileError('The file could not be read from storage.', 409)
  const folders = await foldersOf(db, row.firm_id)
  const open = folders.filter((f) => !f.archived_at)
  if (open.length === 0) throw new FileError('This firm has no folders.', 409)
  const corrections = await recentCorrections(db, row.firm_id, folders)
  const content = await contentFor(bytes, row.mime_type)

  const ids = open.map((f) => f.id) as [string, ...string[]]
  const { output, model } = await sorter.classify(
    {
      filename: row.original_filename ?? row.name,
      uploadedBy: row.uploaded_by_kind === 'student_link' ? 'student' : 'counselor',
      folders: open.map((f) => ({ id: f.id, name: f.name, description: f.description })),
      corrections,
      extractedText: content.text,
      hasFile: Boolean(content.file),
      driveFolder,
    },
    content.file,
    ids,
  )
  // The schema already limits the folder to the firm's ids; this guards a stub or a model that ignored it.
  if (!ids.includes(output.typeId)) throw new AiError('upstream', 'The model chose a folder this firm does not have.')
  const clean = (value: string | null | undefined, max: number) => value?.replace(/\s+/g, ' ').trim().slice(0, max) || undefined
  return {
    typeId: output.typeId,
    title: clean(output.title, 200) ?? row.title ?? row.name,
    schoolYear: clean(output.schoolYear, 20),
    studentName: clean(output.studentName, 120),
    reason: clean(output.reason, 300) ?? '',
    alternatives: [...new Set(output.alternatives)].filter((id) => id !== output.typeId && ids.includes(id)).slice(0, 2),
    // A photo sorted from its name alone is always checked by a person.
    sure: output.sure && !content.nameOnly,
    model,
    at: new Date().toISOString(),
  }
}

/** Whether the firm's owner has left "Sort files automatically" on. Always read from the database. */
async function sortsAutomatically(db: Db, firmId: string): Promise<boolean> {
  const { data, error } = await db.from('firms').select('sort_files_automatically').eq('id', firmId).single()
  if (error) throw failed('reading the firm setting failed', error)
  return data.sort_files_automatically
}

const worthRetrying = (error: unknown) => !(error instanceof AiError && error.code === 'no_key') && !(error instanceof FileError)

// ── A counselor's upload ────────────────────────────────────────────────────

async function ownRow(caller: SignedIn, documentId: unknown): Promise<DocumentRow> {
  if (typeof documentId !== 'string') throw new FileError('That file was not found.', 404)
  const { data, error } = await caller.client.from('documents').select('*').eq('id', documentId).eq('firm_id', caller.firmId).not('storage_path', 'is', null).maybeSingle()
  if (error) throw failed('reading the document failed', error)
  if (!data) throw new FileError('That file was not found. It may have been deleted, or filed where only the firm’s owner can open it.', 404)
  return data
}

/** Step 1: the row that lets the browser upload straight to storage, to exactly one path. */
export async function startCounselorUpload(caller: SignedIn, input: { filename?: unknown; size?: unknown; type?: unknown; studentId?: unknown; today?: unknown }): Promise<DocumentRow> {
  const declared = checkDeclared(input.filename, input.size, input.type)
  const row = uploadingRow({ firmId: caller.firmId, studentId: typeof input.studentId === 'string' && input.studentId ? input.studentId : undefined, ...declared, by: 'counselor', userId: caller.userId, today: plausibleDay(input.today) })
  const { data, error } = await caller.client.from('documents').insert(row).select('*').single()
  if (error) throw error.code === '23503' ? new FileError('That student was not found.', 404) : failed('creating the upload failed', error)
  return data
}

/** Step 2, once the browser has uploaded: check the real file, record its hash, and move the row on. */
export async function finishCounselorUpload(caller: SignedIn, documentId: unknown): Promise<DocumentRow> {
  const row = await ownRow(caller, documentId)
  if (row.file_status !== 'uploading') return row
  const { bytes, hash } = await confirmUpload(caller.client, row)
  const { data, error } = await caller.client.from('documents').update({ size_bytes: bytes.length, content_hash: hash, file_status: 'sorting' }).eq('id', row.id).eq('file_status', 'uploading').select('*').maybeSingle()
  if (error) throw failed('saving the upload failed', error)
  if (data) await logEvent(caller.client, row, { kind: 'counselor', user: caller.userId }, 'uploaded', { by: 'counselor' })
  return data ?? (await ownRow(caller, row.id))
}

/**
 * Step 3: the suggestion. A counselor's upload is never filed by the AI: the
 * row moves to 'suggested' and waits for them. With sorting switched off, or
 * when the model cannot be reached, it waits under the catch-all folder marked
 * to check. A person who filed it in the meantime is never overwritten: every
 * write here applies only while the row is still 'sorting'.
 */
export async function suggestForCounselor(caller: SignedIn, documentId: unknown): Promise<DocumentRow> {
  const row = await ownRow(caller, documentId)
  if (row.file_status !== 'sorting' || row.uploaded_by_kind !== 'counselor') return row
  const db = caller.client
  const settle = async (patch: Database['public']['Tables']['documents']['Update']) => {
    const { error } = await db.from('documents').update({ ...patch, file_status: 'suggested' }).eq('id', row.id).eq('file_status', 'sorting')
    if (error) throw failed('saving the suggestion failed', error)
    return ownRow(caller, row.id).catch(() => row)
  }
  const other = catchAll(await foldersOf(db, row.firm_id)).id

  if (!(await sortsAutomatically(db, row.firm_id))) return settle({ type_id: other, needs_check: true })
  try {
    const suggestion = await classifyDocument(db, row)
    const student = row.student_id ?? (await rosterMatch(db, row.firm_id, suggestion.studentName))
    const saved = await settle({ ai_suggestion: suggestion as unknown as Json, needs_check: !suggestion.sure, student_id: student ?? null })
    await logSystemEvent(row, 'suggested', { typeId: suggestion.typeId, sure: suggestion.sure, model: suggestion.model })
    return saved
  } catch (error) {
    const saved = await settle({ type_id: other, needs_check: true })
    if (worthRetrying(error)) inBackground(retrySuggestion(serviceConfigured() ? serviceClient() : db, row, other))
    return saved
  }
}

/** One more try after a failed suggestion. Applies only if the upload is still waiting, untouched. */
async function retrySuggestion(db: Db, row: DocumentRow, other: string): Promise<void> {
  const suggestion = await classifyDocument(db, row)
  const student = row.student_id ?? (await rosterMatch(db, row.firm_id, suggestion.studentName))
  const { data, error } = await db
    .from('documents')
    .update({ ai_suggestion: suggestion as unknown as Json, needs_check: !suggestion.sure, type_id: null, ...(row.student_id ? {} : { student_id: student ?? null }) })
    .eq('id', row.id)
    .eq('firm_id', row.firm_id)
    .eq('file_status', 'suggested')
    .eq('type_id', other)
    .is('ai_suggestion', null)
    .select('id')
  if (error) throw failed('saving the retried suggestion failed', error)
  if (data.length) await logSystemEvent(row, 'suggested', { typeId: suggestion.typeId, sure: suggestion.sure, model: suggestion.model, retry: true })
}

// ── A student's upload ──────────────────────────────────────────────────────

/**
 * Files a student's upload with no counselor action: folder and title from the
 * model, marked to check when it was not sure. With sorting off, or when the
 * model fails, it goes under the catch-all folder marked to check, and a
 * failure is retried once. There is no signed-in person here, so this uses the
 * service role, filtered by the link's firm.
 *
 * A file synced from a Drive folder linked to a student is filed the same way
 * (the person who linked the folder chose the student). `driveFolder` is the
 * Drive subfolder it sat in, given to the model as a hint.
 */
export async function sortStudentDrop(firmId: string, documentId: string, bytes?: Uint8Array, driveFolder?: string): Promise<void> {
  const db = serviceClient()
  const found = await db.from('documents').select('*').eq('id', documentId).eq('firm_id', firmId).maybeSingle()
  if (found.error) throw failed('reading the document failed', found.error)
  const row = found.data
  if (!row || row.file_status !== 'sorting' || !row.storage_path) return
  const other = catchAll(await foldersOf(db, firmId)).id

  const file = async (patch: Database['public']['Tables']['documents']['Update'], detail: Record<string, unknown>) => {
    const { data, error } = await db.from('documents').update({ ...patch, file_status: 'filed', sorted_by: 'auto' }).eq('id', row.id).eq('firm_id', firmId).eq('file_status', 'sorting').select('id')
    if (error) throw failed('filing the document failed', error)
    if (data.length) await logSystemEvent(row, 'auto_sorted', detail)
  }
  const fromModel = (s: FileSuggestion) => ({ type_id: s.typeId, title: s.title, name: s.title, school_year: s.schoolYear ?? null, needs_check: !s.sure, ai_suggestion: s as unknown as Json })

  if (!(await sortsAutomatically(db, firmId))) return file({ type_id: other, needs_check: true }, { typeId: other, sortingOff: true })
  try {
    const suggestion = await classifyDocument(db, row, bytes, driveFolder)
    await file(fromModel(suggestion), { typeId: suggestion.typeId, sure: suggestion.sure, model: suggestion.model })
  } catch (error) {
    await file({ type_id: other, needs_check: true }, { typeId: other, failed: true })
    if (!worthRetrying(error)) return
    const suggestion = await classifyDocument(db, row, bytes, driveFolder)
    // Only if nobody has touched it since: still auto-sorted, still where the failure put it, same title.
    const retried = await db
      .from('documents')
      .update(fromModel(suggestion))
      .eq('id', row.id)
      .eq('firm_id', firmId)
      .eq('file_status', 'filed')
      .eq('sorted_by', 'auto')
      .eq('type_id', other)
      .eq('title', row.title ?? '')
      .is('ai_suggestion', null)
      .select('id')
    if (retried.error) throw failed('filing the retried document failed', retried.error)
    if (retried.data.length) await logSystemEvent(row, 'auto_sorted', { typeId: suggestion.typeId, sure: suggestion.sure, model: suggestion.model, retry: true })
  }
}

/**
 * Where a file synced from a linked Drive folder is filed, decided from the
 * bytes in memory BEFORE anything is stored. The same rules as sortStudentDrop:
 * the model's folder and title, marked to check when it was not sure; with
 * sorting off, or when the model fails (tried twice), the catch-all folder
 * marked to check.
 *
 * Deciding first matters for who can read it: a row that is not yet filed is
 * open to every member of the firm, so a synced file is only ever written
 * already filed. One that belongs in a folder only the owner can open is never
 * readable by anyone else, not even while it is being sorted.
 */
export async function decideFiling(db: Db, row: DocumentRow, bytes: Uint8Array, driveFolder?: string): Promise<{ patch: Database['public']['Tables']['documents']['Update']; detail: Record<string, unknown> }> {
  const other = catchAll(await foldersOf(db, row.firm_id)).id
  const fallback = (detail: Record<string, unknown>) => ({ patch: { type_id: other, needs_check: true }, detail: { typeId: other, ...detail } })
  if (!(await sortsAutomatically(db, row.firm_id))) return fallback({ sortingOff: true })
  for (let attempt = 0; ; attempt++) {
    try {
      const s = await classifyDocument(db, row, bytes, driveFolder)
      return { patch: { type_id: s.typeId, title: s.title, name: s.title, school_year: s.schoolYear ?? null, needs_check: !s.sure, ai_suggestion: s as unknown as Json }, detail: { typeId: s.typeId, sure: s.sure, model: s.model, ...(attempt ? { retry: true } : {}) } }
    } catch (error) {
      if (attempt > 0 || !worthRetrying(error)) return fallback({ failed: true })
    }
  }
}

// ── What a person does to a file ────────────────────────────────────────────

export interface Filed {
  /** The row as the caller can now read it, or null when it went where only the owner can. */
  document: DocumentRow | null
  /** True when the file was filed under a folder this person cannot open. */
  hidden: boolean
  folderName: string
}

/**
 * A person files a document: accepts the suggestion, picks something else, or
 * moves a filed one. Goes through the database function file_document, which
 * also writes the event and lets a counselor file into a folder only the owner
 * can open. Picking a folder other than the AI's is what the correction log reads.
 */
export async function fileDocument(caller: SignedIn, input: { documentId?: unknown; typeId?: unknown; title?: unknown; studentId?: unknown; schoolYear?: unknown }): Promise<Filed> {
  const row = await ownRow(caller, input.documentId)
  if (row.file_status === 'uploading') throw new FileError('That file is still uploading.', 409)
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title || title.length > 200) throw new FileError('Give the file a title of up to 200 characters.')
  const folder = (await foldersOf(caller.client, caller.firmId)).find((f) => f.id === input.typeId)
  if (!folder) throw new FileError('That folder was not found.', 404)
  if (folder.archived_at && folder.id !== row.type_id) throw new FileError(`“${folder.name}” is archived and takes no new files.`, 409)

  const suggestion = row.ai_suggestion as unknown as FileSuggestion | null
  const approved = row.file_status !== 'filed' && suggestion?.typeId === folder.id && suggestion.title === title
  const { error } = await caller.client.rpc('file_document', {
    document: row.id,
    type: folder.id,
    title,
    student: typeof input.studentId === 'string' && input.studentId ? input.studentId : undefined,
    school_year: typeof input.schoolYear === 'string' && input.schoolYear.trim() ? input.schoolYear.trim().slice(0, 20) : approved ? suggestion?.schoolYear : undefined,
    action: approved ? 'approved' : 'typed',
  })
  // The function's own messages are written for people ("Choose a student first.").
  // The student this file is being given to already holds a copy of the same Drive file.
  if (error?.code === '23505') throw new FileError('That student already has this file from Google Drive.', 409)
  // 42501 is also Postgres's own "permission denied", so its text is not passed on.
  if (error) throw error.code === '42501' ? new FileError('That document was not found.', 404) : error.code === '22023' ? new FileError(error.message, 400) : failed('filing failed', error)

  const after = await caller.client.from('documents').select('*').eq('id', row.id).maybeSingle()
  if (after.error) throw failed('reading the filed document failed', after.error)
  return { document: after.data, hidden: !after.data, folderName: folder.name }
}

export async function renameDocument(caller: SignedIn, input: { documentId?: unknown; title?: unknown }): Promise<DocumentRow> {
  const row = await ownRow(caller, input.documentId)
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title || title.length > 200) throw new FileError('Give the file a title of up to 200 characters.')
  if (title === row.title) return row
  const { data, error } = await caller.client.from('documents').update({ title, name: title }).eq('id', row.id).select('*').maybeSingle()
  if (error) throw failed('renaming failed', error)
  if (!data) throw new FileError('That file was not found.', 404)
  await logEvent(caller.client, row, { kind: 'counselor', user: caller.userId }, 'renamed')
  return data
}

/**
 * A signed URL to view or download one file, made as the caller (so storage
 * checks they may read it) and valid for 60 seconds. Records the event and the
 * first time the file was opened. The URL is returned and never logged.
 */
export async function openDocument(caller: SignedIn, input: { documentId?: unknown; mode?: unknown }): Promise<{ url: string; document: DocumentRow }> {
  const row = await ownRow(caller, input.documentId)
  if (row.file_status === 'uploading') throw new FileError('That file is still uploading.', 409)
  const download = input.mode === 'download'
  const signed = await bucket(caller.client).createSignedUrl(row.storage_path!, SIGNED_URL_SECONDS, download ? { download: row.original_filename ?? true } : undefined)
  if (signed.error || !signed.data?.signedUrl) throw new FileError('That file could not be opened.', 404)
  await logEvent(caller.client, row, { kind: 'counselor', user: caller.userId }, download ? 'downloaded' : 'viewed')
  let document = row
  if (!row.opened_at) {
    const opened = await caller.client.from('documents').update({ opened_at: new Date().toISOString() }).eq('id', row.id).is('opened_at', null).select('*').maybeSingle()
    if (opened.data) document = opened.data
  }
  return { url: signed.data.signedUrl, document }
}

// ── Deleting ────────────────────────────────────────────────────────────────

export type DeleteScope = { documentId: string } | { studentId: string } | { firm: true }

/** The same words the database uses when it refuses (apply_changes). */
export const ownerOnlyRefusal = (count: number, doing: string) =>
  `${count === 1 ? '1 owner-only file is' : `${count} owner-only files are`} in the way: only the firm’s owner can open ${count === 1 ? 'it' : 'them'}, so only the owner can ${doing}. Nothing was changed.`

/**
 * THE one path that removes stored files. apply_changes and a cascade from
 * `delete from students` remove rows only, which would leave objects behind
 * with nothing pointing at them. So before a document, a student or the whole
 * caseload is deleted, this removes each file's object by the exact path on its
 * row (never by a folder prefix), then the row, then logs it.
 *
 * One document is removed as the caller: what they cannot read, they cannot
 * delete, so an owner-only file can be deleted only by the owner.
 *
 * A student's or the firm's files: when any of them is owner-only, only the
 * firm's owner may do it. Anyone else is refused before anything is touched,
 * and told how many such files are in the way. (apply_changes makes the same
 * check on deleting a student and on clearing the caseload.) Otherwise the
 * files are removed with the service role, filtered by the caller's firm, so
 * that files still uploading or waiting with no student go too.
 */
export async function deleteStoredFiles(caller: SignedIn, scope: DeleteScope): Promise<{ removed: string[] }> {
  const one = 'documentId' in scope
  if (!one && caller.role !== 'owner') {
    const student = 'studentId' in scope ? scope.studentId : undefined
    const counted = await caller.client.rpc('owner_only_file_count', { firm: caller.firmId, ...(student ? { students: [student] } : {}) })
    if (counted.error) throw failed('counting owner-only files failed', counted.error)
    if (counted.data > 0) throw new FileError(ownerOnlyRefusal(counted.data, student ? 'delete this student' : 'clear the caseload'), 403)
  }
  const db = !one && serviceConfigured() ? serviceClient() : caller.client
  const folders = new Map((await foldersOf(db, caller.firmId)).map((f) => [f.id, f]))
  const removed: string[] = []

  for (;;) {
    let query = db.from('documents').select('id, firm_id, storage_path, type_id, title, original_filename, file_status, student_id, drive_file_id').eq('firm_id', caller.firmId).not('storage_path', 'is', null).order('seq').limit(200)
    if (one) query = query.eq('id', scope.documentId)
    else if ('studentId' in scope) query = query.eq('student_id', scope.studentId)
    const { data, error } = await query
    if (error) throw failed('reading the files to delete failed', error)
    if (data.length === 0) {
      if (one && removed.length === 0) throw new FileError('That file was not found. It may already be deleted.', 404)
      return { removed }
    }

    await removeObjects(db, data.map((d) => d.storage_path!))
    const gone = await db.from('documents').delete().eq('firm_id', caller.firmId).in('id', data.map((d) => d.id)).select('id')
    if (gone.error) throw failed('deleting the document rows failed', gone.error)
    if (gone.data.length === 0) throw new FileError('Those files could not be deleted.', 403)
    // A file that came from a linked Drive folder is not brought back by the next sync.
    if (one) await rememberRemovedHere(caller.firmId, data.filter((x) => gone.data.some((g) => g.id === x.id)))
    for (const d of data.filter((x) => gone.data.some((g) => g.id === x.id))) {
      removed.push(d.id)
      // Once the row is gone every member can read its events, so a file from a folder only the owner could open leaves no title behind.
      const open = d.file_status !== 'filed' || !d.type_id || folders.get(d.type_id)?.sensitivity === 'standard'
      await logEvent(db, d, { kind: 'counselor', user: caller.userId }, 'deleted', open ? { title: d.title, filename: d.original_filename } : {})
    }
    if (one) return { removed }
  }
}

/** Removes rows left 'uploading' for over an hour, with any object that did arrive. */
export async function removeAbandonedUploads(db: Db, firmId: string, studentId?: string, olderThanMs = ABANDONED_UPLOAD_MS): Promise<string[]> {
  let query = db.from('documents').select('id, storage_path').eq('firm_id', firmId).eq('file_status', 'uploading').not('storage_path', 'is', null).lt('updated_at', new Date(Date.now() - olderThanMs).toISOString()).limit(200)
  if (studentId) query = query.eq('student_id', studentId)
  const { data, error } = await query
  if (error) throw failed('reading abandoned uploads failed', error)
  if (data.length === 0) return []
  await removeObjects(db, data.map((d) => d.storage_path!))
  const gone = await db.from('documents').delete().eq('firm_id', firmId).eq('file_status', 'uploading').in('id', data.map((d) => d.id)).select('id')
  if (gone.error) throw failed('deleting abandoned uploads failed', gone.error)
  return gone.data.map((d) => d.id)
}

// ── Settling ────────────────────────────────────────────────────────────────

/**
 * Called when a counselor's browser loads documents. Finishes anything the
 * background work left behind: a row 'sorting' for more than a few minutes
 * means the function was cut off, so it is settled without the model (a
 * student's upload is filed under the catch-all folder to check; a counselor's
 * waits there for them), and abandoned uploads are removed. Then returns the
 * current rows for the ids the browser asked about, read as the caller.
 */
export async function settleFiles(caller: SignedIn, input: { ids?: unknown }): Promise<{ documents: DocumentRow[]; missing: string[] }> {
  const db = serviceConfigured() ? serviceClient() : caller.client
  await removeAbandonedUploads(db, caller.firmId)
  const stuck = await db.from('documents').select('id, firm_id, uploaded_by_kind').eq('firm_id', caller.firmId).eq('file_status', 'sorting').not('storage_path', 'is', null).lt('updated_at', new Date(Date.now() - STUCK_SORTING_MS).toISOString()).limit(200)
  if (stuck.error) throw failed('reading unfinished files failed', stuck.error)
  if (stuck.data.length) {
    const other = catchAll(await foldersOf(db, caller.firmId)).id
    for (const row of stuck.data) {
      const drop = row.uploaded_by_kind === 'student_link'
      const patch = drop ? { type_id: other, needs_check: true, file_status: 'filed', sorted_by: 'auto' } : { type_id: other, needs_check: true, file_status: 'suggested' }
      const { data, error } = await db.from('documents').update(patch).eq('id', row.id).eq('firm_id', caller.firmId).eq('file_status', 'sorting').select('id')
      if (error) throw failed('settling a file failed', error)
      if (data.length && drop) await logSystemEvent(row, 'auto_sorted', { typeId: other, cutOff: true })
    }
  }

  const ids = Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200) : []
  if (ids.length === 0) return { documents: [], missing: [] }
  const { data, error } = await caller.client.from('documents').select('*').eq('firm_id', caller.firmId).in('id', ids)
  if (error) throw failed('reading documents failed', error)
  return { documents: data, missing: ids.filter((id) => !data.some((d) => d.id === id)) }
}
