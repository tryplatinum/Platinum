// Every data shape in the app lives here. Screens, the store, the seed data and
// the services all import from this file.
//
// The database mirrors these shapes (supabase/migrations). When you change one,
// add a migration and update the mapping in data/repo.ts.

import type { ISODate } from './lib/dates'

export type ID = string

export type Language = 'en' | 'zh-Hans' | 'zh-Hant'
export type Channel = 'email' | 'wechat' | 'line' | 'text'

/** Who did something. Used for activity entries, attachments and completed tasks. */
export type Actor = 'student' | 'parent' | 'counselor' | 'ai'

/** Review state of anything the AI drafted. Nothing leaves "pending" without a counselor. */
export type Review = 'pending' | 'approved' | 'dismissed'

/** Who approved an AI draft, and when. Set at the moment of approval and never without one. */
export interface Approval {
  by: string
  /** The approving account's user id. Absent on approvals recorded before accounts existed. */
  byId?: ID
  at: string
}

/**
 * Where a draft came from. 'claude' = written by the model through /api/ai.
 * 'placeholder' = prepared sample text, used when the endpoint is unreachable
 * or has no key. The interface labels placeholders clearly.
 */
export type AiSource = { kind: 'claude'; model: string } | { kind: 'placeholder'; reason: string }

// ── People ──────────────────────────────────────────────────────────────────

export interface Parent {
  id: ID
  name: string
  /** Name in the parent's own script, used in greetings. */
  localName?: string
  relationship: 'Mother' | 'Father' | 'Guardian'
  language: Language
  /** The channel this parent prefers. Messages to them are drafted for it. */
  channel: Channel
  phone?: string
  email?: string
  wechatId?: string
  lineId?: string
  /** The family's main contact. Escalations and "remind parent" go here first. */
  isPrimary: boolean
  /** Counselor's private note, e.g. "slow to reply, prefers voice messages". */
  note?: string
}

export interface Activity {
  id: ID
  name: string
  role: string
  detail?: string
}

export interface TestScores {
  sat?: number
  act?: number
  toefl?: number
  aps: { subject: string; score: number }[]
}

/** How progress reports go out for one family. There is no scheduler in v0: the schedule is a stated intention. */
export interface ReportSettings {
  schedule: 'after_meetings' | 'every_two_weeks' | 'monthly' | 'manual'
  /** Parents who receive reports. */
  recipientIds: ID[]
}

/**
 * Whether a reminder or weekly text to the student comes with a separate short
 * message to the primary parent. 'when_slipping' = only while the student has a
 * late task or has gone quiet (see isSlipping in lib/derive.ts).
 */
export type ParentCopySetting = 'always' | 'when_slipping' | 'never'

/**
 * A small personal detail the student mentioned: "Regional robotics tournament
 * on Saturday". Saved only once a counselor approves it (or types it in), and
 * used to make texts TO THE STUDENT sound like someone who listens.
 *
 * GUARDRAIL: these never go to anything a parent reads and never to the
 * student link. See notesForDraft in lib/facts.ts and server/studentLink.ts.
 */
export interface PersonalNote {
  id: ID
  studentId: ID
  text: string
  /** The day of the event, when the student gave one. */
  eventDate?: ISODate
  /** True when the student only said roughly when ("sometime next month") and the date is an estimate. */
  eventDateApprox?: boolean
  /**
   * Each time a message that mentioned this note was sent. A note is mentioned
   * once per stage (see noteStage in lib/derive.ts), so nothing is repeated.
   */
  uses: NoteUse[]
  /** 'meeting' = suggested by the AI from a meeting's notes. 'counselor' = typed in by hand. */
  source: 'meeting' | 'counselor'
  meetingId?: ID
  createdAt: string
  /** Who approved (or wrote) it, and when. A note never exists without one. */
  approval: Approval
}

/**
 * Which task a weekly text leads with. Choosing it is the AI's one judgment in
 * that feature; the code checks the text does lead with this task, and the
 * counselor sees the choice and the reason beside the draft.
 */
export interface WeeklyLead {
  title: string
  /** The AI's one-sentence reason, for the counselor only. */
  reason?: string
  /** False when the AI kept the code's own order (most overdue first). */
  changedOrder: boolean
}

/** One mention of a note in a message the counselor sent. */
export interface NoteUse {
  at: string
  /** 'ahead' = before the event ("good luck"), 'after' = once it happened ("how did it go?"), 'undated' = a note with no date. */
  stage: 'ahead' | 'after' | 'undated'
  in: 'weekly_text' | 'reminder'
}

