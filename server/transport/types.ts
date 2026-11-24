// The only way a message leaves the firm. M1 will add Resend and Twilio behind
// this same shape. Nothing outside the dispatcher may call a transport.

import type { QueueChannel, QueueLanguage } from '../../shared/outbox.js'

export type TransportSend = {
  channel: QueueChannel
  to: string
  body: string
  language: QueueLanguage
  subject?: string
  /** The user who approved the message (outbox.approved_by). Email through Gmail is sent from their mailbox. */
  senderUserId?: string
}

export type TransportResult = {
  providerMessageId: string
}

export interface Transport {
  send(input: TransportSend): Promise<TransportResult>
}
