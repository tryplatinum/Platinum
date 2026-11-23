// The database as TypeScript sees it. Written by hand to match
// supabase/migrations (the Supabase CLI was not available). Once the CLI is
// linked to the project, replace this file with:
//   npx supabase gen types typescript --linked > src/lib/database.types.ts
//
// Only src/data/repo.ts should need these row shapes; the rest of the app uses
// the camelCase shapes in src/types.ts.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Uuid = string
/** "2026-11-23" */
type DateString = string
/** ISO timestamp with time zone. */
type Timestamp = string

type Channel = 'email' | 'wechat' | 'line' | 'text'
type Language = 'en' | 'zh-Hans' | 'zh-Hant'
type Actor = 'student' | 'parent' | 'counselor' | 'ai'
type DocCategory = 'academic' | 'testing' | 'application' | 'recommendation' | 'financial' | 'other'

/** Columns every table has. All are filled in by the database when left out. */
type Stamps = { id: Uuid; created_at: Timestamp; updated_at: Timestamp }

/** A table whose `Optional` columns have defaults or allow null, so an insert may leave them out. */
type Table<Row, Optional extends keyof Row> = {
  Row: Row
  Insert: Omit<Row, Optional> & Partial<Pick<Row, Optional>>
  Update: Partial<Row>
  Relationships: []
}

type FirmRow = Stamps & { name: string }

type FirmMemberRow = Stamps & {
  firm_id: Uuid
  user_id: Uuid
  role: 'owner' | 'counselor'
  display_name: string
}

type StudentRow = Stamps & {
  firm_id: Uuid
  seq: number
  first_name: string
  last_name: string
  local_name: string | null
  grad_year: number
  school: string
  city: string
  email: string | null
  phone: string | null
  preferred_channel: Channel | null
  gpa: number | null
  gpa_weighted: number | null
  tests: Json
  majors: Json
  interests: Json
  activities: Json
  counselor_notes: string
  onboarded_on: DateString
  report_settings: Json
  archived: boolean
}

type ParentRow = Stamps & {
  firm_id: Uuid
  student_id: Uuid
  seq: number
  name: string
  local_name: string | null
  relationship: 'Mother' | 'Father' | 'Guardian'
  language: Language
  channel: Channel
  phone: string | null
  email: string | null
  wechat_id: string | null
  line_id: string | null
  is_primary: boolean
  note: string | null
}

type MeetingRow = Stamps & {
  firm_id: Uuid
  student_id: Uuid
  seq: number
  title: string
  date: DateString
  time: string
  duration_min: number
  location: string | null
  status: 'scheduled' | 'completed'
  transcript: string | null
  agenda: Json | null
  brief: Json | null
  ai: Json | null
  recap: Json | null
}

type TaskRow = Stamps & {
  firm_id: Uuid
  student_id: Uuid
  seq: number
  title: string
  detail: string | null
  category: 'essay' | 'application' | 'testing' | 'recommendation' | 'financial' | 'planning'
  owner: 'student' | 'parent' | 'counselor'
  owner_parent_id: Uuid | null
  due_date: DateString
  status: 'todo' | 'in_progress' | 'done'
  progress_note: string | null
  completed_on: DateString | null
  completed_by: Actor | null
  created_on: DateString
  source: 'counselor' | 'ai_meeting' | 'ai_notes'
  meeting_id: Uuid | null
  approval: Json | null
  expects_document: DocCategory | null
  attachments: Json
}

type CollegeRow = Stamps & {
  firm_id: Uuid
  student_id: Uuid
  seq: number
  name: string
  plan: 'ED' | 'ED2' | 'EA' | 'REA' | 'RD' | 'Rolling' | 'UC'
  deadline: DateString
  status: 'considering' | 'in_progress' | 'submitted' | 'admitted' | 'deferred' | 'waitlisted' | 'denied'
  fit: 'Reach' | 'Target' | 'Likely'
  note: string | null
}

type DocumentRow = Stamps & {
  firm_id: Uuid
  student_id: Uuid
  seq: number
  name: string
  kind: 'essay' | 'transcript' | 'score_report' | 'recommendation' | 'resume' | 'other'
  category: DocCategory
  added_on: DateString
  added_by: Actor
  url: string | null
  task_id: Uuid | null
  note: string | null
  essay_group: 'college' | 'summer' | null
  target: string | null
  topic: string | null
  essay_prompt: string | null
  word_limit: number | null
  status: 'not_started' | 'drafting' | 'waiting_on_student' | 'needs_feedback' | 'revising' | 'final' | 'submitted' | null
  drafts: Json | null
  feedback: Json | null
}