/** The note a draft drew on, as it read at the time. Shown beside the draft as "Used: …". */
export interface UsedNote {
  id: ID
  text: string
  /** The stage the note was at when the draft was written. Recorded on the note when the message is sent. */
  stage?: NoteUse['stage']
}

export interface Student {
  id: ID
  firstName: string
  lastName: string
  /** Name in Chinese, where the family uses one. */
  localName?: string
  gradYear: number
  school: string
  city: string
  email?: string
  phone?: string
  preferredChannel?: Channel
  gpa?: number
  gpaWeighted?: number
  tests: TestScores
  majors: string[]
  interests: string[]
  activities: Activity[]
  counselorNotes: string
  onboardedOn: ISODate
  parents: Parent[]
  reportSettings: ReportSettings
  /** False leaves this student out of the weekly texts. Absent means included. */
  weeklyText?: boolean
  /** When a message to the student also goes to the primary parent. Absent means 'when_slipping'. */
  parentCopy?: ParentCopySetting
  /** Archived students keep their history but leave every list. */
  archived?: boolean
}

// ── Work ────────────────────────────────────────────────────────────────────

export type OwnerType = 'student' | 'parent' | 'counselor'
export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type TaskCategory = 'essay' | 'application' | 'testing' | 'recommendation' | 'financial' | 'planning'

export interface Attachment {
  id: ID
  kind: 'file' | 'link'
  /** File name or link label. For files this is the only thing recorded. */
  name: string
  url?: string
  addedOn: ISODate
  addedBy: Actor
}

export interface Task {
  id: ID
  studentId: ID
  title: string
  detail?: string
  category: TaskCategory
  owner: OwnerType
  /** Set when owner is 'parent'. */
  ownerParentId?: ID
  dueDate: ISODate
  status: TaskStatus
  progressNote?: string
  completedOn?: ISODate
  completedBy?: Actor
  createdOn: ISODate
  /** Where the task came from. AI-sourced tasks only exist once approved. */
  source: 'counselor' | 'ai_meeting' | 'ai_notes'
  meetingId?: ID
  /** Set on tasks that began as an AI draft. */
  approval?: Approval
  /** The task asks for a document of this category. Until one is attached it counts as "requested and not received". */
  expectsDocument?: DocCategory
  attachments: Attachment[]
}

export type ApplicationPlan = 'ED' | 'ED2' | 'EA' | 'REA' | 'RD' | 'Rolling' | 'UC'
export type CollegeStatus =
  | 'considering'
  | 'in_progress'
  | 'submitted'
  | 'admitted'
  | 'deferred'
  | 'waitlisted'
  | 'denied'

export interface CollegeApp {
  id: ID
  studentId: ID
  name: string
  plan: ApplicationPlan
  deadline: ISODate
  status: CollegeStatus
  fit: 'Reach' | 'Target' | 'Likely'
  note?: string
}

// ── Documents and essays ────────────────────────────────────────────────────

export type DocumentKind = 'essay' | 'transcript' | 'score_report' | 'recommendation' | 'resume' | 'other'
export type DocCategory = 'academic' | 'testing' | 'application' | 'recommendation' | 'financial' | 'other'

export type EssayStatus = 'not_started' | 'drafting' | 'waiting_on_student' | 'needs_feedback' | 'revising' | 'final' | 'submitted'

export interface EssayDraft {
  n: number
  text: string
  savedOn: ISODate
}

export interface EssayFeedbackPoint {
  area: 'Structure' | 'Clarity' | 'Answers the prompt'
  /** Where in the draft, e.g. "Paragraph 2". */
  location?: string
  observation: string
  /** A question for the student to think about. Never replacement text. */
  question: string
}

export interface EssayFeedback {
  overall: string
  strengths: string[]
  points: EssayFeedbackPoint[]
  review: Review
  generatedOn: ISODate
  /** The draft number the feedback was written about. */
  draftN?: number
  source: AiSource
  approval?: Approval
}

/**
 * A file, a link, or an essay. `kind: 'essay'` documents carry the essay
 * fields and live in the Essays tab; everything else is filed by `category`.
 */
export interface StudentDocument {
  id: ID
  studentId: ID
  name: string
  kind: DocumentKind
  category: DocCategory
  addedOn: ISODate
  addedBy: Actor
  url?: string
  taskId?: ID
  note?: string

