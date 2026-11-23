// Simulated sending. NOTHING IS EVER SENT.
//
// This is the only place a message "goes out". It turns a message into a log
// entry; the store appends that entry to data.outbox, and the Notifications
// screen shows the log. To send for real later, replace the inside of
// simulateSend with calls to an email / SMS / WeChat / LINE provider and keep
// returning the same log entry.

import { nowTimestamp } from '../lib/dates'
import type { OutboxMessage } from '../types'

export type OutgoingMessage = Omit<OutboxMessage, 'id' | 'sentAt'>

let sequence = 0

export function simulateSend(message: OutgoingMessage): OutboxMessage {
  sequence += 1
  return {
    ...message,
    id: `o-${Date.now().toString(36)}-${sequence}`,
    sentAt: nowTimestamp(),
  }
}
