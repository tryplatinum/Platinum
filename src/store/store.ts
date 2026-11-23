// The one store. Every screen reads from `data` and changes it only through
// the actions below, so the counselor view and the student view can never
// disagree.
//
// `data` is the in-memory copy of the firm's rows in the database. An action
// changes memory first, so the screen answers at once, then the difference is
// written through data/repo.ts in one transaction. If the write fails the
// change is undone and the counselor is told why.

import { create } from 'zustand'
import { withFreshIds } from '../data/ids'
import { ACTIVITY_LIMIT, applyChanges, createStudentLink, diffData, firstNameOf, listStudentLinks, loadAll, revokeStudentLink, type Changes } from '../data/repo'
import { buildSeed, DEFAULT_REMINDER_RULES } from '../data/seed'
import { notify } from '../lib/notify'
import { studentLinkWrite, type StudentWrite } from '../services/studentLink'
import { nowTimestamp, todayISO } from '../lib/dates'
import { fullName } from '../lib/derive'
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
  EssayStatus,
  Firm,
  ID,
  Meeting,
  Parent,
  ParentReport,
  ProfilePatch,
  Recap,
  ReminderRule,
  SavedBrief,
  Student,
  StudentDocument,
  StudentLink,
  Task,
  TaskStatus,
} from '../types'
import { CATEGORY_FOR_KIND, migrate } from './migrate'

/** Where versions before accounts kept everything. Read once, to offer an import. */
const LEGACY_STORAGE_KEY = 'platinum-v0'

export type Decision = 'approved' | 'dismissed'

export type NewStudent = Pick<Student, 'firstName' | 'lastName' | 'gradYear' | 'school' | 'city'> &
  Partial<Pick<Student, 'localName' | 'email' | 'phone' | 'preferredChannel'>>

export type StudentFields = Partial<Omit<Student, 'id' | 'parents' | 'onboardedOn'>>

export type NewTask = Pick<Task, 'studentId' | 'title' | 'owner' | 'dueDate'> &
  Partial<Pick<Task, 'detail' | 'category' | 'ownerParentId' | 'expectsDocument'>>

export type NewMeeting = Pick<Meeting, 'studentId' | 'title' | 'date' | 'time'> & Partial<Pick<Meeting, 'durationMin' | 'location'>>

export type NewDocument = Pick<StudentDocument, 'studentId' | 'name' | 'kind' | 'addedBy'> &
  Partial<Omit<StudentDocument, 'id' | 'addedOn' | 'studentId' | 'name' | 'kind' | 'addedBy'>>

/** Who is using the app. Set by store/session.ts from the Supabase session. */
export type Account =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'error'; message: string }
  | { status: 'needs_firm'; userId: ID; email: string }
  | { status: 'ready'; userId: ID; email: string; firmId: ID; role: 'owner' | 'counselor' }

interface State {
  account: Account
  /** Whether `data` holds the firm's rows yet. */
  load: 'idle' | 'loading' | 'ready' | 'error'
  loadError?: string
  /**
   * 'firm': a signed-in counselor; changes are written to the database.
   * 'student_link': a student on their secret link; `data` is the small slice
   * api/student.ts returned and only its three writes are possible.
   */
  mode: 'firm' | 'student_link'
  linkToken?: string
  data: AppData
  /** Active student links for the firm. Not part of AppData: only the student page uses them. */
  studentLinks: StudentLink[]
}

interface Actions {
  /** Loads the firm's data from the database. `quiet` refreshes in the background without a loading screen. */
  reload: (quiet?: boolean) => Promise<void>
  /** Adds the invented sample caseload to the firm, with dates relative to today. */
  loadSample: () => void
  /** Deletes the firm's data and loads the sample caseload again. */
  resetDemo: () => void
  /** Deletes the firm's data, for a counselor entering their own students. */
  startEmpty: () => void
  /** True when this browser still holds data saved by a version before accounts. */
  hasLegacyData: () => boolean
  /** Copies that saved data into the firm, then removes it from the browser. */
  importLegacyData: () => boolean
  dismissLegacyData: () => void
  /** Makes a secret link for a student and returns its token. The token cannot be read again later. */
  createStudentLink: (studentId: ID) => Promise<string>
  revokeStudentLink: (linkId: ID) => Promise<void>
  updateFirm: (firm: Partial<Pick<Firm, 'name' | 'counselorName'>>) => void

