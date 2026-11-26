// Pure status rules for “who needs attention”, shared by the counselor UI
// (via derive.summarize) and the assistant’s list_students_needing_attention tool.

export type AttentionStatus = 'behind' | 'slipping' | 'on_track' | 'new'

export const NEW_STUDENT_DAYS = 21
export const MEETING_GAP_DAYS = 30
/** This many late tasks, or one task this many days late, is Behind. */
export const BEHIND_LATE_TASKS = 3
export const BEHIND_DAYS_LATE = 7

/**
 * Each tag's rule in plain words, for the tooltip on the tag. Built from the
 * numbers classifyAttention uses, so the words cannot drift from the code.
 */
export const ATTENTION_RULE: Record<AttentionStatus, string> = {
  behind: `Behind: ${BEHIND_LATE_TASKS} or more late tasks, or a task ${BEHIND_DAYS_LATE} or more days late.`,
  slipping: `Slipping: one or two late tasks, none yet ${BEHIND_DAYS_LATE} days late, or no meeting in more than ${MEETING_GAP_DAYS} days.`,
  on_track: `On track: no late tasks, and a meeting in the last ${MEETING_GAP_DAYS} days or a start in the last ${NEW_STUDENT_DAYS}.`,
  new: `Just onboarded: started in the last ${NEW_STUDENT_DAYS} days, with no late tasks.`,
}

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
  if (input.lateCount >= BEHIND_LATE_TASKS || input.maxDaysLate >= BEHIND_DAYS_LATE) return 'behind'
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
