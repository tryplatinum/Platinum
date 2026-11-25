// What the browser and the server agree on about stored files: the bucket, the
// limits, the file types, the path convention and how a file's real type is
// read from its first bytes. No imports, so the browser can use it freely.

export const DOCUMENTS_ENDPOINT = '/api/documents'
export const DOCUMENTS_BUCKET = 'documents'

/** 25 MB, the bucket's own limit. */
export const MAX_FILE_BYTES = 26_214_400
/** Above this a counselor's upload is sent in resumable pieces of exactly this size. */
export const RESUMABLE_ABOVE_BYTES = 6 * 1024 * 1024
/** A signed URL to open or download a file lives this long. */
export const SIGNED_URL_SECONDS = 60
/**
 * How long a student has, from asking for an upload URL, to finish the upload.
 * A download is opened at once, so 60 seconds is enough. An upload can be the
 * full 25 MB, and on a slow phone that transfer takes a few minutes; the window
 * has to cover the whole transfer, not only its start. Five minutes does.
 *
 * Supabase Storage takes no expiry for a signed upload URL: the URL itself
 * lasts the project's fixed upload-URL lifetime. The server enforces this
 * window instead: an upload finished later is removed, never filed.
 */
export const STUDENT_UPLOAD_SECONDS = 300

/** True when an upload started at `createdAt` is past STUDENT_UPLOAD_SECONDS. An unreadable time counts as past. */
export const uploadWindowClosed = (createdAt: string, now = Date.now()) => !(now - Date.parse(createdAt) <= STUDENT_UPLOAD_SECONDS * 1000)

/** Limits on a student link. */
export const STUDENT_FILES_PER_DAY = 10
export const STUDENT_TOTAL_BYTES = 200 * 1024 * 1024
/** A row still "uploading" after this long is abandoned and removed with its object. */
export const ABANDONED_UPLOAD_MS = 60 * 60_000
/** A row still "sorting" after this long was cut off; it is settled without the model. */
export const STUCK_SORTING_MS = 3 * 60_000

export const MIME = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const

export type FileMime = (typeof MIME)[keyof typeof MIME]

/** The only types the bucket takes. */
export const ALLOWED_MIME_TYPES: readonly string[] = Object.values(MIME)

const BY_EXTENSION: Record<string, FileMime> = { pdf: MIME.pdf, jpg: MIME.jpeg, jpeg: MIME.jpeg, png: MIME.png, heic: MIME.heic, heif: MIME.heic, docx: MIME.docx, xlsx: MIME.xlsx }

export const FILE_TYPES_LABEL = 'PDF, JPEG, PNG, HEIC, Word (.docx) or Excel (.xlsx)'
/** For <input type="file" accept>. */
export const FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,.heif,.docx,.xlsx,application/pdf,image/jpeg,image/png,image/heic'

/** The allowed type a file claims to be, from what the browser says or else its extension. */
export function declaredMime(filename: string, browserType?: string): FileMime | undefined {
  const type = browserType === 'image/heif' ? MIME.heic : browserType
  if (type && ALLOWED_MIME_TYPES.includes(type)) return type as FileMime
  return BY_EXTENSION[filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? '']
}

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))

function contains(bytes: Uint8Array, text: string): boolean {
  const first = text.charCodeAt(0)
  outer: for (let i = bytes.indexOf(first); i !== -1 && i + text.length <= bytes.length; i = bytes.indexOf(first, i + 1)) {
    for (let j = 1; j < text.length; j++) if (bytes[i + j] !== text.charCodeAt(j)) continue outer
    return true
  }
  return false
}

/** What a file really is, from its own bytes. Undefined for anything that is not one of the allowed types. */
export function sniffMime(bytes: Uint8Array): FileMime | undefined {
  if (bytes.length < 12) return undefined
  if (ascii(bytes, 0, 5) === '%PDF-') return MIME.pdf
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return MIME.jpeg
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return MIME.png
  if (ascii(bytes, 4, 4) === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(ascii(bytes, 8, 4))) return MIME.heic
  // Word and Excel files are zip archives; the entry names inside are stored as plain text.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04 && contains(bytes, '[Content_Types].xml')) {
    if (contains(bytes, 'word/document.xml')) return MIME.docx
    if (contains(bytes, 'xl/workbook.xml')) return MIME.xlsx
  }
  return undefined
}

/** A file name that is safe as the last segment of an object path. The original name is kept on the row. */
export function safeFileName(filename: string): string {
  const dot = filename.lastIndexOf('.')
  const extension = dot > 0 ? filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : ''
  const stem = (dot > 0 ? filename.slice(0, dot) : filename)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${stem || 'file'}${extension ? `.${extension}` : ''}`
}

/** {firm_id}/{student_id or _}/{document_id}/{safe name}. Set once on the row and never changed. */
export const storagePathFor = (firmId: string, studentId: string | undefined | null, documentId: string, filename: string) =>
  `${firmId}/${studentId || '_'}/${documentId}/${safeFileName(filename)}`

/** A file name without its extension, as a first title. */
export const titleFromFilename = (filename: string) => (filename.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/[_]+/g, ' ').trim() || filename).slice(0, 200)

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * A small, valid, text-only PDF made in code: a heading and a few lines. Used
 * for the sample caseload's invented files and by the test scripts, so no
 * binary file is kept in the repository.
 */
export function tinyPdf(heading: string, lines: string[]): Uint8Array {
  const escape = (text: string) => text.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1')
  const content = [`BT /F1 16 Tf 56 760 Td (${escape(heading)}) Tj ET`, ...lines.map((line, i) => `BT /F1 11 Tf 56 ${728 - i * 18} Td (${escape(line)}) Tj ET`)].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Uint8Array.from(body, (c) => c.charCodeAt(0))
}
