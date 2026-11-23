// Steps that join the AI module to the store, shared by more than one screen.
// Each one stores drafts with review: 'pending'. Nothing is approved here.

import { useStore } from '../store/store'
import type { ID } from '../types'
import { draftFromMeeting, draftTasksOnly, preMeetingBrief } from './ai'

export type DraftMode = 'full' | 'tasks'

/** Reads a completed meeting's notes and stores the drafts for review. Throws AiFailure for the screen to show. */
export async function draftMeeting(meetingId: ID, mode: DraftMode = 'full'): Promise<void> {
  const { data } = useStore.getState()
  const meeting = data.meetings.find((m) => m.id === meetingId)
  const student = data.students.find((s) => s.id === meeting?.studentId)
  if (!meeting || !student) return
  const drafts = mode === 'tasks' ? await draftTasksOnly(data, meeting, student) : await draftFromMeeting(data, meeting, student)
  useStore.getState().setMeetingDrafts(meetingId, drafts)
}

/** Prepares the AI part of a pre-meeting brief and keeps it on the meeting. */
export async function prepareBrief(meetingId: ID): Promise<void> {
  const { data } = useStore.getState()
  const meeting = data.meetings.find((m) => m.id === meetingId)
  const student = data.students.find((s) => s.id === meeting?.studentId)
  if (!meeting || !student) return
  useStore.getState().setMeetingBrief(meetingId, await preMeetingBrief(data, meeting, student))
}
