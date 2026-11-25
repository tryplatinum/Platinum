// What the Inbox holds and how many things are in it, so the page, the sidebar
// badge and the Students header always give the same number.

import type { AppData, CollegeListDraft, ID, OutboxMessage, StudentDocument } from '../types'
import { canDeliver } from './delivery'
import { allPendingApprovals, findStudent, type ApprovalItem } from './derive'
import { filesToCheck, waitingFiles } from './files'
import { reminderQueue } from './reminders'

export interface InboxContents {
  approvals: ApprovalItem[]
  /** Counselor uploads nobody has filed yet. */
  toFile: StudentDocument[]
  /** Filed without a person choosing the folder. */
  toCheck: StudentDocument[]
  listDrafts: CollegeListDraft[]
}

export function inboxContents(data: AppData, studentId?: ID): InboxContents {
  const mine = (x: { studentId: ID }) => !studentId || x.studentId === studentId
  return {
    approvals: allPendingApprovals(data, reminderQueue(data), studentId),
    toFile: waitingFiles(data).filter(mine),
    toCheck: filesToCheck(data).filter(mine),
    listDrafts: data.collegeListDrafts.filter((d) => d.status === 'draft' && mine(d) && findStudent(data, d.studentId)),
  }
}

export const inboxSize = (c: InboxContents) => c.approvals.length + c.toFile.length + c.toCheck.length + c.listDrafts.length

export const inboxCount = (data: AppData) => inboxSize(inboxContents(data))

/** Inside its Undo window, or handed to the counselor's phone and not sent yet. */
export const messageOnItsWay = (m: OutboxMessage, now: number) => canDeliver(m.channel) && ((m.status === 'queued' && Date.parse(m.sendAfter) > now) || (m.status === 'sending' && m.detail === 'phone_waiting'))
