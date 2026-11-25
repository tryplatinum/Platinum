// Dev / allowlist smoke transport: prints that a send happened and returns a
// fake id. Never talks to a provider. Never prints the body or the subject: by
// now the body holds a working student link.

import { randomUUID } from 'node:crypto'
import { maskRecipient } from '../../shared/dispatch.js'
import type { Transport, TransportResult, TransportSend } from './types.js'

export class LogTransport implements Transport {
  async send(input: TransportSend): Promise<TransportResult> {
    const providerMessageId = `log_${randomUUID()}`
    console.log('[transport:log]', {
      providerMessageId,
      outboxId: input.outboxId ?? null,
      channel: input.channel,
      to: maskRecipient(input.to),
      bodyLength: input.body.length,
    })
    return { providerMessageId }
  }
}
