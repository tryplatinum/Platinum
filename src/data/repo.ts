// The only file that talks to Supabase tables. Everything else works with the
// camelCase shapes in src/types.ts; this file maps them to and from the
// snake_case rows, loads a firm's data, and writes changes back.
//
// Most writes go through apply_changes, one transaction under the signed-in
// person's own permissions. The store works out the batch with diffData().
// Outbox rows are the exception: queue_message and cancel_message are the only
// writes, and apply_changes rejects a batch that names the outbox.

import type { QueuePayload } from '../../shared/outbox'
import { DEFAULT_REMINDER_RULES } from './seed'
import type { Database, Json } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import type {
  ActivityEvent,
  AppData,
  CollegeApp,
  CollegeListDraft,
  CollegeListDraftItem,
  DocumentType,
  Firm,
  ID,
  Meeting,
  OutboxMessage,
  Parent,
  ParentReport,
  PersonalNote,
  ReminderRule,
  Student,
  StudentDocument,
  ReminderSkip,
  StudentLink,
  Task,
  WeeklyText,
} from '../types'

type Tables = Database['public']['Tables']
type Row<T extends keyof Tables> = Tables[T]['Row']
/** A row as sent to apply_changes: the database supplies firm_id and its own bookkeeping columns. */
type Out<T extends keyof Tables> = Omit<Row<T>, 'firm_id' | 'seq' | 'created_at' | 'updated_at'>

type DataTable = 'students' | 'parents' | 'meetings' | 'tasks' | 'colleges' | 'documents' | 'reports' | 'outbox' | 'activity' | 'weekly_texts' | 'personal_notes' | 'college_list_drafts'

/** A failed read or write, with a message fit to show the counselor. */
export class RepoError extends Error {}

function fail(error: { message: string; code?: string } | null, doing: string): never {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  const reason = offline || /failed to fetch|networkerror|load failed/i.test(error?.message ?? '') ? 'There is no connection to the server.' : (error?.message ?? 'Unknown error.')
  throw new RepoError(`${doing}: ${reason}`)
}

// ── Mapping helpers ─────────────────────────────────────────────────────────

/** undefined → null on the way in. */
const n = <T>(value: T | undefined): T | null => value ?? null
/** null → undefined on the way out. */
const u = <T>(value: T | null): T | undefined => value ?? undefined
const json = (value: unknown): Json => (value ?? null) as Json
const from = <T>(value: Json | null): T | undefined => (value ?? undefined) as T | undefined
/** Timestamps come back with an offset ("+00:00"); the app uses the "Z" form everywhere. */
const stamp = (value: string) => new Date(value).toISOString()

// ── Rows → app shapes ───────────────────────────────────────────────────────

const parentFrom = (r: Row<'parents'>): Parent => ({
  id: r.id,
  name: r.name,
  localName: u(r.local_name),
  relationship: r.relationship as Parent['relationship'],
  language: r.language as Parent['language'],
  channel: r.channel as Parent['channel'],
  phone: u(r.phone),
  email: u(r.email),
  wechatId: u(r.wechat_id),
  lineId: u(r.line_id),
  isPrimary: r.is_primary,
  note: u(r.note),
})

const studentFrom = (r: Row<'students'>, parents: Parent[]): Student => ({
  id: r.id,
  firstName: r.first_name,
  lastName: r.last_name,
  localName: u(r.local_name),
  gradYear: r.grad_year,
  school: r.school,
  city: r.city,
  email: u(r.email),
  phone: u(r.phone),
  preferredChannel: u(r.preferred_channel) as Student['preferredChannel'],
  gpa: u(r.gpa),
  gpaWeighted: u(r.gpa_weighted),
  tests: from<Student['tests']>(r.tests) ?? { aps: [] },
  majors: from<string[]>(r.majors) ?? [],
  interests: from<string[]>(r.interests) ?? [],
  activities: from<Student['activities']>(r.activities) ?? [],
  counselorNotes: r.counselor_notes,
  onboardedOn: r.onboarded_on,
  parents,
  reportSettings: from<Student['reportSettings']>(r.report_settings) ?? { schedule: 'after_meetings', recipientIds: [] },
  weeklyText: r.weekly_text ? undefined : false,
  parentCopy: r.parent_copy === 'when_slipping' ? undefined : (r.parent_copy as Student['parentCopy']),
  archived: r.archived || undefined,
})

