// Builds the logo files the app serves from the one master image in
// design/brand/. Run with `npm run build:brand` after the master changes.
//
// The artwork is only cropped and resized, never redrawn, traced or recoloured,
// and the porcelain background stays as supplied. The crop boxes below were
// measured from the 2048 × 682 master: the visible mark spans x 367–1678,
// y 245–491, and the symbol ends at x 762. Each crop keeps 25% of the symbol's
// height (62 px) as clear space, as the brand guide asks.

import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const MASTER = 'design/brand/platinum-master-logo.png'
const OUT = 'public/brand'
const MASTER_SIZE = { width: 2048, height: 682 }
const MAX_LOGO_BYTES = 40 * 1024

/** Symbol and wordmark with clear space. 1436 × 371, about 3.87:1. */
const FULL = { left: 305, top: 183, width: 1436, height: 371 }
/** The two-layer symbol alone, centred in a square. The wordmark starts 40 px to its right, so the margin is 36 px; the layout adds the rest of the clear space. */
const SYMBOL = { left: 331, top: 134, width: 468, height: 468 }
/** The four-point star inside the symbol's upper layer, on the navy around it. */
const SPARK = { left: 620, top: 267, width: 100, height: 100 }

async function write(name: string, crop: typeof FULL, width: number, limit?: number): Promise<void> {
  const file = path.join(OUT, name)
  const image = sharp(MASTER).extract(crop).resize({ width, kernel: 'lanczos3' })
  await (name.endsWith('.webp') ? image.webp({ quality: 92, smartSubsample: true }) : image.png({ compressionLevel: 9 })).toFile(file)
  const { size } = await stat(file)
  const height = Math.round((width * crop.height) / crop.width)
  console.log(`${file}  ${width} × ${height}  ${(size / 1024).toFixed(1)} KB`)
  if (limit && size > limit) throw new Error(`${file} is over ${limit / 1024} KB`)
}

const meta = await sharp(MASTER).metadata()
if (meta.width !== MASTER_SIZE.width || meta.height !== MASTER_SIZE.height) {
  throw new Error(`The master is ${meta.width} × ${meta.height}, not ${MASTER_SIZE.width} × ${MASTER_SIZE.height}. Measure the crop boxes again before building.`)
}

await mkdir(OUT, { recursive: true })
await write('logo-480.webp', FULL, 480, MAX_LOGO_BYTES)
await write('logo-240.webp', FULL, 240, MAX_LOGO_BYTES)
await write('symbol-192.webp', SYMBOL, 192)
await write('spark-64.webp', SPARK, 64)
await write('favicon.png', SYMBOL, 64)
