// Chooses the transport, per channel.
//
//   * email: Gmail when the server value TRANSPORT_EMAIL is exactly "gmail".
//     Unset or anything else falls through to the rule below, so a mis-set
//     value can never invent a live send.
//   * text: the approving counselor's own iPhone when the server value
//     TRANSPORT_TEXT is exactly "phone". Unset or anything else falls through
//     to the rule below, and text behaves exactly as it did before.
//   * every channel (and email and text otherwise): server env TRANSPORT
//     (default: log).

import type { QueueChannel } from '../../shared/outbox.js'
import { textViaPhone } from '../phoneGateway/config.js'
import { GmailTransport } from './gmail.js'
import { LogTransport } from './log.js'
import { PhoneGatewayTransport } from './phoneGateway.js'
import type { Transport } from './types.js'

export type { Transport, TransportResult, TransportSend } from './types.js'

export function getTransport(channel?: QueueChannel): Transport {
  if (channel === 'email' && (process.env.TRANSPORT_EMAIL || '').trim().toLowerCase() === 'gmail') return new GmailTransport()
  if (channel === 'text' && textViaPhone()) return new PhoneGatewayTransport()
  const name = (process.env.TRANSPORT || 'log').trim().toLowerCase()
  if (name === 'log' || name === '') return new LogTransport()
  // M1 will add resend / twilio here. Unknown values stay on the log path so a
  // mis-set env does not invent a live send.
  console.warn(`[transport] unknown TRANSPORT="${name}", using log`)
  return new LogTransport()
}
