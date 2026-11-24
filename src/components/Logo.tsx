// The only place the logo is rendered. The files are crops of the master image
// with its porcelain background left in place, so the logo belongs on the
// canvas colour (or a porcelain tile) and nowhere else. Width and height are
// always set, so nothing shifts when the image loads.

import { LOGO_FULL, LOGO_SPARK, LOGO_SYMBOL, PRODUCT_NAME } from '../brand'

// ui.tsx uses the spark, so this file does not import from it.
const join = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ')

/**
 * `full` is the symbol and wordmark; `symbol` is the symbol alone. `width` is
 * in CSS pixels. Pass `decorative` when the name is already in text beside it.
 */
export function Logo({ variant = 'full', width, decorative, className }: { variant?: 'full' | 'symbol'; width?: number; decorative?: boolean; className?: string }) {
  const file = variant === 'full' ? LOGO_FULL : LOGO_SYMBOL
  const w = width ?? (variant === 'full' ? 160 : 40)
  return (
    <img
      src={file.src}
      srcSet={variant === 'full' ? `${LOGO_FULL.src} 240w, ${LOGO_FULL.src2x} 480w` : undefined}
      sizes={variant === 'full' ? `${w}px` : undefined}
      width={w}
      height={Math.round(w / file.ratio)}
      alt={decorative ? '' : PRODUCT_NAME}
      decoding="async"
      className={join('block shrink-0', className)}
    />
  )
}

/**
 * The four-point star from the logo, shown beside anything the AI wrote and
 * while it is working. Always decorative: the words next to it carry the meaning.
 */
export function Spark({ size = 14, motion, className }: { size?: number; motion?: 'turn' | 'pulse'; className?: string }) {
  return (
    <img
      src={LOGO_SPARK.src}
      width={size}
      height={size}
      alt=""
      aria-hidden
      className={join('inline-block shrink-0 rounded-full', motion === 'turn' && 'motion-spark-turn', motion === 'pulse' && 'motion-spark-pulse', className)}
    />
  )
}