  // Essays only.
  essayGroup?: 'college' | 'summer'
  /** School, system or program the essay is for: "University of California", "NYU", "COSMOS". */
  target?: string
  /** What the essay is about, in a few words. */
  topic?: string
  essayPrompt?: string
  wordLimit?: number
  status?: EssayStatus
  /** Oldest first. The last entry is the current draft. Word count is computed from it. */
  drafts?: EssayDraft[]
  feedback?: EssayFeedback
}

// ── Meetings and AI drafts ──────────────────────────────────────────────────

export interface DraftTask {
  id: ID
  title: string
  detail?: string
  category: TaskCategory
  owner: OwnerType
  ownerParentId?: ID
  dueDate: ISODate
  /** 'inferred' when the AI chose the date because the notes gave none. */
  dueDateBasis?: 'stated' | 'inferred'
  review: Review
  approval?: Approval
}

/** A change to a student's profile that the AI suggests. Plain data so it can be persisted. */
export type ProfilePatch =
  | { kind: 'score'; field: 'sat' | 'act' | 'toefl' | 'gpa'; value: number }
  | { kind: 'addActivity'; activity: Activity }
  | { kind: 'setMajors'; value: string[] }
  | { kind: 'addInterest'; value: string }

export interface ProfileChange {
  id: ID
  label: string
  from: string
  to: string
  /** The sentence in the meeting that prompted this. */
  evidence: string
  patch: ProfilePatch
  review: Review
  approval?: Approval
}

/** A personal detail the AI picked out of a meeting's notes. It becomes a PersonalNote only when approved. */
export interface DraftPersonalNote {
  id: ID
  text: string
  /** The sentence in the meeting that prompted this. */
  evidence: string
  eventDate?: ISODate
  /** True when the date is the AI's estimate of a loose phrase such as "next month". */
  eventDateApprox?: boolean
  review: Review
  approval?: Approval
}

export interface DraftParentUpdate {
  id: ID
  parentId: ID
  bodyEn: string
  /** In the parent's language. Absent when the parent reads English. */
  bodyLocal?: string
  review: Review
  approval?: Approval
}

export interface Recap {
  summary: string
  nextSteps: string[]
  /** The student sees the recap only once this is 'approved'. */
  review: Review
  approval?: Approval
}

/** Everything the AI drafted from one meeting. Each part is reviewed by the counselor. */
export interface MeetingAI {
  /** The meeting in three short lists. Becomes the meeting's record once approved. */
  decided: string[]
  progress: string[]
  watch: string[]
  /** Fuller notes for the counselor. Never shared. */
  notes: string[]
  notesReview: Review
  notesApproval?: Approval
  draftTasks: DraftTask[]
  parentUpdates: DraftParentUpdate[]
  profileChanges: ProfileChange[]
  /** "Things to remember". Absent on drafts made before the feature existed. */
  personalNotes?: DraftPersonalNote[]
  source: AiSource
}

/** The AI's part of a pre-meeting brief, kept on the meeting once prepared. */
export interface SavedBrief {
  headline?: string
  agenda: { topic: string; why: string }[]
  questions: string[]
  source: AiSource
  preparedOn: ISODate
}

export interface Meeting {
  id: ID
  studentId: ID
  title: string
  date: ISODate
  /** 24h local time, "16:00". */
  time: string
  durationMin: number
  /** "Zoom", "In person", a room. */
  location?: string
  status: 'scheduled' | 'completed'
  /** Notes or a transcript, pasted or typed by the counselor. The AI drafts from this. */
  transcript?: string
  /** The counselor's agenda for an upcoming meeting. */
  agenda?: string[]
  brief?: SavedBrief
  ai?: MeetingAI
  recap?: Recap
}

// ── Parent reports, sending, reminders ──────────────────────────────────────

export interface ParentReport {
  id: ID
  studentId: ID
  parentId: ID
  createdOn: ISODate
  status: 'draft' | 'sent'
  language: Language
  channel: Channel
  subject: string
  bodyEn: string
  bodyLocal?: string
  sentOn?: ISODate
  meetingId?: ID
  /** Fact lines computed by our code that the draft was written around. Shown beside the draft. */
  facts?: string[]
  /** Absent on reports the counselor wrote by hand. */
  source?: AiSource
  approval?: Approval
}

export type OutboxKind = 'parent_report' | 'reminder_upcoming' | 'reminder_late' | 'meeting_recap' | 'essay_feedback' | 'weekly_text'

