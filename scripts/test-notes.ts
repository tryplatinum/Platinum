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

import { ATTENTION_RULE, BEHIND_DAYS_LATE, BEHIND_LATE_TASKS, MEETING_GAP_DAYS, classifyAttention } from '../shared/attention'
import { readFileSync } from 'node:fs'
import { INPUTS } from '../shared/contract.js'
import { STUDENT_UPLOAD_SECONDS, uploadWindowClosed } from '../shared/files.js'
import { PROMPTS } from '../server/prompts.js'
import { buildSeed } from '../src/data/seed.js'
import { addDays, todayISO } from '../src/lib/dates.js'
import { isOpen, noteStage, notesWorthMentioning, primaryParent } from '../src/lib/derive.js'
import { buildFacts, notesForDraft, parentReportInput, reminderRequest } from '../src/lib/facts.js'
import type { AppData, PersonalNote } from '../src/types.js'

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
  const note = (text: string, eventDate?: string): PersonalNote => ({ id: `mark-${s.id}-${eventDate ? 'd' : 'u'}`, studentId: s.id, text, eventDate, uses: [], source: 'counselor', createdAt: approval.at, approval })
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
check('a marked note is among those a draft to the student is offered', notesWorthMentioning(data, kevin.id).some((n) => n.note.text.includes(MARK)))
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

// ── The life of a note: nothing out of date, nothing said twice ──
{
  const DAY0 = '2026-11-23'
  const day = (n: number) => addDays(DAY0, n)
  const base = buildSeed()
  const s = base.students[0]
  const firstMeeting = 'life-m1'
  const world = (notes: Partial<PersonalNote>[], extraMeetings: AppData['meetings'] = []): AppData => ({
    ...base,
    meetings: [{ id: firstMeeting, studentId: s.id, title: 'Check-in', date: DAY0, time: '16:00', durationMin: 45, status: 'completed' }, ...extraMeetings],
    personalNotes: notes.map((n, i) => ({ id: `life-${i}`, studentId: s.id, text: `Note ${i}`, uses: [], source: 'meeting', meetingId: firstMeeting, createdAt: `${DAY0}T18:00:00.000Z`, approval, ...n })),
  })
  const offered = (data: AppData, on: string) => notesForDraft(data, s, 'student', on)
  const timing = (data: AppData, on: string) => offered(data, on).map((n) => n.fact.timing).join()
  const used = (stage: 'ahead' | 'after' | 'undated', at = DAY0) => ({ at: `${at}T19:00:00.000Z`, stage, in: 'weekly_text' as const })

  // A golf tournament five days after the meeting.
  const golf = world([{ text: 'Golf tournament', eventDate: day(5) }])
  check('before the event, a text is offered the note to wish them well', timing(golf, day(1)) === 'coming_up')
  check('once that has been said, it is not offered again before the event', offered(world([{ eventDate: day(5), uses: [used('ahead')] }]), day(3)).length === 0)
  check('after the event it is offered again, this time to ask how it went', timing(world([{ eventDate: day(5), uses: [used('ahead')] }]), day(7)) === 'happened')
  check('once asked about, it is never offered again', offered(world([{ eventDate: day(5), uses: [used('ahead'), used('after', day(7))] }]), day(8)).length === 0)
  check('more than a week after the event it is finished, mentioned or not', noteStage(golf, golf.personalNotes[0], day(13)) === 'finished' && offered(golf, day(13)).length === 0)

  // Something next month, past the next meeting.
  const later = world([{ text: 'Ski trip', eventDate: day(40) }], [{ id: 'life-m2', studentId: s.id, title: 'Next', date: day(14), time: '16:00', durationMin: 45, status: 'completed' }])
  check('an event a month away is kept but not mentioned yet', noteStage(later, later.personalNotes[0], day(1)) === 'later' && offered(later, day(1)).length === 0)
  check('it survives the next meeting', noteStage(later, later.personalNotes[0], day(15)) === 'later')
  check('and is offered when the day gets close', timing(later, day(30)) === 'coming_up')

  // "Next month or so": an estimated date.
  const rough = world([{ text: 'Driving test', eventDate: day(30), eventDateApprox: true }], [{ id: 'life-m2', studentId: s.id, title: 'Next', date: day(14), time: '16:00', durationMin: 45, status: 'completed' }])
  check('a rough date is kept past the next meeting too', noteStage(rough, rough.personalNotes[0], day(15)) !== 'finished')
  check('it is described loosely, without naming a day', /^around .*not known$/.test(offered(rough, day(20))[0]?.fact.when ?? ''), offered(rough, day(20))[0]?.fact.when)
  check('and is not asked about afterwards, since the real day is unknown', noteStage(rough, rough.personalNotes[0], day(32)) === 'finished')

  // No date: it belongs to its meeting cycle.
  const hobby = world([{ text: 'Learning guitar' }])
  check('a note with no date is offered during its meeting cycle', timing(hobby, day(6)) === 'no_date')
  check('…once', offered(world([{ uses: [used('undated')] }]), day(6)).length === 0)
  const nextCycle = world([{ text: 'Learning guitar' }], [{ id: 'life-m2', studentId: s.id, title: 'Next', date: day(14), time: '16:00', durationMin: 45, status: 'completed' }])
  check('it is dropped when the next meeting is logged', noteStage(nextCycle, nextCycle.personalNotes[0], day(14)) === 'finished' && offered(nextCycle, day(14)).length === 0)
  check('a scheduled meeting that has not happened does not drop it', noteStage(world([{}], [{ id: 'life-m2', studentId: s.id, title: 'Next', date: day(3), time: '16:00', durationMin: 45, status: 'scheduled' }]), world([{}]).personalNotes[0], day(5)) === 'undated')
  check('with no meeting since, it still goes stale after 30 days', noteStage(hobby, hobby.personalNotes[0], day(31)) === 'finished')

  // What happened comes before what is coming, and both before the undated.
  const mixed = world([{ text: 'Hobby' }, { text: 'Coming', eventDate: day(6) }, { text: 'Happened', eventDate: day(1) }])
  check('offered in order: just happened, coming up, no date', offered(mixed, day(3)).map((n) => n.note.text).join() === 'Happened,Coming,Hobby')
}

