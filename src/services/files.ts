// The browser side of stored files. Two jobs:
//
//   * talk to /api/documents (signed-in counselors) and to the two upload
//     actions of /api/student (a student link);
//   * send a file's bytes STRAIGHT to storage. A file never passes through a
//     server function: a counselor uploads with their own session to the exact
//     path of a row the server made, a student with a one-time token for one path.
//
// Only the store (store/files.ts) and the student's page use this file.

import { STUDENT_ENDPOINT, STUDENT_TOKEN_HEADER } from '../../shared/constants'
import { DOCUMENTS_BUCKET, DOCUMENTS_ENDPOINT, FILE_TYPES_LABEL, MAX_FILE_BYTES, MIME, RESUMABLE_ABOVE_BYTES, declaredMime } from '../../shared/files'
import type { StudentUploadTicket } from '../../shared/student'
import type { Database } from '../lib/database.types'
import { todayISO } from '../lib/dates'
import { accessToken } from '../store/session'

export type DocumentRow = Database['public']['Tables']['documents']['Row']

const STORAGE = `${(import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''}/storage/v1`
const ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''

/** A failure with a message fit to show beside the file. */
export class FileFailure extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}

// ── /api/documents ──────────────────────────────────────────────────────────

type Reply<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

async function post(token: string, body: string, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(DOCUMENTS_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new FileFailure('The server took too long to answer. Please try again.')
    throw new FileFailure('There is no connection to the server.')
  }
}

/** One action of api/documents.ts, as the signed-in person. */
export async function callDocuments<T>(action: string, body: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
  const token = await accessToken()
  if (!token) throw new FileFailure('Sign in again to work with files.', 401)
  const payload = JSON.stringify({ action, ...body })
  let res = await post(token, payload, timeoutMs)
  if (res.status === 401) {
    const fresh = await accessToken(true)
    if (fresh) res = await post(fresh, payload, timeoutMs)
  }
  if (!res.headers.get('content-type')?.includes('application/json')) throw new FileFailure('Files are not available on this deployment: it has no server functions.', 404)
  const reply = (await res.json()) as Reply<T>
  if (!reply.ok) throw new FileFailure(reply.message, res.status)
  return reply.data
}

// ── Checking a file before anything is sent ─────────────────────────────────

/** The type a file will be stored as, or throws with the reason it cannot be added. */
export function checkFile(file: File): string {
  const mime = declaredMime(file.name, file.type)
  if (!mime) throw new FileFailure(`“${file.name}” cannot be added. Use ${FILE_TYPES_LABEL}.`)
  if (file.size === 0) throw new FileFailure(`“${file.name}” is empty.`)
  if (file.size > MAX_FILE_BYTES) throw new FileFailure(`“${file.name}” is larger than 25 MB.`)
  return mime
}

/** Hex SHA-256 of a file, to notice the same file being added twice. */
export async function hashFile(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ── Sending bytes to storage ────────────────────────────────────────────────

type Progress = (fraction: number) => void

const storageMessage = (status: number, text: string): string => {
  let detail = ''
  try {
    detail = (JSON.parse(text) as { message?: string }).message ?? ''
  } catch {
    // Not JSON: no detail.
  }
  if (status === 413) return 'The file is larger than storage allows (25 MB).'
  if (status === 415 || /mime type/i.test(detail)) return `Storage does not take that kind of file. Use ${FILE_TYPES_LABEL}.`
  if (status === 401 || status === 403 || /row-level security/i.test(detail)) return 'Storage refused the upload. Sign in again and retry.'
  return `The upload failed${status ? ` (${status})` : ''}. Check your connection and retry.`
}

/** One request with upload progress. Resolves with the response; rejects only when the network fails. */
function send(method: string, url: string, headers: Record<string, string>, body: Blob | null, onProgress?: (sent: number) => void): Promise<{ status: number; text: string; header: (name: string) => string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    if (onProgress) xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText, header: (name) => xhr.getResponseHeader(name) })
    xhr.onerror = () => reject(new FileFailure('The connection dropped during the upload. Retry to send it again.'))
    xhr.ontimeout = () => reject(new FileFailure('The upload took too long. Retry to send it again.'))
    xhr.send(body)
  })
}

/** A small file: one request. Never an upsert, so an existing object is never overwritten. */
async function uploadWhole(path: string, file: Blob, mime: string, token: string, onProgress: Progress): Promise<void> {
  const res = await send('POST', `${STORAGE}/object/${DOCUMENTS_BUCKET}/${path}`, { authorization: `Bearer ${token}`, apikey: ANON_KEY, 'content-type': mime, 'x-upsert': 'false', 'cache-control': 'max-age=3600' }, file, (sent) => onProgress(sent / file.size))
  if (res.status >= 300) throw new FileFailure(storageMessage(res.status, res.text), res.status)
}

const b64 = (text: string) => btoa(unescape(encodeURIComponent(text)))

/**
 * A larger file: the resumable (TUS) protocol, in pieces of exactly 6 MB as
 * Supabase requires. A piece that fails is asked about (how much arrived?) and
 * sent again from there, up to three times, before the upload is given up.
 */
