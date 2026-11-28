// What approving an assistant proposal does. One function, so the card in the
// chat and the card in the Inbox do exactly the same thing, and so it can be
// checked without a browser (scripts/test-assistant.ts).
//
// The assistant only ever proposes. This runs in the counselor's own browser,
// when the counselor presses Approve, and every branch calls an action a screen
// already uses: sending goes through sendMessage (the queue, the hold, Undo),
// a meeting through scheduleMeeting (and so the calendar), a template through
// the same two actions the Templates windows call. Nothing here talks to a
// server, and nothing is trusted from the payload without being checked again.

import { AddCollegePayload, ApplyTemplatePayload, ScheduleMeetingPayload, TaskChangePayload } from '../../shared/agent'
import type { OutgoingMessage } from '../services/outbox'
import type { NewMeeting, NewTask } from '../store/store'
import type { NewMessageDraft, TemplateTask } from '../store/templates'
import type { AgentProposal, AppData, CollegeApp, ID, OwnerType, ProfilePatch, Task, TaskCategory } from '../types'
import { todayISO } from './dates'
import { draftFor, mainParent } from './templateUse'

/** The actions approval may take. The store passes its own; a check passes ones that only record. */
export interface ProposalActions {
  sendMessage: (message: OutgoingMessage) => ID
  addTask: (task: NewTask) => void
  changeProfile: (studentId: ID, patch: ProfilePatch, field: string) => void
  /** An older "meeting times" proposal: the choice is noted, nothing is scheduled. */
  noteMeetingTimes: (studentId: ID, times: string[]) => void
  scheduleMeeting: (meeting: NewMeeting) => ID
  addTemplateTasks: (templateId: ID, tasks: TemplateTask[]) => number
  addMessageDrafts: (drafts: NewMessageDraft[]) => ID | undefined
  updateTask: (id: ID, patch: Partial<Pick<Task, 'title' | 'owner' | 'ownerParentId' | 'dueDate'>>) => void
  markTaskDone: (id: ID) => void
  addCollege: (college: Omit<CollegeApp, 'id'>) => void
}

/** Thrown with a sentence for the counselor when a proposal can no longer be carried out as it stands. */
export class ProposalStale extends Error {}

/**
 * Carries out one pending proposal. Returns the id of the message it queued,
 * if it queued one. Throws ProposalStale, having done nothing, when what the
 * proposal is about has changed underneath it.
 */
