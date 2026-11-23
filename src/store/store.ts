// The one store. Every screen reads from `data` and changes it only through
// the actions below, so the counselor view and the student view can never
// disagree. Persisted to localStorage; nothing leaves the browser.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { buildSeed } from '../data/seed'
import { nowTimestamp, todayISO } from '../lib/dates'
import { STUDENT_CHANNEL } from '../lib/language'
import type { ReminderDraft } from '../lib/reminders'
import type { MeetingDrafts } from '../services/ai'
import { simulateSend, type OutgoingMessage } from '../services/outbox'
import type {
  Actor,
  AppData,
  Approval,
  CollegeApp,
  DraftParentUpdate,
  DraftTask,
  EssayFeedback,
  ID,
  Meeting,
  ParentReport,
  ProfilePatch,
  Recap,
  ReminderRule,
  Student,
  StudentDocument,
  Task,
  TaskStatus,
} from '../types'

/** Bump when the shape of AppData changes, so old saved demos are thrown away. */
const SCHEMA = 2
const STORAGE_KEY = 'platinum-v0'

export type Decision = 'approved' | 'dismissed'

export type NewTask = Pick<Task, 'studentId' | 'title' | 'owner' | 'dueDate'> &
  Partial<Pick<Task, 'detail' | 'category' | 'ownerParentId' | 'source' | 'meetingId'>>

export type ProfileFields = Partial<
  Pick<Student, 'gpa' | 'gpaWeighted' | 'tests' | 'majors' | 'interests' | 'activities' | 'counselorNotes'>
>

interface State {
  schema: number
  /** The day the seed was built. A new day rebuilds it so relative dates stay right. */
  seedDate: string
  session: { signedIn: boolean; email: string }
  data: AppData
}

interface Actions {
  signIn: (email: string) => void
  signOut: () => void
  resetDemo: () => void

  addTask: (task: NewTask) => void
  updateTask: (id: ID, patch: Partial<Pick<Task, 'title' | 'detail' | 'owner' | 'ownerParentId' | 'dueDate'>>) => void
  /** Status and/or progress note. Used by both views. */
  updateTaskProgress: (id: ID, patch: { status?: TaskStatus; progressNote?: string }, actor: Actor) => void
  /** Records a file name or a link against a task, and files it under the student's documents. */
  attachToTask: (id: ID, attachment: { kind: 'file' | 'link'; name: string; url?: string }, actor: Actor) => void

  updateProfile: (studentId: ID, fields: ProfileFields, actor: Actor, summary?: string) => void

  addCollege: (college: Omit<CollegeApp, 'id'>) => void
  updateCollege: (id: ID, patch: Partial<Omit<CollegeApp, 'id' | 'studentId'>>) => void

  addDocument: (doc: Omit<StudentDocument, 'id' | 'addedOn'>) => void
  /** The essay text and prompt the AI reads. */
  updateDocument: (docId: ID, patch: Partial<Pick<StudentDocument, 'essayText' | 'essayPrompt'>>) => void
  setEssayFeedback: (docId: ID, feedback: EssayFeedback) => void
  updateEssayFeedback: (docId: ID, patch: Partial<EssayFeedback>) => void
  reviewEssayFeedback: (docId: ID, decision: Decision) => void

  setMeetingDrafts: (meetingId: ID, drafts: MeetingDrafts) => void
  updateDraftTask: (meetingId: ID, draftId: ID, patch: Partial<DraftTask>) => void
  reviewDraftTask: (meetingId: ID, draftId: ID, decision: Decision) => void
  updateRecap: (meetingId: ID, patch: Partial<Recap>) => void
  reviewRecap: (meetingId: ID, decision: Decision) => void
  updateParentUpdate: (meetingId: ID, updateId: ID, patch: Partial<DraftParentUpdate>) => void
  reviewParentUpdate: (meetingId: ID, updateId: ID, decision: Decision) => void
  reviewProfileChange: (meetingId: ID, changeId: ID, decision: Decision) => void
  approveAllInMeeting: (meetingId: ID) => void

  /** Turns approved drafts from the notes reader into real tasks. */
  addTasksFromNotes: (studentId: ID, drafts: DraftTask[]) => void

  addReportDraft: (report: Omit<ParentReport, 'id' | 'createdOn' | 'status'>) => void
  updateReport: (id: ID, patch: Partial<Pick<ParentReport, 'subject' | 'bodyEn' | 'bodyLocal'>>) => void
  /** The counselor's approval. Marks the report sent and writes it to the log. */
  approveReport: (id: ID) => void
  discardReport: (id: ID) => void

