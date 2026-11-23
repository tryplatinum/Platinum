// Steps that join the AI module to the store, shared by more than one screen.
// Each one stores drafts with review: 'pending'. Nothing is approved here.

import { weeklyTextItems, weeklyTextWeek } from '../lib/derive'
import { weeklyTextFacts } from '../lib/reminders'
import { useStore } from '../store/store'
import type { ID } from '../types'
import { draftFromMeeting, draftTasksOnly, preMeetingBrief, weeklyText } from './ai'

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

/**
 * The address students can reach this app at, or undefined when the app is
 * running somewhere only this computer can open (localhost, a private network).
 * A link that only works on the counselor's device must never go into a text.
 * Set VITE_PUBLIC_URL to override, for example while testing a deployment's wording locally.
 */
export function publicOrigin(): string | undefined {
  const configured = (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.trim().replace(/\/+$/, '')
  if (configured) return configured
  const { hostname, origin } = window.location
  const local = hostname === 'localhost' || hostname === '[::1]' || hostname.endsWith('.local') || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)
  return local ? undefined : origin
}

/** The student's own no-login link, made now if they do not have one that can be read back. */
async function studentTaskLink(studentId: ID): Promise<string | undefined> {
  const origin = publicOrigin()
  if (!origin) return undefined
  const existing = useStore.getState().studentLinks.find((l) => l.studentId === studentId && l.token)
  const token = existing?.token ?? (await useStore.getState().createStudentLink(studentId))
  return `${origin}/s/${token}`
}

/**
 * Prepares this week's text for one student and stores it as a draft. Nothing
 * is sent. Throws for the screen to show, so "Draft all" can carry on.
 */
export async function draftWeeklyText(studentId: ID): Promise<void> {
  const { data } = useStore.getState()
  const student = data.students.find((s) => s.id === studentId)
  const items = student && weeklyTextItems(data, student.id)
  if (!student || !items) return
  const facts = weeklyTextFacts(student, data.firm.counselorFirstName, items, await studentTaskLink(student.id))
  // Students have no language setting yet, so the text is in English.
  const draft = await weeklyText(facts, 'en')
  useStore.getState().setWeeklyDraft(student.id, weeklyTextWeek(data.firm.weeklyTextDay), draft)
}