const taskFrom = (r: Row<'tasks'>): Task => ({
  id: r.id,
  studentId: r.student_id,
  title: r.title,
  detail: u(r.detail),
  category: r.category as Task['category'],
  owner: r.owner as Task['owner'],
  ownerParentId: u(r.owner_parent_id),
  dueDate: r.due_date,
  status: r.status as Task['status'],
  progressNote: u(r.progress_note),
  completedOn: u(r.completed_on),
  completedBy: u(r.completed_by) as Task['completedBy'],
  createdOn: r.created_on,
  source: r.source as Task['source'],
  meetingId: u(r.meeting_id),
  approval: from<Task['approval']>(r.approval),
  expectsDocument: u(r.expects_document) as Task['expectsDocument'],
  attachments: from<Task['attachments']>(r.attachments) ?? [],
})

const meetingFrom = (r: Row<'meetings'>): Meeting => ({
  id: r.id,
  studentId: r.student_id,
  title: r.title,
  date: r.date,
  time: r.time,
  durationMin: r.duration_min,
  location: u(r.location),
  status: r.status as Meeting['status'],
  transcript: u(r.transcript),
  agenda: from<string[]>(r.agenda),
  brief: from<Meeting['brief']>(r.brief),
  ai: from<Meeting['ai']>(r.ai),
  recap: from<Meeting['recap']>(r.recap),
})

const collegeFrom = (r: Row<'colleges'>): CollegeApp => ({
  id: r.id,
  studentId: r.student_id,
  name: r.name,
  plan: u(r.plan) as CollegeApp['plan'],
  deadline: u(r.deadline),
  status: r.status as CollegeApp['status'],
  fit: r.fit as CollegeApp['fit'],
  note: u(r.note),
  directoryUnitid: u(r.directory_unitid),
  fitReason: u(r.fit_reason),
  fitSetBy: u(r.fit_set_by) as CollegeApp['fitSetBy'],
})

export const documentFrom = (r: Row<'documents'>): StudentDocument => ({
  id: r.id,
  // Null only on a counselor's upload that is still waiting for a student.
  studentId: r.student_id ?? '',
  name: r.name,
  kind: r.kind as StudentDocument['kind'],
  category: r.category as StudentDocument['category'],
  addedOn: r.added_on,
  addedBy: r.added_by as StudentDocument['addedBy'],
  url: u(r.url),
  taskId: u(r.task_id),
  note: u(r.note),
  essayGroup: u(r.essay_group) as StudentDocument['essayGroup'],
  target: u(r.target),
  topic: u(r.topic),
  essayPrompt: u(r.essay_prompt),
  wordLimit: u(r.word_limit),
  status: u(r.status) as StudentDocument['status'],
  drafts: from<StudentDocument['drafts']>(r.drafts),
  feedback: from<StudentDocument['feedback']>(r.feedback),
  typeId: u(r.type_id),
  title: u(r.title),
  originalFilename: u(r.original_filename),
  storagePath: u(r.storage_path),
  sizeBytes: u(r.size_bytes),
  mimeType: u(r.mime_type),
  contentHash: u(r.content_hash),
  collegeId: u(r.college_id),
  schoolYear: u(r.school_year),
  uploadedByKind: u(r.uploaded_by_kind) as StudentDocument['uploadedByKind'],
  uploadedByUser: u(r.uploaded_by_user),
  studentLinkId: u(r.student_link_id),
  source: u(r.source) as StudentDocument['source'],
  driveFileId: u(r.drive_file_id),
  driveUrl: u(r.drive_url),
  driveModifiedAt: u(r.drive_modified_at),
  fileStatus: u(r.file_status) as StudentDocument['fileStatus'],
  sortedBy: u(r.sorted_by) as StudentDocument['sortedBy'],
  needsCheck: r.needs_check || undefined,
  aiSuggestion: from<StudentDocument['aiSuggestion']>(r.ai_suggestion),
  openedAt: r.opened_at ? stamp(r.opened_at) : undefined,
})

export const documentTypeFrom = (r: Row<'document_types'>): DocumentType => ({
  id: r.id,
  name: r.name,
  description: r.description,
  sensitivity: r.sensitivity as DocumentType['sensitivity'],
  position: r.position,
  archivedAt: r.archived_at ? stamp(r.archived_at) : undefined,
})

export const listDraftFrom = (r: Row<'college_list_drafts'>): CollegeListDraft => ({
  id: r.id,
  studentId: r.student_id,
  createdBy: u(r.created_by),
  preferences: from<CollegeListDraft['preferences']>(r.preferences) ?? {},
  note: u(r.note),
  source: from<CollegeListDraft['source']>(r.source),
  status: r.status as CollegeListDraft['status'],
  approvedBy: u(r.approved_by),
  approvedByName: u(r.approved_by_name),
  approvedAt: r.approved_at ? stamp(r.approved_at) : undefined,
  createdAt: stamp(r.created_at),
})