  updateRule: (id: ReminderRule['id'], patch: Partial<Pick<ReminderRule, 'mode' | 'days'>>) => void
  sendReminder: (reminder: ReminderDraft, trigger: 'automatic' | 'approved') => void
}

// ── Pure helpers on AppData ─────────────────────────────────────────────────

let sequence = 0
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++sequence}`

function patchById<T extends { id: ID }>(list: T[], id: ID, fn: (item: T) => T): T[] {
  return list.map((item) => (item.id === id ? fn(item) : item))
}

function logActivity(data: AppData, studentId: ID, actor: Actor, text: string): AppData {
  return { ...data, activity: [{ id: newId('ev'), at: nowTimestamp(), studentId, actor, text }, ...data.activity] }
}

function deliver(data: AppData, message: OutgoingMessage): AppData {
  return { ...data, outbox: [simulateSend(message), ...data.outbox] }
}

function patchMeeting(data: AppData, meetingId: ID, fn: (m: Meeting) => Meeting): AppData {
  return { ...data, meetings: patchById(data.meetings, meetingId, fn) }
}

function applyProfilePatch(student: Student, patch: ProfilePatch): Student {
  switch (patch.kind) {
    case 'score':
      return patch.field === 'gpa'
        ? { ...student, gpa: patch.value }
        : { ...student, tests: { ...student.tests, [patch.field]: patch.value } }
    case 'addActivity':
      return { ...student, activities: [...student.activities, patch.activity] }
    case 'setMajors':
      return { ...student, majors: patch.value }
    case 'addInterest':
      return { ...student, interests: [...student.interests, patch.value] }
  }
}

/** The record of a counselor's approval. Every approved AI draft carries one. */
const approvalBy = (data: AppData): Approval => ({ by: data.firm.counselorName, at: nowTimestamp() })

function taskFromDraft(studentId: ID, draft: DraftTask, source: Task['source'], approval: Approval, meetingId?: ID): Task {
  return {
    id: newId('t'),
    studentId,
    title: draft.title,
    detail: draft.detail,
    category: draft.category,
    owner: draft.owner,
    ownerParentId: draft.owner === 'parent' ? draft.ownerParentId : undefined,
    dueDate: draft.dueDate,
    status: 'todo',
    createdOn: todayISO(),
    source,
    meetingId,
    approval,
    attachments: [],
  }
}

const actorName = (data: AppData, studentId: ID, actor: Actor) =>
  actor === 'student'
    ? (data.students.find((s) => s.id === studentId)?.firstName ?? 'Student')
    : actor === 'counselor'
      ? data.firm.counselorFirstName
      : actor === 'parent'
        ? 'A parent'
        : 'AI'

function fresh(): Pick<State, 'schema' | 'seedDate' | 'data'> {
  return { schema: SCHEMA, seedDate: todayISO(), data: buildSeed() }
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useStore = create<State & Actions>()(
  persist(
    (set, get) => {
      /** Every action goes through here: take the data, return the new data. */
      const change = (fn: (data: AppData) => AppData) => set((s) => ({ data: fn(s.data) }))

      return {
        ...fresh(),
        session: { signedIn: false, email: '' },

        signIn: (email) => set({ session: { signedIn: true, email } }),
        signOut: () => set({ session: { signedIn: false, email: '' } }),
        resetDemo: () => set(fresh()),

        // ── Tasks ──
        addTask: (task) =>
          change((data) => ({
            ...data,
            tasks: [
              ...data.tasks,
              {
                category: 'planning',
                source: 'counselor',
                ...task,
                id: newId('t'),
                status: 'todo',
                createdOn: todayISO(),
                attachments: [],
              },
            ],
          })),

        updateTask: (id, patch) => change((data) => ({ ...data, tasks: patchById(data.tasks, id, (t) => ({ ...t, ...patch })) })),

        updateTaskProgress: (id, patch, actor) =>
          change((data) => {
            const before = data.tasks.find((t) => t.id === id)
            if (!before) return data
            const status = patch.status ?? before.status
            const after: Task = {
              ...before,
              ...patch,
              status,
              completedOn: status === 'done' ? (before.completedOn ?? todayISO()) : undefined,
            }
            const who = actorName(data, before.studentId, actor)
            let text = `${who} updated “${before.title}”`
            if (status !== before.status) {
              text =
                status === 'done'
                  ? `${who} marked “${before.title}” done`
                  : status === 'in_progress'
                    ? `${who} started “${before.title}”`
                    : `${who} reopened “${before.title}”`
            } else if (patch.progressNote) {
              text += `: ${patch.progressNote}`
            }
            return logActivity({ ...data, tasks: patchById(data.tasks, id, () => after) }, before.studentId, actor, text)
          }),

        attachToTask: (id, attachment, actor) =>
          change((data) => {
            const task = data.tasks.find((t) => t.id === id)
            if (!task) return data
            const today = todayISO()
            const withAttachment = patchById(data.tasks, id, (t) => ({
              ...t,
              status: t.status === 'todo' ? ('in_progress' as const) : t.status,
              attachments: [...t.attachments, { ...attachment, id: newId('a'), addedOn: today, addedBy: actor }],
            }))
            const document: StudentDocument = {
              id: newId('doc'),
              studentId: task.studentId,
              name: attachment.name,
              kind: task.category === 'essay' ? 'essay' : 'other',
              addedOn: today,
              addedBy: actor,
              url: attachment.url,
              taskId: task.id,
            }
            const who = actorName(data, task.studentId, actor)
            const verb = attachment.kind === 'link' ? 'linked' : 'uploaded'
            return logActivity(
              { ...data, tasks: withAttachment, documents: [document, ...data.documents] },
              task.studentId,
              actor,
              `${who} ${verb} “${attachment.name}” on “${task.title}”`,
            )
          }),

        // ── Profile ──
        updateProfile: (studentId, fields, actor, summary) =>
          change((data) => {
            const next = { ...data, students: patchById(data.students, studentId, (s) => ({ ...s, ...fields })) }
            if (actor === 'counselor' && !summary) return next
            const who = actorName(data, studentId, actor)
            return logActivity(next, studentId, actor, `${who} updated the profile${summary ? `: ${summary}` : ''}`)
          }),

        // ── Colleges ──
        addCollege: (college) => change((data) => ({ ...data, colleges: [...data.colleges, { ...college, id: newId('c') }] })),
        updateCollege: (id, patch) =>
          change((data) => ({ ...data, colleges: patchById(data.colleges, id, (c) => ({ ...c, ...patch })) })),

        // ── Documents and essay feedback ──
        addDocument: (doc) =>
          change((data) => ({ ...data, documents: [{ ...doc, id: newId('doc'), addedOn: todayISO() }, ...data.documents] })),

        updateDocument: (docId, patch) =>
          change((data) => ({ ...data, documents: patchById(data.documents, docId, (d) => ({ ...d, ...patch })) })),

        setEssayFeedback: (docId, feedback) =>
          change((data) => ({ ...data, documents: patchById(data.documents, docId, (d) => ({ ...d, feedback })) })),

        updateEssayFeedback: (docId, patch) =>
          change((data) => ({
            ...data,
            documents: patchById(data.documents, docId, (d) => (d.feedback ? { ...d, feedback: { ...d.feedback, ...patch } } : d)),
          })),

        reviewEssayFeedback: (docId, decision) =>
          change((data) => {
            const doc = data.documents.find((d) => d.id === docId)
            const student = data.students.find((s) => s.id === doc?.studentId)
            if (!doc?.feedback || !student) return data
            let next: AppData = {
              ...data,
              documents: patchById(data.documents, docId, (d) => ({
                ...d,
                feedback: { ...d.feedback!, review: decision, approval: decision === 'approved' ? approvalBy(data) : undefined },
              })),
            }
            if (decision === 'approved') {
              next = deliver(next, {
                studentId: student.id,
                toKind: 'student',
                toName: `${student.firstName} ${student.lastName}`,
                channel: STUDENT_CHANNEL,
                language: 'en',
                kind: 'essay_feedback',
                body: `Hi ${student.firstName}, ${data.firm.counselorFirstName} shared feedback on “${doc.name}”. Open Platinum to read it.`,
                trigger: 'approved',
              })
              next = logActivity(next, student.id, 'counselor', `${data.firm.counselorFirstName} shared essay feedback on “${doc.name}”`)
            }
            return next
          }),

        // ── Meetings: AI drafts and their review ──
        setMeetingDrafts: (meetingId, drafts) =>
          change((data) => {
            const meeting = data.meetings.find((m) => m.id === meetingId)
            if (!meeting) return data
            const next = patchMeeting(data, meetingId, (m) => ({ ...m, ai: drafts.ai, recap: drafts.recap }))
            return logActivity(next, meeting.studentId, 'ai', `AI notetaker drafted follow-ups from “${meeting.title}”`)
          }),

        updateDraftTask: (meetingId, draftId, patch) =>
          change((data) =>
            patchMeeting(data, meetingId, (m) =>
              m.ai ? { ...m, ai: { ...m.ai, draftTasks: patchById(m.ai.draftTasks, draftId, (t) => ({ ...t, ...patch })) } } : m,
            ),
          ),

        reviewDraftTask: (meetingId, draftId, decision) =>
          change((data) => {
            const meeting = data.meetings.find((m) => m.id === meetingId)
            const draft = meeting?.ai?.draftTasks.find((t) => t.id === draftId)
            if (!meeting || !draft || draft.review !== 'pending') return data
            const approval = approvalBy(data)
            let next = patchMeeting(data, meetingId, (m) => ({
              ...m,
              ai: { ...m.ai!, draftTasks: patchById(m.ai!.draftTasks, draftId, (t) => ({ ...t, review: decision, approval: decision === 'approved' ? approval : undefined })) },
            }))
            if (decision === 'approved') {
              next = { ...next, tasks: [...next.tasks, taskFromDraft(meeting.studentId, draft, 'ai_meeting', approval, meetingId)] }
              next = logActivity(next, meeting.studentId, 'counselor', `${data.firm.counselorFirstName} approved a new task: ${draft.title}`)
            }
            return next
          }),

        updateRecap: (meetingId, patch) =>
          change((data) => patchMeeting(data, meetingId, (m) => (m.recap ? { ...m, recap: { ...m.recap, ...patch } } : m))),

        reviewRecap: (meetingId, decision) =>
          change((data) => {
            const meeting = data.meetings.find((m) => m.id === meetingId)
            const student = data.students.find((s) => s.id === meeting?.studentId)
            if (!meeting?.recap || !student || meeting.recap.review !== 'pending') return data
            let next = patchMeeting(data, meetingId, (m) => ({ ...m, recap: { ...m.recap!, review: decision, approval: decision === 'approved' ? approvalBy(data) : undefined } }))
            if (decision === 'approved') {
              next = deliver(next, {
                studentId: student.id,
                toKind: 'student',
                toName: `${student.firstName} ${student.lastName}`,
                channel: STUDENT_CHANNEL,
                language: 'en',
                kind: 'meeting_recap',
                body: `Hi ${student.firstName}, your recap from “${meeting.title}” is ready, with ${meeting.recap.nextSteps.length} next steps. Open Platinum to see it.`,
                trigger: 'approved',
              })
              next = logActivity(next, student.id, 'counselor', `${data.firm.counselorFirstName} shared the recap of “${meeting.title}” with ${student.firstName}`)
            }
            return next
          }),

        updateParentUpdate: (meetingId, updateId, patch) =>
          change((data) =>
            patchMeeting(data, meetingId, (m) =>
              m.ai ? { ...m, ai: { ...m.ai, parentUpdates: patchById(m.ai.parentUpdates, updateId, (u) => ({ ...u, ...patch })) } } : m,
            ),
          ),

        reviewParentUpdate: (meetingId, updateId, decision) =>
          change((data) => {
            const meeting = data.meetings.find((m) => m.id === meetingId)
            const update = meeting?.ai?.parentUpdates.find((u) => u.id === updateId)
            const student = data.students.find((s) => s.id === meeting?.studentId)
            const parent = student?.parents.find((p) => p.id === update?.parentId)
            if (!meeting || !update || !student || !parent || update.review !== 'pending') return data
            const approval = approvalBy(data)
            let next = patchMeeting(data, meetingId, (m) => ({
              ...m,
              ai: { ...m.ai!, parentUpdates: patchById(m.ai!.parentUpdates, updateId, (u) => ({ ...u, review: decision, approval: decision === 'approved' ? approval : undefined })) },
            }))
            if (decision === 'approved') {
              const today = todayISO()
              const report: ParentReport = {
                id: newId('r'),
                studentId: student.id,
                parentId: parent.id,
                createdOn: today,
                status: 'sent',
                language: parent.language,
                channel: parent.channel,
                subject: `Update after “${meeting.title}”`,
                bodyEn: update.bodyEn,
                bodyLocal: update.bodyLocal,
                sentOn: today,
                meetingId,
                source: meeting.ai?.source,
                approval,
              }
              next = { ...next, reports: [report, ...next.reports] }
              next = deliver(next, {
                studentId: student.id,
                toKind: 'parent',
                toName: parent.name,
                parentId: parent.id,
                channel: parent.channel,
                language: parent.language,
                kind: 'parent_report',
                body: update.bodyLocal ?? update.bodyEn,
                bodyEn: update.bodyLocal ? update.bodyEn : undefined,
                trigger: 'approved',
              })
              next = logActivity(next, student.id, 'counselor', `${data.firm.counselorFirstName} approved the update to ${parent.name}`)
            }
            return next
          }),

        reviewProfileChange: (meetingId, changeId, decision) =>
          change((data) => {
            const meeting = data.meetings.find((m) => m.id === meetingId)
            const item = meeting?.ai?.profileChanges.find((c) => c.id === changeId)
            if (!meeting || !item || item.review !== 'pending') return data
            let next = patchMeeting(data, meetingId, (m) => ({
              ...m,
              ai: { ...m.ai!, profileChanges: patchById(m.ai!.profileChanges, changeId, (c) => ({
                  ...c,
                  review: decision,
                  approval: decision === 'approved' ? approvalBy(data) : undefined,
                })),
              },
            }))
            if (decision === 'approved') {
              next = { ...next, students: patchById(next.students, meeting.studentId, (s) => applyProfilePatch(s, item.patch)) }
              next = logActivity(next, meeting.studentId, 'counselor', `Profile updated: ${item.label} → ${item.to}`)
            }
            return next
          }),

        approveAllInMeeting: (meetingId) => {
          const meeting = get().data.meetings.find((m) => m.id === meetingId)
          if (!meeting) return
          const a = get()
          meeting.ai?.draftTasks.forEach((t) => a.reviewDraftTask(meetingId, t.id, 'approved'))
          meeting.ai?.profileChanges.forEach((c) => a.reviewProfileChange(meetingId, c.id, 'approved'))
          meeting.ai?.parentUpdates.forEach((u) => a.reviewParentUpdate(meetingId, u.id, 'approved'))
          a.reviewRecap(meetingId, 'approved')
        },

        addTasksFromNotes: (studentId, drafts) =>
          change((data) => {
            if (drafts.length === 0) return data
            const next = { ...data, tasks: [...data.tasks, ...drafts.map((d) => taskFromDraft(studentId, d, 'ai_notes', approvalBy(data)))] }
            return logActivity(
              next,
              studentId,
              'counselor',
              `${data.firm.counselorFirstName} approved ${drafts.length} ${drafts.length === 1 ? 'task' : 'tasks'} from uploaded notes`,
            )
          }),

        // ── Parent reports ──
        addReportDraft: (report) =>
          change((data) => ({
            ...data,
            reports: [{ ...report, id: newId('r'), createdOn: todayISO(), status: 'draft' }, ...data.reports],
          })),

        updateReport: (id, patch) => change((data) => ({ ...data, reports: patchById(data.reports, id, (r) => ({ ...r, ...patch })) })),

        approveReport: (id) =>
          change((data) => {
            const report = data.reports.find((r) => r.id === id)
            const student = data.students.find((s) => s.id === report?.studentId)
            const parent = student?.parents.find((p) => p.id === report?.parentId)
            if (!report || !student || !parent || report.status !== 'draft') return data
            let next: AppData = {
              ...data,
              reports: patchById(data.reports, id, (r) => ({ ...r, status: 'sent', sentOn: todayISO(), approval: approvalBy(data) })),
            }
            next = deliver(next, {
              studentId: student.id,
              toKind: 'parent',
              toName: parent.name,
              parentId: parent.id,
              channel: report.channel,
              language: report.language,
              kind: 'parent_report',
              body: report.bodyLocal ?? report.bodyEn,
              bodyEn: report.bodyLocal ? report.bodyEn : undefined,
              trigger: 'approved',
            })
            return logActivity(next, student.id, 'counselor', `${data.firm.counselorFirstName} approved a progress report to ${parent.name}`)
          }),

        discardReport: (id) => change((data) => ({ ...data, reports: data.reports.filter((r) => r.id !== id || r.status !== 'draft') })),

        // ── Reminders ──
        updateRule: (id, patch) =>
          change((data) => ({ ...data, reminderRules: data.reminderRules.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),

        sendReminder: (reminder, trigger) => change((data) => deliver(data, { ...reminder.message, trigger })),
      }
    },
    {
      name: STORAGE_KEY,
      partialize: ({ schema, seedDate, session, data }) => ({ schema, seedDate, session, data }),
      // Keep saved demo state only if it is from today and from this schema.
      // Otherwise start from a fresh seed (dates are relative to today) but stay signed in.
      merge: (saved, current) => {
        const s = saved as Partial<State> | undefined
        if (!s) return current
        if (s.schema === SCHEMA && s.seedDate === todayISO() && s.data) return { ...current, ...s }
        return { ...current, session: s.session ?? current.session }
      },
    },
  ),
)

// A second tab or window (say, the student view next to the counselor view)
// picks up changes as soon as the other one saves.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) void useStore.persist.rehydrate()
  })
}

/** The whole dataset. Screens call this, then use lib/derive.ts for anything computed. */
export const useData = () => useStore((s) => s.data)
