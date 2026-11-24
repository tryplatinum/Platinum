// Pure status rules for “who needs attention”, shared by the counselor UI
// (via derive.summarize) and the assistant’s list_students_needing_attention tool.

export type AttentionStatus = 'behind' | 'slipping' | 'on_track' | 'new'

export const NEW_STUDENT_DAYS = 21
export const MEETING_GAP_DAYS = 30

export interface AttentionInput {
  lateCount: number
  /** Days late of the oldest overdue task, or 0. */
  maxDaysLate: number
  /** Days since the most recent past meeting; undefined if none. */
  daysSinceMeeting?: number
  /** Days since onboarded. */
  daysSinceOnboarded: number
}

/** Same thresholds as summarize() in src/lib/derive.ts. */
export function classifyAttention(input: AttentionInput): AttentionStatus {
  const isNew = input.daysSinceOnboarded <= NEW_STUDENT_DAYS
  if (input.lateCount >= 3 || input.maxDaysLate >= 7) return 'behind'
  if (input.lateCount >= 1 || (input.daysSinceMeeting !== undefined && input.daysSinceMeeting > MEETING_GAP_DAYS && !isNew)) {
    return 'slipping'
  }
  if (isNew) return 'new'
  return 'on_track'
}

/** Students the roster tool should surface: behind or slipping. */
export function needsAttention(status: AttentionStatus): boolean {
  return status === 'behind' || status === 'slipping'
}
