// Loading a firm's caseload: the snake_case rows of each table, mapped to the
// camelCase shapes in src/types.ts. One place, used two ways:
//
//   * the browser loads the store with it (src/data/repo.ts), and
//   * the assistant's read tools load the same shapes with the counselor's own
//     client (server/agent/caseload.ts), so the Inbox and the reminder queue
//     are worked out by the very same code the screens use, never a second copy.
//
// Nothing here writes. What can be read is decided by the client that is
// passed in: row level security applies to it as to any other read.

import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_REMINDER_RULES } from '../src/data/seed.js'
import type { Database, Json } from '../src/lib/database.types.js'
import type {
  ActivityEvent,
  AgentProposal,
  AppData,
  CollegeApp,
  CollegeListDraft,
  CollegeListDraftItem,
  DocumentType,
  Firm,
  ID,
  Meeting,
  MessageDraft,
  OutboxMessage,
  Parent,
  ParentReport,
  PersonalNote,
  ReminderRule,
  ReminderSkip,
  Student,
  StudentDocument,
  Task,
  Template,
  WeeklyText,
} from '../src/types.js'

export type Client = SupabaseClient<Database>
type Tables = Database['public']['Tables']
type Row<T extends keyof Tables> = Tables[T]['Row']
type DataTable = 'students' | 'parents' | 'meetings' | 'tasks' | 'colleges' | 'documents' | 'reports' | 'outbox' | 'activity' | 'weekly_texts' | 'personal_notes' | 'college_list_drafts'

/** What to do with a failed read. It must not return. */
export type Fail = (error: { message: string; code?: string } | null, doing: string) => never
const thrown: Fail = (error, doing) => {
  throw new Error(`${doing}: ${error?.message ?? 'unknown error'}`)
}

/** null → undefined on the way out. */
export const u = <T>(value: T | null): T | undefined => value ?? undefined
export const from = <T>(value: Json | null): T | undefined => (value ?? undefined) as T | undefined
/** Timestamps come back with an offset ("+00:00"); the app uses the "Z" form everywhere. */
export const stamp = (value: string) => new Date(value).toISOString()

const PAGE = 1000
/** How much of the activity log is kept in memory. The rest stays in the database. */
export const ACTIVITY_LIMIT = 300

export const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || 'Counselor'

// ── Rows → app shapes ───────────────────────────────────────────────────────

