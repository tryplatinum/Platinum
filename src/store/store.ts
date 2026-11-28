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
import { applyProposal } from '../lib/proposals'
import { ACTIVITY_LIMIT, applyChanges, cancelMessage, createStudentLink, decideAgentProposal, diffData, firstNameOf, listStudentLinks, loadAll, logMeetingDraftsReady, queueMessage, revokeStudentLink, rotateStudentLink, skipReminder as writeSkip, undoReminderSkip, updateAgentProposalPayload, type Changes } from '../data/repo'
import { buildSeed, DEFAULT_REMINDER_RULES } from '../data/seed'
import { notify, notifyQueued, notifySkipUndo } from '../lib/notify'
import { UNDO_SECONDS, validateQueuePayload } from '../../shared/outbox'
import { studentLinkWrite, type StudentWrite } from '../services/studentLink'
import { addDays, nowTimestamp, todayISO, type ISODate } from '../lib/dates'
import { fullName } from '../lib/derive'
import type { MeetingDrafts } from '../services/ai'
import type { OutgoingMessage } from '../services/outbox'
import type {
  ActivityEvent,
  Actor,
  AppData,
  Approval,
  CollegeApp,
  DraftParentUpdate,
  DraftPersonalNote,
  DraftTask,
  EssayFeedback,
  EssayStatus,
  Firm,
  ID,
  Meeting,
  NoteUse,
  OutboxMessage,
  Parent,
  ParentCopy,
  ParentReport,
  MeetingAI,
  ProfilePatch,
  Recap,
  ReminderRule,
  SavedBrief,
  Student,
  StudentDocument,
  StudentLink,
  Task,
  TaskStatus,
  UsedNote,
  WeeklyText,
} from '../types'
import { CATEGORY_FOR_KIND, migrate } from './migrate'
import { clearStoredFiles, fileActions, type FileActions } from './files'
import { listDraftActions, type ListDraftActions } from './listDrafts'
import { templateActions, type TemplateActions } from './templates'

/** Where versions before accounts kept everything. Read once, to offer an import. */
const LEGACY_STORAGE_KEY = 'platinum-v0'

export type Decision = 'approved' | 'dismissed'

/** The message was queued, but recording the approval failed. `messageId` is what to offer Undo for. */
export class ProposalNotDecided extends Error {
  readonly messageId: ID
  constructor(messageId: ID, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Could not record the approval.', { cause })
    this.messageId = messageId
  }
}

export type NewStudent = Pick<Student, 'firstName' | 'lastName' | 'gradYear' | 'school' | 'city'> &
  Partial<Pick<Student, 'localName' | 'email' | 'phone' | 'preferredChannel'>>

export type StudentFields = Partial<Omit<Student, 'id' | 'parents' | 'onboardedOn'>>

export type NewTask = Pick<Task, 'studentId' | 'title' | 'owner' | 'dueDate'> &
  Partial<Pick<Task, 'detail' | 'category' | 'ownerParentId' | 'expectsDocument'>>

export type NewMeeting = Pick<Meeting, 'studentId' | 'title' | 'date' | 'time'> & Partial<Pick<Meeting, 'durationMin' | 'location' | 'googleEventId' | 'googleSync'>>

export type NewDocument = Pick<StudentDocument, 'studentId' | 'name' | 'kind' | 'addedBy'> &
  Partial<Omit<StudentDocument, 'id' | 'addedOn' | 'studentId' | 'name' | 'kind' | 'addedBy'>>

/** Who is using the app. Set by store/session.ts from the Supabase session. */
export type Account =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'error'; message: string }
  /** Signed in, and neither a member of a firm nor a student. */
  | { status: 'needs_firm'; userId: ID; email: string }
  /** A student's own sign-in. `data` is their page, as for a student link. `off`: a counselor turned the sign-in off. */
  | { status: 'student'; userId: ID; email: string; off?: boolean }
  | { status: 'ready'; userId: ID; email: string; firmId: ID; role: 'owner' | 'counselor' }

