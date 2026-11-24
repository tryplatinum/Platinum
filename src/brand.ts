// The product's name and logo files. This is the only place either is written:
// a rename is this file plus the images in public/brand/ (made from the master
// in design/brand/ by `npm run build:brand`). The logo is drawn only by
// components/Logo.tsx.

export const PRODUCT_NAME = 'Platinum'

/** Symbol and wordmark, cropped from the master with its porcelain background. 1436 × 371 in the master. */
export const LOGO_FULL = {
  src: '/brand/logo-240.webp',
  src2x: '/brand/logo-480.webp',
  /** width ÷ height */
  ratio: 1436 / 371,
} as const

/** The symbol alone, in a square. */
export const LOGO_SYMBOL = { src: '/brand/symbol-192.webp', ratio: 1 } as const

/** The logo's four-point star, cropped with the navy around it. Marks AI work. */
export const LOGO_SPARK = { src: '/brand/spark-64.webp', ratio: 1 } as const

export const FAVICON = '/brand/favicon.png'
