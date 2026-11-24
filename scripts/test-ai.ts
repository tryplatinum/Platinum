// End-to-end check of the AI endpoint: calls the real handler in api/ai.ts once
// per feature with realistic sample input built from the seed data, and prints
// each draft. Run with:  npm run test:ai
//
// Needs ANTHROPIC_API_KEY and the three Supabase settings in .env.local. The
// endpoint only answers signed-in members of a firm, so the run creates a
// throwaway account and firm and deletes them at the end. Each run makes nine
// real model calls. Pass a feature name to run just one:
//   npm run test:ai -- parentReport

import { POST } from '../api/ai.js'
import type { Feature } from '../shared/contract.js'
import { IDS, KEVIN_ESSAY_PROMPT, KEVIN_ESSAY_TEXT, sampleCounselorNote } from '../src/data/fixtures.js'
import { buildSeed } from '../src/data/seed.js'
import { formatDate, formatDateZh } from '../src/lib/dates.js'
import { daysLate, isOpen, weeklyTextItems } from '../src/lib/derive.js'
import { WEEKLY_NOTE_ROOM, WEEKLY_TEXT_MAX, weeklyTextFacts, weeklyTextFirstTask, weeklyTextHasRoomForNote, weeklyTextMissing, weeklyTextTasks } from '../src/lib/reminders.js'
import { briefFacts, buildFacts, notesForDraft, reminderRequest, reportFacts } from '../src/lib/facts.js'
import { createAccount, removeAccount, requireSettings } from './testAccounts.js'

requireSettings()

const data = buildSeed()
const student = (id: string) => data.students.find((s) => s.id === id)!
const kevin = student(IDS.kevin)
const sophia = student(IDS.sophia)
const kevinMeeting = data.meetings.find((m) => m.id === IDS.kevinMeeting)!
const kevinNext = data.meetings.find((m) => m.studentId === kevin.id && m.status === 'scheduled')!
const brief = briefFacts(data, kevinNext, kevin)
const lateParentTask = data.tasks.find((t) => t.studentId === kevin.id && t.owner === 'parent' && t.status !== 'done')!

const inputs: Partial<Record<Feature, unknown>> = {
  draftFromMeeting: {
    facts: buildFacts(data, kevin),
    meeting: { title: kevinMeeting.title, date: kevinMeeting.date },
    source: kevinMeeting.transcript,
  },
  readNotes: { facts: buildFacts(data, sophia), notes: sampleCounselorNote() },
  preMeetingBrief: {
    facts: buildFacts(data, kevin),
    meeting: { title: kevinNext.title, date: kevinNext.date },
    computed: {
      changesSinceLastMeeting: brief.changes,
      overdue: brief.overdue.map((o) => `${o.title} — owner: ${o.owner}; ${o.daysLate} days late`),
      deadlinesNext14Days: brief.deadlines.map((d) => `${d.label} — due ${d.date}`),
      waitingOnCounselor: brief.waitingOnCounselor,
    },
    counselorNotes: kevin.counselorNotes,
  },
  parentReport: { facts: buildFacts(data, kevin), parentId: IDS.kevinDad, reportFacts: reportFacts(data, kevin, IDS.kevinDad) },
  essayFeedback: { studentFirstName: kevin.firstName, prompt: KEVIN_ESSAY_PROMPT, essay: KEVIN_ESSAY_TEXT },
  // A late task owned by Kevin's father, in Simplified Chinese for WeChat.
  reminderDraft: {
    facts: buildFacts(data, kevin),
    recipient: { kind: 'parent', parentId: IDS.kevinDad },
    channel: 'wechat',
    language: 'zh-Hans',
    purpose: 'late',
    task: { title: lateParentTask.title, owner: 'Dad (Zhang Wei)', dueDate: formatDate(lateParentTask.dueDate), dueDateZh: formatDateZh(lateParentTask.dueDate), daysLate: daysLate(lateParentTask) },
  },
}

const kevinNotes = notesForDraft(data, kevin, 'student')
// A second reminder, to the student this time, which is offered his things to remember.
const kevinOwnTask = data.tasks.find((t) => t.studentId === kevin.id && t.owner === 'student' && isOpen(t))!
const studentReminder = reminderRequest(data, kevin, kevinOwnTask, { kind: 'student' }).input

