// What the Inbox holds and how many things are in it, so the page, the sidebar
// badge and the Students header always give the same number.

import type { AppData, CollegeListDraft, ID, OutboxMessage, StudentDocument } from '../types'
import { canDeliver } from './delivery'
import { previewStudentLink } from '../../shared/dispatch'
import { formatTimestamp } from './dates'
import { APPROVAL_TYPE_LABEL, allPendingApprovals, approvalGroups, findStudent, fullName, type ApprovalItem } from './derive'
import { fileTitle, filesToCheck, waitingFiles } from './files'
import { CHANNEL_LABEL } from './language'
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

// ── The Inbox as a list ─────────────────────────────────────────────────────

/** One thing waiting, as a row of two lines. The same row is used in the Inbox list and on Today. */
export interface InboxRow {
  /** Also what `?item=` holds in the address. */
  key: string
  studentId?: ID
  /** What kind of thing it is: "Reminder", "File", "College list". */
  pill: string
  /** Who it goes to and how: "To Zhang Wei · WeChat". Empty when it goes to nobody. */
  who: string
  /** The message or the file, on one line. */
  line: string
  /** The whole row in words, for the heading above its detail. */
  label: string
  item?: ApprovalItem
  /** A counselor upload nobody has filed yet. */
  toFile?: StudentDocument
  /** A file put in a folder without a person choosing it. */
  toCheck?: StudentDocument
  listDraft?: CollegeListDraft
}

export interface InboxGroup {
  id: string
  /** The student's name, or "Files", or "College list drafts". */
  name: string
  /** "Reminder", "From meeting on Nov 20". */
  source?: string
  studentId?: ID
  rows: InboxRow[]
}

const oneLine = (text: string) => previewStudentLink(text).replace(/\s+/g, ' ').trim()

export function approvalRow(data: AppData, item: ApprovalItem, nameStudent = false): InboxRow {
  const student = findStudent(data, item.studentId)
  const pill = APPROVAL_TYPE_LABEL[item.kind]
  return {
    key: item.key,
    studentId: item.studentId,
    pill,
    who: [nameStudent && student ? fullName(student) : '', item.toName ? `To ${item.toName}${item.channel ? ` · ${CHANNEL_LABEL[item.channel]}` : ''}` : ''].filter(Boolean).join(' · '),
    line: oneLine(item.preview) || item.sourceLine,
    label: `${pill}${item.toName ? ` to ${item.toName}` : ''}${student ? `, ${fullName(student)}` : ''}`,
    item,
  }
}

/** Everything in the Inbox in the order it is shown: drafts by student and source, then files, then college list drafts. */
export function inboxGroups(data: AppData, c: InboxContents): InboxGroup[] {
  const groups: InboxGroup[] = []
  for (const g of approvalGroups(c.approvals)) {
    const student = findStudent(data, g.studentId)
    if (!student) continue
    // Drafts made together from a template: one group under the template's name, each row saying whose it is.
    if (g.groupName) {
      groups.push({ id: g.sourceKey, name: g.groupName, rows: g.items.map((item) => approvalRow(data, item, true)) })
      continue
    }
    groups.push({ id: `${g.studentId}:${g.sourceKey}`, name: fullName(student), source: g.sourceLabel, studentId: g.studentId, rows: g.items.map((item) => approvalRow(data, item)) })
  }
  const fileRow = (doc: StudentDocument, waiting: boolean): InboxRow => {
    const student = doc.studentId ? findStudent(data, doc.studentId) : undefined
    const title = fileTitle(doc)
    return {
      key: `file:${doc.id}`,
      studentId: student?.id,
      pill: 'File',
      who: student ? fullName(student) : 'No student yet',
      line: `${title} · ${waiting ? 'waiting to be filed' : 'filed for you, waiting to be checked'}`,
      label: `File “${title}”${student ? `, ${fullName(student)}` : ''}`,
      ...(waiting ? { toFile: doc } : { toCheck: doc }),
    }
  }
  const files = [...c.toFile.map((d) => fileRow(d, true)), ...c.toCheck.map((d) => fileRow(d, false))]
  if (files.length > 0) groups.push({ id: 'files', name: 'Files', rows: files })
  const lists = c.listDrafts.flatMap((draft): InboxRow[] => {
    const student = findStudent(data, draft.studentId)
    if (!student) return []
    return [{ key: `list:${draft.id}`, studentId: student.id, pill: 'College list', who: fullName(student), line: `Draft list, made ${formatTimestamp(draft.createdAt)}`, label: `College list draft, ${fullName(student)}`, listDraft: draft }]
  })
  if (lists.length > 0) groups.push({ id: 'lists', name: 'College list drafts', rows: lists })
  return groups
}

/** The row to show when `was` has left: the one that came after it, or the one before. */
export function rowAfter(before: readonly string[], was: string, now: readonly string[]): string | undefined {
  const at = before.indexOf(was)
  if (at < 0) return now[0]
  const still = new Set(now)
  for (let i = at + 1; i < before.length; i++) if (still.has(before[i])) return before[i]
  for (let i = at - 1; i >= 0; i--) if (still.has(before[i])) return before[i]
  return undefined
}