export const parentFrom = (r: Row<'parents'>): Parent => ({
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

export const studentFrom = (r: Row<'students'>, parents: Parent[]): Student => ({
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

export const taskFrom = (r: Row<'tasks'>): Task => ({
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
  templateId: u(r.template_id),
})

export const meetingFrom = (r: Row<'meetings'>): Meeting => ({
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
  googleEventId: u(r.google_event_id),
  googleSync: u(r.google_sync),
})

export const collegeFrom = (r: Row<'colleges'>): CollegeApp => ({
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

export const reportFrom = (r: Row<'reports'>): ParentReport => ({
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

export const outboxFrom = (r: Row<'outbox'>): OutboxMessage => ({
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
  detail: u(r.delivery_detail) as OutboxMessage['detail'],
})

export const activityFrom = (r: Row<'activity'>): ActivityEvent => ({
  id: r.id,
  at: stamp(r.at),
  // Empty for a line about the firm itself (a member joined, left or was removed).
  studentId: r.student_id ?? '',
  actor: r.actor as ActivityEvent['actor'],
  text: r.text,
  actorUser: u(r.actor_user),
})

export const weeklyTextFrom = (r: Row<'weekly_texts'>): WeeklyText => ({
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

export const templateFrom = (r: Row<'templates'>): Template => ({
  id: r.id,
  kind: r.kind as Template['kind'],
  name: r.name,
  content: from<Template['content']>(r.content)!,
  archived: r.archived,
  createdBy: u(r.created_by),
})

export const messageDraftFrom = (r: Row<'message_drafts'>): MessageDraft => ({
  id: r.id,
  studentId: r.student_id,
  templateId: u(r.template_id),
  batchId: r.batch_id,
  toKind: r.to_kind as MessageDraft['toKind'],
  parentId: u(r.parent_id),
  toName: r.to_name,
  channel: r.channel as MessageDraft['channel'],
  language: r.language as MessageDraft['language'],
  kind: r.kind as MessageDraft['kind'],
  subject: u(r.subject),
  body: r.body,
  untranslated: r.untranslated || undefined,
  status: r.status as MessageDraft['status'],
  approval: from<MessageDraft['approval']>(r.approval),
  createdAt: stamp(r.created_at),
})

export const personalNoteFrom = (r: Row<'personal_notes'>): PersonalNote => ({
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

/** Every column but token_hash, which signed-in people cannot read. */
/** Every row of one table for the firm, in insertion order. Pages past the API's row cap. */
async function all<T extends DataTable>(client: Client, fail: Fail, table: T, firmId: ID, newestFirst: boolean, limit = Infinity): Promise<Row<T>[]> {
  const rows: Row<T>[] = []
  while (rows.length < limit) {
    const size = Math.min(PAGE, limit - rows.length)
    const { data, error } = await client
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

/**
 * Everything the firm has that this client is allowed to read, in the shape
 * the store holds. The browser passes its own client; the assistant's tools
 * pass the counselor's, so row level security decides what is in it.
 */
export async function loadCaseload(client: Client, firmId: ID, userId: ID, fail: Fail = thrown): Promise<AppData> {
  const [firm, member, students, parents, tasks, meetings, colleges, documents, reports, outbox, activity, rules, weeklyTexts, personalNotes, documentTypes, listDrafts, listDraftItems, skips, proposals, templates, messageDrafts] = await Promise.all([
    client.from('firms').select('name, weekly_text_day, sort_files_automatically').eq('id', firmId).single(),
    client.from('firm_members').select('display_name').eq('firm_id', firmId).eq('user_id', userId).single(),
    all(client, fail, 'students', firmId, false),
    all(client, fail, 'parents', firmId, false),
    all(client, fail, 'tasks', firmId, false),
    all(client, fail, 'meetings', firmId, false),
    all(client, fail, 'colleges', firmId, false),
    all(client, fail, 'documents', firmId, true),
    all(client, fail, 'reports', firmId, true),
    all(client, fail, 'outbox', firmId, true),
    all(client, fail, 'activity', firmId, true, ACTIVITY_LIMIT),
    client.from('reminder_rules').select('rule, days, mode').eq('firm_id', firmId),
    all(client, fail, 'weekly_texts', firmId, false),
    all(client, fail, 'personal_notes', firmId, false),
    client.from('document_types').select('*').eq('firm_id', firmId).order('position').order('name'),
    all(client, fail, 'college_list_drafts', firmId, false),
    client.from('college_list_draft_items').select('*').eq('firm_id', firmId).order('position').limit(5000),
    client.from('reminder_skips').select('*').eq('firm_id', firmId).order('skipped_at', { ascending: false }),
    client.from('agent_proposals').select('*').eq('firm_id', firmId).eq('status', 'pending').order('created_at', { ascending: false }).limit(200),
    client.from('templates').select('*').eq('firm_id', firmId).order('seq'),
    // Decided drafts are history the Sent log already holds as messages; only the waiting ones are loaded.
    client.from('message_drafts').select('*').eq('firm_id', firmId).eq('status', 'draft').order('seq').limit(2000),
  ])
  if (firm.error) fail(firm.error, 'Could not load your firm')
  if (member.error) fail(member.error, 'Could not load your account')
  if (rules.error) fail(rules.error, 'Could not load your reminder rules')
  if (documentTypes.error) fail(documentTypes.error, 'Could not load your folders')
  if (listDraftItems.error) fail(listDraftItems.error, 'Could not load your draft lists')
  if (skips.error) fail(skips.error, 'Could not load reminder skips')
  if (proposals.error) fail(proposals.error, 'Could not load assistant proposals')
  if (templates.error) fail(templates.error, 'Could not load your templates')
  if (messageDrafts.error) fail(messageDrafts.error, 'Could not load your drafts')

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
    agentProposals: proposals.data.map(agentProposalFrom),
    templates: templates.data.map(templateFrom),
    messageDrafts: messageDrafts.data.map(messageDraftFrom),
  }
}

export const reminderSkipFrom = (r: { id: string; dedupe_key: string; skipped_at: string; until: string | null; skipped_by: string | null }): ReminderSkip => ({
  id: r.id,
  dedupeKey: r.dedupe_key,
  skippedAt: stamp(r.skipped_at),
  until: r.until ?? undefined,
  skippedBy: u(r.skipped_by),
})

export const agentProposalFrom = (r: {
  id: string
  student_id: string
  thread_id: string
  kind: string
  payload: Json
  rationale: string
  sources: Json
  status: string
  created_at: string
  decided_by: string | null
  decided_at: string | null
}): AgentProposal => ({
  id: r.id,
  studentId: r.student_id,
  threadId: r.thread_id,
  kind: r.kind as AgentProposal['kind'],
  payload: (r.payload && typeof r.payload === 'object' && !Array.isArray(r.payload) ? r.payload : {}) as Record<string, unknown>,
  rationale: r.rationale,
  sources: Array.isArray(r.sources) ? (r.sources as unknown as AgentProposal['sources']) : [],
  status: r.status as AgentProposal['status'],
  createdAt: stamp(r.created_at),
  decidedBy: u(r.decided_by),
  decidedAt: r.decided_at ? stamp(r.decided_at) : undefined,
})

