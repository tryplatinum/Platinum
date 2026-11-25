// Can Platinum deliver a message on this channel itself? The answer comes from
// the rule the dispatcher uses (resolveAddress in shared/dispatch.ts), so the
// screen never offers to send what the server would refuse. A channel that is
// not connected is sent by hand: the counselor copies the text and sends it
// from their own app, and the approval is still recorded.

import { resolveAddress } from '../../shared/dispatch'
import { outboxStatusLabel, QUEUE_CHANNELS, type QueueStatus } from '../../shared/outbox'
import type { Channel } from '../types'
import { CHANNEL_LABEL } from './language'

/** Someone with every kind of address, so only the channel decides. */
const ANYONE = { phone: '+15550100', email: 'someone@example.com' }

/** True when the dispatcher has a way to send on this channel. No channel means nothing is addressed yet. */
export const canDeliver = (channel: Channel | undefined): boolean => !channel || resolveAddress(channel, ANYONE).ok

/** The channels a counselor has to send on themselves. */
export const BY_HAND_CHANNELS: readonly Channel[] = QUEUE_CHANNELS.filter((c) => !canDeliver(c))

/** A send that Platinum cannot make: its card offers Copy, never "Approve and send". */
export const sentByHand = (item: { isSend: boolean; channel?: Channel }): boolean => item.isSend && !canDeliver(item.channel)

/** "WeChat is not connected. Copy it and send it yourself." */
export const notConnectedLine = (channel: Channel): string => `${CHANNEL_LABEL[channel]} is not connected. Copy it and send it yourself.`

/**
 * The status line of a logged message. On a channel Platinum cannot send on,
 * it never says queued, sending or failed: the row is the record of an
 * approval, and the message goes out by hand or not at all.
 */
export function messageStatusLabel(message: { channel: Channel; status: QueueStatus; sendAfter: string; error?: string; detail?: string }, now = Date.now()): string {
  if (canDeliver(message.channel) || message.status === 'cancelled') return outboxStatusLabel(message, now)
  const left = message.status === 'queued' ? Math.ceil((Date.parse(message.sendAfter) - now) / 1000) : 0
  if (left > 0) return `Approved to send by hand. Undo for ${left}s`
  return `By hand: ${CHANNEL_LABEL[message.channel]} is not connected`
}
