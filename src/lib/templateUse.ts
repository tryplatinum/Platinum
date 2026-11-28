// What a template makes for one student: a plan's dated tasks, or a message's
// draft. Worked out by code from the record, never by a model. The Templates
// windows use this, and so does approving a template the assistant proposed,
// so both make exactly the same tasks and the same drafts.

import { bodyFor, fillPlaceholders, planDates, templateOutboxKind, type MessageContent, type PlaceholderValues, type TaskPlanContent } from '../../shared/templates'
import type { NewMessageDraft, TemplateTask } from '../store/templates'
import type { AppData, Parent, Student, Template } from '../types'
import { formatDateLong, type ISODate } from './dates'
import { fullName, nextMeeting } from './derive'

/** A plan's task for one student, with its real date. `past` marks a date already behind. */
export type PlanRow = TemplateTask & { past: boolean }

/**
 * The tasks a plan makes for one student. A task for "the parent" goes to the
 * main contact, or to the counselor when the student has no parent on file. A
 * task that counts back from a date has no date until `anchor` is given.
 */
export function planRows(plan: TaskPlanContent, student: Student, today: ISODate, anchor?: ISODate): PlanRow[] {
  return planDates(plan, today, anchor).map((t) => {
    const parent = t.owner === 'parent' ? mainParent(student) : undefined
    return { studentId: student.id, title: t.title, owner: t.owner === 'parent' && !parent ? 'counselor' : t.owner, ownerParentId: parent?.id, dueDate: t.dueDate ?? '', detail: t.note, past: t.past }
  })
}

/** The parent a message "to the parent" goes to: the main contact, or the first on file. */
export const mainParent = (student: Student): Parent | undefined => student.parents.find((p) => p.isPrimary) ?? student.parents[0]

/** What the code knows for one student. Each value comes from the record; none is written by a model. */
export function placeholderValues(data: AppData, student: Student, parent: Parent | undefined, dueDate?: ISODate): PlaceholderValues {
  const meeting = nextMeeting(data, student.id)
  return {
    student_first_name: student.firstName,
    student_full_name: fullName(student),
    parent_name: parent?.name,
    counselor_name: data.firm.counselorName,
    firm_name: data.firm.name,
    next_meeting_date: meeting ? formatDateLong(meeting.date) : undefined,
    due_date: dueDate ? formatDateLong(dueDate) : undefined,
  }
}

/** The draft a message template makes for one student, or why it makes none. */
export function draftFor(data: AppData, template: Template, student: Student, dueDate?: ISODate): { draft?: NewMessageDraft; problems: string[]; skipped?: string } {
  const content = template.content as MessageContent
  const parent = content.to === 'parent' ? mainParent(student) : undefined
  if (content.to === 'parent' && !parent) return { problems: [], skipped: `${student.firstName} has no parent on file.` }
  const language = parent?.language ?? 'en'
  const chosen = bodyFor(content, language)
  const filled = fillPlaceholders(chosen.body, placeholderValues(data, student, parent, dueDate), content.to === 'student')
  return {
    problems: filled.problems,
    draft: {
      studentId: student.id,
      templateId: template.id,
      toKind: content.to,
      parentId: parent?.id,
      toName: parent ? parent.name : fullName(student),
      channel: parent ? parent.channel : (student.preferredChannel ?? 'text'),
      language,
      kind: templateOutboxKind(content.to),
      subject: content.subject?.trim() || undefined,
      body: filled.text,
      untranslated: chosen.missing || undefined,
    },
  }
}