// ── The student link's code ──
const link = readFileSync(new URL('../server/studentLink.ts', import.meta.url), 'utf8')
const tablesRead = [...link.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1])
check('the student link reads no personal_notes or weekly_texts', !tablesRead.includes('personal_notes') && !tablesRead.includes('weekly_texts'), [...new Set(tablesRead)].join(', '))
check('the student link never selects a meeting’s AI drafts', !/select\('[^']*\bai\b[^']*'\)/.test(link))
{
  const started = '2026-11-24T10:00:00.000Z'
  const at = (seconds: number) => Date.parse(started) + seconds * 1000
  check('a student upload may finish within five minutes of its URL', STUDENT_UPLOAD_SECONDS === 300 && !uploadWindowClosed(started, at(0)) && !uploadWindowClosed(started, at(300)))
  check('…and is refused after, or when its start time cannot be read', uploadWindowClosed(started, at(301)) && uploadWindowClosed('not a time', at(0)))
  check('finishing a student upload checks that window before reading the file', /uploadWindowClosed\(row\.created_at\)/.test(link) && link.indexOf('uploadWindowClosed(row.created_at)') < link.indexOf('confirmUpload(db, row)'))
}

// ── The words on the Behind and Slipping tags come from the rule's own numbers ──
{
  const base = { lateCount: 0, maxDaysLate: 0, daysSinceMeeting: 5, daysSinceOnboarded: 200 }
  check('behind starts at the number of late tasks the tooltip names', classifyAttention({ ...base, lateCount: BEHIND_LATE_TASKS, maxDaysLate: 1 }) === 'behind' && classifyAttention({ ...base, lateCount: BEHIND_LATE_TASKS - 1, maxDaysLate: 1 }) === 'slipping' && ATTENTION_RULE.behind.includes(`${BEHIND_LATE_TASKS} or more late tasks`))
  check('…and at the days late it names', classifyAttention({ ...base, lateCount: 1, maxDaysLate: BEHIND_DAYS_LATE }) === 'behind' && classifyAttention({ ...base, lateCount: 1, maxDaysLate: BEHIND_DAYS_LATE - 1 }) === 'slipping' && ATTENTION_RULE.behind.includes(`${BEHIND_DAYS_LATE} or more days late`))
  check('slipping starts after the meeting gap it names', classifyAttention({ ...base, daysSinceMeeting: MEETING_GAP_DAYS + 1 }) === 'slipping' && classifyAttention({ ...base, daysSinceMeeting: MEETING_GAP_DAYS }) === 'on_track' && ATTENTION_RULE.slipping.includes(`more than ${MEETING_GAP_DAYS} days`))
  check('every tag has its rule in words', (['behind', 'slipping', 'on_track', 'new'] as const).every((k) => ATTENTION_RULE[k].length > 20))
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
