// Checks, against the real Supabase project, that firms cannot reach each
// other's data, that the anon key alone reaches nothing, and that the student
// link and the AI endpoint let in only who they should. Run with:
//
//   npm run test:isolation
//
// Needs VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY
// in .env.local. It creates two throwaway accounts and firms with invented
// rows, runs the checks, and deletes them again. It makes no AI calls.

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { POST as aiPost } from '../api/ai.js'
import { GET as studentGet, POST as studentPost } from '../api/student.js'
import { POST as documentsPost } from '../api/documents.js'
import { backgroundIdle, matchRoster, sorter } from '../server/documentSorting.js'
import type { SortPromptInput } from '../server/prompts.js'
import { tinyPdf } from '../shared/files.js'
import { STUDENT_TOKEN_HEADER } from '../shared/constants.js'
import type { Json } from '../src/lib/database.types.js'
import { adminClient, anonClient, createAccount, createMember, removeAccount, requireSettings, type TestAccount } from './testAccounts.js'

requireSettings()

let failed = 0
function check(name: string, pass: boolean, detail = ''): void {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const TABLES = ['students', 'parents', 'meetings', 'tasks', 'colleges', 'documents', 'reports', 'outbox', 'reminder_rules', 'activity', 'weekly_texts', 'personal_notes', 'student_links', 'document_types'] as const
const ALL_TABLES = ['firms', 'firm_members', ...TABLES] as const

/** A thing to remember, worded so it would stand out anywhere it leaked. */
const NOTE_TEXT = 'School play on Friday REMEMBERED'

interface Seeded {
  studentId: string
  taskId: string
  parentTaskId: string
  linkToken: string
}

/** One row in every table for the firm, written the way the app writes: through apply_changes. */
async function seed(account: TestAccount): Promise<Seeded> {
  const studentId = randomUUID()
  const parentId = randomUUID()
  const taskId = randomUUID()
  const parentTaskId = randomUUID()
  const meetingId = randomUUID()
  const noteId = randomUUID()
  const task = { student_id: studentId, category: 'essay', due_date: '2030-01-15', status: 'todo', created_on: '2026-11-01', source: 'counselor', attachments: [] }
  const changes = {
    upsert: {
      students: [
        {
          id: studentId, first_name: `Student${account.label}`, last_name: 'Invented', grad_year: 2030, school: 'Test High', city: 'Nowhere',
          tests: { aps: [] }, majors: [], interests: [], activities: [], counselor_notes: `PRIVATE NOTE ${account.label}`, onboarded_on: '2026-11-01',
          report_settings: { schedule: 'manual', recipientIds: [] }, archived: false,
        },
      ],
      parents: [{ id: parentId, student_id: studentId, name: `Parent ${account.label}`, relationship: 'Mother', language: 'en', channel: 'email', email: 'parent@example.com', is_primary: true }],
      meetings: [
        { id: meetingId, student_id: studentId, title: 'Check-in', date: '2030-01-10', time: '16:00', duration_min: 45, status: 'scheduled' },
        {
          id: randomUUID(), student_id: studentId, title: 'Past meeting', date: '2026-11-01', time: '16:00', duration_min: 45, status: 'completed', transcript: 'PRIVATE TRANSCRIPT',
          ai: { notes: ['PRIVATE AI NOTE'], draftTasks: [], parentUpdates: [], profileChanges: [], personalNotes: [{ id: 'pn-1', text: 'PRIVATE DRAFT THING TO REMEMBER', evidence: 'PRIVATE EVIDENCE', review: 'pending' }] },
          recap: { summary: 'Approved recap', nextSteps: ['One'], review: 'approved', approval: { by: 'Counselor', byId: account.userId, at: new Date().toISOString() } },
        },
      ],
      tasks: [
        { ...task, id: taskId, title: `Task ${account.label}`, owner: 'student' },
        { ...task, id: parentTaskId, title: 'Parent task', owner: 'parent', owner_parent_id: parentId, progress_note: 'PRIVATE PARENT NOTE' },
      ],
      colleges: [{ id: randomUUID(), student_id: studentId, name: 'Test University', plan: 'RD', deadline: '2030-01-01', status: 'considering', fit: 'Target' }],
      documents: [{ id: randomUUID(), student_id: studentId, name: 'Essay', kind: 'essay', category: 'application', added_on: '2026-11-01', added_by: 'counselor', drafts: [{ n: 1, text: 'PRIVATE DRAFT', savedOn: '2026-11-01' }] }],
      reports: [{ id: randomUUID(), student_id: studentId, parent_id: parentId, created_on: '2026-11-01', status: 'draft', language: 'en', channel: 'email', subject: 'S', body_en: 'PRIVATE REPORT' }],
      outbox: [{ id: randomUUID(), student_id: studentId, sent_at: new Date().toISOString(), to_kind: 'student', to_name: 'N', channel: 'text', language: 'en', kind: 'reminder_late', body: 'B', trigger: 'approved' }],
      reminder_rules: [{ rule: 'student_late', days: 2, mode: 'off' }],
      activity: [{ id: randomUUID(), student_id: studentId, at: new Date().toISOString(), actor: 'counselor', text: 'seeded' }],
      personal_notes: [
        { id: noteId, student_id: studentId, text: NOTE_TEXT, event_date: '2030-01-12', source: 'meeting', meeting_id: meetingId, approval: { by: 'Counselor', byId: account.userId, at: new Date().toISOString() } },
        { id: randomUUID(), student_id: studentId, text: 'Robotics scrimmage REMEMBERED', source: 'counselor', approval: { by: 'Counselor', byId: account.userId, at: new Date().toISOString() } },
      ],
      weekly_texts: [
        {
          id: randomUUID(), student_id: studentId, week_start: '2026-11-22', status: 'draft', body: 'PRIVATE WEEKLY DRAFT', used_note: { id: noteId, text: NOTE_TEXT },
          parent_copy: { parentId, taskId, channel: 'email', language: 'en', kind: 'reminder_late', body: 'PRIVATE PARENT COPY', source: { kind: 'placeholder', reason: 'test' }, status: 'draft' },
        },
      ],
    },
  }
  const applied = await account.client.rpc('apply_changes', { firm: account.firmId, changes: changes as unknown as Json })
  if (applied.error) throw new Error(`seeding ${account.label} failed: ${applied.error.message}`)

  const linkToken = randomBytes(32).toString('base64url')
  const link = await account.client.from('student_links').insert({ firm_id: account.firmId, student_id: studentId, token_hash: createHash('sha256').update(linkToken).digest('hex'), created_by: account.userId })
  if (link.error) throw new Error(`creating a link for ${account.label} failed: ${link.error.message}`)
  return { studentId, taskId, parentTaskId, linkToken }
}

const student = (token: string, body?: unknown) => {
  const request = new Request('http://localhost/api/student', {
    method: body ? 'POST' : 'GET',
    headers: { [STUDENT_TOKEN_HEADER]: token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return body ? studentPost(request) : studentGet(request)
}

const BUCKET = 'documents'
/** A tiny, harmless PDF. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
/** Every object the run puts in the bucket, removed at the end with the service role. */
const objects: string[] = []

const accounts: TestAccount[] = []
try {
  const a = await createAccount('A')
  accounts.push(a)
  const b = await createAccount('B')
  accounts.push(b)
  const seeded = { A: await seed(a), B: await seed(b) }

  // ── Two firms ──
  for (const [me, other] of [[a, b], [b, a]] as const) {
    const theirs = seeded[other.label as 'A' | 'B']
    for (const table of ALL_TABLES) {
      const key = table === 'firms' ? 'id' : 'firm_id'
      const rows = await me.client.from(table).select('*')
      const own = (rows.data ?? []) as unknown as Record<string, string>[]
      check(`${me.label} reads only its own ${table}`, !rows.error && own.length > 0 && own.every((r) => r[key] === me.firmId), `${own.length} rows`)
      const direct = await me.client.from(table).select('*').eq(key as 'id', other.firmId)
      check(`${me.label} cannot read ${other.label}'s ${table}`, (direct.data ?? []).length === 0)
    }
    for (const table of TABLES) {
      const updated = await me.client.from(table).update({ updated_at: new Date().toISOString() }).eq('firm_id', other.firmId).select('id')
      check(`${me.label} cannot update ${other.label}'s ${table}`, (updated.data ?? []).length === 0)
      const deleted = await me.client.from(table).delete().eq('firm_id', other.firmId).select('id')
      check(`${me.label} cannot delete ${other.label}'s ${table}`, (deleted.data ?? []).length === 0)
    }
    const insert = await me.client.from('students').insert({ firm_id: other.firmId, first_name: 'X', last_name: 'Y', grad_year: 2030 })
    check(`${me.label} cannot insert a student into ${other.label}'s firm`, Boolean(insert.error))
    const crossTask = await me.client.from('tasks').insert({ firm_id: me.firmId, student_id: theirs.studentId, title: 'X', category: 'essay', owner: 'student', due_date: '2030-01-01', status: 'todo', source: 'counselor' })
    check(`${me.label} cannot attach a task to ${other.label}'s student`, Boolean(crossTask.error))
    const join = await me.client.from('firm_members').insert({ firm_id: other.firmId, user_id: me.userId, role: 'owner', display_name: 'X' })
    check(`${me.label} cannot add itself to ${other.label}'s firm`, Boolean(join.error))
    const rename = await me.client.from('firms').update({ name: 'Taken over' }).eq('id', other.firmId).select('id')
    check(`${me.label} cannot rename ${other.label}'s firm`, (rename.data ?? []).length === 0)
    const batch = await me.client.rpc('apply_changes', { firm: other.firmId, changes: { delete: { students: [theirs.studentId] } } })
    check(`${me.label} cannot run apply_changes on ${other.label}'s firm`, Boolean(batch.error))
    const overwrite = await me.client.rpc('apply_changes', {
      firm: me.firmId,
      changes: { upsert: { tasks: [{ id: theirs.taskId, student_id: seeded[me.label as 'A' | 'B'].studentId, title: 'Hijacked', category: 'essay', owner: 'student', due_date: '2030-01-01', status: 'todo', created_on: '2026-11-01', source: 'counselor', attachments: [] }] } },
    })
    check(`${me.label} cannot overwrite ${other.label}'s row by reusing its id`, Boolean(overwrite.error))
    const clear = await me.client.rpc('apply_changes', { firm: other.firmId, changes: { clear: true } })
    check(`${me.label} cannot clear ${other.label}'s firm`, Boolean(clear.error))
    const write = await me.client.rpc('student_link_write', { p_firm: other.firmId, p_student: theirs.studentId, p_task: theirs.taskId, p_patch: { status: 'done' }, p_activity: 'x' })
    check(`${me.label} cannot call the student link's write function`, Boolean(write.error))
  }
  const intact = await adminClient().from('tasks').select('title, status').in('id', [seeded.A.taskId, seeded.B.taskId])
  check('both firms’ rows are intact after all of that', (intact.data ?? []).length === 2 && intact.data!.every((t) => t.status === 'todo' && t.title.startsWith('Task ')))
  const second = await a.client.rpc('create_firm', { name: 'Second', display_name: 'A' })
  check('an account cannot create a second firm', Boolean(second.error))

  // ── Rules the database enforces on the new columns ──
  const noApproval = await a.client.from('personal_notes').insert({ firm_id: a.firmId, student_id: seeded.A.studentId, text: 'No approval', source: 'counselor', approval: {} })
  check('a thing to remember cannot be saved without an approval', Boolean(noApproval.error))
  const crossNote = await a.client.from('personal_notes').insert({ firm_id: a.firmId, student_id: seeded.B.studentId, text: 'X', source: 'counselor', approval: { by: 'A', at: new Date().toISOString() } })
  check("A cannot attach a thing to remember to B's student", Boolean(crossNote.error))
  const unapprovedCopy = await a.client.from('weekly_texts').update({ parent_copy: { status: 'sent', body: 'x' } }).eq('firm_id', a.firmId).select('id')
  check('a parent copy cannot be marked sent without an approval', Boolean(unapprovedCopy.error))
  const badSetting = await a.client.from('students').update({ parent_copy: 'sometimes' }).eq('firm_id', a.firmId).select('id')
  check('the parent copy setting takes only its three values', Boolean(badSetting.error))
  const setting = await adminClient().from('students').select('parent_copy').eq('firm_id', a.firmId).single()
  check('a student saved without the setting gets when_slipping', setting.data?.parent_copy === 'when_slipping')

  // ── The anon key alone ──
  const anon = anonClient()
  for (const table of ALL_TABLES) {
    const rows = await anon.from(table).select('*')
    check(`anon reads nothing from ${table}`, (rows.data ?? []).length === 0, rows.error ? 'refused' : 'empty')
    const removed = await anon.from(table).delete().neq('id', randomUUID()).select('id')
    check(`anon deletes nothing from ${table}`, (removed.data ?? []).length === 0)
  }
  check('anon cannot insert a student', Boolean((await anon.from('students').insert({ firm_id: a.firmId, first_name: 'X', last_name: 'Y', grad_year: 2030 })).error))
  check('anon cannot call create_firm', Boolean((await anon.rpc('create_firm', { name: 'X', display_name: 'Y' })).error))
  check('anon cannot call apply_changes', Boolean((await anon.rpc('apply_changes', { firm: a.firmId, changes: { clear: true } })).error))
  check('anon cannot call is_firm_member', Boolean((await anon.rpc('is_firm_member', { firm: a.firmId })).error))
  check('anon cannot call student_link_write', Boolean((await anon.rpc('student_link_write', { p_firm: a.firmId, p_student: seeded.A.studentId, p_task: seeded.A.taskId, p_patch: {}, p_activity: 'x' })).error))
  check('firm A still has its student', ((await adminClient().from('students').select('id').eq('firm_id', a.firmId)).data ?? []).length === 1)

  // ── The student link ──
  const page = await student(seeded.A.linkToken)
  const body = (await page.json()) as { ok: boolean; data?: { students: { id: string; lastName: string; counselorNotes: string; parents: unknown[] }[]; tasks: { id: string; progressNote?: string }[]; meetings: Record<string, unknown>[]; documents: Record<string, unknown>[]; reports: unknown[]; outbox: unknown[]; activity: unknown[] } }
  const text = JSON.stringify(body)
  check('a valid link opens the student page', page.status === 200 && body.ok === true)
  check('the page holds only that student', body.data?.students.length === 1 && body.data.students[0].id === seeded.A.studentId)
  check('the page has no parents, notes, reports, messages or activity', body.data?.students[0].parents.length === 0 && body.data.students[0].counselorNotes === '' && body.data.reports.length === 0 && body.data.outbox.length === 0 && body.data.activity.length === 0)
  check('the page has no private text', !/PRIVATE|parent@example\.com|Parent A/.test(text), text.match(/PRIVATE[ A-Z]*/)?.[0] ?? '')
  const pageNotes = (body.data as unknown as { personalNotes?: unknown[] } | undefined)?.personalNotes ?? []
  check('the page has none of the student’s things to remember', pageNotes.length === 0 && !/REMEMBERED|THING TO REMEMBER|PARENT COPY|EVIDENCE/.test(text), text.match(/[A-Za-z ]*(REMEMBERED|THING TO REMEMBER|PARENT COPY|EVIDENCE)/)?.[0] ?? '')
  const savedNotes = await a.client.from('personal_notes').select('text').eq('student_id', seeded.A.studentId)
  check('…while the firm itself can read them', (savedNotes.data ?? []).some((n) => n.text === NOTE_TEXT))
  check('the page has no AI drafts or transcripts', body.data?.meetings.every((m) => !('ai' in m) && !('transcript' in m)) === true)
  check('the page has no essay drafts (none approved)', body.data?.documents.length === 0)
  check('the page shows the approved recap', text.includes('Approved recap'))
  check("the page has nothing of firm B's", !text.includes('StudentB') && !text.includes(seeded.B.studentId))

  const unknown = await student(randomBytes(32).toString('base64url'))
  check('an unknown token gets 404', unknown.status === 404)
  check('a malformed token gets 404', (await student('nope')).status === 404)

  const done = await student(seeded.A.linkToken, { action: 'progress', taskId: seeded.A.taskId, status: 'done', today: new Date().toISOString().slice(0, 10) })
  const after = await adminClient().from('tasks').select('status, completed_by').eq('id', seeded.A.taskId).single()
  check('the student can mark their task done', done.status === 200 && after.data?.status === 'done' && after.data.completed_by === 'student')
  const logged = await adminClient().from('activity').select('actor, text').eq('student_id', seeded.A.studentId).eq('actor', 'student')
  check('that is recorded in activity as done by the student', (logged.data ?? []).length === 1, logged.data?.[0]?.text)
  const note = await student(seeded.A.linkToken, { action: 'progress', taskId: seeded.A.taskId, progressNote: 'Halfway there', today: '2026-11-23' })
  check('the student can leave a progress note', note.status === 200 && (await adminClient().from('tasks').select('progress_note').eq('id', seeded.A.taskId).single()).data?.progress_note === 'Halfway there')
  const linked = await student(seeded.A.linkToken, { action: 'attach_link', taskId: seeded.A.taskId, name: 'My doc', url: 'https://docs.google.com/document/d/invented', today: '2026-11-23' })
  const filed = await adminClient().from('documents').select('name, added_by').eq('task_id', seeded.A.taskId)
  check('the student can attach a link', linked.status === 200 && filed.data?.length === 1 && filed.data[0].added_by === 'student')
  check('a javascript: link is refused', (await student(seeded.A.linkToken, { action: 'attach_link', taskId: seeded.A.taskId, name: 'x', url: 'javascript:alert(1)', today: '2026-11-23' })).status === 400)
  check("a link cannot change another firm's task", (await student(seeded.A.linkToken, { action: 'progress', taskId: seeded.B.taskId, status: 'done', today: '2026-11-23' })).status === 404)
  check("a link cannot change a parent's task", (await student(seeded.A.linkToken, { action: 'progress', taskId: seeded.A.parentTaskId, status: 'done', today: '2026-11-23' })).status === 404)
  check('any other write is refused', (await student(seeded.A.linkToken, { action: 'delete_task', taskId: seeded.A.taskId })).status === 400)
  check("firm B's task is untouched", (await adminClient().from('tasks').select('status').eq('id', seeded.B.taskId).single()).data?.status === 'todo')

  const links = await a.client.from('student_links').select('id').eq('student_id', seeded.A.studentId)
  await a.client.from('student_links').update({ revoked_at: new Date().toISOString() }).eq('id', links.data![0].id)
  const revoked = await student(seeded.A.linkToken)
  check('a revoked link gets the same 404 as an unknown one', revoked.status === 404 && (await revoked.text()) === (await unknown.text()))

  // ── The AI endpoint (no model call is made: every request here is refused first) ──
  const ai = (headers: Record<string, string>) => aiPost(new Request('http://localhost/api/ai', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ feature: 'nope', input: {} }) }))
  check('the AI endpoint refuses a request with no token', (await ai({})).status === 401)
  check('the AI endpoint refuses a made-up token', (await ai({ authorization: 'Bearer not-a-real-token' })).status === 401)
  check('the AI endpoint refuses the anon key as a token', (await ai({ authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}` })).status === 401)
  check('the AI endpoint refuses the old passcode header', (await ai({ 'x-platinum-passcode': process.env.PLATINUM_PASSCODE ?? 'anything' })).status === 401)
  const signedIn = await ai({ authorization: `Bearer ${a.token}` })
  check('the AI endpoint lets a signed-in member through to validation', signedIn.status === 400 || signedIn.status === 503, `HTTP ${signedIn.status}`)

  // A reminder to a parent that carries a student's personal notes is refused before any model call.
  if (process.env.ANTHROPIC_API_KEY) {
    const facts = { today: '2026-11-23', counselorFirstName: 'C', student: { firstName: 'S', yearLabel: 'Senior', gradYear: 2030, gpa: 0, majors: [], interests: [], activities: [] }, parents: [{ id: 'p1', name: 'P', relationship: 'Mother', language: 'en', channel: 'email' }], openTasks: [], recentlyDone: [], colleges: [] }
    const input = { facts, recipient: { kind: 'parent', parentId: 'p1' }, channel: 'email', language: 'en', purpose: 'escalation', task: { title: 'T', owner: 'S', dueDate: 'Nov 1', dueDateZh: '11月1日', daysLate: 3 }, personalNotes: [{ id: 'n1', text: NOTE_TEXT }] }
    const withNotes = await aiPost(new Request('http://localhost/api/ai', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${a.token}` }, body: JSON.stringify({ feature: 'reminderDraft', input }) }))
    const reply = (await withNotes.json()) as { ok: boolean; message?: string }
    check('the AI endpoint refuses a parent reminder that carries personal notes', withNotes.status === 400 && /personalNotes/.test(reply.message ?? ''), reply.message)
  } else {
    console.log('SKIP  the AI endpoint refuses a parent reminder that carries personal notes  (no ANTHROPIC_API_KEY: the endpoint stops earlier)')
  }

  // ── The documents bucket (real storage) ──
  const c = await createMember(a, 'C')
  accounts.push(c)
  const folders = (await a.client.from('document_types').select('id, name')).data ?? []
  const folder = (name: string) => folders.find((f) => f.name === name)!.id
  check('a new firm starts with the eleven folders', folders.length === 11)
  const fileRow = (id: string) => ({
    id, student_id: seeded.A.studentId, name: 'upload.pdf', kind: 'other', category: 'other', added_on: '2026-11-01', added_by: 'counselor',
    storage_path: `${a.firmId}/${seeded.A.studentId}/${id}/upload.pdf`, original_filename: 'upload.pdf', size_bytes: PDF.length, mime_type: 'application/pdf',
    uploaded_by_kind: 'counselor', uploaded_by_user: a.userId, file_status: 'uploading',
  })
  const [open, restricted, waiting] = [fileRow(randomUUID()), fileRow(randomUUID()), fileRow(randomUUID())]
  const rowsMade = await a.client.rpc('apply_changes', { firm: a.firmId, changes: { upsert: { documents: [open, restricted, waiting] } } as unknown as Json })
  if (rowsMade.error) throw new Error(`creating upload rows failed: ${rowsMade.error.message}`)
  type Who = { client: ReturnType<typeof anonClient> }
  const bucket = (who: Who) => who.client.storage.from(BUCKET)
  const put = (who: Who, path: string) => bucket(who).upload(path, PDF, { contentType: 'application/pdf' })
  const stranger: Who = { client: anon }

  check('A cannot upload to a path with no document row', Boolean((await put(a, `${a.firmId}/${seeded.A.studentId}/${randomUUID()}/x.pdf`)).error))
  check('A cannot upload under another name beside an uploading row', Boolean((await put(a, `${a.firmId}/${seeded.A.studentId}/${open.id}/other.pdf`)).error))
  for (const row of [open, restricted]) {
    objects.push(row.storage_path)
    const up = await put(a, row.storage_path)
    check('A uploads to the exact path of its own uploading row', !up.error, up.error?.message)
  }
  objects.push(waiting.storage_path)
  check('the bucket refuses a file type that is not allowed', Boolean((await bucket(a).upload(waiting.storage_path, Buffer.from('<html></html>'), { contentType: 'text/html' })).error))
  const filedOpen = await a.client.rpc('file_document', { document: open.id, type: folder('Test scores'), title: 'SAT score report' })
  check('A files one under Test scores', !filedOpen.error, filedOpen.error?.message)
  const filedAid = await a.client.rpc('file_document', { document: restricted.id, type: folder('Financial aid'), title: 'Aid offer' })
  check('A files the other under Financial aid (restricted)', !filedAid.error, filedAid.error?.message)
  check('A cannot upload again once the row is no longer uploading', Boolean((await put(a, `${a.firmId}/${seeded.A.studentId}/${open.id}/again.pdf`)).error))
  const mine = await bucket(a).download(open.storage_path)
  check('A downloads its own object', !mine.error && mine.data?.size === PDF.length, mine.error?.message)
  check('A (the owner) downloads the restricted object', !(await bucket(a).download(restricted.storage_path)).error)

  for (const [name, who] of [['B', b], ['anon', stranger]] as const) {
    check(`${name} cannot download A's object`, Boolean((await bucket(who).download(open.storage_path)).error))
    check(`${name} cannot get a signed URL for A's object`, Boolean((await bucket(who).createSignedUrl(open.storage_path, 60)).error))
    const listed = await bucket(who).list(`${a.firmId}/${seeded.A.studentId}/${open.id}`)
    const top = await bucket(who).list(a.firmId)
    check(`${name} cannot list A's objects`, (listed.data ?? []).length === 0 && (top.data ?? []).length === 0)
    check(`${name} cannot upload to A's uploading row`, Boolean((await put(who, waiting.storage_path)).error))
    check(`${name} cannot upload anywhere under A's firm`, Boolean((await put(who, `${a.firmId}/${seeded.A.studentId}/${randomUUID()}/x.pdf`)).error))
    const removed = await bucket(who).remove([open.storage_path, restricted.storage_path])
    check(`${name} cannot delete A's objects`, (removed.data ?? []).length === 0)
    check(`${name} cannot overwrite A's object`, Boolean((await bucket(who).update(open.storage_path, PDF, { contentType: 'application/pdf' })).error))
    check(`${name} cannot move A's object`, Boolean((await bucket(who).move(open.storage_path, `${b.firmId}/x/${randomUUID()}/x.pdf`)).error))
    check(`${name} cannot file A's document`, Boolean((await who.client.rpc('file_document', { document: open.id, type: folder('Other'), title: 'x' })).error))
  }
  const publicUrl = await fetch(bucket(stranger).getPublicUrl(open.storage_path).data.publicUrl)
  check('there is no public URL for an object', publicUrl.status >= 400, `HTTP ${publicUrl.status}`)
  const still = await adminClient().storage.from(BUCKET).list(`${a.firmId}/${seeded.A.studentId}/${open.id}`)
  check("A's objects are still there after all of that", (still.data ?? []).some((o) => o.name === 'upload.pdf') && !(await adminClient().storage.from(BUCKET).download(restricted.storage_path)).error)
  check("…and nothing was put under A's uploading row", ((await adminClient().storage.from(BUCKET).list(`${a.firmId}/${seeded.A.studentId}/${waiting.id}`)).data ?? []).length === 0)

  // A counselor in firm A who is not its owner.
  check('a counselor who is not the owner reads the standard file and its object', ((await c.client.from('documents').select('id').eq('id', open.id)).data ?? []).length === 1 && !(await bucket(c).download(open.storage_path)).error)
  check('…but not the restricted row', ((await c.client.from('documents').select('id').eq('id', restricted.id)).data ?? []).length === 0)
  check('…nor its object', Boolean((await bucket(c).download(restricted.storage_path)).error) && Boolean((await bucket(c).createSignedUrl(restricted.storage_path, 60)).error))
  check('…nor its events', ((await c.client.from('document_events').select('id').eq('document_id', restricted.id)).data ?? []).length === 0)
  check('…and cannot delete or re-file it', ((await bucket(c).remove([restricted.storage_path])).data ?? []).length === 0 && ((await c.client.from('documents').delete().eq('id', restricted.id).select('id')).data ?? []).length === 0 && Boolean((await c.client.rpc('file_document', { document: restricted.id, type: folder('Other'), title: 'x' })).error))
  check('…and cannot change the folders', Boolean((await c.client.from('document_types').insert({ firm_id: a.firmId, name: 'Mine' })).error))
  check('the owner still reads the restricted row, its events and its object', ((await a.client.from('documents').select('id').eq('id', restricted.id)).data ?? []).length === 1 && ((await a.client.from('document_events').select('id').eq('document_id', restricted.id)).data ?? []).length === 1 && !(await bucket(a).download(restricted.storage_path)).error)
  check('document events cannot be changed or deleted', ((await a.client.from('document_events').update({ action: 'deleted' }).eq('firm_id', a.firmId).select('id')).data ?? []).length === 0 && ((await a.client.from('document_events').delete().eq('firm_id', a.firmId).select('id')).data ?? []).length === 0)
  check("B and anon read none of A's document events", ((await b.client.from('document_events').select('id').eq('firm_id', a.firmId)).data ?? []).length === 0 && ((await anon.from('document_events').select('id')).data ?? []).length === 0)
  const gone = await bucket(a).remove([open.storage_path])
  check('A deletes its own object', (gone.data ?? []).length === 1, gone.error?.message)

  // ── Stored files through the server (api/documents.ts, api/student.ts) ──
  // The model is never called here: the one function that calls it is replaced
  // by a stand-in that counts its calls and answers as told.
  const admin = adminClient()
  const exists = async (path: string) => !(await admin.storage.from(BUCKET).download(path)).error
  const rowOf = async (id: string) => (await admin.from('documents').select('*').eq('id', id).maybeSingle()).data
  const eventsOf = async (id: string) => ((await admin.from('document_events').select('action, actor_kind, actor_user, detail').eq('document_id', id).order('created_at')).data ?? [])
  let modelCalls = 0
  let lastInput: SortPromptInput | undefined
  let answer: { folder: string; title: string; sure: boolean; studentName: string | null; fail?: boolean } = { folder: 'Test scores', title: 'SAT score report, Aug 2026', sure: true, studentName: null }
  sorter.classify = async (input) => {
    modelCalls++
    lastInput = input
    if (answer.fail) throw new Error('stand-in model failure')
    return { output: { typeId: folder(answer.folder), title: answer.title, schoolYear: null, studentName: answer.studentName, reason: 'Stand-in reason.', alternatives: [folder('Other')], sure: answer.sure }, model: 'stand-in' }
  }
  type Reply = { ok: boolean; message?: string; data?: Record<string, unknown> & { document?: Record<string, unknown> | null }; upload?: { documentId: string; path: string; token: string }; added?: { name: string } }
  const documents = async (who: { token: string } | undefined, body: Record<string, unknown>) => {
    const res = await documentsPost(new Request('http://localhost/api/documents', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': 'test-documents', ...(who ? { authorization: `Bearer ${who.token}` } : {}) }, body: JSON.stringify(body) }))
    return { status: res.status, body: (await res.json()) as Reply }
  }
  const pdfOf = (label: string) => Buffer.from(tinyPdf(label, ['Invented test file.', label]))
  /** A counselor's upload, as the browser does it: start, send the file straight to storage, finish. */
  const counselorUpload = async (who: TestAccount, label: string, studentId?: string, bytes: Buffer = pdfOf(label)) => {
    const started = await documents(who, { action: 'start', filename: `${label}.pdf`, size: bytes.length, type: 'application/pdf', studentId })
    const row = started.body.data as { id: string; storage_path: string; student_id: string | null }
    objects.push(row.storage_path)
    const up = await who.client.storage.from(BUCKET).upload(row.storage_path, bytes, { contentType: 'application/pdf' })
    if (up.error) throw new Error(`test upload failed: ${up.error.message}`)
    const finished = await documents(who, { action: 'finish', documentId: row.id })
    return { id: row.id, path: row.storage_path, startedWith: row, finished }
  }
  /** A student's upload from their link: start, send the file with the one-time token, finish. */
  const studentUpload = async (token: string, label: string, bytes: Buffer = pdfOf(label), declared = 'application/pdf') => {
    const started = await student(token, { action: 'start_upload', filename: `${label}.pdf`, size: bytes.length, type: declared, today: new Date().toISOString().slice(0, 10) })
    const ticket = ((await started.json()) as Reply).upload
    if (!ticket) return { started, ticket }
    objects.push(ticket.path)
    const up = await anon.storage.from(BUCKET).uploadToSignedUrl(ticket.path, ticket.token, bytes, { contentType: declared })
    if (up.error) throw new Error(`test upload with a signed URL failed: ${up.error.message}`)
    const finished = await student(token, { action: 'finish_upload', documentId: ticket.documentId })
    return { started, ticket, finished, reply: (await finished.clone().json()) as Reply }
  }
  const newLink = async (account: TestAccount, studentId: string) => {
    const token = randomBytes(32).toString('base64url')
    const made = await account.client.from('student_links').insert({ firm_id: account.firmId, student_id: studentId, token_hash: createHash('sha256').update(token).digest('hex'), created_by: account.userId })
    if (made.error) throw new Error(`creating a link failed: ${made.error.message}`)
    return token
  }

  check('the documents endpoint refuses a request with no token', (await documents(undefined, { action: 'settle' })).status === 401)
  check('the documents endpoint refuses the anon key as a token', (await documents({ token: process.env.VITE_SUPABASE_ANON_KEY ?? '' }, { action: 'settle' })).status === 401)
  const revokedStart = await student(seeded.A.linkToken, { action: 'start_upload', filename: 'x.pdf', size: 100, type: 'application/pdf', today: '2026-11-23' })
  check('a revoked link cannot start an upload', revokedStart.status === 404)
  check('an unknown link cannot start an upload', (await student(randomBytes(32).toString('base64url'), { action: 'start_upload', filename: 'x.pdf', size: 100, type: 'application/pdf', today: '2026-11-23' })).status === 404)
  const linkA = await newLink(a, seeded.A.studentId)
  check('a link cannot start an upload of a type that is not allowed', (await student(linkA, { action: 'start_upload', filename: 'x.html', size: 100, type: 'text/html', today: '2026-11-23' })).status === 415)
  check('a link cannot start an upload over 25 MB', (await student(linkA, { action: 'start_upload', filename: 'x.pdf', size: 30_000_000, type: 'application/pdf', today: '2026-11-23' })).status === 413)

  // A student drop is filed with no counselor action.
  const drop = await studentUpload(linkA, 'Score report')
  check('a student adds a file from their link', drop.finished?.status === 200 && drop.reply?.added?.name === 'Score report.pdf', drop.reply?.message)
  check('…and the answer holds nothing but the file’s name', JSON.stringify(drop.reply) === JSON.stringify({ ok: true, added: { name: 'Score report.pdf' } }))
  await backgroundIdle()
  const dropped = await rowOf(drop.ticket!.documentId)
  check('a student drop ends up filed under a folder with no counselor action', dropped?.file_status === 'filed' && dropped.type_id === folder('Test scores') && dropped.sorted_by === 'auto' && dropped.needs_check === false && dropped.title === 'SAT score report, Aug 2026' && modelCalls === 1, `${dropped?.file_status}, ${modelCalls} model call(s)`)
  check('…with its real size and hash recorded', dropped?.size_bytes === pdfOf('Score report').length && dropped.content_hash === createHash('sha256').update(pdfOf('Score report')).digest('hex'))
  check('…at the path {firm}/{student}/{document}/{safe name}', dropped?.storage_path === `${a.firmId}/${seeded.A.studentId}/${dropped?.id}/Score-report.pdf` && (await exists(dropped!.storage_path!)))
  const dropEvents = await eventsOf(drop.ticket!.documentId)
  check('…and uploaded and auto_sorted events', dropEvents.map((e) => `${e.actor_kind}:${e.action}`).join(',') === 'student_link:uploaded,system:auto_sorted', dropEvents.map((e) => e.action).join(','))
  const dropActivity = await admin.from('activity').select('text').eq('student_id', seeded.A.studentId).eq('actor', 'student').like('text', '%added a file')
  check('…and an activity entry as done by the student, naming no file', (dropActivity.data ?? []).length === 1 && !/Score/.test(dropActivity.data![0].text))
  check('the model was given the folders and no roster', Boolean(lastInput) && lastInput!.folders.length === 11 && !JSON.stringify(lastInput).includes('StudentA') && !JSON.stringify(lastInput).includes(seeded.A.studentId))
  check('the one-time upload token cannot be used again', Boolean((await anon.storage.from(BUCKET).uploadToSignedUrl(drop.ticket!.path, drop.ticket!.token, PDF, { contentType: 'application/pdf' })).error))
  const linkPage = await student(linkA)
  const linkText = await linkPage.text()
  check('the student link page still returns no stored file', linkPage.status === 200 && (JSON.parse(linkText) as { data: { documents: unknown[] } }).data.documents.length === 0 && !linkText.includes('storage_path') && !linkText.includes('Score') && !linkText.includes(drop.ticket!.documentId))
  for (const action of ['open', 'list', 'download', 'settle', 'delete']) {
    check(`a link cannot ${action} a file`, (await student(linkA, { action, documentId: drop.ticket!.documentId, today: '2026-11-23' })).status === 400)
  }
  check('a link cannot finish another student’s upload', (await student(seeded.B.linkToken, { action: 'finish_upload', documentId: drop.ticket!.documentId })).status === 404)

  // A file whose real type is not the declared one is rejected and removed.
  const fake = await studentUpload(linkA, 'Not a pdf', Buffer.from('<html><body>not a pdf at all</body></html>'))
  check('a file with a wrong real type is rejected at finish-upload', fake.finished?.status === 415, `HTTP ${fake.finished?.status}`)
  check('…and its object and row are removed', !(await exists(fake.ticket!.path)) && !(await rowOf(fake.ticket!.documentId)))
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)])
  const mislabelled = await studentUpload(linkA, 'Really a png', png)
  check('…as is an allowed type under the wrong name', mislabelled.finished?.status === 415 && !(await rowOf(mislabelled.ticket!.documentId)))

  // The model fails: the upload still succeeds, filed under Other to be checked, and is retried once.
  modelCalls = 0
  answer = { ...answer, fail: true }
  const unlucky = await studentUpload(linkA, 'Model down')
  await backgroundIdle()
  const unluckyRow = await rowOf(unlucky.ticket!.documentId)
  check('an upload never fails because sorting failed', unlucky.finished?.status === 200 && unluckyRow?.file_status === 'filed' && unluckyRow.type_id === folder('Other') && unluckyRow.needs_check === true && unluckyRow.ai_suggestion === null)
  check('…and sorting is retried once', modelCalls === 2, `${modelCalls} call(s)`)
  answer = { ...answer, fail: false }

  // With sorting switched off, no request reaches the model.
  modelCalls = 0
  check('a counselor who is not the owner cannot switch sorting off', Boolean((await c.client.rpc('apply_changes', { firm: a.firmId, changes: { firm: { sortFilesAutomatically: false } } })).error))
  const off = await a.client.rpc('apply_changes', { firm: a.firmId, changes: { firm: { sortFilesAutomatically: false } } })
  if (off.error) throw new Error(`switching sorting off failed: ${off.error.message}`)
  const offDrop = await studentUpload(linkA, 'While off')
  await backgroundIdle()
  const offDropRow = await rowOf(offDrop.ticket!.documentId)
  const offUpload = await counselorUpload(a, 'Counselor while off', seeded.A.studentId)
  const offSuggested = await documents(a, { action: 'suggest', documentId: offUpload.id })
  await backgroundIdle()
  const offUploadRow = await rowOf(offUpload.id)
  check('with sorting switched off, no request reaches the model', modelCalls === 0, `${modelCalls} call(s)`)
  check('…a student drop lands under Other to be checked', offDropRow?.file_status === 'filed' && offDropRow.type_id === folder('Other') && offDropRow.needs_check === true)
  check('…and a counselor upload waits under Other to be checked', offSuggested.status === 200 && offUploadRow?.file_status === 'suggested' && offUploadRow.type_id === folder('Other') && offUploadRow.needs_check === true && offUploadRow.ai_suggestion === null)
  const on = await a.client.rpc('apply_changes', { firm: a.firmId, changes: { firm: { sortFilesAutomatically: true } } })
  if (on.error) throw new Error(`switching sorting on failed: ${on.error.message}`)

  // A counselor upload made outside a student page: no student until a person files it.
  modelCalls = 0
  answer = { folder: 'Transcripts and grades', title: 'Transcript, grades 9 to 11', sure: true, studentName: 'INVENTED, StudentA' }
  const loose = await counselorUpload(c, 'Loose transcript')
  check('a counselor upload made outside a student page has no student', loose.finished.status === 200 && loose.startedWith.student_id === null && loose.path.startsWith(`${a.firmId}/_/${loose.id}/`))
  check('…and waits as sorting, with an uploaded event', (await rowOf(loose.id))?.file_status === 'sorting' && (await eventsOf(loose.id)).some((e) => e.action === 'uploaded' && e.actor_user === c.userId))
  const suggested = await documents(c, { action: 'suggest', documentId: loose.id })
  const looseRow = await rowOf(loose.id)
  check('the suggestion is recorded and the name on the file is matched to the roster in code', suggested.status === 200 && looseRow?.file_status === 'suggested' && (looseRow.ai_suggestion as { typeId?: string } | null)?.typeId === folder('Transcripts and grades') && looseRow.student_id === seeded.A.studentId && modelCalls === 1)
  const filedForA = async () => ((await admin.from('documents').select('id').eq('student_id', seeded.A.studentId).eq('file_status', 'filed').not('storage_path', 'is', null)).data ?? []).map((d) => d.id)
  check('a counselor upload is not visible under any student until approved', looseRow?.type_id === null && looseRow.sorted_by === null && !(await filedForA()).includes(loose.id))
  const approved = await documents(c, { action: 'file', documentId: loose.id, typeId: folder('Transcripts and grades'), title: 'Transcript, grades 9 to 11', studentId: seeded.A.studentId })
  const approvedRow = await rowOf(loose.id)
  check('“Yes, put it there” files it under the student and records the approval', approved.status === 200 && approvedRow?.file_status === 'filed' && approvedRow.sorted_by === 'person' && approvedRow.student_id === seeded.A.studentId && (await filedForA()).includes(loose.id) && (await eventsOf(loose.id)).some((e) => e.action === 'approved' && e.actor_user === c.userId))
  check('…and the AI’s suggestion is kept after filing', (approvedRow?.ai_suggestion as { title?: string } | null)?.title === 'Transcript, grades 9 to 11')
  check('a file cannot be filed without a student', (await documents(c, { action: 'file', documentId: (await counselorUpload(c, 'No student')).id, typeId: folder('Other'), title: 'No student' })).status === 400)

  // Choosing another folder than the AI's is a correction, and the next request to the model carries it.
  const corrected = await counselorUpload(a, 'Corrected', seeded.A.studentId)
  await documents(a, { action: 'suggest', documentId: corrected.id })
  const typed = await documents(a, { action: 'file', documentId: corrected.id, typeId: folder('Applications'), title: 'Application confirmation' })
  check('choosing another folder than the suggestion records a correction', typed.status === 200 && (await eventsOf(corrected.id)).some((e) => e.action === 'typed'))
  const next = await counselorUpload(a, 'After correction', seeded.A.studentId)
  await documents(a, { action: 'suggest', documentId: next.id })
  check('…which the model is shown next time', lastInput?.corrections.some((x) => x.title === 'Application confirmation' && x.aiFolder === 'Transcripts and grades' && x.chosenFolder === 'Applications') === true, JSON.stringify(lastInput?.corrections))
  const renamed = await documents(a, { action: 'rename', documentId: corrected.id, title: 'Common App confirmation' })
  check('a file can be renamed, and the path does not change', renamed.status === 200 && (await rowOf(corrected.id))?.title === 'Common App confirmation' && (await rowOf(corrected.id))?.storage_path === corrected.path)

  // Opening: a signed URL made on request, as the caller.
  const opened = await documents(c, { action: 'open', documentId: corrected.id, mode: 'view' })
  const url = (opened.body.data as { url?: string } | undefined)?.url ?? ''
  check('a counselor opens a file through a signed URL', opened.status === 200 && (await fetch(url)).status === 200)
  check('…which records a viewed event and the first opening', (await eventsOf(corrected.id)).some((e) => e.action === 'viewed' && e.actor_user === c.userId) && Boolean((await rowOf(corrected.id))?.opened_at))
  check('a download is recorded too', (await documents(a, { action: 'open', documentId: corrected.id, mode: 'download' })).status === 200 && (await eventsOf(corrected.id)).some((e) => e.action === 'downloaded'))
  for (const [action, extra] of [['open', {}], ['rename', { title: 'x' }], ['file', { typeId: folder('Other'), title: 'x' }], ['suggest', {}], ['finish', {}], ['delete', {}]] as const) {
    check(`B cannot ${action} A's file through the endpoint`, (await documents(b, { action, documentId: corrected.id, ...extra })).status === 404)
  }
  check("…and A's file is untouched", (await rowOf(corrected.id))?.title === 'Common App confirmation' && (await exists(corrected.path)))

  // A counselor who is not the owner files into a restricted folder: it is filed, and gone from their view.
  const secret = await counselorUpload(c, 'Aid offer letter', seeded.A.studentId)
  const hidden = await documents(c, { action: 'file', documentId: secret.id, typeId: folder('Financial aid'), title: 'Aid offer letter' })
  check('a counselor who is not the owner can file into a restricted folder', hidden.status === 200 && hidden.body.data?.hidden === true && hidden.body.data.document === null && (await rowOf(secret.id))?.type_id === folder('Financial aid'))
  check('…and can then neither open, rename, re-file nor delete it', (await Promise.all([documents(c, { action: 'open', documentId: secret.id }), documents(c, { action: 'rename', documentId: secret.id, title: 'x' }), documents(c, { action: 'file', documentId: secret.id, typeId: folder('Other'), title: 'x' }), documents(c, { action: 'delete', documentId: secret.id })])).every((r) => r.status === 404) && (await exists(secret.path)))
  check('…while the owner still opens it', (await documents(a, { action: 'open', documentId: secret.id })).status === 200)
  const upsertInto = await c.client.rpc('apply_changes', { firm: a.firmId, changes: { upsert: { documents: [{ ...(await rowOf(corrected.id)), type_id: folder('Identity and visa') }] } } as unknown as Json })
  check('…and cannot move a file there with an ordinary save', Boolean(upsertInto.error) || (await rowOf(corrected.id))?.type_id === folder('Applications'))

  // Deleting: the object and the row go together, through one path.
  const deletedOne = await documents(c, { action: 'delete', documentId: corrected.id })
  check('deleting a document removes its object and its row together', deletedOne.status === 200 && !(await exists(corrected.path)) && !(await rowOf(corrected.id)))
  check('…and logs it with the title, since the folder was open to all', (await eventsOf(corrected.id)).some((e) => e.action === 'deleted' && (e.detail as { title?: string }).title === 'Common App confirmation'))
  const before = ((await admin.from('documents').select('id, storage_path').eq('student_id', seeded.A.studentId).not('storage_path', 'is', null)).data ?? [])
  const studentGone = await documents(c, { action: 'delete', studentId: seeded.A.studentId })
  const leftRows = ((await admin.from('documents').select('id').eq('student_id', seeded.A.studentId).not('storage_path', 'is', null)).data ?? [])
  const leftObjects = (await Promise.all(before.map((d) => exists(d.storage_path!)))).filter(Boolean)
  check('deleting a student’s files removes every object, even ones the counselor cannot see', studentGone.status === 200 && before.length >= 5 && before.some((d) => d.id === secret.id) && leftRows.length === 0 && leftObjects.length === 0, `${before.length} before, ${leftRows.length} rows and ${leftObjects.length} objects left`)
  const secretDeleted = (await eventsOf(secret.id)).find((e) => e.action === 'deleted')
  check('…and the deleted event of a restricted file carries no title or file name', Boolean(secretDeleted) && Object.keys(secretDeleted!.detail as object).length === 0)
  check('…and leaves the student and their essays alone', ((await admin.from('students').select('id').eq('id', seeded.A.studentId)).data ?? []).length === 1 && ((await admin.from('documents').select('id').eq('student_id', seeded.A.studentId).eq('kind', 'essay')).data ?? []).length === 1)
  const loner = await counselorUpload(a, 'Waiting with no student')
  const firmGone = await documents(a, { action: 'delete', firm: true })
  check('clearing a firm’s files removes those waiting with no student too', firmGone.status === 200 && !(await exists(loner.path)) && !(await rowOf(loner.id)))
  check("…and touches nothing of firm B's", ((await admin.from('documents').select('id').eq('firm_id', b.firmId)).data ?? []).length > 0)

  // The link's limits.
  const many = Array.from({ length: 10 }, () => { const id = randomUUID(); return { ...fileRow(id), firm_id: b.firmId, student_id: seeded.B.studentId, storage_path: `${b.firmId}/${seeded.B.studentId}/${id}/x.pdf`, uploaded_by_kind: 'student_link', uploaded_by_user: null, added_by: 'student', file_status: 'sorting' } })
  const padded = await admin.from('documents').insert(many)
  if (padded.error) throw new Error(`padding the daily limit failed: ${padded.error.message}`)
  check('a link cannot add more than 10 files in a day', (await student(seeded.B.linkToken, { action: 'start_upload', filename: 'x.pdf', size: 100, type: 'application/pdf', today: '2026-11-23' })).status === 429)
  await admin.from('documents').update({ uploaded_by_kind: 'counselor', size_bytes: 25_000_000 }).eq('firm_id', b.firmId).not('storage_path', 'is', null)
  check('…nor take a student past 200 MB in total', (await student(seeded.B.linkToken, { action: 'start_upload', filename: 'x.pdf', size: 1_000_000, type: 'application/pdf', today: '2026-11-23' })).status === 413)

  // The roster match is code, not the model.
  const roster = [{ id: '1', first_name: 'Maya', last_name: 'Chen' }, { id: '2', first_name: 'Chen', last_name: 'Wei' }, { id: '3', first_name: 'Sam', last_name: 'Lee' }, { id: '4', first_name: 'Sam', last_name: 'Lee' }]
  check('the roster match is exact, then case and order insensitive, and never a guess', matchRoster('Maya Chen', roster) === '1' && matchRoster('CHEN, maya', roster) === '1' && matchRoster('Maya', roster) === undefined && matchRoster('Sam Lee', roster) === undefined && matchRoster('Nobody Here', roster) === undefined && matchRoster(null, roster) === undefined)

  // ── The college directory ──
  for (const table of ['college_directory', 'college_programs'] as const) {
    check(`anon reads nothing from ${table}`, ((await anon.from(table).select('*').limit(1)).data ?? []).length === 0)
    check(`a signed-in person can read ${table}`, !(await a.client.from(table).select('*').limit(1)).error)
    check(`…but cannot delete from ${table}`, Boolean((await a.client.from(table).delete().gte('unitid', 0)).error))
  }
  check('a signed-in person cannot insert into or update the directory', Boolean((await a.client.from('college_directory').insert({ unitid: 999999999, name: 'Invented' })).error) && Boolean((await a.client.from('college_directory').update({ name: 'x' }).gte('unitid', 0)).error))
} catch (error) {
  failed++
  console.error('\nThe run stopped early:', error instanceof Error ? error.message : error)
} finally {
  if (objects.length) await adminClient().storage.from(BUCKET).remove(objects)
  // A member is only a user; the firm goes with its owner's account.
  for (const account of accounts.filter((x) => x.label === 'C')) await adminClient().auth.admin.deleteUser(account.userId)
  for (const account of accounts.filter((x) => x.label !== 'C')) await removeAccount(account)
  console.log(`\nRemoved ${accounts.length} test account(s) and their firms.`)
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
