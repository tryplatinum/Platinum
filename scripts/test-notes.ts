// Checks that a student's "things to remember" (personal notes) cannot reach
// anything a parent reads. Run with:
//
//   npm run test:notes
//
// It needs no keys and no network: it builds the same requests the app sends,
// from the sample caseload plus marked notes for every student, and looks for
// note text in them. It then puts notes into requests by force and checks the
// server's side drops or refuses them.
//
// The student link is checked against the real database in test:isolation.

import { readFileSync } from 'node:fs'
import { INPUTS } from '../shared/contract.js'
import { PROMPTS } from '../server/prompts.js'
import { buildSeed } from '../src/data/seed.js'
import { addDays, todayISO } from '../src/lib/dates.js'
import { isOpen, notesWorthMentioning, primaryParent } from '../src/lib/derive.js'
import { buildFacts, notesForDraft, parentReportInput, reminderRequest } from '../src/lib/facts.js'
import type { PersonalNote } from '../src/types.js'

let failed = 0
function check(name: string, pass: boolean, detail = ''): void {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const MARK = 'ZZ-PRIVATE-NOTE'
const data = buildSeed()
const approval = { by: 'Test Counselor', at: new Date().toISOString() }
// Two marked notes per student, placed so they are the first ones a draft would be offered.
for (const s of data.students) {
  const note = (text: string, eventDate?: string): PersonalNote => ({ id: `mark-${s.id}-${eventDate ? 'd' : 'u'}`, studentId: s.id, text, eventDate, source: 'counselor', createdAt: approval.at, approval })
  data.personalNotes.push(note(`${MARK} tournament for ${s.firstName}`, addDays(todayISO(), 1)), note(`${MARK} school play for ${s.firstName}`))
}
const noteTexts = data.personalNotes.map((n) => n.text)
/** The first note text found in `value`, if any. */
const leak = (value: unknown): string | undefined => {
  const json = JSON.stringify(value)
  return noteTexts.find((text) => json.includes(text) || json.includes(JSON.stringify(text).slice(1, -1)))
}

// ── The check is not vacuous: notes do reach the student's own messages ──
const kevin = data.students[0]
const kevinTask = data.tasks.find((t) => t.studentId === kevin.id && t.owner === 'student' && isOpen(t))!
check('every sample student has two or three invented notes', data.students.every((s) => [2, 3].includes(buildSeed().personalNotes.filter((n) => n.studentId === s.id).length)))
check('a marked note is among those a draft to the student is offered', notesWorthMentioning(data, kevin.id).some((n) => n.text.includes(MARK)))
check('a reminder to the student carries notes', Boolean(leak(reminderRequest(data, kevin, kevinTask, { kind: 'student' }).input)))
check('a reminder to the student carries none when redrafted without', !leak(reminderRequest(data, kevin, kevinTask, { kind: 'student' }, false).input))
check('at most three notes are offered', data.students.every((s) => notesForDraft(data, s, 'student').length <= 3))

// ── Requests the app builds for parents ──
let reports = 0
let reminders = 0
const leaks: string[] = []
for (const s of data.students) {
  if (notesForDraft(data, s, 'parent').length) leaks.push(`notesForDraft(parent) for ${s.firstName}`)
  if (leak(buildFacts(data, s))) leaks.push(`buildFacts for ${s.firstName}`)
  for (const p of s.parents) {
    reports++
    const report = parentReportInput(data, s, p.id)
    if (leak(report)) leaks.push(`parent report request for ${s.firstName} → ${p.name}`)
    if (leak(PROMPTS.parentReport.user(report))) leaks.push(`parent report prompt for ${s.firstName} → ${p.name}`)
    for (const t of data.tasks.filter((x) => x.studentId === s.id && isOpen(x))) {
      reminders++
      const reminder = reminderRequest(data, s, t, { kind: 'parent', parent: p })
      if (reminder.notes.length || reminder.input.personalNotes || leak(reminder.input)) leaks.push(`parent reminder request for ${s.firstName} → ${p.name}`)
      if (leak(PROMPTS.reminderDraft.user(reminder.input))) leaks.push(`parent reminder prompt for ${s.firstName} → ${p.name}`)
    }
  }
}
check(`no note text in any parent report request or prompt (${reports} built)`, !leaks.some((l) => l.includes('report')), leaks.find((l) => l.includes('report')))
check(`no note text in any reminder or parent copy to a parent (${reminders} built)`, !leaks.some((l) => l.includes('reminder')), leaks.find((l) => l.includes('reminder')))
check('the shared student facts and the parent audience never include notes', !leaks.some((l) => l.startsWith('buildFacts') || l.startsWith('notesForDraft')), leaks[0])

// ── The server, given notes by force ──
const forced = notesForDraft(data, kevin, 'student').map((n) => n.fact)
const dad = primaryParent(kevin)!

const report = INPUTS.parentReport.safeParse({ ...parentReportInput(data, kevin, dad.id), personalNotes: forced, facts: { ...buildFacts(data, kevin), personalNotes: forced } })
check('the server drops notes added to a parent report request', report.success && !leak(report.data) && !leak(PROMPTS.parentReport.user(report.data)))

const meeting = INPUTS.draftFromMeeting.safeParse({ facts: buildFacts(data, kevin), meeting: { title: 'Check-in', date: todayISO() }, source: 'Notes from a meeting, long enough to pass.', personalNotes: forced })
check('the server drops notes added to a meeting draft request (it writes parent updates)', meeting.success && !leak(meeting.data))

const toParent = reminderRequest(data, kevin, kevinTask, { kind: 'parent', parent: dad }).input
const refused = INPUTS.reminderDraft.safeParse({ ...toParent, personalNotes: forced })
check('the server refuses a reminder to a parent that carries notes', !refused.success && refused.error.issues[0]?.path.join('.') === 'personalNotes')
check('the parent reminder prompt ignores notes even if they got that far', !leak(PROMPTS.reminderDraft.user({ ...toParent, personalNotes: forced })))
check('the server accepts the same notes on a reminder to the student', INPUTS.reminderDraft.safeParse(reminderRequest(data, kevin, kevinTask, { kind: 'student' }).input).success)

// ── The student link's code ──
const link = readFileSync(new URL('../server/studentLink.ts', import.meta.url), 'utf8')
const tablesRead = [...link.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1])
check('the student link reads no personal_notes or weekly_texts', !tablesRead.includes('personal_notes') && !tablesRead.includes('weekly_texts'), [...new Set(tablesRead)].join(', '))
check('the student link never selects a meeting’s AI drafts', !/select\('[^']*\bai\b[^']*'\)/.test(link))

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