type ReportRow = Stamps & {
  firm_id: Uuid
  student_id: Uuid
  seq: number
  parent_id: Uuid
  created_on: DateString
  status: 'draft' | 'sent'
  language: Language
  channel: Channel
  subject: string
  body_en: string
  body_local: string | null
  sent_on: DateString | null
  meeting_id: Uuid | null
  facts: Json | null
  source: Json | null
  approval: Json | null
}

type OutboxRow = Stamps & {
  firm_id: Uuid
  student_id: Uuid
  seq: number
  sent_at: Timestamp
  to_kind: 'student' | 'parent'
  to_name: string
  parent_id: Uuid | null
  channel: Channel
  language: Language
  kind: 'parent_report' | 'reminder_upcoming' | 'reminder_late' | 'meeting_recap' | 'essay_feedback'
  body: string
  body_en: string | null
  trigger: 'automatic' | 'approved'
  task_id: Uuid | null
  dedupe_key: string | null
}

type ReminderRuleRow = Stamps & {
  firm_id: Uuid
  rule: 'student_upcoming' | 'student_late' | 'parent_upcoming' | 'parent_late' | 'parent_escalation'
  days: number
  mode: 'automatic' | 'needs_approval' | 'off'
}

type ActivityRow = Stamps & {
  firm_id: Uuid
  student_id: Uuid
  seq: number
  at: Timestamp
  actor: Actor
  text: string
}

type StudentLinkRow = Stamps & {
  firm_id: Uuid
  student_id: Uuid
  token_hash: string
  created_by: Uuid | null
  revoked_at: Timestamp | null
}

type StampKeys = keyof Stamps

export type Database = {
  public: {
    Tables: {
      firms: Table<FirmRow, StampKeys>
      firm_members: Table<FirmMemberRow, StampKeys>
      students: Table<
        StudentRow,
        | StampKeys
        | 'seq'
        | 'local_name'
        | 'school'
        | 'city'
        | 'email'
        | 'phone'
        | 'preferred_channel'
        | 'gpa'
        | 'gpa_weighted'
        | 'tests'
        | 'majors'
        | 'interests'
        | 'activities'
        | 'counselor_notes'
        | 'onboarded_on'
        | 'report_settings'
        | 'archived'
      >
      parents: Table<ParentRow, StampKeys | 'seq' | 'local_name' | 'phone' | 'email' | 'wechat_id' | 'line_id' | 'is_primary' | 'note'>
      meetings: Table<MeetingRow, StampKeys | 'seq' | 'duration_min' | 'location' | 'transcript' | 'agenda' | 'brief' | 'ai' | 'recap'>
      tasks: Table<
        TaskRow,
        | StampKeys
        | 'seq'
        | 'detail'
        | 'owner_parent_id'
        | 'progress_note'
        | 'completed_on'
        | 'completed_by'
        | 'created_on'
        | 'meeting_id'
        | 'approval'
        | 'expects_document'
        | 'attachments'
      >
      colleges: Table<CollegeRow, StampKeys | 'seq' | 'note'>
      documents: Table<
        DocumentRow,
        | StampKeys
        | 'seq'
        | 'added_on'
        | 'url'
        | 'task_id'
        | 'note'
        | 'essay_group'
        | 'target'
        | 'topic'
        | 'essay_prompt'
        | 'word_limit'
        | 'status'
        | 'drafts'
        | 'feedback'
      >
      reports: Table<ReportRow, StampKeys | 'seq' | 'created_on' | 'body_local' | 'sent_on' | 'meeting_id' | 'facts' | 'source' | 'approval'>
      outbox: Table<OutboxRow, StampKeys | 'seq' | 'sent_at' | 'parent_id' | 'body_en' | 'task_id' | 'dedupe_key'>
      reminder_rules: Table<ReminderRuleRow, StampKeys>
      activity: Table<ActivityRow, StampKeys | 'seq' | 'at'>
      student_links: Table<StudentLinkRow, StampKeys | 'created_by' | 'revoked_at'>
    }
    Views: { [_ in never]: never }
    Functions: {
      create_firm: { Args: { name: string; display_name: string }; Returns: Uuid }
      is_firm_member: { Args: { firm: Uuid }; Returns: boolean }
      is_firm_owner: { Args: { firm: Uuid }; Returns: boolean }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