export const listDraftItemFrom = (r: Row<'college_list_draft_items'>): CollegeListDraftItem => ({
  id: r.id,
  draftId: r.draft_id,
  unitid: r.unitid,
  fit: r.fit as CollegeListDraftItem['fit'],
  fitBasis: from<CollegeListDraftItem['fitBasis']>(r.fit_basis) ?? {},
  fitSetBy: r.fit_set_by as CollegeListDraftItem['fitSetBy'],
  reason: r.reason,
  aiExplained: r.ai_explained,
  kept: r.kept,
  position: r.position,
})

const reportFrom = (r: Row<'reports'>): ParentReport => ({
  id: r.id,
  studentId: r.student_id,
  parentId: r.parent_id,
  createdOn: r.created_on,
  status: r.status as ParentReport['status'],
  language: r.language as ParentReport['language'],
  channel: r.channel as ParentReport['channel'],
  subject: r.subject,
  bodyEn: r.body_en,
  bodyLocal: u(r.body_local),
  sentOn: u(r.sent_on),
  meetingId: u(r.meeting_id),
  facts: from<string[]>(r.facts),
  source: from<ParentReport['source']>(r.source),
  approval: from<ParentReport['approval']>(r.approval),
})

const outboxFrom = (r: Row<'outbox'>): OutboxMessage => ({
  id: r.id,
  sentAt: stamp(r.sent_at),
  studentId: r.student_id,
  toKind: r.to_kind as OutboxMessage['toKind'],
  toName: r.to_name,
  parentId: u(r.parent_id),
  channel: r.channel as OutboxMessage['channel'],
  language: r.language as OutboxMessage['language'],
  kind: r.kind as OutboxMessage['kind'],
  body: r.body,
  bodyEn: u(r.body_en),
  trigger: r.trigger as OutboxMessage['trigger'],
  taskId: u(r.task_id),
  note: u(r.note),
  approval: from<OutboxMessage['approval']>(r.approval),
  dedupeKey: u(r.dedupe_key),
  status: (r.status as OutboxMessage['status']) ?? 'queued',
  sendAfter: stamp(r.send_after),
  approvedBy: u(r.approved_by),
  approvedAt: r.approved_at ? stamp(r.approved_at) : undefined,
  providerMessageId: u(r.provider_message_id),
  error: u(r.error),
})

const activityFrom = (r: Row<'activity'>): ActivityEvent => ({
  id: r.id,
  at: stamp(r.at),
  studentId: r.student_id,
  actor: r.actor as ActivityEvent['actor'],
  text: r.text,
})

const weeklyTextFrom = (r: Row<'weekly_texts'>): WeeklyText => ({
  id: r.id,
  studentId: r.student_id,
  weekStart: r.week_start,
  status: r.status as WeeklyText['status'],
  body: r.body,
  facts: from<string[]>(r.facts),
  source: from<WeeklyText['source']>(r.source),
  approval: from<WeeklyText['approval']>(r.approval),
  sentVia: u(r.sent_via) as WeeklyText['sentVia'],
  usedNote: from<WeeklyText['usedNote']>(r.used_note),
  lead: from<WeeklyText['lead']>(r.lead),
  parentCopy: from<WeeklyText['parentCopy']>(r.parent_copy),
})

const personalNoteFrom = (r: Row<'personal_notes'>): PersonalNote => ({
  id: r.id,
  studentId: r.student_id,
  text: r.text,
  eventDate: u(r.event_date),
  eventDateApprox: r.event_date_approx || undefined,
  uses: from<PersonalNote['uses']>(r.uses) ?? [],
  source: r.source as PersonalNote['source'],
  meetingId: u(r.meeting_id),
  createdAt: stamp(r.created_at),
  approval: r.approval as unknown as PersonalNote['approval'],
})

const linkFrom = (r: Row<'student_links'>): StudentLink => ({
  id: r.id,
  studentId: r.student_id,
  createdAt: stamp(r.created_at),
  revokedAt: r.revoked_at ? stamp(r.revoked_at) : undefined,
})

// ── App shapes → rows ───────────────────────────────────────────────────────

const studentRow = (s: Student): Out<'students'> => ({
  id: s.id,
  first_name: s.firstName,
  last_name: s.lastName,
  local_name: n(s.localName),
  grad_year: s.gradYear,
  school: s.school,
  city: s.city,
  email: n(s.email),
  phone: n(s.phone),
  preferred_channel: n(s.preferredChannel),
  gpa: n(s.gpa),
  gpa_weighted: n(s.gpaWeighted),
  tests: json(s.tests),
  majors: json(s.majors),
  interests: json(s.interests),
  activities: json(s.activities),
  counselor_notes: s.counselorNotes,
  onboarded_on: s.onboardedOn,
  report_settings: json(s.reportSettings),
  weekly_text: s.weeklyText !== false,
  parent_copy: s.parentCopy ?? 'when_slipping',
  archived: Boolean(s.archived),
})