interface State {
  account: Account
  /** Whether `data` holds the firm's rows yet. */
  load: 'idle' | 'loading' | 'ready' | 'error'
  loadError?: string
  /**
   * 'firm': a signed-in counselor; changes are written to the database.
   * 'student_link': a student on their secret link, or signed in with a student
   * account (then there is no linkToken); `data` is the small slice
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
  /** Resolves true once the caseload is replaced, false when it was refused or failed (nothing changed, and the person was told why). */
  resetDemo: () => Promise<boolean>
  /** Deletes the firm's data, for a counselor entering their own students. */
  /** As resetDemo: true once the caseload is cleared, false when nothing was changed. */
  startEmpty: () => Promise<boolean>
  /** True when this browser still holds data saved by a version before accounts. */
  hasLegacyData: () => boolean
  /** Copies that saved data into the firm, then removes it from the browser. */
  importLegacyData: () => boolean
  dismissLegacyData: () => void
  /** Makes a secret link for a student and returns its token. The token cannot be read again later. */
  createStudentLink: (studentId: ID) => Promise<string>
  /** Replaces a link's secret. The previous token stops working. Returns the new token once. */
  rotateStudentLink: (linkId: ID) => Promise<string>
  revokeStudentLink: (linkId: ID) => Promise<void>
  /** Undoes a queued message during its 10-second window. */
  cancelQueued: (id: ID) => Promise<void>
  updateFirm: (firm: Partial<Pick<Firm, 'name' | 'counselorName' | 'weeklyTextDay' | 'sortFilesAutomatically'>>) => void
  /**
   * Takes in rows the server has already saved (a file it sorted, a draft list it made):
   * memory changes, nothing is written back. Never use it for a change the person made.
   */
  absorb: (fn: (data: AppData) => AppData) => void

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
  /** What a meeting remembers about its Google Calendar event. Set after Google has answered; `undefined` clears a field. */
  setMeetingCalendar: (id: ID, patch: Pick<Meeting, 'googleEventId' | 'googleSync'> | Pick<Meeting, 'googleSync'>) => void
  /** Resolves once every change made so far has been written, or has failed and been undone. */
  whenSaved: () => Promise<void>
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
  /** Edits the proposed value on a pending profile change (patch + display `to`). */
  updateProfileChange: (meetingId: ID, changeId: ID, next: { to: string; patch: ProfilePatch }) => void
  /** Edits the meeting-notes lists before notes are approved. */
  updateMeetingNotes: (meetingId: ID, patch: Partial<Pick<MeetingAI, 'decided' | 'progress' | 'watch' | 'notes'>>) => void
  updateDraftNote: (meetingId: ID, noteId: ID, patch: Partial<Pick<DraftPersonalNote, 'text' | 'eventDate' | 'eventDateApprox'>>) => void
  /** Approving saves the detail as a "thing to remember" for this student. Dismissing saves nothing. */
  reviewDraftNote: (meetingId: ID, noteId: ID, decision: Decision) => void
  approveAllInMeeting: (meetingId: ID) => void
  /** Skip a reminder: 'once' until tomorrow, 'until_on' until undo. */
  skipReminder: (dedupeKey: string, mode: 'once' | 'until_on', studentId: ID, taskTitle: string) => Promise<void>
  undoSkipReminder: (skipId: ID) => Promise<void>
  /** Inline edit of a pending assistant proposal payload. */
  updateAgentProposal: (id: ID, payload: Record<string, unknown>) => void
  /**
   * Approve a pending assistant proposal (queues/sends via existing paths).
   * Resolves to the id of the message it queued, or undefined when it queued none.
   * Rejects with ProposalNotDecided when a message was queued but the decision was not saved.
   */
  approveAgentProposal: (id: ID) => Promise<ID | undefined>
  discardAgentProposal: (id: ID) => Promise<void>

  // Things to remember
  /** A note the counselor types in. Writing it is the approval. */
  addPersonalNote: (studentId: ID, text: string, eventDate?: string) => void
  deletePersonalNote: (id: ID) => void

  // Parent reports
  addReportDraft: (report: Omit<ParentReport, 'id' | 'createdOn' | 'status'>) => void
  updateReport: (id: ID, patch: Partial<Pick<ParentReport, 'subject' | 'bodyEn' | 'bodyLocal'>>) => void
  /** The counselor's approval. Marks the report sent and writes it to the log. */
  approveReport: (id: ID) => void
  discardReport: (id: ID) => void

  // Messages
  updateRule: (id: ReminderRule['id'], patch: Partial<Pick<ReminderRule, 'mode' | 'days'>>) => void
  // Weekly texts
  /** Stores this week's draft for a student, replacing an earlier draft. Nothing is sent. */
  setWeeklyDraft: (studentId: ID, weekStart: string, draft: Pick<WeeklyText, 'body' | 'facts' | 'source' | 'usedNote' | 'lead'>) => void
  updateWeeklyText: (id: ID, body: string) => void
  /**
   * The counselor pressed Copy or Open in Messages, which is their approval:
   * records who and when, logs the text, and marks this week's text sent.
   */
  sendWeeklyText: (id: ID, via: 'copy' | 'sms') => void
  skipWeeklyText: (studentId: ID, weekStart: string) => void
  /** Puts a skipped student back on this week's list. */
  unskipWeeklyText: (id: ID) => void
  /** Stores (or with `undefined`, removes) the draft of the separate message to the parent. A copy already sent stays. */
  setWeeklyParentCopy: (studentId: ID, weekStart: string, copy: Omit<ParentCopy, 'status' | 'approval'> | undefined) => void
  updateWeeklyParentCopy: (id: ID, patch: Partial<Pick<ParentCopy, 'body' | 'bodyEn'>>) => void
  /** The counselor's approval of the parent copy, on its own: records who and when, and logs it. */
  sendWeeklyParentCopy: (id: ID) => void

