// Every data shape in the app lives here. Screens, the store, the seed data and
// the mock services all import from this file.

import type { ISODate } from './lib/dates'

export type ID = string

export type Language = 'en' | 'zh-Hans' | 'zh-Hant'
export type Channel = 'email' | 'wechat' | 'line' | 'text'

/** Who did something. Used for activity entries and attachments. */
export type Actor = 'student' | 'parent' | 'counselor' | 'ai'

/** Review state of anything the AI drafted. Nothing leaves "pending" without a counselor. */
export type Review = 'pending' | 'approved' | 'dismissed'

/** Who approved an AI draft, and when. Set at the moment of approval and never without one. */
export interface Approval {
  by: string
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
  channel: Channel
  /** Email address, phone number or messaging handle. Invented. */
  contact: string
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

export interface Student {
  id: ID
  firstName: string
  lastName: string
  /** Name in Chinese, where the family uses one. */
  localName?: string
  gradYear: number
  school: string
  city: string
  email: string
  gpa: number
  gpaWeighted?: number
  tests: TestScores
  majors: string[]
  interests: string[]
  activities: Activity[]
  counselorNotes: string
  onboardedOn: ISODate
  parents: Parent[]
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
  createdOn: ISODate
  /** Where the task came from. AI-sourced tasks only exist once approved. */
  source: 'counselor' | 'ai_meeting' | 'ai_notes'
  meetingId?: ID
  /** Set on tasks that began as an AI draft. */
  approval?: Approval
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

export type DocumentKind = 'essay' | 'transcript' | 'score_report' | 'recommendation' | 'resume' | 'other'

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
  source: AiSource
  approval?: Approval
}

export interface StudentDocument {
  id: ID
  studentId: ID
  name: string
  kind: DocumentKind
  addedOn: ISODate
  addedBy: Actor
  url?: string
  taskId?: ID
  note?: string
  /** Essays only: the prompt and the draft text the AI reads. */
  essayPrompt?: string
  essayText?: string
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

export interface MeetingAI {
  /** Internal notes for the counselor. Never shared. */
  notes: string[]
  draftTasks: DraftTask[]
  parentUpdates: DraftParentUpdate[]
  profileChanges: ProfileChange[]
  source: AiSource
}

export interface Meeting {
  id: ID
  studentId: ID
  title: string
  date: ISODate
  /** 24h local time, "16:00". */
  time: string
  durationMin: number
  status: 'scheduled' | 'completed'
  /** True when the AI notetaker joined (or is set to join). */
  aiAttended: boolean
  counselorNotes?: string
  /** The notes or transcript the AI drafts from. Sample text in v0: there is no recording. */
  transcript?: string
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

export type OutboxKind = 'parent_report' | 'reminder_upcoming' | 'reminder_late' | 'meeting_recap' | 'essay_feedback'

/** One entry in the "what went out" log. Nothing is ever really sent. */
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

// ── Root ────────────────────────────────────────────────────────────────────

export interface Firm {
  name: string
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
}