  // Students and families
  addStudent: (student: NewStudent) => ID
  updateStudent: (id: ID, fields: StudentFields, actor?: Actor, summary?: string) => void
  archiveStudent: (id: ID, archived?: boolean) => void
  addParent: (studentId: ID, parent: Omit<Parent, 'id' | 'isPrimary'> & { isPrimary?: boolean }) => void
  updateParent: (studentId: ID, parentId: ID, fields: Partial<Omit<Parent, 'id'>>) => void
  removeParent: (studentId: ID, parentId: ID) => void

  // Tasks
  addTask: (task: NewTask) => void
  updateTask: (id: ID, patch: Partial<Pick<Task, 'title' | 'detail' | 'owner' | 'ownerParentId' | 'dueDate' | 'expectsDocument'>>) => void
  /** Status and/or progress note. Used by both views. */
  updateTaskProgress: (id: ID, patch: { status?: TaskStatus; progressNote?: string }, actor: Actor) => void
  /** Records a file name or a link against a task, and files it under the student's documents. */
  attachToTask: (id: ID, attachment: { kind: 'file' | 'link'; name: string; url?: string }, actor: Actor) => void
  deleteTask: (id: ID) => void

  // Colleges
  addCollege: (college: Omit<CollegeApp, 'id'>) => void
  updateCollege: (id: ID, patch: Partial<Omit<CollegeApp, 'id' | 'studentId'>>) => void
  removeCollege: (id: ID) => void

  // Documents and essays
  addDocument: (doc: NewDocument) => ID
  updateDocument: (docId: ID, patch: Partial<Omit<StudentDocument, 'id' | 'studentId' | 'drafts' | 'feedback'>>) => void
  removeDocument: (docId: ID) => void
  /** Saves essay text. `asNew` starts the next numbered draft; otherwise the current draft is replaced. */
  saveEssayDraft: (docId: ID, text: string, asNew: boolean) => void
  setEssayFeedback: (docId: ID, feedback: EssayFeedback) => void
  updateEssayFeedback: (docId: ID, patch: Partial<Pick<EssayFeedback, 'overall' | 'strengths' | 'points'>>) => void
  reviewEssayFeedback: (docId: ID, decision: Decision) => void

  // Meetings
  addMeeting: (meeting: NewMeeting) => ID
  /** Reschedule, rename, or edit the agenda. */
  updateMeeting: (id: ID, patch: Partial<Pick<Meeting, 'title' | 'date' | 'time' | 'durationMin' | 'location' | 'agenda'>>) => void
  /** Marks a meeting as held and stores the notes or transcript the AI will read. */
  completeMeeting: (id: ID, notes: string, heldOn?: string) => void
  deleteMeeting: (id: ID) => void
  setMeetingBrief: (id: ID, brief: SavedBrief) => void

  // Meeting drafts and their review
  setMeetingDrafts: (meetingId: ID, drafts: MeetingDrafts) => void
  reviewNotes: (meetingId: ID, decision: Decision) => void
  updateDraftTask: (meetingId: ID, draftId: ID, patch: Partial<DraftTask>) => void
  reviewDraftTask: (meetingId: ID, draftId: ID, decision: Decision) => void
  updateRecap: (meetingId: ID, patch: Partial<Recap>) => void
  reviewRecap: (meetingId: ID, decision: Decision) => void
  updateParentUpdate: (meetingId: ID, updateId: ID, patch: Partial<DraftParentUpdate>) => void
  reviewParentUpdate: (meetingId: ID, updateId: ID, decision: Decision) => void
  reviewProfileChange: (meetingId: ID, changeId: ID, decision: Decision) => void
  approveAllInMeeting: (meetingId: ID) => void

