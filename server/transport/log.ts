// Dev / allowlist smoke transport: prints the send and returns a fake id.
// Never talks to a provider.

import { randomUUID } from 'node:crypto'
import type { Transport, TransportResult, TransportSend } from './types.js'

export class LogTransport implements Transport {
  async send(input: TransportSend): Promise<TransportResult> {
    const providerMessageId = `log_${randomUUID()}`
    console.log('[transport:log]', {
      providerMessageId,
      channel: input.channel,
      to: input.to,
      language: input.language,
      subject: input.subject,
      body: input.body,
    })
    return { providerMessageId }
  }
}