/** Where a queued message is. Delivery itself arrives in M1. */
export type OutboxStatus = 'queued' | 'cancelled' | 'sending' | 'sent' | 'failed'

/**
 * One outbound message. A new row is queued by the database, with the counselor
 * who approved it, and waits 60 seconds before a sender may deliver it.
 */
export interface OutboxMessage {
  id: ID
  sentAt: string
  studentId: ID
  toKind: 'student' | 'parent'
  toName: string
  parentId?: ID
  channel: Channel
  language: Language
  kind: OutboxKind
  body: string
  /** English version, when body is in another language. */
  bodyEn?: string
  /** 'automatic' = a rule the counselor ran. 'approved' = the counselor pressed the button. Both are approved. */
  trigger: 'automatic' | 'approved'
  taskId?: ID
  /** How it went out, when that is worth saying: "Sent from your own phone". */
  note?: string
  /** Who approved it, and when. Set on every message. */
  approval?: Approval
  /** Lets the reminder queue know this reminder has already gone out. */
  dedupeKey?: string
  status: OutboxStatus
  /** The sender may deliver it only after this instant. Undo is allowed until then. */
  sendAfter: string
  approvedBy?: ID
  approvedAt?: string
  providerMessageId?: string
  error?: string
}

export type ReminderMode = 'automatic' | 'needs_approval' | 'off'

export interface ReminderRule {
  id: 'student_upcoming' | 'student_late' | 'parent_upcoming' | 'parent_late' | 'parent_escalation'
  label: string
  description: string
  /** Days before the due date (upcoming rules) or days late (escalation). */
  days: number
  mode: ReminderMode
}

export interface ActivityEvent {
  id: ID
  at: string
  studentId: ID
  actor: Actor
  text: string
}

/**
 * The weekly text for one student for one week: the draft, then whether the
 * counselor sent it (from their own phone) or skipped it.
 */
export interface WeeklyText {
  id: ID
  studentId: ID
  /** The first day of the week it belongs to: the firm's weekly text day. */
  weekStart: ISODate
  status: 'draft' | 'sent' | 'skipped'
  body: string
  /** Fact lines computed by our code that the text was built from. Shown beside the draft. */
  facts?: string[]
  source?: AiSource
  /** Set when the counselor pressed Copy or Open in Messages. */
  approval?: Approval
  sentVia?: 'copy' | 'sms'
  /** The "thing to remember" the draft drew on, if any. */
  usedNote?: UsedNote
  /** The task the AI chose to put first as most urgent, and why. Set only when the text really leads with it. */
  lead?: WeeklyLead
  /** The separate short message to the primary parent, when "Also tell parent" is ticked. */
  parentCopy?: ParentCopy
}

/**
 * A short message to the primary parent that goes alongside a text to the
 * student: its own draft, in the parent's language and for their channel, with
 * its own approval and its own log entry. Written by the reminder feature about
 * one task. It never contains a "thing to remember".
 */
export interface ParentCopy {
  parentId: ID
  /** The task it is about: the student's most overdue task, or the next one due. */
  taskId: ID
  channel: Channel
  language: Language
  kind: 'reminder_upcoming' | 'reminder_late'
  /** What the parent reads, in their language. */
  body: string
  /** English, when body is in another language. */
  bodyEn?: string
  source: AiSource
  /** Fixed facts the draft did not carry as given. Shown to the counselor. */
  warnings?: string[]
  status: 'draft' | 'sent'
  approval?: Approval
}

/** A secret link that opens one student's page without a login. The token itself is not stored. */
export interface StudentLink {
  id: ID
  studentId: ID
  createdAt: string
  revokedAt?: string
}

// ── Root ────────────────────────────────────────────────────────────────────

export interface Firm {
  name: string
  /** The day each week's texts to students start: 0 = Sunday … 6 = Saturday. */
  weeklyTextDay: number
  counselorName: string
  counselorFirstName: string
}

/** Everything the app knows. The store holds exactly one of these. */
export interface AppData {
  firm: Firm
  students: Student[]
  tasks: Task[]
  meetings: Meeting[]
  colleges: CollegeApp[]
  documents: StudentDocument[]
  reports: ParentReport[]
  outbox: OutboxMessage[]
  reminderRules: ReminderRule[]
  activity: ActivityEvent[]
  weeklyTexts: WeeklyText[]
  /** Oldest first. */
  personalNotes: PersonalNote[]
}