async function uploadResumable(path: string, file: Blob, mime: string, token: string, onProgress: Progress): Promise<void> {
  const auth = { authorization: `Bearer ${token}`, apikey: ANON_KEY, 'tus-resumable': '1.0.0' }
  const metadata = [`bucketName ${b64(DOCUMENTS_BUCKET)}`, `objectName ${b64(path)}`, `contentType ${b64(mime)}`, `cacheControl ${b64('3600')}`].join(',')
  const created = await send('POST', `${STORAGE}/upload/resumable`, { ...auth, 'x-upsert': 'false', 'upload-length': String(file.size), 'upload-metadata': metadata }, null)
  const location = created.header('location')
  if (created.status !== 201 || !location) throw new FileFailure(storageMessage(created.status, created.text), created.status)
  const url = new URL(location, `${STORAGE}/upload/resumable`).toString()

  let offset = 0
  let failures = 0
  while (offset < file.size) {
    const piece = file.slice(offset, offset + RESUMABLE_ABOVE_BYTES)
    try {
      const start = offset
      const res = await send('PATCH', url, { ...auth, 'upload-offset': String(offset), 'content-type': 'application/offset+octet-stream' }, piece, (sent) => onProgress((start + sent) / file.size))
      if (res.status !== 204) throw new FileFailure(storageMessage(res.status, res.text), res.status)
      offset = Number(res.header('upload-offset') ?? offset + piece.size)
      failures = 0
    } catch (error) {
      // Refused outright (too large, wrong type, not allowed): trying again will not help.
      if (error instanceof FileFailure && error.status >= 400 && error.status < 500 && error.status !== 409) throw error
      if (++failures > 3) throw error
      await new Promise((resolve) => setTimeout(resolve, 1000 * failures))
      const head = await send('HEAD', url, auth, null).catch(() => undefined)
      const arrived = Number(head?.header('upload-offset'))
      if (head && head.status < 300 && Number.isFinite(arrived)) offset = arrived
    }
  }
}

/** Sends a counselor's file to the exact path of its row. Resumable above 6 MB. */
export async function uploadToStorage(path: string, file: Blob, mime: string, onProgress: Progress): Promise<void> {
  const token = await accessToken()
  if (!token) throw new FileFailure('Sign in again to upload.', 401)
  if (file.size > RESUMABLE_ABOVE_BYTES) await uploadResumable(path, file, mime, token, onProgress)
  else await uploadWhole(path, file, mime, token, onProgress)
  onProgress(1)
}

// ── A student link ──────────────────────────────────────────────────────────

/** Phone photos are large. One over this is scaled down in the browser before it is sent. */
const PHOTO_SHRINK_ABOVE = 3_000_000
const PHOTO_LONG_EDGE = 2400

/** A smaller JPEG of a large photo, still easy to read. Anything else is returned as it is. */
export async function shrinkPhoto(file: File): Promise<File> {
  if ((file.type !== MIME.jpeg && file.type !== MIME.png) || file.size <= PHOTO_SHRINK_ABOVE) return file
  try {
    const image = await createImageBitmap(file)
    const scale = Math.min(1, PHOTO_LONG_EDGE / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * scale)
    canvas.height = Math.round(image.height * scale)
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, MIME.jpeg, 0.85))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.(png|jpe?g)$/i, '') + '.jpg', { type: MIME.jpeg })
  } catch {
    return file
  }
}

type StudentReply = { ok: true; upload?: StudentUploadTicket; added?: { name: string } } | { ok: false; message: string }

async function studentCall(token: string, body: Record<string, unknown>): Promise<Extract<StudentReply, { ok: true }>> {
  let res: Response
  try {
    res = await fetch(STUDENT_ENDPOINT, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', [STUDENT_TOKEN_HEADER]: token }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) })
  } catch {
    throw new FileFailure('There is no connection right now. Try again in a moment.')
  }
  if (!res.headers.get('content-type')?.includes('application/json')) throw new FileFailure('Files cannot be added right now.')
  const reply = (await res.json()) as StudentReply
  if (!reply.ok) throw new FileFailure(reply.message, res.status)
  return reply
}

/**
 * Adds one file from a student link: ask the server for a one-time upload
 * token, send the file straight to storage with it, then tell the server it is
 * there. Returns the file's name. The link gets nothing else back.
 */
export async function studentLinkUpload(linkToken: string, original: File, onProgress: Progress): Promise<string> {
  const file = await shrinkPhoto(original)
  const mime = checkFile(file)
  const { upload } = await studentCall(linkToken, { action: 'start_upload', filename: file.name, size: file.size, type: mime, today: todayISO() })
  if (!upload) throw new FileFailure('The upload could not be started. Try again.')
  const res = await send(
    'PUT',
    `${STORAGE}/object/upload/sign/${DOCUMENTS_BUCKET}/${upload.path}?token=${encodeURIComponent(upload.token)}`,
    { authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY, 'content-type': mime, 'x-upsert': 'false', 'cache-control': 'max-age=3600' },
    file,
    (sent) => onProgress(sent / file.size),
  )
  if (res.status >= 300) throw new FileFailure(storageMessage(res.status, res.text), res.status)
  onProgress(1)
  const { added } = await studentCall(linkToken, { action: 'finish_upload', documentId: upload.documentId })
  return added?.name ?? file.name
}