const parentRow = (p: Parent, studentId: ID): Out<'parents'> => ({
  id: p.id,
  student_id: studentId,
  name: p.name,
  local_name: n(p.localName),
  relationship: p.relationship,
  language: p.language,
  channel: p.channel,
  phone: n(p.phone),
  email: n(p.email),
  wechat_id: n(p.wechatId),
  line_id: n(p.lineId),
  is_primary: p.isPrimary,
  note: n(p.note),
})

const taskRow = (t: Task): Out<'tasks'> => ({
  id: t.id,
  student_id: t.studentId,
  title: t.title,
  detail: n(t.detail),
  category: t.category,
  owner: t.owner,
  owner_parent_id: n(t.ownerParentId),
  due_date: t.dueDate,
  status: t.status,
  progress_note: n(t.progressNote),
  completed_on: n(t.completedOn),
  completed_by: n(t.completedBy),
  created_on: t.createdOn,
  source: t.source,
  meeting_id: n(t.meetingId),
  approval: json(t.approval),
  expects_document: n(t.expectsDocument),
  attachments: json(t.attachments),
})

const meetingRow = (m: Meeting): Out<'meetings'> => ({
  id: m.id,
  student_id: m.studentId,
  title: m.title,
  date: m.date,
  time: m.time,
  duration_min: m.durationMin,
  location: n(m.location),
  status: m.status,
  transcript: n(m.transcript),
  agenda: json(m.agenda),
  brief: json(m.brief),
  ai: json(m.ai),
  recap: json(m.recap),
})

const collegeRow = (c: CollegeApp): Out<'colleges'> => ({
  id: c.id,
  student_id: c.studentId,
  name: c.name,
  plan: n(c.plan),
  deadline: n(c.deadline),
  status: c.status,
  fit: c.fit,
  note: n(c.note),
  directory_unitid: n(c.directoryUnitid),
  fit_reason: n(c.fitReason),
  fit_set_by: n(c.fitSetBy),
})

const documentRow = (d: StudentDocument): Out<'documents'> => ({
  id: d.id,
  student_id: d.studentId || null,
  name: d.name,
  kind: d.kind,
  category: d.category,
  added_on: d.addedOn,
  added_by: d.addedBy,
  url: n(d.url),
  task_id: n(d.taskId),
  note: n(d.note),
  essay_group: n(d.essayGroup),
  target: n(d.target),
  topic: n(d.topic),
  essay_prompt: n(d.essayPrompt),
  word_limit: n(d.wordLimit),
  status: n(d.status),
  drafts: json(d.drafts),
  feedback: json(d.feedback),
  type_id: n(d.typeId),
  title: n(d.title),
  original_filename: n(d.originalFilename),
  storage_path: n(d.storagePath),
  size_bytes: n(d.sizeBytes),
  mime_type: n(d.mimeType),
  content_hash: n(d.contentHash),
  college_id: n(d.collegeId),
  school_year: n(d.schoolYear),
  uploaded_by_kind: n(d.uploadedByKind),
  uploaded_by_user: n(d.uploadedByUser),
  student_link_id: n(d.studentLinkId),
  source: n(d.source),
  drive_file_id: n(d.driveFileId),
  drive_url: n(d.driveUrl),
  drive_modified_at: n(d.driveModifiedAt),
  file_status: n(d.fileStatus),
  sorted_by: n(d.sortedBy),
  needs_check: Boolean(d.needsCheck),
  ai_suggestion: json(d.aiSuggestion),
  opened_at: n(d.openedAt),
})

// Only the firm's owner may write folders: row level security refuses anyone else.
const documentTypeRow = (t: DocumentType): Omit<Out<'document_types'>, 'archived_at'> & { archived_at: string | null } => ({
  id: t.id,
  name: t.name,
  description: t.description,
  sensitivity: t.sensitivity,
  position: t.position,
  archived_at: n(t.archivedAt),
})

const listDraftRow = (d: CollegeListDraft): Out<'college_list_drafts'> => ({
  id: d.id,
  student_id: d.studentId,
  created_by: n(d.createdBy),
  preferences: json(d.preferences),
  note: n(d.note),
  source: json(d.source),
  status: d.status,
  approved_by: n(d.approvedBy),
  approved_by_name: n(d.approvedByName),
  approved_at: n(d.approvedAt),
})

const listDraftItemRow = (i: CollegeListDraftItem): Out<'college_list_draft_items'> => ({
  id: i.id,
  draft_id: i.draftId,
  unitid: i.unitid,
  fit: i.fit,
  fit_basis: json(i.fitBasis),
  fit_set_by: i.fitSetBy,
  reason: i.reason,
  ai_explained: i.aiExplained,
  kept: i.kept,
  position: i.position,
})

