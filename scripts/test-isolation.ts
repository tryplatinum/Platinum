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
import { STUDENT_TOKEN_HEADER } from '../shared/constants.js'
import type { Json } from '../src/lib/database.types.js'
import { adminClient, anonClient, createAccount, removeAccount, requireSettings, type TestAccount } from './testAccounts.js'

requireSettings()

let failed = 0
function check(name: string, pass: boolean, detail = ''): void {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const TABLES = ['students', 'parents', 'meetings', 'tasks', 'colleges', 'documents', 'reports', 'outbox', 'reminder_rules', 'activity', 'weekly_texts', 'personal_notes', 'student_links'] as const
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
  const queued = await account.client.rpc('queue_message', {
    payload: { id: randomUUID(), studentId, toKind: 'student', toName: 'N', channel: 'text', language: 'en', kind: 'reminder_late', body: 'B', trigger: 'approved' },
  })
  if (queued.error) throw new Error(`queueing a message for ${account.label} failed: ${queued.error.message}`)

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
} catch (error) {
  failed++
  console.error('\nThe run stopped early:', error instanceof Error ? error.message : error)
} finally {
  for (const account of accounts) await removeAccount(account)
  console.log(`\nRemoved ${accounts.length} test account(s) and their firms.`)
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
