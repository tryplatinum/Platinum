// The only way a message leaves the firm. M1 will add Resend and Twilio behind
// this same shape. Nothing outside the dispatcher may call a transport.
//
// Transports today: log (the default), Gmail for email (TRANSPORT_EMAIL=gmail),
// and the counselor's own iPhone for text (TRANSPORT_TEXT=phone). The phone
// transport does not send: it makes a job the phone claims from /api/phone, and
// answers `waiting`. The one send outside the dispatcher is the fixed wake
// email to the counselor's own address (server/phoneGateway/wake.ts).

import type { QueueChannel, QueueLanguage } from '../../shared/outbox.js'

export type TransportSend = {
  channel: QueueChannel
  to: string
  body: string
  language: QueueLanguage
  subject?: string
  /** The user who approved the message (outbox.approved_by). Email through Gmail is sent from their mailbox; a text goes to their phone. */
  senderUserId?: string
  /** The outbox row being sent. The phone transport makes at most one job per row. */
  outboxId?: string
  /** The row's note. "Sent from your own phone" marks a text the counselor already sent by hand. */
  note?: string
}

export type TransportResult = {
  providerMessageId: string
  /** True when nothing has been sent yet: the message was handed to the counselor's phone and the row waits for it. */
  waiting?: boolean
}

export interface Transport {
  send(input: TransportSend): Promise<TransportResult>
}
