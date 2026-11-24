// Chooses the transport from server env TRANSPORT (default: log).

import { LogTransport } from './log.js'
import type { Transport } from './types.js'

export type { Transport, TransportResult, TransportSend } from './types.js'

export function getTransport(): Transport {
  const name = (process.env.TRANSPORT || 'log').trim().toLowerCase()
  if (name === 'log' || name === '') return new LogTransport()
  // M1 will add resend / twilio here. Unknown values stay on the log path so a
  // mis-set env does not invent a live send.
  console.warn(`[transport] unknown TRANSPORT="${name}", using log`)
  return new LogTransport()
}
