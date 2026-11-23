// End-to-end check of the AI endpoint: calls the real handler in api/ai.ts once
// per feature with realistic sample input built from the seed data, and prints
// each draft. Run with:  npm run test:ai
//
// Needs ANTHROPIC_API_KEY and the three Supabase settings in .env.local. The
// endpoint only answers signed-in members of a firm, so the run creates a
// throwaway account and firm and deletes them at the end. Each run makes seven
// real model calls. Pass a feature name to run just one:
//   npm run test:ai -- parentReport

import { POST } from '../api/ai.js'
import type { Feature } from '../shared/contract.js'
import { IDS, KEVIN_ESSAY_PROMPT, KEVIN_ESSAY_TEXT, sampleCounselorNote } from '../src/data/fixtures.js'
import { buildSeed } from '../src/data/seed.js'
import { formatDate, formatDateZh } from '../src/lib/dates.js'
import { daysLate, weeklyTextItems } from '../src/lib/derive.js'
import { WEEKLY_TEXT_MAX, weeklyTextFacts, weeklyTextMissing } from '../src/lib/reminders.js'
import { briefFacts, buildFacts, reportFacts } from '../src/lib/facts.js'
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

// A realistic weekly text: Kevin's own late and upcoming tasks, his next meeting, an invented link.
const kevinWeekly = weeklyTextFacts(kevin, data.firm.counselorFirstName, weeklyTextItems(data, kevin.id) ?? { late: [], due: [] }, 'https://platinum.example/s/Lka1hSX5xoW6d5u4VfaKiSq-hkmUPMrnHfK0bG63aRY')
inputs.weeklyText = {
  today: data.students.length ? new Date().toISOString().slice(0, 10) : '',
  studentFirstName: kevinWeekly.firstName,
  counselorFirstName: kevinWeekly.counselorFirstName,
  language: 'en',
  meeting: kevinWeekly.meeting,
  late: kevinWeekly.late,
  due: kevinWeekly.due,
  more: kevinWeekly.more,
  link: kevinWeekly.link,
  maxChars: WEEKLY_TEXT_MAX,
}

const only = process.argv[2] as Feature | undefined
let failed = 0
const account = await createAccount('AI')

for (const feature of Object.keys(inputs) as Feature[]) {
  if (only && feature !== only) continue
  const started = Date.now()
  const response = await POST(
    new Request('http://localhost/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${account.token}` },
      body: JSON.stringify({ feature, input: inputs[feature] }),
    }),
  )
  const body = await response.json()
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\n━━ ${feature} · HTTP ${response.status} · ${seconds}s ${'━'.repeat(40)}`)
  console.log(JSON.stringify(body, null, 2))
  if (!body.ok) failed += 1
  if (feature === 'weeklyText' && body.ok) {
    const missing = weeklyTextMissing(body.draft.text, kevinWeekly)
    console.log(`weeklyText: ${body.draft.text.length} characters (limit ${WEEKLY_TEXT_MAX}); facts changed or missing: ${missing.length ? missing.join(' | ') : 'none'}`)
    if (missing.length || body.draft.text.length > WEEKLY_TEXT_MAX) failed += 1
  }
}

await removeAccount(account)

if (failed > 0) {
  console.error(`\n${failed} feature(s) failed.`)
  process.exit(1)
}
