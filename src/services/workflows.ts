// Steps that join the AI module to the store, shared by more than one screen.
// Each one stores drafts with review: 'pending'. Nothing is approved here.

import { parentCopyTask, primaryParent, weeklyTextItems, weeklyTextWeek } from '../lib/derive'
import { notesForDraft } from '../lib/facts'
import { STUDENT_LINK_PLACEHOLDER } from '../../shared/dispatch'
import { WEEKLY_NOTE_ROOM, weeklyTextFacts } from '../lib/reminders'
import { useStore } from '../store/store'
import type { ID } from '../types'
import { draftFromMeeting, draftTasksOnly, preMeetingBrief, reminderDraft, weeklyText } from './ai'

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

export interface WeeklyDraftOptions {
  /** False redrafts without any "thing to remember". */
  useNotes?: boolean
  /** Also draft the separate short message to the primary parent. */
  tellParent?: boolean
}

/**
 * Prepares this week's text for one student and stores it as a draft. Nothing
 * is sent. Throws for the screen to show, so "Draft all" can carry on.
 */
export async function draftWeeklyText(studentId: ID, { useNotes = true, tellParent = false }: WeeklyDraftOptions = {}): Promise<void> {
  const { data } = useStore.getState()
  const student = data.students.find((s) => s.id === studentId)
  const items = student && weeklyTextItems(data, student.id)
  if (!student || !items) return
  // Things to remember go to the student's text only. notesForDraft returns none for any other audience,
  // and leaves out anything out of date or already mentioned.
  const notes = useNotes ? notesForDraft(data, student, 'student') : []
  // With something personal to say, the task list gives up room for it.
  // The real /s/... URL is minted at send time. The draft carries a placeholder.
  const facts = weeklyTextFacts(student, data.firm.counselorFirstName, items, STUDENT_LINK_PLACEHOLDER, undefined, notes.length ? WEEKLY_NOTE_ROOM : 0)
  // Students have no language setting yet, so the text is in English.
  const draft = await weeklyText(facts, 'en', notes)
  const weekStart = weeklyTextWeek(data.firm.weeklyTextDay)
  useStore.getState().setWeeklyDraft(student.id, weekStart, draft)

  const hasCopy = useStore.getState().data.weeklyTexts.some((w) => w.studentId === student.id && w.weekStart === weekStart && w.parentCopy)
  if (tellParent && !hasCopy) {
    try {
      await draftWeeklyParentCopy(student.id)
    } catch (error) {
      throw new Error(`The text is drafted, but the parent copy is not. ${error instanceof Error ? error.message : 'Try again.'}`, { cause: error })
    }
  }
}

/**
 * Drafts the parent copy of this week's text: a short message to the primary
 * parent about the student's most pressing task, in the parent's language and
 * for their channel. It is the reminder feature, addressed to a parent, so it
 * is given no "things to remember". Stored as its own draft; nothing is sent.
 */
export async function draftWeeklyParentCopy(studentId: ID): Promise<void> {
  const { data } = useStore.getState()
  const student = data.students.find((s) => s.id === studentId)
  const items = student && weeklyTextItems(data, student.id)
  const parent = student && primaryParent(student)
  const task = items && parentCopyTask(items)
  if (!student || !parent || !task) return
  const message = await reminderDraft(data, student, task, { kind: 'parent', parent })
  useStore.getState().setWeeklyParentCopy(student.id, weeklyTextWeek(data.firm.weeklyTextDay), {
    parentId: parent.id,
    taskId: task.id,
    channel: message.channel,
    language: message.language,
    kind: message.kind,
    body: message.body,
    bodyEn: message.bodyEn,
    source: message.source,
    warnings: message.warnings.length ? message.warnings : undefined,
  })
}
