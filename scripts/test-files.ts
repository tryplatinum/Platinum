// Checks, with no keys and no network, what of a photo the sorting model is
// shown. Run with:
//
//   npm run test:files
//
// A photo too large to send as it is gets a reduced copy made in memory; the
// bytes that were uploaded are never changed. When no copy can be made the
// model gets the file name only, and the file is then always marked to check.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { contentFor } from '../server/documentSorting.js'
import { REDUCED_LONG_EDGE, reducedPhoto } from '../server/fileText.js'
import { MIME } from '../shared/files.js'
import { phonePhoto } from './phonePhoto.js'

let failed = 0
function check(name: string, pass: boolean, detail = ''): void {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`

// ── A phone-sized photo of a document ──
const photo = new Uint8Array(await phonePhoto())
const before = sha(photo)
const size = await sharp(photo).metadata()
check('the test photo is phone-sized and too large to send as it is', size.width === 4032 && size.height === 3024 && photo.length > 3_500_000, `${size.width} x ${size.height}, ${mb(photo.length)}`)

const shown = await contentFor(photo, MIME.jpeg)
const copy = shown.file?.kind === 'image' ? Buffer.from(shown.file.base64, 'base64') : undefined
const copySize = copy && (await sharp(copy).metadata())
check('the model is shown an image, not just the file name', shown.file?.kind === 'image' && !shown.nameOnly)
check('…a JPEG no longer than 1568 pixels on its longest edge', shown.file?.kind === 'image' && shown.file.mediaType === MIME.jpeg && Math.max(copySize?.width ?? 0, copySize?.height ?? 0) === REDUCED_LONG_EDGE, `${copySize?.width} x ${copySize?.height}`)
check('…small enough to send', Boolean(copy && copy.length < 1_000_000), copy ? mb(copy.length) : '')
check('…with the same proportions', Boolean(copySize && Math.abs(copySize.width! / copySize.height! - 4032 / 3024) < 0.01))
check('the uploaded bytes are untouched', sha(photo) === before)

// ── Photos that are sent as they are ──
const small = new Uint8Array(await sharp({ create: { width: 800, height: 600, channels: 3, background: '#f6f3ea' } }).png().toBuffer())
const smallShown = await contentFor(small, MIME.png)
check('a small image is sent as it is', smallShown.file?.kind === 'image' && smallShown.file.mediaType === MIME.png && smallShown.file.base64 === Buffer.from(small).toString('base64'))

// ── A photo taken sideways ──
const sideways = new Uint8Array(await sharp(Buffer.from(photo)).withMetadata({ orientation: 6 }).jpeg({ quality: 96 }).toBuffer())
const turned = await reducedPhoto(sideways, MIME.jpeg)
const turnedSize = turned && (await sharp(turned).metadata())
check('a photo marked as taken sideways is turned upright in the copy', Boolean(turnedSize && turnedSize.height! > turnedSize.width!), `${turnedSize?.width} x ${turnedSize?.height}`)

// ── The fallback ──
const broken = new Uint8Array(4_000_000).fill(7)
broken.set([0xff, 0xd8, 0xff, 0xe0])
const fallback = await contentFor(broken, MIME.jpeg)
check('a large image that cannot be read falls back to the file name', fallback.file === undefined && fallback.nameOnly === true)
const brokenHeic = await contentFor(new Uint8Array(50_000).fill(3), MIME.heic)
check('a HEIC file that cannot be read falls back to the file name', brokenHeic.file === undefined && brokenHeic.nameOnly === true)
check('a PDF or a Word file is never treated as a photo', !(await contentFor(new Uint8Array([1, 2, 3]), MIME.pdf)).nameOnly && !(await contentFor(new Uint8Array([1, 2, 3]), MIME.docx)).nameOnly)
const source = readFileSync(new URL('../server/documentSorting.ts', import.meta.url), 'utf8')
check('a file sorted from its name alone is always marked to check', /sure: output\.sure && !content\.nameOnly/.test(source))

// ── HEIC, when a sample is given ──
// No HEIC file is kept in the repo. Pass the path of one to check that it is decoded:
//   npm run test:files -- path/to/photo.heic
const heicPath = process.argv[2]
if (heicPath) {
  const heic = new Uint8Array(readFileSync(heicPath))
  const heicShown = await contentFor(heic, MIME.heic)
  const heicCopy = heicShown.file?.kind === 'image' ? await sharp(Buffer.from(heicShown.file.base64, 'base64')).metadata() : undefined
  check('a HEIC photo is decoded and shown to the model as a JPEG', heicShown.file?.kind === 'image' && heicShown.file.mediaType === MIME.jpeg && Boolean(heicCopy?.width), heicCopy ? `${heicCopy.width} x ${heicCopy.height}` : 'not decoded')
} else {
  console.log('SKIP  a HEIC photo is decoded and shown to the model as a JPEG  (no sample given: npm run test:files -- path/to/photo.heic)')
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