const reportRow = (r: ParentReport): Out<'reports'> => ({
  id: r.id,
  student_id: r.studentId,
  parent_id: r.parentId,
  created_on: r.createdOn,
  status: r.status,
  language: r.language,
  channel: r.channel,
  subject: r.subject,
  body_en: r.bodyEn,
  body_local: n(r.bodyLocal),
  sent_on: n(r.sentOn),
  meeting_id: n(r.meetingId),
  facts: json(r.facts),
  source: json(r.source),
  approval: json(r.approval),
})

const activityRow = (e: ActivityEvent): Out<'activity'> => ({
  id: e.id,
  student_id: e.studentId,
  at: e.at,
  actor: e.actor,
  text: e.text,
})

const weeklyTextRow = (w: WeeklyText): Out<'weekly_texts'> => ({
  id: w.id,
  student_id: w.studentId,
  week_start: w.weekStart,
  status: w.status,
  body: w.body,
  facts: json(w.facts),
  source: json(w.source),
  approval: json(w.approval),
  sent_via: n(w.sentVia),
  used_note: json(w.usedNote),
  lead: json(w.lead),
  parent_copy: json(w.parentCopy),
})

// created_at is the database's: a note is dated when it is saved.
const personalNoteRow = (p: PersonalNote): Out<'personal_notes'> => ({
  id: p.id,
  student_id: p.studentId,
  text: p.text,
  event_date: n(p.eventDate),
  event_date_approx: Boolean(p.eventDate && p.eventDateApprox),
  uses: json(p.uses),
  source: p.source,
  meeting_id: n(p.meetingId),
  approval: json(p.approval),
})

const ruleRow = (r: ReminderRule) => ({ rule: r.id, days: r.days, mode: r.mode })

// ── Changes ─────────────────────────────────────────────────────────────────

type WriteTable = DataTable | 'reminder_rules' | 'document_types' | 'college_list_drafts' | 'college_list_draft_items'

/** One batch for apply_changes. See supabase/migrations/…_apply_changes.sql. */
export interface Changes {
  firm?: { name?: string; displayName?: string; weeklyTextDay?: number; sortFilesAutomatically?: boolean }
  /** Remove everything the firm has before applying the rest. */
  clear?: boolean
  upsert: Partial<Record<WriteTable, object[]>>
  delete: Partial<Record<WriteTable, ID[]>>
}

interface Diff<T> {
  changed: T[]
  removed: ID[]
}

/** Items that are new or were replaced, and ids that are gone. Unchanged items keep their reference. */
function diffList<T extends { id: ID }>(before: T[], after: T[]): Diff<T> {
  if (before === after) return { changed: [], removed: [] }
  const old = new Map(before.map((item) => [item.id, item]))
  const changed = after.filter((item) => old.get(item.id) !== item)
  const kept = new Set(after.map((item) => item.id))
  return { changed, removed: before.filter((item) => !kept.has(item.id)).map((item) => item.id) }
}

/**
 * What it takes to turn `before` into `after` in the database, or undefined
 * when nothing that is stored changed.
 */
