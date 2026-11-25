// Which queued message an approved assistant draft became, for this session.
// The approval card uses it to show "Sending in 60 seconds" and its own Undo,
// in the assistant panel and in the Inbox alike. Nothing here writes
// to the outbox: the id is the one the store gave the row, and `confirmed`
// comes from the same notice the Undo toast listens to.

import { create } from 'zustand'
import type { ID } from '../types'
import { onNotify } from './notify'

interface Sends {
  /** Proposal id to the id of the message it queued. */
  messageOf: Record<ID, ID>
  /** Messages the database has queued, so they can be cancelled. */
  confirmed: Record<ID, true>
  /** Proposals being approved or discarded right now. Both screens' buttons wait. */
  deciding: Record<ID, true>
}

export const useApprovalSends = create<Sends>()(() => ({ messageOf: {}, confirmed: {}, deciding: {} }))

onNotify((notice) => {
  if (notice.kind === 'queue') useApprovalSends.setState((s) => ({ confirmed: { ...s.confirmed, [notice.messageId]: true } }))
})

export function rememberSend(proposalId: ID, messageId: ID): void {
  useApprovalSends.setState((s) => ({ messageOf: { ...s.messageOf, [proposalId]: messageId } }))
}

/** Runs one decision on a proposal. A second press while it is on its way does nothing. */
export async function deciding(proposalId: ID, work: () => Promise<void>): Promise<void> {
  if (useApprovalSends.getState().deciding[proposalId]) return
  useApprovalSends.setState((s) => ({ deciding: { ...s.deciding, [proposalId]: true } }))
  try {
    await work()
  } finally {
    useApprovalSends.setState((s) => {
      const { [proposalId]: _done, ...rest } = s.deciding
      return { deciding: rest }
    })
  }
}
