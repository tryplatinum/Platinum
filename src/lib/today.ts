// What the Today page shows, worked out from data already loaded.

import type { AppData, Meeting, Student } from '../types'
import { addDays, daysBetween, todayISO, type ISODate } from './dates'
import { activeStudents, type ApprovalItem, type StudentSummary } from './derive'

export interface TodayMeeting {
  meeting: Meeting
  student: Student
  /** `earlier` is a meeting from the last week that was never logged. */
  when: 'earlier' | 'today' | 'tomorrow'
  /** Its time has passed. */
  over: boolean
}

/** A scheduled meeting this many days old can still be logged from Today. */
const UNLOGGED_DAYS = 7

/** "14:30" as minutes into the day. */
const minutes = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

const byTime = (a: { meeting: Meeting }, b: { meeting: Meeting }) => (a.meeting.date + a.meeting.time).localeCompare(b.meeting.date + b.meeting.time)

/** Meetings today and tomorrow in time order, after any that were held and not logged. `next` is the one after that. */
export function meetingsForToday(data: AppData, now = new Date(), today: ISODate = todayISO()): { list: TodayMeeting[]; next?: { meeting: Meeting; student: Student } } {
  const students = new Map(activeStudents(data).map((s) => [s.id, s]))
  const tomorrow = addDays(today, 1)
  const clock = now.getHours() * 60 + now.getMinutes()
  const list: TodayMeeting[] = []
  const later: { meeting: Meeting; student: Student }[] = []
  for (const meeting of data.meetings) {
    const student = students.get(meeting.studentId)
    if (!student) continue
    if (meeting.date === today) list.push({ meeting, student, when: 'today', over: clock >= minutes(meeting.time) + meeting.durationMin })
    else if (meeting.date === tomorrow) list.push({ meeting, student, when: 'tomorrow', over: false })
    else if (meeting.status === 'scheduled' && meeting.date < today && daysBetween(meeting.date, today) <= UNLOGGED_DAYS) list.push({ meeting, student, when: 'earlier', over: true })
    else if (meeting.status === 'scheduled' && meeting.date > tomorrow) later.push({ meeting, student })
  }
  return { list: list.sort(byTime), next: later.sort(byTime)[0] }
}

/** Students who are behind or slipping, worst first: behind before slipping, then the most overdue, then the most late tasks. */
export function slippingStudents(all: StudentSummary[]): StudentSummary[] {
  const rank = (s: StudentSummary) => (s.status === 'behind' ? 0 : 1)
  return all
    .filter((s) => s.status === 'behind' || s.status === 'slipping')
    .sort((a, b) => rank(a) - rank(b) || (b.waitingOn?.daysLate ?? 0) - (a.waitingOn?.daysLate ?? 0) || b.progress.late - a.progress.late)
}

/**
 * A few drafts to clear from Today, chosen for spread: the oldest first, and no
 * more than one for any student, so it is never three of one family's reminders.
 */
export function waitingSpread(approvals: ApprovalItem[], count = 3): ApprovalItem[] {
  const seen = new Set<string>()
  const picked: ApprovalItem[] = []
  // A stable sort: drafts of the same age keep the order the Inbox gives them.
  for (const item of [...approvals].sort((a, b) => (Date.parse(a.sortAt) || 0) - (Date.parse(b.sortAt) || 0))) {
    if (seen.has(item.studentId)) continue
    seen.add(item.studentId)
    picked.push(item)
    if (picked.length === count) break
  }
  return picked
}