  /**
   * Queues one message. The database records the approval and holds it for 60
   * seconds. `usedNote` is the thing to remember the message mentioned, if any.
   * Returns the id of the queued message.
   */
  sendMessage: (message: OutgoingMessage, usedNote?: UsedNote) => ID
}

/** Stored files and folders: see store/files.ts. Their rows are changed through the server and taken in with `absorb`. */
// Declaration merge: these add FileActions and ListDraftActions onto Actions.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Actions extends FileActions {}

/** Draft college lists: see store/listDrafts.ts. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Actions extends ListDraftActions {}

/** Templates and the drafts a message template makes: see store/templates.ts. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Actions extends TemplateActions {}

// ── Pure helpers on AppData ─────────────────────────────────────────────────

/** Row ids are uuids, made here so a new row can be shown before the database confirms it. */
const newId = () => crypto.randomUUID()

function patchById<T extends { id: ID }>(list: T[], id: ID, fn: (item: T) => T): T[] {
  return list.map((item) => (item.id === id ? fn(item) : item))
}

/** The signed-in person, recorded on the counselor lines they write. */
function signedInUser(): ID | undefined {
  const { account } = useStore.getState()
  return account.status === 'ready' ? account.userId : undefined
}

/**
 * Adds a line to the activity log in memory. Only counselor lines are saved by
 * save(); any other actor is written by the database or the server.
 */
function logActivity(data: AppData, studentId: ID, actor: Actor, text: string): AppData {
  const entry: ActivityEvent = { id: newId(), at: nowTimestamp(), studentId, actor, text, ...(actor === 'counselor' ? { actorUser: signedInUser() } : {}) }
  return { ...data, activity: [entry, ...data.activity].slice(0, ACTIVITY_LIMIT) }
}

/** Adds a queued message in memory. save() asks the database to record the approval. */
function deliver(data: AppData, message: OutgoingMessage, id: ID = newId()): AppData {
  const approval = message.approval ?? approvalBy(data)
  const now = new Date()
  const row: OutboxMessage = {
    ...message,
    approval,
    id,
    sentAt: now.toISOString(),
    status: 'queued',
    sendAfter: new Date(now.getTime() + UNDO_SECONDS * 1000).toISOString(),
    approvedBy: approval.byId,
    approvedAt: now.toISOString(),
  }
  return { ...data, outbox: [row, ...data.outbox] }
}

/**
 * Records that a sent message mentioned a note, so the same thing is not said
 * twice. It goes by what the draft said it used: if the counselor cut the
 * personal line by hand before sending, the note still counts as mentioned.
 */
function markNoteUsed(data: AppData, used: UsedNote | undefined, via: NoteUse['in']): AppData {
  if (!used?.stage || !data.personalNotes.some((n) => n.id === used.id)) return data
  const use: NoteUse = { at: nowTimestamp(), stage: used.stage, in: via }
  return { ...data, personalNotes: patchById(data.personalNotes, used.id, (n) => ({ ...n, uses: [...n.uses, use] })) }
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
    weeklyTexts: [],
    personalNotes: [],
    documentTypes: [],
    collegeListDrafts: [],
    collegeListDraftItems: [],
    reminderSkips: [],
    agentProposals: [],
    templates: [],
    messageDrafts: [],
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
    weeklyTexts: [...base.weeklyTexts, ...add.weeklyTexts],
    templates: [...(base.templates ?? []), ...(add.templates ?? [])],
    personalNotes: [...base.personalNotes, ...add.personalNotes],
  }
}

/** Why the caseload was not cleared. A refusal over owner-only files already says nothing was changed. */
const notCleared = (error: unknown) => (/Nothing was changed\.$/.test(reasonOf(error)) ? reasonOf(error) : `Nothing was changed: the stored files could not be removed. ${reasonOf(error)}`)

