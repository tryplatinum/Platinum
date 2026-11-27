// The store's actions for templates: the firm's library, and using one on a
// student. They are part of the one store (store.ts spreads them in).
//
// Nothing here sends. Applying a task plan or giving a handout adds ordinary
// tasks. A message template makes drafts; a draft reaches the outbox only when
// a counselor approves it, through the same sendMessage every other approved
// send uses, with the same hold and Undo.

import { draftProblems, parseTemplateContent, templateName, type TemplateContent, type TemplateKind } from '../../shared/templates'
import { nowTimestamp, todayISO, type ISODate } from '../lib/dates'
import type { OutgoingMessage } from '../services/outbox'
import type { AppData, ID, MessageDraft, OwnerType, Task, Template } from '../types'

/** One task about to be made from a template, with its real date. */
export interface TemplateTask {
  studentId: ID
  title: string
  owner: OwnerType
  ownerParentId?: ID
  dueDate: ISODate
  detail?: string
}

export type NewMessageDraft = Omit<MessageDraft, 'id' | 'status' | 'createdAt' | 'batchId' | 'approval'>

export interface TemplateActions {
  /** Makes a template, or saves over one. Throws with a sentence to show when the name or content is not complete. */
  saveTemplate: (template: { id?: ID; kind: TemplateKind; name: string; content: TemplateContent }) => ID
  duplicateTemplate: (id: ID) => ID | undefined
  /** Archived is not deleted: what was made from the template keeps working, and it can be brought back. */
  archiveTemplate: (id: ID, archived: boolean) => void
  /** Adds the tasks as ordinary tasks, each marked as from this template. Returns how many were added. */
  addTemplateTasks: (templateId: ID, tasks: TemplateTask[]) => number
  /** Gives a handout to each student: a task "Complete: <name>" with the handout on it. Returns how many were given. */
  giveHandout: (templateId: ID, studentIds: ID[], dueDate: ISODate) => number
  /** Puts drafts in the Inbox as one group. Nothing is queued. Returns the group's id. */
  addMessageDrafts: (drafts: NewMessageDraft[]) => ID | undefined
  updateMessageDraft: (id: ID, patch: Partial<Pick<MessageDraft, 'body' | 'subject'>>) => void
  /** The counselor's approval: queues the message and marks the draft approved. Throws when a blank is still in the text. */
  approveMessageDraft: (id: ID) => ID
  discardMessageDraft: (id: ID) => void
}

interface Tools {
  get: () => { data: AppData; account: { status: string; userId?: ID }; sendMessage: (message: OutgoingMessage) => ID }
  change: (fn: (data: AppData) => AppData) => void
  /** Several changes saved as one. */
  batch: (work: () => void) => void
  /** A counselor's line in a student's activity. The store's own, so the log is written one way. */
  log: (data: AppData, studentId: ID, text: string) => AppData
}

const newId = () => crypto.randomUUID()