// A realistic weekly text: Kevin's own late and upcoming tasks, his next meeting, an invented link.
const kevinWeekly = weeklyTextFacts(kevin, data.firm.counselorFirstName, weeklyTextItems(data, kevin.id) ?? { late: [], due: [] }, 'https://platinum.example/s/Lka1hSX5xoW6d5u4VfaKiSq-hkmUPMrnHfK0bG63aRY', undefined, kevinNotes.length ? WEEKLY_NOTE_ROOM : 0)
inputs.weeklyText = {
  today: data.students.length ? new Date().toISOString().slice(0, 10) : '',
  studentFirstName: kevinWeekly.firstName,
  counselorFirstName: kevinWeekly.counselorFirstName,
  language: 'en',
  meeting: kevinWeekly.meeting,
  late: kevinWeekly.late,
  due: kevinWeekly.due,
  more: kevinWeekly.more,
  deadlines: kevinWeekly.deadlines,
  link: kevinWeekly.link,
  // Kevin's things to remember from the sample data, offered (as in the app) only when the
  // facts leave room. The text may use at most one and must say which.
  personalNotes: weeklyTextHasRoomForNote(kevinWeekly) ? kevinNotes.map((n) => n.fact) : undefined,
  maxChars: WEEKLY_TEXT_MAX,
}

// A second weekly text with room for a personal line: one task, one meeting, the same notes.
const shortWeekly = { ...kevinWeekly, late: kevinWeekly.late.slice(0, 1), due: [], more: 0 }
const shortWeeklyInput = { ...(inputs.weeklyText as object), late: shortWeekly.late, due: [], more: 0, personalNotes: kevinNotes.map((n) => n.fact) }

const only = process.argv[2] as Feature | undefined
let failed = 0
const account = await createAccount('AI')

/** What the model said it used, checked against what it was given. */
function reportUsedNote(label: string, usedNoteId: string | null): void {
  const used = kevinNotes.find((n) => n.fact.id === usedNoteId)
  console.log(`${label}: offered ${kevinNotes.map((n) => `${n.fact.id} “${n.fact.text}”`).join(', ')}; used: ${usedNoteId === null ? 'none' : (used?.fact.text ?? `UNKNOWN ID ${usedNoteId}`)}`)
  if (usedNoteId !== null && !used) failed += 1
}

const runs: { feature: Feature; input: unknown; label?: string }[] = (Object.keys(inputs) as Feature[]).map((feature) => ({ feature, input: inputs[feature] }))
runs.push({ feature: 'reminderDraft', input: studentReminder, label: 'reminderDraft (to the student, with things to remember)' })
runs.push({ feature: 'weeklyText', input: shortWeeklyInput, label: 'weeklyText (short, with things to remember)' })

for (const { feature, input, label } of runs) {
  if (only && feature !== only) continue
  const started = Date.now()
  const response = await POST(
    new Request('http://localhost/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${account.token}` },
      body: JSON.stringify({ feature, input }),
    }),
  )
  const body = await response.json()
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\n━━ ${label ?? feature} · HTTP ${response.status} · ${seconds}s ${'━'.repeat(40)}`)
  console.log(JSON.stringify(body, null, 2))
  if (!body.ok) failed += 1
  if (feature === 'weeklyText' && body.ok) {
    const missing = weeklyTextMissing(body.draft.text, label ? shortWeekly : kevinWeekly)
    console.log(`weeklyText: ${body.draft.text.length} characters (limit ${WEEKLY_TEXT_MAX}); facts changed or missing: ${missing.length ? missing.join(' | ') : 'none'}`)
    if (missing.length || body.draft.text.length > WEEKLY_TEXT_MAX) failed += 1
    // Which task it chose to put first, and whether the text really leads with it.
    const used = label ? shortWeekly : kevinWeekly
    const tasks = weeklyTextTasks(used)
    const first = weeklyTextFirstTask(body.draft.text, used)
    const claimed = tasks.find((t) => t.id === body.draft.leadTaskId)
    console.log(`weeklyText: tasks in the code's order: ${tasks.map((t) => `${t.id} “${t.title}”`).join(', ')}`)
    console.log(`weeklyText: says it leads with ${claimed ? `${claimed.id} “${claimed.title}”` : body.draft.leadTaskId}; the text leads with ${first?.id}. Reason: ${body.draft.leadReason}`)
    if (tasks.length >= 2 ? first?.id !== body.draft.leadTaskId : body.draft.leadTaskId !== null) failed += 1
    if ((input as { personalNotes?: unknown[] }).personalNotes?.length) reportUsedNote('weeklyText', body.draft.usedNoteId)
    else console.log('weeklyText: no things to remember were offered (the facts leave no room); usedNoteId: ' + body.draft.usedNoteId)
  }
  if (feature === 'reminderDraft' && body.ok) {
    if (label) reportUsedNote('reminderDraft to the student', body.draft.usedNoteId)
    // A reminder to a parent is given no notes, so it cannot have used one.
    else if (body.draft.usedNoteId !== null) {
      console.log(`reminderDraft to a parent claims a note: ${body.draft.usedNoteId}`)
      failed += 1
    }
  }
  if (feature === 'draftFromMeeting' && body.ok) console.log(`draftFromMeeting: things to remember: ${JSON.stringify(body.draft.personalNotes)}`)
}

