// A QR code as one SVG path, made in the browser. Always dark on white with a
// quiet border, so a phone camera reads it in either theme. The value never
// leaves the page: nothing is sent anywhere to draw it.

import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

export function QrCode({ value, label }: { value: string; label: string }) {
  const { d, size } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const count = qr.getModuleCount()
    let path = ''
    for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (qr.isDark(row, col)) path += `M${col + 4} ${row + 4}h1v1h-1z`
    return { d: path, size: count + 8 }
  }, [value])
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-44 w-44 rounded-lg" role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#0b1220" />
    </svg>
  )
}