export function templateActions({ get, change, batch, log: logged }: Tools): TemplateActions {
  const me = () => {
    const { account } = get()
    return account.status === 'ready' ? account.userId : undefined
  }
  const find = (id: ID) => get().data.templates.find((t) => t.id === id)

  return {
    saveTemplate: ({ id, kind, name, content }) => {
      const named = templateName(name)
      if (!named.success) throw new Error('Give the template a name.')
      const checked = parseTemplateContent(kind, content)
      if (!checked.ok) throw new Error(checked.message)
      const saved: Template = { id: id ?? newId(), kind, name: named.data, content: checked.value, archived: false, createdBy: me() }
      change((data) => {
        const existing = data.templates.find((t) => t.id === saved.id)
        // The kind of a template never changes: what was made from it says what it was.
        if (existing) return { ...data, templates: data.templates.map((t) => (t.id === saved.id ? { ...t, name: saved.name, content: saved.content } : t)) }
        return { ...data, templates: [...data.templates, saved] }
      })
      return saved.id
    },

    duplicateTemplate: (id) => {
      const from = find(id)
      if (!from) return undefined
      const copy: Template = { ...from, id: newId(), name: `${from.name} (copy)`.slice(0, 120), archived: false, createdBy: me() }
      change((data) => ({ ...data, templates: [...data.templates, copy] }))
      return copy.id
    },

    archiveTemplate: (id, archived) => change((data) => (data.templates.some((t) => t.id === id && t.archived !== archived) ? { ...data, templates: data.templates.map((t) => (t.id === id ? { ...t, archived } : t)) } : data)),

    addTemplateTasks: (templateId, tasks) => {
      const template = find(templateId)
      const wanted = tasks.filter((t) => t.title.trim() && t.dueDate)
      if (!template || wanted.length === 0) return 0
      change((data) => {
        const students = new Set(data.students.map((s) => s.id))
        const made: Task[] = wanted
          .filter((t) => students.has(t.studentId))
          .map((t) => ({
            id: newId(),
            studentId: t.studentId,
            title: t.title.trim(),
            detail: t.detail?.trim() || undefined,
            category: 'planning',
            owner: t.owner,
            ownerParentId: t.owner === 'parent' ? t.ownerParentId : undefined,
            dueDate: t.dueDate,
            status: 'todo',
            createdOn: todayISO(),
            source: 'counselor',
            attachments: [],
            templateId,
          }))
        if (made.length === 0) return data
        let next: AppData = { ...data, tasks: [...data.tasks, ...made] }
        for (const studentId of new Set(made.map((t) => t.studentId))) {
          const n = made.filter((t) => t.studentId === studentId).length
          next = logged(next, studentId, `Added ${n} ${n === 1 ? 'task' : 'tasks'} from the “${template.name}” template.`)
        }
        return next
      })
      return wanted.length
    },

    giveHandout: (templateId, studentIds, dueDate) => {
      const template = find(templateId)
      if (!template || template.kind !== 'handout' || !dueDate) return 0
      const content = template.content as Extract<TemplateContent, { source: string }>
      let given = 0
      change((data) => {
        let next = data
        for (const studentId of new Set(studentIds)) {
          if (!data.students.some((s) => s.id === studentId)) continue
          const task: Task = {
            id: newId(),
            studentId,
            title: `Complete: ${template.name}`,
            // A handout written in Platinum is the task's own text, which the student's page shows in full.
            detail: content.source === 'text' ? content.text : undefined,
            category: 'planning',
            owner: 'student',
            dueDate,
            status: 'todo',
            createdOn: todayISO(),
            source: 'counselor',
            attachments: content.source === 'link' ? [{ id: newId(), kind: 'link', name: content.label?.trim() || template.name, url: content.url, addedOn: todayISO(), addedBy: 'counselor' }] : [],
            templateId,
          }
          next = logged({ ...next, tasks: [...next.tasks, task] }, studentId, `Gave the “${template.name}” handout.`)
          given++
        }
        return next
      })
      return given
    },

    addMessageDrafts: (drafts) => {
      const wanted = drafts.filter((d) => d.body.trim())
      if (wanted.length === 0) return undefined
      const batchId = newId()
      change((data) => ({ ...data, messageDrafts: [...data.messageDrafts, ...wanted.map((d): MessageDraft => ({ ...d, id: newId(), batchId, status: 'draft', createdAt: nowTimestamp() }))] }))
      return batchId
    },

    updateMessageDraft: (id, patch) => change((data) => (data.messageDrafts.some((d) => d.id === id && d.status === 'draft') ? { ...data, messageDrafts: data.messageDrafts.map((d) => (d.id === id ? { ...d, ...patch } : d)) } : data)),

    approveMessageDraft: (id) => {
      const { data, sendMessage } = get()
      const draft = data.messageDrafts.find((d) => d.id === id)
      if (!draft || draft.status !== 'draft') throw new Error('This draft has already been decided.')
      // A blank still in the text blocks approval. The card says which one.
      const problems = draftProblems(draft.body, draft.toKind === 'student')
      if (problems.length > 0) throw new Error(problems[0])
      const template = data.templates.find((t) => t.id === draft.templateId)
      let messageId = ''
      batch(() => {
        // The one way into the outbox, with its hold and Undo, as for every other approved send.
        messageId = sendMessage({
          studentId: draft.studentId,
          toKind: draft.toKind,
          toName: draft.toName,
          parentId: draft.parentId,
          channel: draft.channel,
          language: draft.language,
          kind: draft.kind,
          body: draft.body,
          trigger: 'approved',
          note: template ? `From the “${template.name}” template` : 'From a template',
        })
        change((now) => ({ ...now, messageDrafts: now.messageDrafts.map((d) => (d.id === id ? { ...d, status: 'approved' as const, approval: { by: now.firm.counselorName, byId: me(), at: nowTimestamp() } } : d)) }))
      })
      return messageId
    },

    discardMessageDraft: (id) => change((data) => (data.messageDrafts.some((d) => d.id === id && d.status === 'draft') ? { ...data, messageDrafts: data.messageDrafts.map((d) => (d.id === id ? { ...d, status: 'discarded' as const } : d)) } : data)),
  }
}
