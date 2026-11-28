// The only file that talks to Supabase tables. Everything else works with the
// camelCase shapes in src/types.ts; this file maps them to and from the
// snake_case rows, loads a firm's data, and writes changes back.
//
// Most writes go through apply_changes, one transaction under the signed-in
// person's own permissions. The store works out the batch with diffData().
// Outbox rows are the exception: queue_message and cancel_message are the only
// writes, and apply_changes rejects a batch that names the outbox.

import { studentLinkExpiry } from '../../shared/dispatch'
import { activityFrom, collegeFrom, listDraftFrom, listDraftItemFrom, loadCaseload, outboxFrom, reminderSkipFrom, stamp } from '../../shared/caseload'
import type { QueuePayload } from '../../shared/outbox'
import type { Database, Json } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import type {
  ActivityEvent,
  AppData,
  CollegeApp,
  CollegeListDraft,
  CollegeListDraftItem,
  DocumentType,
  ID,
  Meeting,
  OutboxMessage,
  Parent,
  ParentReport,
  MessageDraft,
  PersonalNote,
  Template,
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
const json = (value: unknown): Json => (value ?? null) as Json

const LINK_COLUMNS = 'id, firm_id, student_id, created_by, created_at, updated_at, revoked_at, expires_at'

const linkFrom = (r: Pick<Row<'student_links'>, 'id' | 'student_id' | 'created_at' | 'revoked_at'>): StudentLink => ({
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
  template_id: n(t.templateId),
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
  google_event_id: n(m.googleEventId),
  google_sync: n(m.googleSync),
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
  student_id: e.studentId || null,
  at: e.at,
  actor: e.actor,
  text: e.text,
  actor_user: n(e.actorUser),
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

const templateRow = (t: Template): Out<'templates'> => ({
  id: t.id,
  kind: t.kind,
  name: t.name,
  content: json(t.content),
  archived: t.archived,
  created_by: n(t.createdBy),
})

// created_at is the database's: a draft is dated when it is saved.
const messageDraftRow = (d: MessageDraft): Out<'message_drafts'> => ({
  id: d.id,
  student_id: d.studentId,
  template_id: n(d.templateId),
  batch_id: d.batchId,
  to_kind: d.toKind,
  parent_id: n(d.parentId),
  to_name: d.toName,
  channel: d.channel,
  language: d.language,
  kind: d.kind,
  subject: n(d.subject),
  body: d.body,
  untranslated: Boolean(d.untranslated),
  status: d.status,
  approval: json(d.approval),
})

const ruleRow = (r: ReminderRule) => ({ rule: r.id, days: r.days, mode: r.mode })

// ── Changes ─────────────────────────────────────────────────────────────────

type WriteTable = DataTable | 'reminder_rules' | 'document_types' | 'college_list_drafts' | 'college_list_draft_items' | 'templates' | 'message_drafts'

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
  // Templates are archived and drafts are decided, never deleted. Templates go first: a task can point at one.
  put('templates', diffList(before.templates ?? [], after.templates ?? []).changed.map(templateRow))
  appended('meetings', before.meetings, after.meetings, meetingRow)
  appended('tasks', before.tasks, after.tasks, taskRow)
  appended('colleges', before.colleges, after.colleges, collegeRow)
  appended('personal_notes', before.personalNotes, after.personalNotes, personalNoteRow)
  appended('weekly_texts', before.weeklyTexts, after.weeklyTexts, weeklyTextRow)
  appended('college_list_drafts', before.collegeListDrafts, after.collegeListDrafts, listDraftRow)
  appended('college_list_draft_items', before.collegeListDraftItems, after.collegeListDraftItems, listDraftItemRow)
  // Folders are archived, never deleted.
  put('document_types', diffList(before.documentTypes, after.documentTypes).changed.map(documentTypeRow))
  put('message_drafts', diffList(before.messageDrafts ?? [], after.messageDrafts ?? []).changed.map(messageDraftRow))

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
  // Only counselor lines are written from here; the database refuses any other actor.
  const counselorLines = (list: ActivityEvent[]) => list.filter((e) => e.actor === 'counselor')
  prepended('activity', counselorLines(before.activity), counselorLines(after.activity), activityRow, false)

  put('reminder_rules', diffList(before.reminderRules, after.reminderRules).changed.map(ruleRow))

  return any ? changes : undefined
}

export async function applyChanges(firmId: ID, changes: Changes): Promise<void> {
  const { error } = await supabase.rpc('apply_changes', { firm: firmId, changes: changes as unknown as Json })
  if (error) fail(error, 'Could not save')
}

// ── Loading ─────────────────────────────────────────────────────────────────
// The rows of each table become the app's shapes in shared/caseload.ts, which
// the assistant's read tools also use, with the counselor's own client.

export { ACTIVITY_LIMIT, documentFrom, documentTypeFrom, firstNameOf, listDraftFrom, listDraftItemFrom } from '../../shared/caseload'

/** Everything the firm has, in the shape the store holds. */
export const loadAll = (firmId: ID, userId: ID): Promise<AppData> => loadCaseload(supabase, firmId, userId, fail)


/** Older activity rows than the ones already loaded (for the Activity screen’s Load more). */
export async function loadOlderActivity(firmId: ID, olderThanAt: string, limit = 50, studentId?: ID): Promise<ActivityEvent[]> {
  let query = supabase.from('activity').select('*').eq('firm_id', firmId).lt('at', olderThanAt).order('at', { ascending: false }).limit(limit)
  if (studentId) query = query.eq('student_id', studentId)
  const { data, error } = await query
  if (error) fail(error, 'Could not load older activity')
  return data.map(activityFrom)
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

/**
 * Whether this sign-in is a student's, and if so whether a counselor has turned
 * it off. A student can read their own account row and nothing else.
 */
export async function myStudentAccount(userId: ID): Promise<{ off: boolean } | undefined> {
  const { data, error } = await supabase.from('student_accounts').select('disabled_at').eq('user_id', userId).maybeSingle()
  if (error) fail(error, 'Could not check your account')
  return data ? { off: Boolean(data.disabled_at) } : undefined
}

/** Creates a firm with the signed-in person as its owner. */
export async function createFirm(name: string, displayName: string): Promise<ID> {
  const { data, error } = await supabase.rpc('create_firm', { name, display_name: displayName })
  if (error) fail(error, 'Could not create the firm')
  return data
}

/** Updates a pending proposal’s editable payload (inline edit on the approval card). */
export async function updateAgentProposalPayload(id: ID, payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc('edit_agent_proposal', { proposal: id, payload: payload as Json })
  if (error) fail(error, 'Could not update the proposal')
}

/** Marks a pending proposal approved or discarded. The database records the caller as the decider. */
export async function decideAgentProposal(id: ID, status: 'approved' | 'discarded'): Promise<void> {
  const { error } = await supabase.rpc('decide_agent_proposal', { proposal: id, decision: status })
  if (error) fail(error, 'Could not update the proposal')
}

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
  const { data, error } = await supabase.from('student_links').select(LINK_COLUMNS).eq('firm_id', firmId).is('revoked_at', null).order('created_at', { ascending: false })
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
    .insert({ firm_id: firmId, student_id: studentId, token_hash: await hashToken(token), created_by: userId, expires_at: studentLinkExpiry() })
    .select(LINK_COLUMNS)
    .single()
  if (error) fail(error, 'Could not create the link')
  return { link: linkFrom(data), token }
}

/** Replaces the hash and starts a new expiry. The previous token stops working. The new token is returned once. */
export async function rotateStudentLink(id: ID): Promise<{ link: StudentLink; token: string }> {
  const token = newToken()
  const { data, error } = await supabase
    .from('student_links')
    .update({ token_hash: await hashToken(token), expires_at: studentLinkExpiry() })
    .eq('id', id)
    .select(LINK_COLUMNS)
    .single()
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

/** The only insert into the outbox. The database records the approver and the 10-second hold. */
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

/** The AI line saying a meeting's drafts are ready. The database writes it, worded from the meeting's title. */
export async function logMeetingDraftsReady(meetingId: ID): Promise<ActivityEvent> {
  const { data, error } = await supabase.rpc('log_meeting_drafts_ready', { meeting: meetingId })
  if (error) fail(error, 'Could not record the drafts in the activity log')
  return activityFrom(data as unknown as Row<'activity'>)
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