const NO_FIRM: Firm = { name: '', weeklyTextDay: 0, sortFilesAutomatically: true, counselorName: '', counselorFirstName: '' }

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
  const fresh = after.outbox.filter((m) => m.status === 'queued' && !before.outbox.some((o) => o.id === m.id))
  if (!changes && fresh.length === 0) return
  const firmId = account.firmId
  const counselorName = after.firm.counselorName
  const queuedAt = failures
  pendingWrites++
  writes = writes
    .then(async () => {
      if (queuedAt !== failures) return
      const queued: Awaited<ReturnType<typeof queueMessage>>[] = []
      try {
        for (const message of fresh) {
          const payload = validateQueuePayload({
            id: message.id,
            studentId: message.studentId,
            toKind: message.toKind,
            toName: message.toName,
            parentId: message.parentId,
            channel: message.channel,
            language: message.language,
            kind: message.kind,
            body: message.body,
            bodyEn: message.bodyEn,
            trigger: message.trigger,
            taskId: message.taskId,
            note: message.note,
            dedupeKey: message.dedupeKey,
            approvedBy: message.approval?.by ?? counselorName,
          })
          if (!payload.ok) throw new Error(payload.message)
          queued.push(await queueMessage(payload.value))
        }
        if (changes) await applyChanges(firmId, changes)
        if (queued.length > 0) {
          const byId = new Map(queued.map((q) => [q.message.id, q.message]))
          useStore.setState((s) => ({
            data: {
              ...s.data,
              outbox: s.data.outbox.map((m) => byId.get(m.id) ?? m),
              activity: [...queued.map((q) => q.activity).reverse(), ...s.data.activity].slice(0, ACTIVITY_LIMIT),
            },
          }))
          for (const q of queued) notifyQueued(q.message.id, q.message.sendAfter)
        }
      } catch (error) {
        for (const q of queued) {
          try {
            await cancelMessage(q.message.id)
          } catch {
            // The row may already be gone. The reload below is the source of truth.
          }
        }
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

/** Runs after every write queued so far, so the rows it relies on are already saved. */
function afterWrites(work: () => Promise<unknown>, doing: string) {
  if (useStore.getState().account.status !== 'ready') return
  pendingWrites++
  writes = writes
    .then(work)
    .then(
      () => undefined,
      (error) => notify(`${doing} ${reasonOf(error)}`),
    )
    .finally(() => {
      pendingWrites--
    })
}

// Leaving or reloading the page cancels a save that is still on its way, so the
// browser asks first. Saves take well under a second; this only shows in that window.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (pendingWrites > 0) event.preventDefault()
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
      // A link's token, or a signed-in student's session. Anything else on this page changes nothing.
      if (!asStudent || !(state.linkToken || state.account.status === 'student')) return
      set({ data: fn(before) })
      // The answer is kept only if the same student, by the same way in, is still the one on screen.
      const who = 'userId' in state.account ? state.account.userId : undefined
      const still = () => get().mode === 'student_link' && get().linkToken === state.linkToken && ('userId' in get().account ? (get().account as { userId: ID }).userId : undefined) === who
      studentLinkWrite(state.linkToken, asStudent)
        .then((data) => still() && set({ data }))
        .catch((error) => {
          if (!still()) return
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
    // Clearing removes the caseload. The firm's folders are settings and stay.
    // Sample history is not written into the outbox. New messages are queued on approval.
    const base = clear ? { ...emptyData(before.firm), documentTypes: before.documentTypes } : before
    // Only the sample's counselor lines are saved, as the person loading it. The
    // student, parent, AI and system lines stay in memory until the next reload.
    const userId = signedInUser()
    const added = add ? { ...add, outbox: [], activity: add.activity.map((e) => (e.actor === 'counselor' ? { ...e, actorUser: userId } : e)) } : undefined
    const after = added ? { ...merged(base, added), outbox: base.outbox } : base
    const changes: Changes = (added && diffData(emptyData(before.firm), merged(emptyData(before.firm), added))) || { upsert: {}, delete: {} }
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
      // Saved before weekly texts and things to remember existed.
      return data && data.students.length > 0 ? { ...data, templates: data.templates ?? [], messageDrafts: data.messageDrafts ?? [], weeklyTexts: data.weeklyTexts ?? [], personalNotes: (data.personalNotes ?? []).map((n) => ({ ...n, uses: n.uses ?? [] })) } : undefined
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
        // Files still being sorted when this loaded: bring them up to date, and let the server finish any it was cut off on.
        void get().refreshFiles()
      } catch (error) {
        if (!quiet) set({ load: 'error', loadError: reasonOf(error) })
      }
    },

    // The sample's invented PDFs are uploaded once its students are saved. Clearing the
    // caseload first removes every stored file through the server (objects, then rows):
    // apply_changes removes rows only and would leave the objects behind.
    loadSample: () => {
      const data = sample()
      install(data, false)
      void writes.then(() => get().addSampleFiles(data.students))
    },
    resetDemo: () =>
      clearStoredFiles(get()).then(
        () => {
          const data = sample()
          install(data, true)
          void writes.then(() => get().addSampleFiles(data.students))
          return true
        },
        (error) => {
          notify(notCleared(error))
          return false
        },
      ),
    startEmpty: () =>
      clearStoredFiles(get()).then(
        () => {
          install(undefined, true)
          return true
        },
        (error) => {
          notify(notCleared(error))
          return false
        },
      ),

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
    rotateStudentLink: async (linkId) => {
      const { link, token } = await rotateStudentLink(linkId)
      set((s) => ({ studentLinks: s.studentLinks.map((l) => (l.id === linkId ? link : l)) }))
      return token
    },
    cancelQueued: async (id) => {
      const result = await cancelMessage(id)
      set((s) => ({
        data: {
          ...s.data,
          outbox: s.data.outbox.map((m) => (m.id === id ? result.message : m)),
          activity: [result.activity, ...s.data.activity].slice(0, ACTIVITY_LIMIT),
        },
      }))
    },
    revokeStudentLink: async (linkId) => {
      await revokeStudentLink(linkId)
      set((s) => ({ studentLinks: s.studentLinks.filter((l) => l.id !== linkId) }))
    },

    absorb: (fn) => {
      const before = get().data
      const after = fn(before)
      if (after === before || get().mode === 'student_link') return
      revision++
      set({ data: after })
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

    removeDocument: (docId) => {
      // A stored file goes through the server, which removes the object and the row together.
      if (get().data.documents.find((d) => d.id === docId)?.storagePath) {
        get().deleteFile(docId).catch((error) => notify(`That file was not deleted. ${reasonOf(error)}`))
        return
      }
      change((data) => ({ ...data, documents: data.documents.filter((d) => d.id !== docId) }))
    },

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

    setMeetingCalendar: (id, patch) => change((data) => (data.meetings.some((m) => m.id === id) ? patchMeeting(data, id, (m) => ({ ...m, ...patch })) : data)),

    whenSaved: () => writes,

    completeMeeting: (id, notes, heldOn) =>
      change((data) => {
        const meeting = data.meetings.find((m) => m.id === id)
        if (!meeting) return data
        const next = patchMeeting(data, id, (m) => ({ ...m, status: 'completed', date: heldOn ?? (m.date > todayISO() ? todayISO() : m.date), transcript: notes.trim() || m.transcript }))
        return logActivity(next, meeting.studentId, 'counselor', `${data.firm.counselorFirstName} logged the meeting “${meeting.title}”`)
      }),

    deleteMeeting: (id) =>
      change((data) => ({
        ...data,
        meetings: data.meetings.filter((m) => m.id !== id),
        // Notes saved from the meeting stay; they just no longer point at it.
        personalNotes: data.personalNotes.map((n) => (n.meetingId === id ? { ...n, meetingId: undefined } : n)),
      })),

    setMeetingBrief: (id, brief) => change((data) => patchMeeting(data, id, (m) => ({ ...m, brief, agenda: m.agenda ?? brief.agenda.map((a) => a.topic) }))),

    // ── Meeting drafts and their review ──
    setMeetingDrafts: (meetingId, drafts) => {
      change((data) => {
        const meeting = data.meetings.find((m) => m.id === meetingId)
        if (!meeting) return data
        const next = patchMeeting(data, meetingId, (m) => ({ ...m, ai: drafts.ai, recap: drafts.recap }))
        return logActivity(next, meeting.studentId, 'ai', `Drafts from “${meeting.title}” are ready for review`)
      })
      // The line above is shown at once. The saved one is written by the database.
      if (get().data.meetings.some((m) => m.id === meetingId)) afterWrites(() => logMeetingDraftsReady(meetingId), 'The activity log was not updated.')
    },

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
          // Re-read after patch in case the counselor edited the proposed value.
          const edited = next.meetings.find((m) => m.id === meetingId)?.ai?.profileChanges.find((c) => c.id === changeId) ?? item
          next = patchStudent(next, meeting.studentId, (s) => applyProfilePatch(s, edited.patch))
          next = logActivity(next, meeting.studentId, 'counselor', `Profile updated: ${edited.label} → ${edited.to}`)
        }
        return next
      }),

    updateProfileChange: (meetingId, changeId, next) =>
      change((data) =>
        patchMeeting(data, meetingId, (m) =>
          m.ai
            ? {
                ...m,
                ai: {
                  ...m.ai,
                  profileChanges: patchById(m.ai.profileChanges, changeId, (c) => (c.review === 'pending' ? { ...c, to: next.to, patch: next.patch } : c)),
                },
              }
            : m,
        ),
      ),

    updateMeetingNotes: (meetingId, patch) =>
      change((data) =>
        patchMeeting(data, meetingId, (m) =>
          m.ai && m.ai.notesReview === 'pending' ? { ...m, ai: { ...m.ai, ...patch } } : m,
        ),
      ),

    skipReminder: async (dedupeKey, mode, studentId, taskTitle) => {
      const { account } = get()
      if (account.status !== 'ready') throw new Error('Sign in first.')
      const until: ISODate | null = mode === 'once' ? addDays(todayISO(), 1) : null
      const skip = await writeSkip(account.firmId, dedupeKey, account.userId, until)
      const text =
        mode === 'once'
          ? `Skipped reminder about “${taskTitle}” until ${until}.`
          : `Skipped reminder about “${taskTitle}” until turned back on.`
      change((d) => {
        let next = { ...d, reminderSkips: [skip, ...d.reminderSkips.filter((s) => s.dedupeKey !== dedupeKey)] }
        next = logActivity(next, studentId, 'counselor', text)
        return next
      })
      notifySkipUndo(skip.id, mode === 'once' ? 'Reminder skipped for now.' : 'Reminder skipped until you turn it back on.')
    },

    undoSkipReminder: async (skipId) => {
      await undoReminderSkip(skipId)
      set((s) => ({ data: { ...s.data, reminderSkips: s.data.reminderSkips.filter((x) => x.id !== skipId) } }))
    },

    updateAgentProposal: (id, payload) => {
      const before = get().data
      const row = before.agentProposals.find((p) => p.id === id && p.status === 'pending')
      if (!row) return
      const after = {
        ...before,
        agentProposals: before.agentProposals.map((p) => (p.id === id ? { ...p, payload } : p)),
      }
      set({ data: after })
      void updateAgentProposalPayload(id, payload).catch((error: unknown) => {
        set({ data: before })
        notify(error instanceof Error ? error.message : 'Could not update the proposal.')
      })
    },

    approveAgentProposal: async (id) => {
      const { account, data } = get()
      if (account.status !== 'ready') throw new Error('Sign in first.')
      const proposal = data.agentProposals.find((p) => p.id === id && p.status === 'pending')
      if (!proposal) return undefined
      // The meeting path keeps the calendar in step; it is loaded here because it uses this store.
      const { scheduleMeeting } = await import('../lib/meetings')
      // Every kind is carried out in one place (src/lib/proposals.ts), by the actions the screens already use.
      const { messageId } = applyProposal(proposal, data, {
        sendMessage: (message) => get().sendMessage(message),
        addTask: (task) => get().addTask(task),
        changeProfile: (studentId, patch, field) =>
          change((d) => logActivity(patchStudent(d, studentId, (s) => applyProfilePatch(s, patch)), studentId, 'counselor', `Approved profile change from the assistant: ${field}`)),
        noteMeetingTimes: (studentId, times) => change((d) => logActivity(d, studentId, 'counselor', `Recorded meeting times from the assistant: ${times.join(', ') || 'slots'}`)),
        scheduleMeeting,
        addTemplateTasks: (templateId, tasks) => get().addTemplateTasks(templateId, tasks),
        addMessageDrafts: (drafts) => get().addMessageDrafts(drafts),
        updateTask: (taskId, patch) => get().updateTask(taskId, patch),
        markTaskDone: (taskId) => get().updateTaskProgress(taskId, { status: 'done' }, 'counselor'),
        addCollege: (college) => get().addCollege(college),
      })

      try {
        await decideAgentProposal(id, 'approved')
      } catch (error) {
        throw messageId ? new ProposalNotDecided(messageId, error) : error
      }
      change((d) => {
        const next = {
          ...d,
          agentProposals: d.agentProposals.map((p) =>
            p.id === id ? { ...p, status: 'approved' as const, decidedBy: account.userId, decidedAt: nowTimestamp() } : p,
          ),
        }
        return logActivity(next, proposal.studentId, 'counselor', `Approved assistant draft (${proposal.kind})`)
      })
      return messageId
    },

    discardAgentProposal: async (id) => {
      const { account, data } = get()
      if (account.status !== 'ready') throw new Error('Sign in first.')
      const proposal = data.agentProposals.find((p) => p.id === id && p.status === 'pending')
      if (!proposal) return
      await decideAgentProposal(id, 'discarded')
      change((d) => {
        const next = {
          ...d,
          agentProposals: d.agentProposals.map((p) =>
            p.id === id ? { ...p, status: 'discarded' as const, decidedBy: account.userId, decidedAt: nowTimestamp() } : p,
          ),
        }
        return logActivity(next, proposal.studentId, 'counselor', `Discarded assistant draft (${proposal.kind})`)
      })
    },

    updateDraftNote: (meetingId, noteId, patch) =>
      change((data) =>
        patchMeeting(data, meetingId, (m) =>
          m.ai?.personalNotes ? { ...m, ai: { ...m.ai, personalNotes: patchById(m.ai.personalNotes, noteId, (n) => (n.review === 'pending' ? { ...n, ...patch } : n)) } } : m,
        ),
      ),

    reviewDraftNote: (meetingId, noteId, decision) =>
      change((data) => {
        const meeting = data.meetings.find((m) => m.id === meetingId)
        const draft = meeting?.ai?.personalNotes?.find((n) => n.id === noteId)
        if (!meeting || !draft || draft.review !== 'pending') return data
        const text = draft.text.trim()
        // Nothing to save: an emptied note can only be dismissed.
        if (decision === 'approved' && !text) return data
        const approval = approvalBy(data)
        let next = patchMeeting(data, meetingId, (m) => ({
          ...m,
          ai: { ...m.ai!, personalNotes: patchById(m.ai!.personalNotes!, noteId, (n) => ({ ...n, review: decision, approval: decision === 'approved' ? approval : undefined })) },
        }))
        if (decision === 'approved') {
          next = {
            ...next,
            personalNotes: [...next.personalNotes, { id: newId(), studentId: meeting.studentId, text, eventDate: draft.eventDate, eventDateApprox: draft.eventDate ? draft.eventDateApprox : undefined, uses: [], source: 'meeting', meetingId, createdAt: approval.at, approval }],
          }
          // The log says that something was saved, not what: it is the student's own detail.
          next = logActivity(next, meeting.studentId, 'counselor', `${data.firm.counselorFirstName} saved something to remember from “${meeting.title}”`)
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
        meeting.ai?.personalNotes?.forEach((n) => a.reviewDraftNote(meetingId, n.id, 'approved'))
        meeting.ai?.parentUpdates.forEach((u) => a.reviewParentUpdate(meetingId, u.id, 'approved'))
        a.reviewRecap(meetingId, 'approved')
      })
    },

    // ── Things to remember ──
    addPersonalNote: (studentId, text, eventDate) =>
      change((data) => {
        const note = text.trim().slice(0, 300)
        if (!note || !data.students.some((s) => s.id === studentId)) return data
        const approval = approvalBy(data)
        return { ...data, personalNotes: [...data.personalNotes, { id: newId(), studentId, text: note, eventDate: eventDate || undefined, uses: [], source: 'counselor', createdAt: approval.at, approval }] }
      }),

    deletePersonalNote: (id) => change((data) => ({ ...data, personalNotes: data.personalNotes.filter((n) => n.id !== id) })),

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
        return next
      }),

    discardReport: (id) => change((data) => ({ ...data, reports: data.reports.filter((r) => r.id !== id || r.status !== 'draft') })),

    // ── Messages ──
    updateRule: (id, patch) => change((data) => ({ ...data, reminderRules: data.reminderRules.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),

    // ── Weekly texts ──
    setWeeklyDraft: (studentId, weekStart, draft) =>
      change((data) => {
        const existing = data.weeklyTexts.find((w) => w.studentId === studentId && w.weekStart === weekStart)
        // A text already sent or skipped this week is not redrafted.
        if (existing && existing.status !== 'draft') return data
        // A redraft replaces the wording and which note it used; the parent copy is its own draft and stays.
        const fields = { body: draft.body, facts: draft.facts, source: draft.source, usedNote: draft.usedNote, lead: draft.lead }
        return existing
          ? { ...data, weeklyTexts: patchById(data.weeklyTexts, existing.id, (w) => ({ ...w, ...fields })) }
          : { ...data, weeklyTexts: [...data.weeklyTexts, { id: newId(), studentId, weekStart, status: 'draft', ...fields }] }
      }),

    updateWeeklyText: (id, body) =>
      change((data) => {
        const text = data.weeklyTexts.find((w) => w.id === id)
        if (!text || text.status !== 'draft' || text.body === body) return data
        return { ...data, weeklyTexts: patchById(data.weeklyTexts, id, (w) => ({ ...w, body })) }
      }),

    sendWeeklyText: (id, via) =>
      change((data) => {
        const text = data.weeklyTexts.find((w) => w.id === id)
        const student = data.students.find((s) => s.id === text?.studentId)
        if (!text || !student || text.status !== 'draft' || !text.body.trim()) return data
        let next: AppData = { ...data, weeklyTexts: patchById(data.weeklyTexts, id, (w) => ({ ...w, status: 'sent', approval: approvalBy(data), sentVia: via })) }
        next = deliver(next, { ...toStudent(student), channel: 'text', kind: 'weekly_text', body: text.body, trigger: 'approved', note: 'Sent from your own phone' })
        return markNoteUsed(next, text.usedNote, 'weekly_text')
      }),

    skipWeeklyText: (studentId, weekStart) =>
      change((data) => {
        const existing = data.weeklyTexts.find((w) => w.studentId === studentId && w.weekStart === weekStart)
        if (existing?.status === 'sent') return data
        return existing
          ? { ...data, weeklyTexts: patchById(data.weeklyTexts, existing.id, (w) => ({ ...w, status: 'skipped' })) }
          : { ...data, weeklyTexts: [...data.weeklyTexts, { id: newId(), studentId, weekStart, status: 'skipped', body: '' }] }
      }),

    unskipWeeklyText: (id) =>
      change((data) => {
        const text = data.weeklyTexts.find((w) => w.id === id)
        if (text?.status !== 'skipped') return data
        // Back to a draft if there was one; otherwise the row is simply removed.
        return text.body
          ? { ...data, weeklyTexts: patchById(data.weeklyTexts, id, (w) => ({ ...w, status: 'draft' })) }
          : { ...data, weeklyTexts: data.weeklyTexts.filter((w) => w.id !== id) }
      }),

    setWeeklyParentCopy: (studentId, weekStart, copy) =>
      change((data) => {
        const existing = data.weeklyTexts.find((w) => w.studentId === studentId && w.weekStart === weekStart)
        // A copy the counselor already approved is a record; it is not replaced or removed.
        if (!existing || existing.parentCopy?.status === 'sent') return data
        if (!copy && !existing.parentCopy) return data
        return { ...data, weeklyTexts: patchById(data.weeklyTexts, existing.id, (w) => ({ ...w, parentCopy: copy && { ...copy, status: 'draft' as const } })) }
      }),

    updateWeeklyParentCopy: (id, patch) =>
      change((data) => {
        const copy = data.weeklyTexts.find((w) => w.id === id)?.parentCopy
        if (!copy || copy.status !== 'draft') return data
        if ((patch.body ?? copy.body) === copy.body && (patch.bodyEn ?? copy.bodyEn) === copy.bodyEn) return data
        return { ...data, weeklyTexts: patchById(data.weeklyTexts, id, (w) => ({ ...w, parentCopy: { ...copy, ...patch } })) }
      }),

    sendWeeklyParentCopy: (id) =>
      change((data) => {
        const text = data.weeklyTexts.find((w) => w.id === id)
        const copy = text?.parentCopy
        const student = data.students.find((s) => s.id === text?.studentId)
        const parent = student?.parents.find((p) => p.id === copy?.parentId)
        if (!text || !copy || !student || !parent || copy.status !== 'draft' || !copy.body.trim()) return data
        const approval = approvalBy(data)
        let next: AppData = { ...data, weeklyTexts: patchById(data.weeklyTexts, id, (w) => ({ ...w, parentCopy: { ...copy, status: 'sent' as const, approval } })) }
        next = deliver(next, {
          studentId: student.id,
          toKind: 'parent',
          toName: parent.name,
          parentId: parent.id,
          channel: copy.channel,
          language: copy.language,
          kind: copy.kind,
          body: copy.body,
          bodyEn: copy.bodyEn,
          trigger: 'approved',
          // Only if the task is still there: the log row points at it.
          taskId: data.tasks.some((t) => t.id === copy.taskId) ? copy.taskId : undefined,
          note: 'Parent copy of the weekly text',
          approval,
        })
        return next
      }),

    sendMessage: (message, usedNote) => {
      const id = newId()
      change((data) => markNoteUsed(deliver(data, message, id), usedNote, 'reminder'))
      return id
    },

    ...fileActions({ get, absorb: (fn) => get().absorb(fn), change }),

    ...listDraftActions({ get, absorb: (fn) => get().absorb(fn), change, saved: () => writes }),

    ...templateActions({ get, change, batch, log: (data, studentId, text) => logActivity(data, studentId, 'counselor', text) }),
  }
})

/** An empty dataset, for when nobody is signed in. */
export const emptyAppData = () => emptyData(NO_FIRM)

/** The whole dataset. Screens call this, then use lib/derive.ts for anything computed. */
export const useData = () => useStore((s) => s.data)