  // Parent reports
  addReportDraft: (report: Omit<ParentReport, 'id' | 'createdOn' | 'status'>) => void
  updateReport: (id: ID, patch: Partial<Pick<ParentReport, 'subject' | 'bodyEn' | 'bodyLocal'>>) => void
  /** The counselor's approval. Marks the report sent and writes it to the log. */
  approveReport: (id: ID) => void
  discardReport: (id: ID) => void

  // Messages
  updateRule: (id: ReminderRule['id'], patch: Partial<Pick<ReminderRule, 'mode' | 'days'>>) => void
  /** Writes one message to the "Messages sent" log. Nothing is delivered in v0. */
  sendMessage: (message: OutgoingMessage) => void
}

// ── Pure helpers on AppData ─────────────────────────────────────────────────

/** Row ids are uuids, made here so a new row can be shown before the database confirms it. */
const newId = () => crypto.randomUUID()

function patchById<T extends { id: ID }>(list: T[], id: ID, fn: (item: T) => T): T[] {
  return list.map((item) => (item.id === id ? fn(item) : item))
}

function logActivity(data: AppData, studentId: ID, actor: Actor, text: string): AppData {
  return { ...data, activity: [{ id: newId(), at: nowTimestamp(), studentId, actor, text }, ...data.activity].slice(0, ACTIVITY_LIMIT) }
}

function deliver(data: AppData, message: OutgoingMessage): AppData {
  return { ...data, outbox: [simulateSend(message), ...data.outbox] }
}

function patchMeeting(data: AppData, meetingId: ID, fn: (m: Meeting) => Meeting): AppData {
  return { ...data, meetings: patchById(data.meetings, meetingId, fn) }
}

