// A phone-sized photo of an invented document, made in code for the tests:
// 4032 x 3024 pixels (a 12-megapixel camera), a printed page lying slightly
// crooked on a desk, with sensor-like noise so the JPEG is several megabytes,
// as a real one is. It is generated, not taken with a phone.

import sharp from 'sharp'

export const PHOTO_LINES = [
  'LAKEVIEW HIGH SCHOOL',
  'Official Transcript',
  '',
  'Student: Maya Chen          Grade 11',
  'School year 2025-26',
  '',
  'AP Chemistry .................... A',
  'AP United States History ........ A-',
  'Precalculus Honors .............. A',
  'English 11 Honors ............... A',
  'Spanish 4 ....................... B+',
  '',
  'Cumulative GPA (unweighted): 3.92',
  'Registrar: R. Alvarez',
]

export async function phonePhoto(lines: string[] = PHOTO_LINES): Promise<Buffer> {
  const [width, height] = [4032, 3024]
  const text = lines
    .map((line, i) => `<text x="330" y="${420 + i * 150}" font-family="Courier New, monospace" font-size="${i < 2 ? 110 : 84}" font-weight="${i < 2 ? 700 : 400}" fill="#1b1b1b" xml:space="preserve">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`)
    .join('')
  const page = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="2500"><rect width="3000" height="2500" fill="#f6f3ea"/>${text}</svg>`))
    .rotate(3, { background: '#5b4a3a' })
    .png()
    .toBuffer()
  const noise = await sharp({ create: { width, height, channels: 3, background: '#5b4a3a', noise: { type: 'gaussian', mean: 128, sigma: 40 } } })
    .png()
    .toBuffer()
  return sharp({ create: { width, height, channels: 3, background: '#5b4a3a' } })
    .composite([
      { input: page, gravity: 'centre' },
      { input: noise, blend: 'soft-light' },
    ])
    .jpeg({ quality: 96 })
    .toBuffer()
}