// ── Sorting a file (not an /api/ai feature: the server reads the file from storage) ──
// Two real model calls: an invented score report as a PDF with the student's name
// printed on it, uploaded by the counselor outside a student page, and an invented
// transcript under an unhelpful file name. Run alone with:  npm run test:ai -- sortFile
if (!only || (only as string) === 'sortFile') {
  const { POST: documentsPost } = await import('../api/documents.js')
  const { tinyPdf, DOCUMENTS_BUCKET } = await import('../shared/files.js')
  const { adminClient } = await import('./testAccounts.js')
  const call = async (body: Record<string, unknown>) => {
    const response = await documentsPost(new Request('http://localhost/api/documents', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${account.token}` }, body: JSON.stringify(body) }))
    return (await response.json()) as { ok: boolean; message?: string; data?: Record<string, unknown> }
  }
  const studentId = crypto.randomUUID()
  const made = await account.client.from('students').insert({ id: studentId, firm_id: account.firmId, first_name: 'Maya', last_name: 'Chen', grad_year: 2027 })
  if (made.error) throw new Error(`could not create the test student: ${made.error.message}`)
  const folders = (await account.client.from('document_types').select('id, name')).data ?? []
  const files = [
    { name: 'scan_0042.pdf', expect: 'Test scores', pdf: tinyPdf('SAT Score Report', ['College Board', 'Student: CHEN, MAYA', 'Test date: August 23, 2026', 'Total score: 1480', 'Evidence-Based Reading and Writing: 720', 'Math: 760']) },
    { name: 'document (3).pdf', expect: 'Transcripts and grades', pdf: tinyPdf('Official High School Transcript', ['Lakeview High School', 'Student: Maya Chen', 'School year 2025-26, Grade 11', 'AP Chemistry: A', 'AP US History: A-', 'Precalculus Honors: A', 'Cumulative GPA: 3.92']) },
  ]
  const paths: string[] = []
  for (const file of files) {
    const started = Date.now()
    const row = (await call({ action: 'start', filename: file.name, size: file.pdf.length, type: 'application/pdf' })).data as { id: string; storage_path: string }
    paths.push(row.storage_path)
    const up = await account.client.storage.from(DOCUMENTS_BUCKET).upload(row.storage_path, file.pdf, { contentType: 'application/pdf' })
    if (up.error) throw new Error(`upload failed: ${up.error.message}`)
    await call({ action: 'finish', documentId: row.id })
    const body = await call({ action: 'suggest', documentId: row.id })
    const doc = body.data as { file_status?: string; student_id?: string | null; needs_check?: boolean; ai_suggestion?: { typeId: string; title: string; studentName?: string; reason: string; alternatives: string[]; sure: boolean; model: string } | null } | undefined
    const folderName = (id?: string) => folders.find((f) => f.id === id)?.name ?? id
    console.log(`\n━━ sortFile “${file.name}” · ${((Date.now() - started) / 1000).toFixed(1)}s ${'━'.repeat(40)}`)
    console.log(JSON.stringify(doc?.ai_suggestion ? { ...doc.ai_suggestion, typeId: folderName(doc.ai_suggestion.typeId), alternatives: doc.ai_suggestion.alternatives.map(folderName) } : body, null, 2))
    console.log(`sortFile: status ${doc?.file_status}; needs a check: ${doc?.needs_check}; name matched to the roster: ${doc?.student_id === studentId ? 'Maya Chen' : 'no'}`)
    if (!doc?.ai_suggestion || folderName(doc.ai_suggestion.typeId) !== file.expect || doc.student_id !== studentId || doc.file_status !== 'suggested') failed += 1
  }
  await adminClient().storage.from(DOCUMENTS_BUCKET).remove(paths)
}

await removeAccount(account)

if (failed > 0) {
  console.error(`\n${failed} feature(s) failed.`)
  process.exit(1)
}
