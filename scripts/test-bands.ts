// Unit tests for college list drafting: the band rules, the candidate cap, the
// majors match, the check on model-written reasons, and how a draft is put
// together. Run with:
//
//   npm run test:bands
//
// It needs no keys and no network. It also reads the code that builds the
// student link and parent reports, and fails if either starts reading drafts.

import { readFileSync } from 'node:fs'
import { CIP_PROGRAMS } from '../shared/cipPrograms.js'
import { BAND_RULES, CANDIDATE_CAP, DEFAULT_MIX, bandCollege, bestTest, capCandidates, counselorBasis, sizeBandOf, type BandCollege, type Candidate } from '../src/lib/collegeBands.js'
import {
  MAJOR_ALIASES,
  STOCK_REASON,
  assembleDraft,
  checkPicks,
  defaultPreferences,
  handPickRows,
  matchMajors,
  normalizePreferences,
  notesForListDraft,
  reasonProblem,
  stillNeeded,
} from '../src/lib/collegeListDraft.js'
import type { CollegeFit, Meeting } from '../src/types.js'

let failed = 0
function check(name: string, pass: boolean, detail = ''): void {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

// ── The band rules ──
const sources = { admissions: { source: 'Scorecard', year: 'Fall 2024' }, tests: { source: 'Scorecard', year: 'Fall 2024' } }
/** A college whose SAT middle half is 1200 to 1400 and ACT 26 to 31. */
const college = (admitRate: number | undefined, extra: Partial<BandCollege> = {}): BandCollege => ({
  admitRate,
  satEbrw25: 600,
  satMath25: 600,
  satEbrw75: 700,
  satMath75: 700,
  act25: 26,
  act75: 31,
  sources,
  ...extra,
})
const noTests = { satEbrw25: undefined, satMath25: undefined, satEbrw75: undefined, satMath75: undefined, act25: undefined, act75: undefined }
const fit = (student: Parameters<typeof bandCollege>[0], c: BandCollege) => bandCollege(student, c).fit
const basis = (student: Parameters<typeof bandCollege>[0], c: BandCollege) => bandCollege(student, c).basis

check('the thresholds are the ones the brief gives', BAND_RULES.reachAdmitRateBelow === 0.2 && BAND_RULES.likelyAdmitRateAtLeast === 0.5)
check('the default mix is 3 Reach, 5 Target, 3 Likely', DEFAULT_MIX.Reach === 3 && DEFAULT_MIX.Target === 5 && DEFAULT_MIX.Likely === 3)

// Under 20%.
check('admit rate under 20% is a Reach, even for a student far above the 75th percentile', fit({ sat: 1600, act: 36 }, college(0.19)) === 'Reach' && basis({ sat: 1600 }, college(0.19)).rule === 'admit_rate_under_reach')
check('…and with no score on file, and it is not flagged as limited (no score would change it)', fit({}, college(0.05)) === 'Reach' && basis({}, college(0.05)).limitedData === false)
check('…and with no test ranges reported', fit({ sat: 1500 }, college(0.07, noTests)) === 'Reach')
check('exactly 20% is not under 20%', fit({ sat: 1300 }, college(0.2)) === 'Target')

// The full rule.
check('at the 75th percentile with admit rate 50%: Likely', fit({ sat: 1400 }, college(0.5)) === 'Likely')
check('above the 75th percentile with admit rate 80%: Likely', fit({ sat: 1550 }, college(0.8)) === 'Likely')
check('above the 75th percentile but admit rate 49%: Target', fit({ sat: 1550 }, college(0.49)) === 'Target')
check('one point under the 75th percentile with a high admit rate: Target', fit({ sat: 1390 }, college(0.9)) === 'Target')
check('below the 25th percentile: Reach, whatever the admit rate', fit({ sat: 1190 }, college(0.9)) === 'Reach' && basis({ sat: 1190 }, college(0.9)).rule === 'below_25th')
check('exactly the 25th percentile is not below it: Target', fit({ sat: 1200 }, college(0.6)) === 'Target')
check('in the middle half: Target', fit({ sat: 1300 }, college(0.35)) === 'Target' && basis({ sat: 1300 }, college(0.35)).rule === 'between')
check('a band on the full rule is not flagged as limited', basis({ sat: 1300 }, college(0.35)).limitedData === false && basis({ sat: 1300 }, college(0.35)).limitedReason === undefined)

// SAT is the total against the sum of the two sections; ACT against the composite.
const satBasis = basis({ sat: 1300 }, college(0.35))
check('SAT is compared as a total with the sum of the section percentiles', satBasis.student?.test === 'SAT' && satBasis.college?.test25 === 1200 && satBasis.college?.test75 === 1400)
check('ACT is compared with the composite percentiles', fit({ act: 31 }, college(0.6)) === 'Likely' && fit({ act: 25 }, college(0.6)) === 'Reach' && basis({ act: 28 }, college(0.6)).college?.test75 === 31)
check('with both tests on file, the one that places the student higher is used', bestTest({ sat: 1150, act: 32 }, college(0.6))?.test === 'ACT' && fit({ sat: 1150, act: 32 }, college(0.6)) === 'Likely' && bestTest({ sat: 1450, act: 24 }, college(0.6))?.test === 'SAT')
check('a test the college reports no range for is not used', bestTest({ sat: 1500, act: 20 }, college(0.6, { act25: undefined, act75: undefined }))?.test === 'SAT' && bestTest({ act: 30 }, college(0.6, { act25: undefined }))?.test === undefined)
check('one missing SAT section percentile means no SAT comparison', bestTest({ sat: 1500 }, college(0.6, { satMath75: undefined })) === undefined)
check('an impossible score on file is ignored', bestTest({ sat: 14800 }, college(0.6)) === undefined && bestTest({ act: 0 }, college(0.6)) === undefined)

// Missing data.
const noScore = bandCollege({}, college(0.6))
check('no test score on file: banded on the admit rate alone and flagged', noScore.basis.rule === 'admit_rate_alone' && noScore.basis.limitedData === true && noScore.fit === 'Target' && /no SAT or ACT score/i.test(noScore.basis.limitedReason ?? ''))
check('…where 75% or more is Likely and 74% is not', fit({}, college(0.75)) === 'Likely' && fit({}, college(0.74)) === 'Target' && BAND_RULES.aloneLikelyAdmitRateAtLeast === 0.75)
const noRanges = bandCollege({ sat: 1400 }, college(0.8, noTests))
check('college reports no test ranges: admit rate alone, flagged, and the reason says which', noRanges.basis.rule === 'admit_rate_alone' && noRanges.basis.limitedData === true && noRanges.fit === 'Likely' && /did not report score ranges/.test(noRanges.basis.limitedReason ?? ''))
const noRate = bandCollege({ sat: 1500 }, college(undefined))
check('college reports no admit rate: never Likely, and flagged', noRate.fit === 'Target' && noRate.basis.limitedData === true && fit({ sat: 1100 }, college(undefined)) === 'Reach')
const nothing = bandCollege({ sat: 1500 }, college(undefined, noTests))
check('no figures at all: Target, flagged', nothing.fit === 'Target' && nothing.basis.rule === 'no_figures' && nothing.basis.limitedData === true)
const open = bandCollege({}, college(undefined, { ...noTests, openAdmissions: true }))
check('an open-admission college with no admit rate: Likely, flagged', open.fit === 'Likely' && open.basis.rule === 'open_admission' && open.basis.limitedData === true)

// The basis.
const full = bandCollege({ sat: 1450, gpa: 3.9, gpaWeighted: 4.3 }, college(0.62))
check('the basis names the rule, the numbers, the thresholds and the data years', full.basis.rule === 'at_or_above_75th' && full.basis.student?.score === 1450 && full.basis.college?.admitRate === 0.62 && full.basis.years?.admissions === 'Fall 2024' && full.basis.years?.tests === 'Fall 2024' && full.basis.thresholds?.reachAdmitRateBelow === 0.2 && full.basis.ruleFit === 'Likely')
check('the "why" line states each figure with its year', full.basis.summary === 'SAT 1450 is at or above the 75th percentile of enrolled students, 1400 (Fall 2024), and the admit rate is 62% (Fall 2024), 50% or more.', full.basis.summary)
check('the GPA is recorded for context and changes no band', full.basis.student?.gpa === 3.9 && FITS_EQUAL({ sat: 1450, gpa: 1.0 }, { sat: 1450, gpa: 4.0 }))
function FITS_EQUAL(a: Parameters<typeof bandCollege>[0], b: Parameters<typeof bandCollege>[0]): boolean {
  return [0.05, 0.3, 0.6, 0.9].every((rate) => fit(a, college(rate)) === fit(b, college(rate)))
}
const everyBand = [bandCollege({ sat: 1600 }, college(0.03)), full, noScore, noRanges, noRate, nothing, open, bandCollege({ sat: 1000 }, college(0.5)), bandCollege({ sat: 1500 }, college(0.3))]
check('every "why" line fits the list row it is copied to (500 characters)', everyBand.every((b) => (b.basis.summary ?? '').length > 0 && (b.basis.summary ?? '').length <= 500))
check('no "why" line speaks of a chance, odds or a probability', everyBand.every((b) => !/chance|odds|probab|likelihood/i.test(b.basis.summary ?? '')))
check('a rate that rounds onto a threshold is written out, so the line never reads "50% is under 50%"', /the admit rate, 49\.7% \(Fall 2024\), is under 50%/.test(bandCollege({ sat: 1500 }, college(0.497)).basis.summary ?? ''), bandCollege({ sat: 1500 }, college(0.497)).basis.summary)
check('a missing year is said, not invented', /year not recorded/.test(bandCollege({}, { admitRate: 0.1 }).basis.summary ?? ''))

// A counselor changes the band.
const changed = counselorBasis(full.basis, 'Target')
check('a counselor’s band is recorded as theirs, with what the rule gave', changed.fitSetBy === 'counselor' && /^Set to Target by a counselor\. By the rule it was a Likely: SAT 1450/.test(changed.basis.summary ?? '') && changed.basis.ruleFit === 'Likely' && changed.basis.college?.admitRate === 0.62)
const back = counselorBasis(changed.basis, 'Likely')
check('choosing the rule’s band again puts the rule’s line back', back.fitSetBy === 'rule' && back.basis.summary === full.basis.summary && back.basis.ruleSummary === undefined)
check('changing twice keeps the rule’s own line, not a line about a line', counselorBasis(changed.basis, 'Reach').basis.summary === `Set to Reach by a counselor. By the rule it was a Likely: ${full.basis.summary}`)

check('sizes: 4,999 is small, 5,000 medium, 15,000 large, none is none', sizeBandOf(4999) === 'small' && sizeBandOf(5000) === 'medium' && sizeBandOf(14999) === 'medium' && sizeBandOf(15000) === 'large' && sizeBandOf(undefined) === undefined)

// ── The cap ──
const cand = (unitid: number, band: CollegeFit, extra: Partial<Candidate> = {}): Candidate => ({ unitid, name: `College ${String(unitid).padStart(4, '0')}`, fit: band, basis: { limitedData: false }, programs: [], undergradSize: 10_000 - unitid, ...extra })
const many = [...Array.from({ length: 900 }, (_, i) => cand(i + 1, 'Likely')), ...Array.from({ length: 40 }, (_, i) => cand(1000 + i, 'Target')), ...Array.from({ length: 6 }, (_, i) => cand(2000 + i, 'Reach'))]
const capped = capCandidates(many, DEFAULT_MIX)
const count = (list: Candidate[], band: CollegeFit) => list.filter((c) => c.fit === band).length
check(`the cap is ${CANDIDATE_CAP}`, capped.length === 300 && CANDIDATE_CAP === 300)
check('the cap keeps every college of a scarce band, however many of another there are', count(capped, 'Reach') === 6 && count(capped, 'Target') === 40 && count(capped, 'Likely') === 254)
check('under the cap, nothing is dropped', capCandidates(many.slice(0, 200), DEFAULT_MIX).length === 200)
check('a must-include is always kept, even in a band the mix asks nothing of', capCandidates([...many, cand(9999, 'Reach', { mustInclude: true })], { Reach: 0, Target: 5, Likely: 3 }).some((c) => c.unitid === 9999))
check('a band the mix asks nothing of gets no candidates', count(capCandidates(many, { Reach: 0, Target: 5, Likely: 3 }), 'Reach') === 0)
const relevant = capCandidates([...many, cand(5000, 'Likely', { programs: ['Computer Science', 'Data Science'], undergradSize: 900 })], DEFAULT_MIX)
check('a college with more matching programs outranks a larger one', relevant.filter((c) => c.fit === 'Likely')[0].unitid === 5000)

// ── Majors to programs ──
const codes = (major: string) => (matchMajors([major])[0]?.programs ?? []).map((p) => p.cipCode).join(',')
const allCodes = new Set(CIP_PROGRAMS.map((p) => p.cipCode))
check('the program list was generated from the directory', CIP_PROGRAMS.length > 300 && CIP_PROGRAMS.every((p) => /^\d{4}$/.test(p.cipCode) && p.cipTitle && p.colleges > 0))
check('every alias points at a program the directory has', Object.values(MAJOR_ALIASES).flat().every((code) => allCodes.has(code)), Object.values(MAJOR_ALIASES).flat().filter((code) => !allCodes.has(code)).join(','))
check('"Computer Science" matches Computer Science and the general computing program', codes('Computer Science') === '1107,1101')
check('"Mechanical Engineering" matches exactly that', codes('Mechanical Engineering') === '1419')
check('"Biology" matches "Biology, General"', codes('Biology') === '2601')
check('"Psychology" matches "Psychology, General"', codes('Psychology') === '4201')
check('"Data Science", "Economics", "Applied Mathematics", "Public Health", "Architecture" each match their own program', codes('Data Science') === '3070' && codes('Economics') === '4506' && codes('Applied Mathematics') === '2703' && codes('Public Health') === '5122' && codes('Architecture') === '0402')
check('"Undecided" matches nothing', codes('Undecided') === '' && codes('  ') === '')
check('a major the directory has no title for matches nothing, and is not guessed', codes('Underwater Basket Weaving') === '')
check('at most three programs are suggested for one major', matchMajors(['Engineering Technology'])[0].programs.length <= 3)
const kevin = defaultPreferences({ majors: ['Computer Science', 'Data Science'] })
check('the form starts from the student’s majors and their programs, with the default mix', kevin.majors?.join() === 'Computer Science,Data Science' && kevin.programs?.map((p) => p.cipCode).join() === '1107,1101,3070' && kevin.mix?.Target === 5 && kevin.states === undefined)

const normal = normalizePreferences({ states: ['ca', 'CA', 'zzz'], mustInclude: [{ unitid: 1, name: 'A' }, { unitid: 1, name: 'A' }], exclude: [{ unitid: 1, name: 'A' }, { unitid: 2, name: 'B' }], mix: { Reach: 99, Target: -1, Likely: 2.4 } })
check('preferences are tidied: states upper-cased and deduplicated, counts kept in range', normal.states.join() === 'CA' && normal.mix.Reach === 10 && normal.mix.Target === 0 && normal.mix.Likely === 2)
check('a college both wanted and excluded stays wanted', normal.mustInclude.length === 1 && normal.exclude.map((r) => r.unitid).join() === '2')
check('open-admission colleges are left out unless asked', normal.includeOpenAdmission === false)

// ── The check on what the model writes ──
const ok = ['Strong computer science department with a co-op program that fits his robotics work.', 'A large public flagship in the Midwest. Its data science major is housed with statistics.', 'Top 10 program for robotics; Big Ten research university.']
check('ordinary reasons pass', ok.every((r) => reasonProblem(r) === undefined), ok.map(reasonProblem).filter(Boolean).join(' | '))
const bad = [
  'Admits about 8% of applicants, so it is a stretch.',
  'An admit rate of 8 % makes this a reach.',
  'Roughly 60 percent of applicants are admitted.',
  'His 1480 is above the middle range here.',
  'The middle half of enrolled students scored 1,350 to 1,510.',
  'A 45％ admit rate.',
  'Ranked highly since 2019 for engineering.',
  '',
  'x'.repeat(401),
]
check('a reason with a digit followed by % is rejected', [bad[0], bad[1], bad[5]].every((r) => reasonProblem(r) === 'it stated a percentage'))
check('…and "percent" spelled out', reasonProblem(bad[2]) === 'it stated a percentage')
check('a reason with a four-digit test score is rejected, with or without a comma', /four-digit/.test(reasonProblem(bad[3]) ?? '') && /four-digit/.test(reasonProblem(bad[4]) ?? ''))
check('any four-digit number is rejected, a year included', /four-digit/.test(reasonProblem(bad[6]) ?? ''))
check('an empty or overlong reason is rejected', reasonProblem(bad[7]) === 'it was empty' && reasonProblem(bad[8]) === 'it was too long')
check('five digits or more are not mistaken for a test score', reasonProblem('About 31000 undergraduates on one campus.') === undefined && reasonProblem('About 31,000 undergraduates.') === undefined)

// ── From the model's picks to the draft ──
const pool = [cand(1, 'Reach'), cand(2, 'Reach'), cand(3, 'Reach'), cand(4, 'Reach'), cand(11, 'Target'), cand(12, 'Target'), cand(13, 'Target'), cand(21, 'Likely'), cand(22, 'Likely', { mustInclude: true })]
const mix = { Reach: 2, Target: 2, Likely: 2 }
const checked = checkPicks(
  [
    { unitid: 2, reason: 'Good fit for robotics.' },
    { unitid: 777, reason: 'Not a candidate.' },
    { unitid: 2, reason: 'Named twice.' },
    { unitid: 3, reason: 'Admits 9% of applicants.' },
    { unitid: 11, reason: ' Strong program. ' },
  ],
  pool,
)
check('a unitid that is not a candidate is dropped, and so is a duplicate', checked.dropped === 2 && checked.accepted.map((p) => p.unitid).join() === '2,11')
check('a reason that fails the check is rejected, and the college is not accepted', checked.rejected.length === 1 && checked.rejected[0].unitid === 3 && checked.rejected[0].problem === 'it stated a percentage')
check('a second answer cannot re-add what was already accepted', checkPicks([{ unitid: 2, reason: 'Again.' }, { unitid: 12, reason: 'New.' }], pool, new Set([2, 11])).accepted.map((p) => p.unitid).join() === '12')
const need = stillNeeded(pool, mix, checked.accepted)
check('what is still needed counts accepted picks and must-includes, and never more than a band has', need.Reach === 1 && need.Target === 1 && need.Likely === 1 && stillNeeded(pool, { Reach: 9, Target: 0, Likely: 0 }, []).Reach === 4)

const rows = assembleDraft(pool, mix, checked.accepted, checked.rejected.map((r) => r.unitid))
const ids = (band: CollegeFit) => rows.filter((r) => r.candidate.fit === band).map((r) => r.candidate.unitid).join()
check('the draft is grouped Reach, Target, Likely, with the mix in each', rows.map((r) => r.candidate.fit).join() === 'Reach,Reach,Target,Target,Likely,Likely')
check('a short band is filled first with the college the model chose but explained badly', ids('Reach') === '2,3')
check('…then from the top candidates in that band', ids('Target') === '11,12')
check('a must-include is always in, and counts towards its band', ids('Likely') === '22,21')
check('filled rows carry the stock reason and are marked as not AI-explained', rows.filter((r) => !r.aiExplained).every((r) => r.reason === STOCK_REASON) && rows.find((r) => r.candidate.unitid === 3)?.reason === 'Matches your filters' && rows.find((r) => r.candidate.unitid === 3)?.aiExplained === false)
check('accepted rows carry the model’s reason, trimmed', rows.find((r) => r.candidate.unitid === 11)?.reason === 'Strong program.' && rows.find((r) => r.candidate.unitid === 11)?.aiExplained === true)
check('no rejected text survives anywhere in the draft', !JSON.stringify(rows.map((r) => r.reason)).includes('9%'))
check('more picks than the mix asks for are cut, in the model’s order', assembleDraft(pool, mix, [1, 2, 3, 4].map((unitid) => ({ unitid, reason: 'Fine.' }))).filter((r) => r.candidate.fit === 'Reach').map((r) => r.candidate.unitid).join() === '1,2')
check('a band with fewer candidates than the mix simply has fewer', assembleDraft(pool, { Reach: 2, Target: 2, Likely: 5 }, []).filter((r) => r.candidate.fit === 'Likely').length === 2)
const byHand = handPickRows(pool, mix)
check('with no AI step, the top candidates of each band are offered with the stock reason', byHand.length === pool.length && byHand.every((r) => r.reason === STOCK_REASON && !r.aiExplained))

// ── Which notes the model reads ──
const meeting = (date: string, extra: Partial<Meeting>): Meeting => ({ id: date, studentId: 's', title: `Meeting ${date}`, date, time: '16:00', durationMin: 45, status: 'completed', transcript: 'RAW TRANSCRIPT', ...extra })
const ai = (review: 'approved' | 'pending', text: string) => ({ decided: [`decided ${text}`], progress: [], watch: [], notes: [`notes ${text}`], notesReview: review, draftTasks: [], parentUpdates: [], profileChanges: [], source: { kind: 'claude' as const, model: 'm' } })
const recap = (review: 'approved' | 'pending', text: string) => ({ summary: `recap ${text}`, nextSteps: ['step'], review })
const notes = notesForListDraft([
  meeting('2026-09-01', { ai: ai('approved', 'OLDEST') }),
  meeting('2026-11-20', { ai: ai('pending', 'UNAPPROVED'), recap: recap('pending', 'UNAPPROVED') }),
  meeting('2026-11-10', { ai: ai('pending', 'UNAPPROVED'), recap: recap('approved', 'NOV10') }),
  meeting('2026-10-01', { ai: ai('approved', 'OCT1') }),
  meeting('2026-10-15', { ai: ai('approved', 'OCT15'), recap: recap('approved', 'IGNORED') }),
  meeting('2026-12-01', { status: 'scheduled', ai: ai('approved', 'FUTURE') }),
])
const noteText = JSON.stringify(notes)
check('the model reads the three most recent approved meeting records, newest first', notes.map((n) => n.date).join() === '2026-11-10,2026-10-15,2026-10-01')
check('approved meeting notes are used; an approved recap stands in when the notes are not approved', noteText.includes('OCT15') && noteText.includes('recap NOV10') && !noteText.includes('IGNORED'))
check('never a transcript, never anything unapproved, never a meeting that has not happened', !noteText.includes('RAW TRANSCRIPT') && !noteText.includes('UNAPPROVED') && !noteText.includes('FUTURE'))

// ── Privacy: a draft is the counselor's alone ──
// Nothing in a draft may reach the student link or a parent report. Neither
// reads the draft tables or the draft lists today; these fail if that changes.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const DRAFT_WORDS = /college_list_draft|collegeListDraft|add_draft_to_college_list|fit_basis|fitBasis/
const link = read('../server/studentLink.ts')
const linkTables = [...link.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1])
// The link's answer has the two draft lists, always empty. Those two lines aside, the file must not mention drafts.
const emptyLists = /^\s*collegeListDraft(s|Items): \[\],\s*$/gm
check('the student link answers with empty draft lists', (link.match(emptyLists) ?? []).length === 2)
check('the student link reads neither draft table', !linkTables.some((t) => t.startsWith('college_list_draft')) && !DRAFT_WORDS.test(link.replace(emptyLists, '')), [...new Set(linkTables)].join(', '))
check('…and selects no note or fit reason from the college list', !/from\('colleges'\)\.select\('[^']*\b(note|fit_reason|fit_set_by)\b[^']*'\)/.test(link))
check('the student link’s handler does not touch drafts either', !DRAFT_WORDS.test(read('../api/student.ts')))
check('the facts behind parent reports and every other AI request never read drafts', !DRAFT_WORDS.test(read('../src/lib/facts.ts')))
check('…and neither do reminders and weekly texts', !DRAFT_WORDS.test(read('../src/lib/reminders.ts')))
// Once a draft is added, its reason becomes the list row's note and its "why" line the row's fit reason. Students see neither.
check('the student’s own page shows nothing from a draft, and no list row’s note or fit reason', !/collegeListDraft|fitBasis|fitReason|\.note\b/.test(read('../src/screens/student/StudentView.tsx')))

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