export function diffData(before: AppData, after: AppData): Changes | undefined {
  const changes: Changes = { upsert: {}, delete: {} }
  let any = false
  const put = (table: WriteTable, rows: object[]) => {
    if (rows.length === 0) return
    changes.upsert[table] = [...(changes.upsert[table] ?? []), ...rows]
    any = true
  }
  const drop = (table: WriteTable, ids: ID[]) => {
    if (ids.length === 0) return
    changes.delete[table] = [...(changes.delete[table] ?? []), ...ids]
    any = true
  }

  if (
    before.firm.name !== after.firm.name ||
    before.firm.counselorName !== after.firm.counselorName ||
    before.firm.weeklyTextDay !== after.firm.weeklyTextDay ||
    before.firm.sortFilesAutomatically !== after.firm.sortFilesAutomatically
  ) {
    changes.firm = {}
    if (before.firm.sortFilesAutomatically !== after.firm.sortFilesAutomatically) changes.firm.sortFilesAutomatically = after.firm.sortFilesAutomatically
    if (before.firm.weeklyTextDay !== after.firm.weeklyTextDay) changes.firm.weeklyTextDay = after.firm.weeklyTextDay
    if (before.firm.name !== after.firm.name) changes.firm.name = after.firm.name
    if (before.firm.counselorName !== after.firm.counselorName) changes.firm.displayName = after.firm.counselorName
    any = true
  }

  // Students carry their parents; each is its own table.
  const students = diffList(before.students, after.students)
  const oldStudents = new Map(before.students.map((s) => [s.id, s]))
  put('students', students.changed.map(studentRow))
  for (const student of students.changed) {
    const parents = diffList(oldStudents.get(student.id)?.parents ?? [], student.parents)
    put('parents', parents.changed.map((p) => parentRow(p, student.id)))
    drop('parents', parents.removed)
  }
  drop('students', students.removed)

  // Lists the app adds to at the end.
  const appended = <T extends { id: ID }>(table: WriteTable, a: T[], b: T[], row: (item: T) => object) => {
    const d = diffList(a, b)
    put(table, d.changed.map(row))
    drop(table, d.removed)
  }
  appended('meetings', before.meetings, after.meetings, meetingRow)
  appended('tasks', before.tasks, after.tasks, taskRow)
  appended('colleges', before.colleges, after.colleges, collegeRow)
  appended('personal_notes', before.personalNotes, after.personalNotes, personalNoteRow)
  appended('weekly_texts', before.weeklyTexts, after.weeklyTexts, weeklyTextRow)
  appended('college_list_drafts', before.collegeListDrafts, after.collegeListDrafts, listDraftRow)
  appended('college_list_draft_items', before.collegeListDraftItems, after.collegeListDraftItems, listDraftItemRow)
  // Folders are archived, never deleted.
  put('document_types', diffList(before.documentTypes, after.documentTypes).changed.map(documentTypeRow))

  // Lists the app adds to at the front (newest first). Rows are sent oldest
  // first, so insertion order in the database matches and loading can reverse it.
  const prepended = <T extends { id: ID }>(table: WriteTable, a: T[], b: T[], row: (item: T) => object, canDelete: boolean) => {
    const d = diffList(a, b)
    put(table, d.changed.map(row).reverse())
    if (canDelete) drop(table, d.removed)
  }
  prepended('documents', before.documents, after.documents, documentRow, true)
  prepended('reports', before.reports, after.reports, reportRow, true)
  // Activity is only ever added to. The outbox is not in this batch: queue_message writes it.
  prepended('activity', before.activity, after.activity, activityRow, false)

  put('reminder_rules', diffList(before.reminderRules, after.reminderRules).changed.map(ruleRow))

  return any ? changes : undefined
}

export async function applyChanges(firmId: ID, changes: Changes): Promise<void> {
  const { error } = await supabase.rpc('apply_changes', { firm: firmId, changes: changes as unknown as Json })
  if (error) fail(error, 'Could not save')
}

// ── Loading ─────────────────────────────────────────────────────────────────

const PAGE = 1000
/** How much of the activity log is kept in memory. The rest stays in the database. */
export const ACTIVITY_LIMIT = 300

/** Older activity rows than the ones already loaded (for the Activity screen’s Load more). */
export async function loadOlderActivity(firmId: ID, olderThanAt: string, limit = 50, studentId?: ID): Promise<ActivityEvent[]> {
  let query = supabase.from('activity').select('*').eq('firm_id', firmId).lt('at', olderThanAt).order('at', { ascending: false }).limit(limit)
  if (studentId) query = query.eq('student_id', studentId)
  const { data, error } = await query
  if (error) fail(error, 'Could not load older activity')
  return data.map(activityFrom)
}

/** Every row of one table for the firm, in insertion order. Pages past the API's row cap. */
async function all<T extends DataTable>(table: T, firmId: ID, newestFirst: boolean, limit = Infinity): Promise<Row<T>[]> {
  const rows: Row<T>[] = []
  while (rows.length < limit) {
    const size = Math.min(PAGE, limit - rows.length)
    const { data, error } = await supabase
      .from(table as 'tasks')
      .select('*')
      .eq('firm_id', firmId)
      .order('seq', { ascending: !newestFirst })
      .range(rows.length, rows.length + size - 1)
    if (error) fail(error, 'Could not load your data')
    rows.push(...(data as unknown as Row<T>[]))
    if (data.length < size) break
  }
  return rows
}

export interface Membership {
  firmId: ID
  role: 'owner' | 'counselor'
}

/** The firm this person belongs to, if any. */
export async function myMembership(userId: ID): Promise<Membership | undefined> {
  const { data, error } = await supabase.from('firm_members').select('firm_id, role').eq('user_id', userId).maybeSingle()
  if (error) fail(error, 'Could not check your account')
  return data ? { firmId: data.firm_id, role: data.role as Membership['role'] } : undefined
}

/** Creates a firm with the signed-in person as its owner. */
export async function createFirm(name: string, displayName: string): Promise<ID> {
  const { data, error } = await supabase.rpc('create_firm', { name, display_name: displayName })
  if (error) fail(error, 'Could not create the firm')
  return data
}

export const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || 'Counselor'

