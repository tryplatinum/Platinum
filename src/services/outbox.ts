// A message the counselor has approved, before the database assigns its queue fields.
// queue_message is the only insert. Nothing here talks to a provider.

import type { OutboxMessage } from '../types'

export type OutgoingMessage = Omit<OutboxMessage, 'id' | 'sentAt' | 'status' | 'sendAfter' | 'approvedBy' | 'approvedAt' | 'providerMessageId' | 'error'>
