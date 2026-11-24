// Getting a small, cheap piece of a file ready for the model that sorts it:
// the first two pages of a PDF, the first few thousand characters of a Word or
// Excel file, or a reduced copy of a large photo. Nothing here logs file
// contents, and nothing here changes what is stored: every result is a copy
// made in memory for one request to the model.

import { inflateRawSync } from 'node:zlib'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { MIME } from '../shared/files.js'

/** How many pages of a PDF the model is shown. */
export const PDF_PAGES = 2
/** How much extracted text the model is shown. */
export const TEXT_CHARS = 4_000

/** The first two pages as their own PDF, or undefined when the file cannot be read (encrypted, damaged). */
export async function firstPages(pdf: Uint8Array): Promise<Uint8Array | undefined> {
  try {
    const source = await PDFDocument.load(pdf, { updateMetadata: false })
    const count = source.getPageCount()
    if (count <= PDF_PAGES) return pdf
    const out = await PDFDocument.create()
    const pages = await out.copyPages(source, Array.from({ length: PDF_PAGES }, (_, i) => i))
    pages.forEach((page) => out.addPage(page))
    return await out.save()
  } catch {
    return undefined
  }
}

/** The longest edge of the copy of a photo the model is shown. Enough to read a printed page. */
export const REDUCED_LONG_EDGE = 1568
/** Refuse to decode anything larger than this many pixels (a 100-megapixel image). */
const MAX_PIXELS = 100_000_000

/**
 * A smaller JPEG copy of a photo, for the model only: turned the right way up,
 * at most 1568 pixels on its longest edge. HEIC (an iPhone's own format) is
 * decoded first. Returns undefined when the image cannot be read, and the
 * caller then falls back to the file name. The stored original is never touched.
 */
export async function reducedPhoto(bytes: Uint8Array, mime: string): Promise<Uint8Array | undefined> {
  try {
    let source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (mime === MIME.heic) {
      // Loaded only when a HEIC file arrives: it carries its own decoder.
      const { default: convert } = await import('heic-convert')
      source = Buffer.from(await convert({ buffer: source, format: 'JPEG', quality: 0.9 }))
    }
    const out = await sharp(source, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({ width: REDUCED_LONG_EDGE, height: REDUCED_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
  } catch {
    return undefined
  }
}

/** One entry of a zip archive, inflated. Reads the central directory, so sizes are always known. */
function zipEntry(zip: Buffer, name: string, limit = 5_000_000): Buffer | undefined {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) return undefined
  const entries = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  for (let i = 0; i < entries && at + 46 <= zip.length; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) return undefined
    const method = zip.readUInt16LE(at + 10)
    const compressed = zip.readUInt32LE(at + 20)
    const size = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const extraLength = zip.readUInt16LE(at + 30)
    const commentLength = zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    if (zip.toString('utf8', at + 46, at + 46 + nameLength) === name) {
      if (size > limit * 20) return undefined
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      const data = zip.subarray(start, start + compressed)
      if (method === 0) return data
      if (method === 8) return inflateRawSync(data, { maxOutputLength: limit * 20 })
      return undefined
    }
    at += 46 + nameLength + extraLength + commentLength
  }
  return undefined
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }

/** The opening text of a Word or Excel file, or undefined when it cannot be read cheaply. */
export function officeText(bytes: Uint8Array, mime: string): string | undefined {
  try {
    const xml = zipEntry(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), mime === MIME.docx ? 'word/document.xml' : 'xl/sharedStrings.xml')
    if (!xml) return undefined
    const text = xml
      .toString('utf8', 0, 400_000)
      .replace(/<\/w:p>|<\/si>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&(amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity])
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim()
    return text ? text.slice(0, TEXT_CHARS) : undefined
  } catch {
    return undefined
  }
}