export function applyProposal(proposal: AgentProposal, data: AppData, act: ProposalActions): { messageId?: ID } {
  const payload = proposal.payload
  const student = data.students.find((s) => s.id === proposal.studentId)

  switch (proposal.kind) {
    case 'message':
    case 'parent_update': {
      const toKind = proposal.kind === 'parent_update' || payload.recipientKind === 'parent' ? 'parent' : 'student'
      return {
        messageId: act.sendMessage({
          studentId: proposal.studentId,
          toKind,
          toName: String(payload.toName ?? (toKind === 'student' ? student?.firstName : 'Parent') ?? 'Recipient'),
          parentId: typeof payload.parentId === 'string' ? payload.parentId : undefined,
          channel: (payload.channel as OutgoingMessage['channel']) ?? 'text',
          language: (payload.language as OutgoingMessage['language']) ?? 'en',
          kind: proposal.kind === 'parent_update' ? 'parent_report' : ((payload.outboxKind as OutgoingMessage['kind']) ?? 'reminder_upcoming'),
          body: String(payload.body ?? ''),
          bodyEn: typeof payload.bodyEn === 'string' ? payload.bodyEn : undefined,
          // The task it is about, so the reminder queue knows this one went out.
          taskId: typeof payload.taskId === 'string' ? payload.taskId : undefined,
          trigger: 'approved',
        }),
      }
    }
    case 'task':
      act.addTask({
        studentId: proposal.studentId,
        title: String(payload.title ?? 'Task'),
        detail: typeof payload.detail === 'string' ? payload.detail : undefined,
        category: (payload.category as TaskCategory) ?? 'planning',
        owner: (payload.owner as OwnerType) ?? 'student',
        ownerParentId: typeof payload.ownerParentId === 'string' ? payload.ownerParentId : undefined,
        dueDate: String(payload.dueDate ?? todayISO()),
      })
      return {}
    case 'profile_change':
      if (student && payload.patch) act.changeProfile(proposal.studentId, payload.patch as ProfilePatch, String(payload.field ?? 'field'))
      return {}
    case 'meeting_times':
      // No longer made. One already stored is still decided the way it always was.
      act.noteMeetingTimes(proposal.studentId, Array.isArray(payload.slots) ? (payload.slots as { when?: string }[]).flatMap((s) => (s.when ? [s.when] : [])) : [])
      return {}
    case 'schedule_meeting': {
      const meeting = ScheduleMeetingPayload.safeParse(payload)
      if (!meeting.success || !student) throw new ProposalStale('This proposal could not be read. Discard it and ask again.')
      const slot = meeting.data.slots[meeting.data.chosen] ?? meeting.data.slots[0]
      // One meeting, at the time that was chosen. The other times are not kept anywhere.
      act.scheduleMeeting({ studentId: proposal.studentId, title: meeting.data.title, date: slot.date, time: slot.time, durationMin: meeting.data.durationMin, location: meeting.data.location })
      return {}
    }
    case 'apply_template': {
      const use = ApplyTemplatePayload.safeParse(payload)
      if (!use.success || !student) throw new ProposalStale('This proposal could not be read. Discard it and ask again.')
      const template = data.templates.find((t) => t.id === use.data.templateId && !t.archived && t.kind === use.data.templateKind)
      if (!template) throw new ProposalStale('That template is no longer in the firm’s library. Nothing was added.')
      if (use.data.templateKind === 'task_plan') {
        const parent = mainParent(student)
        // The tasks and dates the card showed, added the way "From a template" adds them.
        act.addTemplateTasks(
          template.id,
          use.data.tasks.map((t) => ({ studentId: student.id, title: t.title, owner: t.owner === 'parent' && !parent ? 'counselor' : t.owner, ownerParentId: t.owner === 'parent' ? parent?.id : undefined, dueDate: t.dueDate, detail: t.detail })),
        )
        return {}
      }
      // The same draft the Templates window would make for this student, from the record as it is now.
      const made = draftFor(data, template, student, use.data.dueDate)
      if (!made.draft) throw new ProposalStale(`No draft could be made: ${made.skipped ?? 'the template has nothing for this student.'}`)
      act.addMessageDrafts([made.draft])
      return {}
    }
    case 'task_change': {
      const change = TaskChangePayload.safeParse(payload)
      if (!change.success) throw new ProposalStale('This proposal could not be read. Discard it and ask again.')
      const task = data.tasks.find((t) => t.id === change.data.taskId && t.studentId === proposal.studentId)
      if (!task) throw new ProposalStale('That task is no longer on the list. Nothing was changed.')
      const patch = Object.fromEntries(Object.entries(change.data.patch).filter(([, value]) => value !== undefined))
      if (Object.keys(patch).length > 0) act.updateTask(task.id, patch)
      if (change.data.markDone && task.status !== 'done') act.markTaskDone(task.id)
      return {}
    }
    case 'add_college': {
      const college = AddCollegePayload.safeParse(payload)
      if (!college.success || !student) throw new ProposalStale('This proposal could not be read. Discard it and ask again.')
      if (data.colleges.some((c) => c.studentId === proposal.studentId && c.directoryUnitid === college.data.unitid)) throw new ProposalStale(`${college.data.name} is already on the list. Nothing was added.`)
      // As "Add college" on the college list adds one from the directory.
      act.addCollege({ studentId: proposal.studentId, name: college.data.name, plan: college.data.plan, deadline: college.data.deadline, status: 'considering', fit: 'Target', directoryUnitid: college.data.unitid })
      return {}
    }
  }
}
