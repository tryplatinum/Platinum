// The only file that talks to Supabase tables. Everything else works with the
// camelCase shapes in src/types.ts; this file maps them to and from the
// snake_case rows, loads a firm's data, and writes changes back.
//
// Writes go through one database function, apply_changes, which applies a batch
// of inserts, updates and deletes in a single transaction under the signed-in
// person's own permissions. The store works out the batch with diffData().

import { DEFAULT_REMINDER_RULES } from './seed'
import type { Database, Json } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import type {
  ActivityEvent,
  AppData,
  CollegeApp,
  Firm,
  ID,
  Meeting,
  OutboxMessage,
  Parent,
  ParentReport,
  ReminderRule,
  Student,
  StudentDocument,
  StudentLink,
  Task,
} from '../types'

type Tables = Database['public']['Tables']
type Row<T extends keyof Tables> = Tables[T]['Row']
/** A row as sent to apply_changes: the database supplies firm_id and its own bookkeeping columns. */
type Out<T extends keyof Tables> = Omit<Row<T>, 'firm_id' | 'seq' | 'created_at' | 'updated_at'>

type DataTable = 'students' | 'parents' | 'meetings' | 'tasks' | 'colleges' | 'documents' | 'reports' | 'outbox' | 'activity'

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
  plan: r.plan as CollegeApp['plan'],
  deadline: r.deadline,
  status: r.status as CollegeApp['status'],
  fit: r.fit as CollegeApp['fit'],
  note: u(r.note),
})

const documentFrom = (r: Row<'documents'>): StudentDocument => ({
  id: r.id,
  studentId: r.student_id,
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
  dedupeKey: u(r.dedupe_key),
})

const activityFrom = (r: Row<'activity'>): ActivityEvent => ({
  id: r.id,
  at: stamp(r.at),
  studentId: r.student_id,
  actor: r.actor as ActivityEvent['actor'],
  text: r.text,
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
  plan: c.plan,
  deadline: c.deadline,
  status: c.status,
  fit: c.fit,
  note: n(c.note),
})

const documentRow = (d: StudentDocument): Out<'documents'> => ({
  id: d.id,
  student_id: d.studentId,
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

const outboxRow = (o: OutboxMessage): Out<'outbox'> => ({
  id: o.id,
  student_id: o.studentId,
  sent_at: o.sentAt,
  to_kind: o.toKind,
  to_name: o.toName,
  parent_id: n(o.parentId),
  channel: o.channel,
  language: o.language,
  kind: o.kind,
  body: o.body,
  body_en: n(o.bodyEn),
  trigger: o.trigger,
  task_id: n(o.taskId),
  dedupe_key: n(o.dedupeKey),
})

const activityRow = (e: ActivityEvent): Out<'activity'> => ({
  id: e.id,
  student_id: e.studentId,
  at: e.at,
  actor: e.actor,
  text: e.text,
})

const ruleRow = (r: ReminderRule) => ({ rule: r.id, days: r.days, mode: r.mode })

// ── Changes ─────────────────────────────────────────────────────────────────

type WriteTable = DataTable | 'reminder_rules'

/** One batch for apply_changes. See supabase/migrations/…_apply_changes.sql. */
export interface Changes {
  firm?: { name?: string; displayName?: string }
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

  if (before.firm.name !== after.firm.name || before.firm.counselorName !== after.firm.counselorName) {
    changes.firm = {}
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

  // Lists the app adds to at the front (newest first). Rows are sent oldest
  // first, so insertion order in the database matches and loading can reverse it.
  const prepended = <T extends { id: ID }>(table: WriteTable, a: T[], b: T[], row: (item: T) => object, canDelete: boolean) => {
    const d = diffList(a, b)
    put(table, d.changed.map(row).reverse())
    if (canDelete) drop(table, d.removed)
  }
  prepended('documents', before.documents, after.documents, documentRow, true)
  prepended('reports', before.reports, after.reports, reportRow, true)
  // The two logs are only ever added to. (Memory keeps the latest activity only; older rows stay stored.)
  prepended('outbox', before.outbox, after.outbox, outboxRow, false)
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
  const [firm, member, students, parents, tasks, meetings, colleges, documents, reports, outbox, activity, rules] = await Promise.all([
    supabase.from('firms').select('name').eq('id', firmId).single(),
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
  ])
  if (firm.error) fail(firm.error, 'Could not load your firm')
  if (member.error) fail(member.error, 'Could not load your account')
  if (rules.error) fail(rules.error, 'Could not load your reminder rules')

  const parentsOf = new Map<ID, Parent[]>()
  for (const p of parents) parentsOf.set(p.student_id, [...(parentsOf.get(p.student_id) ?? []), parentFrom(p)])
  const saved = new Map(rules.data.map((r) => [r.rule, r]))
  const info: Firm = { name: firm.data.name, counselorName: member.data.display_name, counselorFirstName: firstNameOf(member.data.display_name) }

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
  }
}

// ── Student links ───────────────────────────────────────────────────────────

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function listStudentLinks(firmId: ID): Promise<StudentLink[]> {
  const { data, error } = await supabase.from('student_links').select('*').eq('firm_id', firmId).is('revoked_at', null).order('created_at', { ascending: false })
  if (error) fail(error, 'Could not load student links')
  return data.map(linkFrom)
}

/**
 * Makes a new link for a student. The secret token is returned once, here; the
 * database keeps only its SHA-256 hash, so it cannot be shown again later.
 */
export async function createStudentLink(firmId: ID, studentId: ID, userId: ID): Promise<{ link: StudentLink; token: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const hash = toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  const { data, error } = await supabase
    .from('student_links')
    .insert({ firm_id: firmId, student_id: studentId, token_hash: hash, created_by: userId })
    .select('*')
    .single()
  if (error) fail(error, 'Could not create the link')
  return { link: linkFrom(data), token }
}

export async function revokeStudentLink(id: ID): Promise<void> {
  const { error } = await supabase.from('student_links').update({ revoked_at: new Date().toISOString() }).eq('id', id)
  if (error) fail(error, 'Could not revoke the link')
}
