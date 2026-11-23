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

/** One entry in the "Messages sent" log. Nothing is ever really delivered in v0. */
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
  /** 'automatic' = sent by a rule the counselor switched on. 'approved' = counselor pressed the button. */
  trigger: 'automatic' | 'approved'
  taskId?: ID
  /** How it went out, when that is worth saying: "Sent from your own phone". */
  note?: string
  /** Lets the reminder queue know this reminder has already gone out. */
  dedupeKey?: string
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
}

/** A secret link that opens one student's page without a login. */
export interface StudentLink {
  id: ID
  studentId: ID
  /** The secret. Absent on links made before tokens were kept: those work but cannot be shown again. */
  token?: string
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
}