function patchStudent(data: AppData, studentId: ID, fn: (s: Student) => Student): AppData {
  return { ...data, students: patchById(data.students, studentId, fn) }
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

/** The record of a counselor's approval: their name, their account, and when. Every approved AI draft carries one. */
function approvalBy(data: AppData): Approval {
  const { account } = useStore.getState()
  return { by: data.firm.counselorName, byId: account.status === 'ready' ? account.userId : undefined, at: nowTimestamp() }
}
const stamp = (data: AppData, decision: Decision) => (decision === 'approved' ? approvalBy(data) : undefined)

function taskFromDraft(studentId: ID, draft: DraftTask, source: Task['source'], approval: Approval, meetingId?: ID): Task {
  return {
    id: newId(),
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

function toStudent(student: Student): Pick<OutgoingMessage, 'studentId' | 'toKind' | 'toName' | 'channel' | 'language'> {
  return { studentId: student.id, toKind: 'student', toName: fullName(student), channel: student.preferredChannel ?? 'text', language: 'en' }
}

function emptyData(firm: Firm): AppData {
  return {
    firm,
    students: [],
    tasks: [],
    meetings: [],
    colleges: [],
    documents: [],
    reports: [],
    outbox: [],
    reminderRules: DEFAULT_REMINDER_RULES.map((r) => ({ ...r })),
    activity: [],
  }
}

/** `add` joined onto `base`, keeping each list's order convention (see diffData in data/repo.ts). */
function merged(base: AppData, add: AppData): AppData {
  return {
    ...base,
    students: [...base.students, ...add.students],
    tasks: [...base.tasks, ...add.tasks],
    meetings: [...base.meetings, ...add.meetings],
    colleges: [...base.colleges, ...add.colleges],
    documents: [...add.documents, ...base.documents],
    reports: [...add.reports, ...base.reports],
    outbox: [...add.outbox, ...base.outbox],
    activity: [...add.activity, ...base.activity].slice(0, ACTIVITY_LIMIT),
  }
}

const NO_FIRM: Firm = { name: '', counselorName: '', counselorFirstName: '' }

// ── Writing changes to the database ─────────────────────────────────────────
// Writes run one at a time, in the order the changes were made.

let writes: Promise<void> = Promise.resolve()
let pendingWrites = 0
/** Goes up when a write fails, so changes queued behind it (and already undone with it) are skipped. */
let failures = 0
/** Goes up on every change, so a background refresh that raced with one is thrown away. */
let revision = 0

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error.')

function save(before: AppData, after: AppData, given?: Changes) {
  const { account } = useStore.getState()
  if (account.status !== 'ready') return
  const changes = given ?? diffData(before, after)
  if (!changes) return
  const firmId = account.firmId
  const queuedAt = failures
  pendingWrites++
  writes = writes
    .then(async () => {
      if (queuedAt !== failures) return
      try {
        await applyChanges(firmId, changes)
      } catch (error) {
        failures++
        revision++
        // Undo this change and everything made on top of it, then check against the database.
        useStore.setState({ data: before })
        notify(`Your last change was undone. ${reasonOf(error)}`)
        void useStore.getState().reload(true)
      }
    })
    .finally(() => {
      pendingWrites--
    })
}

/** Inside a batch, several actions are saved as one transaction. */
let batchDepth = 0
let batchBefore: AppData | undefined

// ── Store ───────────────────────────────────────────────────────────────────

export const useStore = create<State & Actions>()((set, get) => {
  /**
   * Every action goes through here: take the data, return the new data.
   * `asStudent` describes the same change as one of the three writes a
   * student link may make; actions without it do nothing on a student link.
   */
  const change = (fn: (data: AppData) => AppData, asStudent?: StudentWrite) => {
    const state = get()
    const before = state.data
    if (state.mode === 'student_link') {
      if (!asStudent || !state.linkToken) return
      set({ data: fn(before) })
      studentLinkWrite(state.linkToken, asStudent)
        .then((data) => set({ data }))
        .catch((error) => {
          set({ data: before })
          notify(`That was not saved. ${reasonOf(error)}`)
        })
      return
    }
    const after = fn(before)
    if (after === before) return
    revision++
    set({ data: after })
    if (batchDepth === 0) save(before, after)
  }

  const batch = (work: () => void) => {
    if (batchDepth++ === 0) batchBefore = get().data
    try {
      work()
    } finally {
      if (--batchDepth === 0) {
        save(batchBefore!, get().data)
        batchBefore = undefined
      }
    }
  }

  /** Replaces or extends the firm's data in one transaction. */
  const install = (add: AppData | undefined, clear: boolean) => {
    const before = get().data
    const base = clear ? emptyData(before.firm) : before
    const after = add ? merged(base, add) : base
    const changes: Changes = (add && diffData(emptyData(before.firm), merged(emptyData(before.firm), add))) || { upsert: {}, delete: {} }
    changes.clear = clear
    revision++
    set((s) => ({ data: after, studentLinks: clear ? [] : s.studentLinks }))
    save(before, after, changes)
  }

  const sample = () => withFreshIds(buildSeed())

  const legacyData = (): AppData | undefined => {
    try {
      const saved = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? 'null') as { state?: { schema?: unknown; data?: unknown } } | null
      const data = migrate(saved?.state?.schema, saved?.state?.data)
      return data && data.students.length > 0 ? data : undefined
    } catch {
      return undefined
    }
  }
  const forgetLegacyData = () => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      // Storage unavailable: nothing to remove.
    }
  }

  return {
    account: { status: 'loading' },
    load: 'idle',
    mode: 'firm',
    data: emptyData(NO_FIRM),
    studentLinks: [],

    reload: async (quiet = false) => {
      const { account } = get()
      if (account.status !== 'ready') return
      if (quiet && pendingWrites > 0) return
      if (!quiet) set({ load: 'loading', loadError: undefined })
      const startedAt = revision
      try {
        const [data, studentLinks] = await Promise.all([loadAll(account.firmId, account.userId), listStudentLinks(account.firmId)])
        // A change made while this was loading is newer than what came back.
        if (quiet && (startedAt !== revision || pendingWrites > 0)) return
        if (get().account.status !== 'ready' || get().mode !== 'firm') return
        set({ data, studentLinks, load: 'ready', loadError: undefined })
      } catch (error) {
        if (!quiet) set({ load: 'error', loadError: reasonOf(error) })
      }
    },

    loadSample: () => install(sample(), false),
    resetDemo: () => install(sample(), true),
    startEmpty: () => install(undefined, true),

    hasLegacyData: () => legacyData() !== undefined,
    importLegacyData: () => {
      const saved = legacyData()
      if (!saved) return false
      install(withFreshIds(saved), false)
      forgetLegacyData()
      return true
    },
    dismissLegacyData: forgetLegacyData,

    createStudentLink: async (studentId) => {
      const { account } = get()
      if (account.status !== 'ready') throw new Error('Sign in first.')
      const { link, token } = await createStudentLink(account.firmId, studentId, account.userId)
      set((s) => ({ studentLinks: [link, ...s.studentLinks] }))
      return token
    },
    revokeStudentLink: async (linkId) => {
      await revokeStudentLink(linkId)
      set((s) => ({ studentLinks: s.studentLinks.filter((l) => l.id !== linkId) }))
    },

    updateFirm: (firm) =>
      change((data) => {
        const next = { ...data.firm, ...firm }
        return { ...data, firm: { ...next, counselorFirstName: firstNameOf(next.counselorName) } }
      }),

    // ── Students and families ──
    addStudent: (student) => {
      const id = newId()
      change((data) => ({
        ...data,
        students: [
          ...data.students,
          {
            tests: { aps: [] },
            majors: [],
            interests: [],
            activities: [],
            counselorNotes: '',
            parents: [],
            reportSettings: { schedule: 'after_meetings', recipientIds: [] },
            preferredChannel: 'text',
            ...student,
            id,
            onboardedOn: todayISO(),
          },
        ],
      }))
      return id
    },

    updateStudent: (id, fields, actor = 'counselor', summary) =>
      change((data) => {
        const next = patchStudent(data, id, (s) => ({ ...s, ...fields }))
        if (!summary) return next
        return logActivity(next, id, actor, `${actorName(data, id, actor)} updated the profile: ${summary}`)
      }),

    archiveStudent: (id, archived = true) => change((data) => patchStudent(data, id, (s) => ({ ...s, archived }))),

    addParent: (studentId, parent) =>
      change((data) =>
        patchStudent(data, studentId, (s) => {
          const id = newId()
          // The first parent added is the main contact.
          const isPrimary = Boolean(parent.isPrimary) || s.parents.length === 0
          const parents = [...s.parents.map((p) => (isPrimary ? { ...p, isPrimary: false } : p)), { ...parent, id, isPrimary }]
          return { ...s, parents, reportSettings: { ...s.reportSettings, recipientIds: [...s.reportSettings.recipientIds, id] } }
        }),
      ),

    updateParent: (studentId, parentId, fields) =>
      change((data) =>
        patchStudent(data, studentId, (s) => ({
          ...s,
          // Only one parent is the main contact.
          parents: s.parents.map((p) => (p.id === parentId ? { ...p, ...fields } : fields.isPrimary ? { ...p, isPrimary: false } : p)),
        })),
      ),

    removeParent: (studentId, parentId) =>
      change((data) => {
        const next = patchStudent(data, studentId, (s) => {
          const parents = s.parents.filter((p) => p.id !== parentId)
          if (parents.length && !parents.some((p) => p.isPrimary)) parents[0] = { ...parents[0], isPrimary: true }
          return { ...s, parents, reportSettings: { ...s.reportSettings, recipientIds: s.reportSettings.recipientIds.filter((x) => x !== parentId) } }
        })
        // Their open tasks go to the counselor to reassign; nothing is silently lost.
        return {
          ...next,
          tasks: next.tasks.map((t) => (t.ownerParentId === parentId && t.status !== 'done' ? { ...t, owner: 'counselor' as const, ownerParentId: undefined } : t)),
        }
      }),

    // ── Tasks ──
    addTask: (task) =>
      change((data) => ({
        ...data,
        tasks: [...data.tasks, { category: 'planning', ...task, id: newId(), source: 'counselor', status: 'todo', createdOn: todayISO(), attachments: [] }],
      })),

    updateTask: (id, patch) => change((data) => ({ ...data, tasks: patchById(data.tasks, id, (t) => ({ ...t, ...patch })) })),

    updateTaskProgress: (id, patch, actor) =>
      change((data) => {
        const before = data.tasks.find((t) => t.id === id)
        if (!before) return data
        const status = patch.status ?? before.status
        const done = status === 'done'
        const after: Task = {
          ...before,
          ...patch,
          status,
          completedOn: done ? (before.completedOn ?? todayISO()) : undefined,
          completedBy: done ? (before.completedBy ?? actor) : undefined,
        }
        const who = actorName(data, before.studentId, actor)
        let text = `${who} updated “${before.title}”`
        if (status !== before.status) {
          text = done ? `${who} marked “${before.title}” done` : status === 'in_progress' ? `${who} started “${before.title}”` : `${who} reopened “${before.title}”`
        } else if (patch.progressNote) {
          text += `: ${patch.progressNote}`
        }
        return logActivity({ ...data, tasks: patchById(data.tasks, id, () => after) }, before.studentId, actor, text)
      }, { action: 'progress', taskId: id, status: patch.status, progressNote: patch.progressNote, today: todayISO() }),

    attachToTask: (id, attachment, actor) =>
      change((data) => {
        const task = data.tasks.find((t) => t.id === id)
        if (!task) return data
        const today = todayISO()
        const tasks = patchById(data.tasks, id, (t) => ({
          ...t,
          status: t.status === 'todo' ? ('in_progress' as const) : t.status,
          attachments: [...t.attachments, { ...attachment, id: newId(), addedOn: today, addedBy: actor }],
        }))
        // Filed under the category the task asked for, or by the kind of task.
        const document: StudentDocument = {
          id: newId(),
          studentId: task.studentId,
          name: attachment.name,
          kind: 'other',
          category: task.expectsDocument ?? (task.category === 'financial' ? 'financial' : task.category === 'testing' ? 'testing' : task.category === 'recommendation' ? 'recommendation' : 'application'),
          addedOn: today,
          addedBy: actor,
          url: attachment.url,
          taskId: task.id,
        }
        const who = actorName(data, task.studentId, actor)
        return logActivity(
          { ...data, tasks, documents: [document, ...data.documents] },
          task.studentId,
          actor,
          `${who} ${attachment.kind === 'link' ? 'linked' : 'uploaded'} “${attachment.name}” on “${task.title}”`,
        )
      }, attachment.kind === 'link' && attachment.url ? { action: 'attach_link', taskId: id, name: attachment.name, url: attachment.url, today: todayISO() } : undefined),

    deleteTask: (id) => change((data) => ({ ...data, tasks: data.tasks.filter((t) => t.id !== id) })),

    // ── Colleges ──
    addCollege: (college) => change((data) => ({ ...data, colleges: [...data.colleges, { ...college, id: newId() }] })),
    updateCollege: (id, patch) => change((data) => ({ ...data, colleges: patchById(data.colleges, id, (c) => ({ ...c, ...patch })) })),
    removeCollege: (id) => change((data) => ({ ...data, colleges: data.colleges.filter((c) => c.id !== id) })),

    // ── Documents and essays ──
    addDocument: (doc) => {
      const id = newId()
      change((data) => ({
        ...data,
        documents: [{ category: CATEGORY_FOR_KIND[doc.kind], ...(doc.kind === 'essay' ? { essayGroup: 'college' as const, status: 'not_started' as EssayStatus, drafts: [] } : {}), ...doc, id, addedOn: todayISO() }, ...data.documents],
      }))
      return id
    },

    updateDocument: (docId, patch) => change((data) => ({ ...data, documents: patchById(data.documents, docId, (d) => ({ ...d, ...patch })) })),

    removeDocument: (docId) => change((data) => ({ ...data, documents: data.documents.filter((d) => d.id !== docId) })),

    saveEssayDraft: (docId, text, asNew) =>
      change((data) => ({
        ...data,
        documents: patchById(data.documents, docId, (d) => {
          const drafts = d.drafts ?? []
          const today = todayISO()
          const next =
            asNew || drafts.length === 0
              ? [...drafts, { n: (drafts.at(-1)?.n ?? 0) + 1, text, savedOn: today }]
              : [...drafts.slice(0, -1), { ...drafts.at(-1)!, text, savedOn: today }]
          // A new draft arriving means it is the counselor's turn.
          const status: EssayStatus = d.status === 'not_started' || d.status === 'waiting_on_student' || (asNew && d.status === 'revising') ? 'needs_feedback' : (d.status ?? 'drafting')
          return { ...d, drafts: next, status }
        }),
      })),

    setEssayFeedback: (docId, feedback) => change((data) => ({ ...data, documents: patchById(data.documents, docId, (d) => ({ ...d, feedback })) })),

    updateEssayFeedback: (docId, patch) =>
      change((data) => ({
        ...data,
        documents: patchById(data.documents, docId, (d) => (d.feedback ? { ...d, feedback: { ...d.feedback, ...patch } } : d)),
      })),

    reviewEssayFeedback: (docId, decision) =>
      change((data) => {
        const doc = data.documents.find((d) => d.id === docId)
        const student = data.students.find((s) => s.id === doc?.studentId)
        if (!doc?.feedback || !student || doc.feedback.review !== 'pending') return data
        let next: AppData = {
          ...data,
          documents: patchById(data.documents, docId, (d) => ({
            ...d,
            status: decision === 'approved' ? 'revising' : d.status,
            feedback: { ...d.feedback!, review: decision, approval: stamp(data, decision) },
          })),
        }
        if (decision === 'approved') {
          next = deliver(next, {
            ...toStudent(student),
            kind: 'essay_feedback',
            body: `Hi ${student.firstName}, ${data.firm.counselorFirstName} shared feedback on “${doc.name}”. Open Platinum to read it.`,
            trigger: 'approved',
          })
          next = logActivity(next, student.id, 'counselor', `${data.firm.counselorFirstName} shared essay feedback on “${doc.name}”`)
        }
        return next
      }),

    // ── Meetings ──
    addMeeting: (meeting) => {
      const id = newId()
      change((data) => ({ ...data, meetings: [...data.meetings, { durationMin: 45, ...meeting, id, status: 'scheduled' }] }))
      return id
    },

    updateMeeting: (id, patch) => change((data) => patchMeeting(data, id, (m) => ({ ...m, ...patch }))),

    completeMeeting: (id, notes, heldOn) =>
      change((data) => {
        const meeting = data.meetings.find((m) => m.id === id)
        if (!meeting) return data
        const next = patchMeeting(data, id, (m) => ({ ...m, status: 'completed', date: heldOn ?? (m.date > todayISO() ? todayISO() : m.date), transcript: notes.trim() || m.transcript }))
        return logActivity(next, meeting.studentId, 'counselor', `${data.firm.counselorFirstName} logged the meeting “${meeting.title}”`)
      }),

    deleteMeeting: (id) => change((data) => ({ ...data, meetings: data.meetings.filter((m) => m.id !== id) })),

    setMeetingBrief: (id, brief) => change((data) => patchMeeting(data, id, (m) => ({ ...m, brief, agenda: m.agenda ?? brief.agenda.map((a) => a.topic) }))),

    // ── Meeting drafts and their review ──
    setMeetingDrafts: (meetingId, drafts) =>
      change((data) => {
        const meeting = data.meetings.find((m) => m.id === meetingId)
        if (!meeting) return data
        const next = patchMeeting(data, meetingId, (m) => ({ ...m, ai: drafts.ai, recap: drafts.recap }))
        return logActivity(next, meeting.studentId, 'ai', `Drafts from “${meeting.title}” are ready for review`)
      }),

    reviewNotes: (meetingId, decision) =>
      change((data) =>
        patchMeeting(data, meetingId, (m) =>
          m.ai && m.ai.notesReview === 'pending' ? { ...m, ai: { ...m.ai, notesReview: decision, notesApproval: stamp(data, decision) } } : m,
        ),
      ),

    updateDraftTask: (meetingId, draftId, patch) =>
      change((data) =>
        patchMeeting(data, meetingId, (m) => (m.ai ? { ...m, ai: { ...m.ai, draftTasks: patchById(m.ai.draftTasks, draftId, (t) => ({ ...t, ...patch })) } } : m)),
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

    updateRecap: (meetingId, patch) => change((data) => patchMeeting(data, meetingId, (m) => (m.recap ? { ...m, recap: { ...m.recap, ...patch } } : m))),

    reviewRecap: (meetingId, decision) =>
      change((data) => {
        const meeting = data.meetings.find((m) => m.id === meetingId)
        const student = data.students.find((s) => s.id === meeting?.studentId)
        if (!meeting?.recap || !student || meeting.recap.review !== 'pending') return data
        let next = patchMeeting(data, meetingId, (m) => ({ ...m, recap: { ...m.recap!, review: decision, approval: stamp(data, decision) } }))
        if (decision === 'approved') {
          next = deliver(next, {
            ...toStudent(student),
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
            id: newId(),
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
          ai: { ...m.ai!, profileChanges: patchById(m.ai!.profileChanges, changeId, (c) => ({ ...c, review: decision, approval: stamp(data, decision) })) },
        }))
        if (decision === 'approved') {
          next = patchStudent(next, meeting.studentId, (s) => applyProfilePatch(s, item.patch))
          next = logActivity(next, meeting.studentId, 'counselor', `Profile updated: ${item.label} → ${item.to}`)
        }
        return next
      }),

    approveAllInMeeting: (meetingId) => {
      const meeting = get().data.meetings.find((m) => m.id === meetingId)
      if (!meeting) return
      const a = get()
      // One transaction: the new tasks, profile changes, reports and log entries land together or not at all.
      batch(() => {
        a.reviewNotes(meetingId, 'approved')
        meeting.ai?.draftTasks.forEach((t) => a.reviewDraftTask(meetingId, t.id, 'approved'))
        meeting.ai?.profileChanges.forEach((c) => a.reviewProfileChange(meetingId, c.id, 'approved'))
        meeting.ai?.parentUpdates.forEach((u) => a.reviewParentUpdate(meetingId, u.id, 'approved'))
        a.reviewRecap(meetingId, 'approved')
      })
    },

    // ── Parent reports ──
    addReportDraft: (report) =>
      change((data) => ({ ...data, reports: [{ ...report, id: newId(), createdOn: todayISO(), status: 'draft' }, ...data.reports] })),

    updateReport: (id, patch) => change((data) => ({ ...data, reports: patchById(data.reports, id, (r) => ({ ...r, ...patch })) })),

    approveReport: (id) =>
      change((data) => {
        const report = data.reports.find((r) => r.id === id)
        const student = data.students.find((s) => s.id === report?.studentId)
        const parent = student?.parents.find((p) => p.id === report?.parentId)
        if (!report || !student || !parent || report.status !== 'draft') return data
        let next: AppData = { ...data, reports: patchById(data.reports, id, (r) => ({ ...r, status: 'sent', sentOn: todayISO(), approval: approvalBy(data) })) }
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

    // ── Messages ──
    updateRule: (id, patch) => change((data) => ({ ...data, reminderRules: data.reminderRules.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),

    sendMessage: (message) => change((data) => deliver(data, message)),
  }
})

/** An empty dataset, for when nobody is signed in. */
export const emptyAppData = () => emptyData(NO_FIRM)

/** The whole dataset. Screens call this, then use lib/derive.ts for anything computed. */
export const useData = () => useStore((s) => s.data)