/** Everything the firm has, in the shape the store holds. */
export async function loadAll(firmId: ID, userId: ID): Promise<AppData> {
  const [firm, member, students, parents, tasks, meetings, colleges, documents, reports, outbox, activity, rules, weeklyTexts, personalNotes, documentTypes, listDrafts, listDraftItems, skips] = await Promise.all([
    supabase.from('firms').select('name, weekly_text_day, sort_files_automatically').eq('id', firmId).single(),
    supabase.from('firm_members').select('display_name').eq('firm_id', firmId).eq('user_id', userId).single(),
    all('students', firmId, false),
    all('parents', firmId, false),
    all('tasks', firmId, false),
    all('meetings', firmId, false),
    all('colleges', firmId, false),
    all('documents', firmId, true),
    all('reports', firmId, true),
    all('outbox', firmId, true),
    all('activity', firmId, true, ACTIVITY_LIMIT),
    supabase.from('reminder_rules').select('rule, days, mode').eq('firm_id', firmId),
    all('weekly_texts', firmId, false),
    all('personal_notes', firmId, false),
    supabase.from('document_types').select('*').eq('firm_id', firmId).order('position').order('name'),
    all('college_list_drafts', firmId, false),
    supabase.from('college_list_draft_items').select('*').eq('firm_id', firmId).order('position').limit(5000),
    supabase.from('reminder_skips').select('*').eq('firm_id', firmId).order('skipped_at', { ascending: false }),
  ])
  if (firm.error) fail(firm.error, 'Could not load your firm')
  if (member.error) fail(member.error, 'Could not load your account')
  if (rules.error) fail(rules.error, 'Could not load your reminder rules')
  if (documentTypes.error) fail(documentTypes.error, 'Could not load your folders')
  if (listDraftItems.error) fail(listDraftItems.error, 'Could not load your draft lists')
  if (skips.error) fail(skips.error, 'Could not load reminder skips')

  const parentsOf = new Map<ID, Parent[]>()
  for (const p of parents) parentsOf.set(p.student_id, [...(parentsOf.get(p.student_id) ?? []), parentFrom(p)])
  const saved = new Map(rules.data.map((r) => [r.rule, r]))
  const info: Firm = { name: firm.data.name, weeklyTextDay: firm.data.weekly_text_day, sortFilesAutomatically: firm.data.sort_files_automatically, counselorName: member.data.display_name, counselorFirstName: firstNameOf(member.data.display_name) }

  return {
    firm: info,
    students: students.map((s) => studentFrom(s, parentsOf.get(s.id) ?? [])),
    tasks: tasks.map(taskFrom),
    meetings: meetings.map(meetingFrom),
    colleges: colleges.map(collegeFrom),
    documents: documents.map(documentFrom),
    reports: reports.map(reportFrom),
    outbox: outbox.map(outboxFrom),
    // Labels and descriptions live in the app; the database holds what the firm changed.
    reminderRules: DEFAULT_REMINDER_RULES.map((rule) => {
      const row = saved.get(rule.id)
      return row ? { ...rule, days: row.days, mode: row.mode as ReminderRule['mode'] } : { ...rule }
    }),
    activity: activity.map(activityFrom),
    weeklyTexts: weeklyTexts.map(weeklyTextFrom),
    personalNotes: personalNotes.map(personalNoteFrom),
    documentTypes: documentTypes.data.map(documentTypeFrom),
    collegeListDrafts: listDrafts.map(listDraftFrom),
    collegeListDraftItems: listDraftItems.data.map(listDraftItemFrom),
    reminderSkips: skips.data.map(reminderSkipFrom),
  }
}

const reminderSkipFrom = (r: { id: string; dedupe_key: string; skipped_at: string; until: string | null; skipped_by: string | null }): ReminderSkip => ({
  id: r.id,
  dedupeKey: r.dedupe_key,
  skippedAt: stamp(r.skipped_at),
  until: r.until ?? undefined,
  skippedBy: u(r.skipped_by),
})

/** Records a skip for a reminder dedupe key. Replaces any existing skip for that key. */
export async function skipReminder(firmId: ID, dedupeKey: string, userId: ID, until: string | null): Promise<ReminderSkip> {
  await supabase.from('reminder_skips').delete().eq('firm_id', firmId).eq('dedupe_key', dedupeKey)
  const { data, error } = await supabase
    .from('reminder_skips')
    .insert({ firm_id: firmId, dedupe_key: dedupeKey, skipped_by: userId, until })
    .select('*')
    .single()
  if (error) fail(error, 'Could not skip the reminder')
  return reminderSkipFrom(data)
}

/** Removes a skip so the reminder can appear again. */
export async function undoReminderSkip(id: ID): Promise<void> {
  const { error } = await supabase.from('reminder_skips').delete().eq('id', id)
  if (error) fail(error, 'Could not undo the skip')
}

// ── Student links ───────────────────────────────────────────────────────────

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function listStudentLinks(firmId: ID): Promise<StudentLink[]> {
  const { data, error } = await supabase.from('student_links').select('*').eq('firm_id', firmId).is('revoked_at', null).order('created_at', { ascending: false })
  if (error) fail(error, 'Could not load student links')
  return data.map(linkFrom)
}

const newToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const hashToken = async (token: string) => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))

/**
 * Makes a new link for a student. Only the SHA-256 hash is stored. `token` is
 * returned once so the counselor can copy it, and cannot be read back.
 */
export async function createStudentLink(firmId: ID, studentId: ID, userId: ID): Promise<{ link: StudentLink; token: string }> {
  const token = newToken()
  const { data, error } = await supabase
    .from('student_links')
    .insert({ firm_id: firmId, student_id: studentId, token_hash: await hashToken(token), created_by: userId })
    .select('*')
    .single()
  if (error) fail(error, 'Could not create the link')
  return { link: linkFrom(data), token }
}

/** Replaces the hash. The previous token stops working. The new token is returned once. */
export async function rotateStudentLink(id: ID): Promise<{ link: StudentLink; token: string }> {
  const token = newToken()
  const { data, error } = await supabase.from('student_links').update({ token_hash: await hashToken(token) }).eq('id', id).select('*').single()
  if (error) fail(error, 'Could not replace the link')
  return { link: linkFrom(data), token }
}

interface Queued {
  message: OutboxMessage
  activity: ActivityEvent
}

function queuedFrom(data: Json): Queued {
  const body = data as { message?: Row<'outbox'>; activity?: Row<'activity'> }
  if (!body?.message || !body.activity) throw new RepoError('Could not queue the message: the server returned an unexpected result.')
  return { message: outboxFrom(body.message), activity: activityFrom(body.activity) }
}

/** The only insert into the outbox. The database records the approver and the 60-second hold. */
export async function queueMessage(payload: QueuePayload): Promise<Queued> {
  const { data, error } = await supabase.rpc('queue_message', { payload: payload as unknown as Json })
  if (error) fail(error, 'Could not queue the message')
  return queuedFrom(data)
}

/** Undoes a queued message while its send time is still in the future. */
export async function cancelMessage(id: ID): Promise<Queued> {
  const { data, error } = await supabase.rpc('cancel_message', { id })
  if (error) fail(error, 'Could not undo the message')
  return queuedFrom(data)
}

export async function revokeStudentLink(id: ID): Promise<void> {
  const { error } = await supabase.from('student_links').update({ revoked_at: new Date().toISOString() }).eq('id', id)
  if (error) fail(error, 'Could not revoke the link')
}

// ── College list drafts ─────────────────────────────────────────────────────
// A draft is created by the server (server/collegeListDrafts.ts) and added to
// the list by a database function, so these read what was saved for the store
// to take in with `absorb`. Review edits are ordinary changes (diffData above).

/** One draft and its colleges, as the server saved them. */
export async function loadListDraft(draftId: ID): Promise<{ draft: CollegeListDraft; items: CollegeListDraftItem[] }> {
  const [draft, items] = await Promise.all([
    supabase.from('college_list_drafts').select('*').eq('id', draftId).single(),
    supabase.from('college_list_draft_items').select('*').eq('draft_id', draftId).order('position'),
  ])
  if (draft.error) fail(draft.error, 'Could not load the draft list')
  if (items.error) fail(items.error, 'Could not load the draft list')
  return { draft: listDraftFrom(draft.data), items: items.data.map(listDraftItemFrom) }
}

/**
 * "Add to list": one database function writes the draft's kept colleges into
 * the student's list (skipping any already there), marks the draft approved
 * with who and when, and logs it. Returns how many were added.
 */
export async function addDraftToCollegeList(draftId: ID): Promise<number> {
  const { data, error } = await supabase.rpc('add_draft_to_college_list', { draft: draftId })
  if (error) fail(error, 'Could not add the draft to the list')
  return data
}

/** What add_draft_to_college_list changed for one student: their list, the draft, and the latest activity. */
export async function loadAfterListApproval(studentId: ID, draftId: ID): Promise<{ colleges: CollegeApp[]; draft: CollegeListDraft; activity: ActivityEvent[] }> {
  const [colleges, draft, activity] = await Promise.all([
    supabase.from('colleges').select('*').eq('student_id', studentId).order('seq'),
    supabase.from('college_list_drafts').select('*').eq('id', draftId).single(),
    supabase.from('activity').select('*').eq('student_id', studentId).order('seq', { ascending: false }).limit(5),
  ])
  if (colleges.error) fail(colleges.error, 'Could not load the college list')
  if (draft.error) fail(draft.error, 'Could not load the draft list')
  if (activity.error) fail(activity.error, 'Could not load the activity log')
  return { colleges: colleges.data.map(collegeFrom), draft: listDraftFrom(draft.data), activity: activity.data.map(activityFrom) }
}
