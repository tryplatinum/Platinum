// Reach, Target or Likely for one student at one college, decided in code.
//
// Everything here is a pure function of the student's record and the college
// directory's figures. The model never decides a band and never produces a
// number: it is not even shown the figures (see server/collegeListDrafts.ts).
//
// A band is a starting point from public data, not a prediction. Nothing here
// computes or implies any student's chance of admission. The admit rate is the
// institution's own published rate for everyone who applied.
//
// What the rules compare:
//   * the student's best test score: the SAT total against the sum of the
//     college's Reading-and-Writing and Math percentiles (25th with 25th, 75th
//     with 75th), or the ACT composite against the ACT percentiles. With both
//     on file, the test that places the student higher is used.
//   * the college's admit rate.
// The directory has no GPA figures for colleges, so a GPA cannot be compared
// with anything. It is recorded in the basis for context and no rule reads it.

import type { BandRule, CollegeFit, DataSource, FitBasis, ListMix, SizeBand } from '../types'

/** Every threshold the rules use. Change one here and the tests, the screen and the README's table follow. */
export const BAND_RULES = {
  /** An admit rate under this is a Reach, whatever the student's numbers. */
  reachAdmitRateBelow: 0.2,
  /** Likely needs the student at or above the 75th percentile AND an admit rate of at least this. */
  likelyAdmitRateAtLeast: 0.5,
  /**
   * With no test comparison to go on, Likely needs an admit rate of at least
   * this. It is stricter than the full rule on purpose: half the evidence is missing.
   */
  aloneLikelyAdmitRateAtLeast: 0.75,
} as const

export const FITS: CollegeFit[] = ['Reach', 'Target', 'Likely']

export const DEFAULT_MIX: ListMix = { Reach: 3, Target: 5, Likely: 3 }
export const MAX_PER_BAND = 10
/** How many banded candidates one draft considers (and shows the model). */
export const CANDIDATE_CAP = 300

/** Undergraduates. `max` is inclusive. */
export const SIZE_BANDS: Record<SizeBand, { label: string; min: number; max?: number }> = {
  small: { label: 'Small (under 5,000)', min: 0, max: 4_999 },
  medium: { label: 'Medium (5,000 to 14,999)', min: 5_000, max: 14_999 },
  large: { label: 'Large (15,000 or more)', min: 15_000 },
}
export const SIZES = Object.keys(SIZE_BANDS) as SizeBand[]

export const sizeBandOf = (undergraduates: number | undefined): SizeBand | undefined =>
  undergraduates === undefined ? undefined : SIZES.find((s) => undergraduates >= SIZE_BANDS[s].min && (SIZE_BANDS[s].max === undefined || undergraduates <= SIZE_BANDS[s].max))

/** The student's figures a band may read. */
export interface BandStudent {
  sat?: number
  act?: number
  gpa?: number
  gpaWeighted?: number
}

/** The directory figures a band may read. A missing figure is absent, never 0. */
export interface BandCollege {
  admitRate?: number
  openAdmissions?: boolean
  satEbrw25?: number
  satEbrw75?: number
  satMath25?: number
  satMath75?: number
  act25?: number
  act75?: number
  sources?: Record<string, DataSource>
}

export interface Band {
  fit: CollegeFit
  basis: FitBasis
}

/** 0.0365 → "3.7%", 0.41 → "41%". The same form the directory's figures are shown in. */
export const formatRate = (rate: number) => `${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%`

const year = (y: string | undefined) => ` (${y ?? 'year not recorded'})`

type Place = 'below_25th' | 'between' | 'at_or_above_75th'
const PLACE_RANK: Record<Place, number> = { below_25th: 0, between: 1, at_or_above_75th: 2 }

interface TestPlace {
  test: 'SAT' | 'ACT'
  score: number
  p25: number
  p75: number
  place: Place
  /** How far through the middle half the score sits. Only used to break a tie between the two tests. */
  through: number
}

function placeOn(test: 'SAT' | 'ACT', score: number | undefined, p25: number | undefined, p75: number | undefined): TestPlace | undefined {
  if (score === undefined || p25 === undefined || p75 === undefined) return undefined
  const place: Place = score >= p75 ? 'at_or_above_75th' : score < p25 ? 'below_25th' : 'between'
  return { test, score, p25, p75, place, through: (score - p25) / Math.max(p75 - p25, 1) }
}

const validSat = (n: number | undefined) => (n !== undefined && Number.isFinite(n) && n >= 400 && n <= 1600 ? n : undefined)
const validAct = (n: number | undefined) => (n !== undefined && Number.isFinite(n) && n >= 1 && n <= 36 ? n : undefined)
const sum = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined ? undefined : a + b)

/**
 * Where the student's best test score sits among the college's enrolled
 * students, or undefined when there is no score on file or the college did not
 * report ranges for a test the student has taken.
 */
export function bestTest(student: BandStudent, college: BandCollege): TestPlace | undefined {
  const sat = placeOn('SAT', validSat(student.sat), sum(college.satEbrw25, college.satMath25), sum(college.satEbrw75, college.satMath75))
  const act = placeOn('ACT', validAct(student.act), college.act25, college.act75)
  if (!sat || !act) return sat ?? act
  const byPlace = PLACE_RANK[act.place] - PLACE_RANK[sat.place]
  if (byPlace !== 0) return byPlace > 0 ? act : sat
  return act.through > sat.through ? act : sat
}

/**
 * The band for one student at one college, with what it rests on.
 *
 * In order:
 *   1. admit rate under 20%: Reach, whatever the student's numbers.
 *   2. with a test comparison and an admit rate:
 *        at or above the 75th percentile and admit rate 50% or more: Likely;
 *        below the 25th percentile: Reach; otherwise Target.
 *   3. with less than that, `limitedData` is set:
 *        an open-admission college with no admit rate: Likely;
 *        a test comparison but no admit rate: Reach below the 25th percentile, otherwise Target;
 *        an admit rate alone: Likely at 75% or more, otherwise Target;
 *        no figures at all: Target.
 */
export function bandCollege(student: BandStudent, college: BandCollege): Band {
  const R = BAND_RULES
  const rate = college.admitRate
  const test = bestTest(student, college)
  const admissionsYear = college.sources?.admissions?.year
  const testsYear = college.sources?.tests?.year
  const hasScore = validSat(student.sat) !== undefined || validAct(student.act) !== undefined

  const basis = (rule: BandRule, fit: CollegeFit, summary: string, limitedReason?: string): Band => ({
    fit,
    basis: {
      summary,
      limitedData: limitedReason !== undefined,
      ...(limitedReason === undefined ? {} : { limitedReason }),
      rule,
      ruleFit: fit,
      student: { ...(test ? { test: test.test, score: test.score } : {}), ...(student.gpa === undefined ? {} : { gpa: student.gpa }), ...(student.gpaWeighted === undefined ? {} : { gpaWeighted: student.gpaWeighted }) },
      college: {
        ...(rate === undefined ? {} : { admitRate: rate }),
        ...(college.openAdmissions === undefined ? {} : { openAdmissions: college.openAdmissions }),
        ...(test ? { test25: test.p25, test75: test.p75 } : {}),
      },
      years: { ...(admissionsYear ? { admissions: admissionsYear } : {}), ...(testsYear ? { tests: testsYear } : {}) },
      thresholds: { ...R },
    },
  })

  // A rate that rounds onto a threshold it is not equal to is written with one decimal, so "49.7% is under 50%" never reads "50% is under 50%".
  const onThreshold = rate !== undefined && Object.values(R).some((t) => t !== rate && formatRate(t) === formatRate(rate))
  const rateText = rate === undefined ? '' : `${onThreshold ? `${(rate * 100).toFixed(1)}%` : formatRate(rate)}${year(admissionsYear)}`

  // 1. Very selective: nobody's numbers make it anything but a Reach.
  if (rate !== undefined && rate < R.reachAdmitRateBelow) {
    return basis('admit_rate_under_reach', 'Reach', `The admit rate is ${rateText}, under ${formatRate(R.reachAdmitRateBelow)}, so this is a Reach whatever the student’s scores.`)
  }

  const scoreText = test ? `${test.test} ${test.score}` : ''
  const noTest = hasScore ? 'the college did not report score ranges for the test on file' : 'no SAT or ACT score is on file for the student'

  // 2. The full rule.
  if (test && rate !== undefined) {
    if (test.place === 'at_or_above_75th' && rate >= R.likelyAdmitRateAtLeast) {
      return basis('at_or_above_75th', 'Likely', `${scoreText} is at or above the 75th percentile of enrolled students, ${test.p75}${year(testsYear)}, and the admit rate is ${rateText}, ${formatRate(R.likelyAdmitRateAtLeast)} or more.`)
    }
    if (test.place === 'below_25th') {
      return basis('below_25th', 'Reach', `${scoreText} is below the 25th percentile of enrolled students, ${test.p25}${year(testsYear)}. The admit rate is ${rateText}.`)
    }
    if (test.place === 'at_or_above_75th') {
      return basis('between', 'Target', `${scoreText} is at or above the 75th percentile of enrolled students, ${test.p75}${year(testsYear)}, but the admit rate, ${rateText}, is under ${formatRate(R.likelyAdmitRateAtLeast)}.`)
    }
    return basis('between', 'Target', `${scoreText} is in the middle half of enrolled students, ${test.p25} to ${test.p75}${year(testsYear)}. The admit rate is ${rateText}.`)
  }

  // 3. Less to go on.
  if (rate === undefined && college.openAdmissions) {
    return basis('open_admission', 'Likely', `The college reports an open admission policy${year(admissionsYear)} and no admit rate.`, 'The college has an open admission policy and reports no admit rate.')
  }
  if (test) {
    const missing = 'The college did not report an admit rate.'
    if (test.place === 'below_25th') {
      return basis('below_25th', 'Reach', `${scoreText} is below the 25th percentile of enrolled students, ${test.p25}${year(testsYear)}. The college did not report an admit rate.`, missing)
    }
    const where = test.place === 'at_or_above_75th' ? `at or above the 75th percentile of enrolled students, ${test.p75}${year(testsYear)}` : `in the middle half of enrolled students, ${test.p25} to ${test.p75}${year(testsYear)}`
    return basis('between', 'Target', `${scoreText} is ${where}. The college did not report an admit rate, so it is not placed as Likely.`, missing)
  }
  if (rate !== undefined) {
    const reason = `${noTest[0].toUpperCase()}${noTest.slice(1)}.`
    const likely = rate >= R.aloneLikelyAdmitRateAtLeast
    return basis(
      'admit_rate_alone',
      likely ? 'Likely' : 'Target',
      `Placed on the admit rate alone, ${rateText}, because ${noTest}. On the admit rate alone, ${formatRate(R.aloneLikelyAdmitRateAtLeast)} or more is Likely.`,
      reason,
    )
  }
  return basis('no_figures', 'Target', 'The college did not report an admit rate or usable test score ranges, so it is placed as a Target until you decide.', 'The college did not report an admit rate or usable test score ranges.')
}

/**
 * The basis after a counselor sets the band by hand. The figures stay; the
 * "why" line says who set it and what the rule gave. Choosing the rule's own
 * band again puts the rule's line back.
 */
export function counselorBasis(basis: FitBasis, fit: CollegeFit): { basis: FitBasis; fitSetBy: 'rule' | 'counselor' } {
  const ruleSummary = basis.ruleSummary ?? basis.summary ?? ''
  if (basis.ruleFit === undefined || basis.ruleFit === fit) {
    const { ruleSummary: _dropped, ...rest } = basis
    return { basis: { ...rest, summary: ruleSummary }, fitSetBy: basis.ruleFit === undefined ? 'counselor' : 'rule' }
  }
  return { basis: { ...basis, ruleSummary, summary: `Set to ${fit} by a counselor. By the rule it was a ${basis.ruleFit}: ${ruleSummary}`.slice(0, 480) }, fitSetBy: 'counselor' }
}

// ── Which candidates a draft considers ──────────────────────────────────────

/** One banded college a draft may choose. */
export interface Candidate {
  unitid: number
  name: string
  state?: string
  control?: 'public' | 'private_nonprofit' | 'private_for_profit'
  undergradSize?: number
  fit: CollegeFit
  basis: FitBasis
  /** Titles of its programs that matched the program filter. */
  programs: string[]
  mustInclude?: boolean
}

/**
 * Most relevant first: more matching programs, then a band that rests on full
 * data, then the larger college, then by name. Used for the cap and for
 * filling a band the model left short.
 */
export function byRelevance(a: Candidate, b: Candidate): number {
  return (
    b.programs.length - a.programs.length ||
    Number(a.basis.limitedData ?? false) - Number(b.basis.limitedData ?? false) ||
    (b.undergradSize ?? -1) - (a.undergradSize ?? -1) ||
    a.name.localeCompare(b.name)
  )
}

/**
 * At most `cap` candidates, chosen so the cap cannot starve a band: every
 * must-include, then each band's share of the rest in proportion to the mix,
 * most relevant first, then whatever room is left in relevance order. A band
 * the mix asks nothing of gets no share.
 */
export function capCandidates(all: Candidate[], mix: ListMix, cap = CANDIDATE_CAP): Candidate[] {
  const must = all.filter((c) => c.mustInclude)
  const rest = all.filter((c) => !c.mustInclude && mix[c.fit] > 0).sort(byRelevance)
  const room = Math.max(cap - must.length, 0)
  if (rest.length <= room) return [...must, ...rest]

  const total = FITS.reduce((n, fit) => n + mix[fit], 0)
  const taken = new Set<number>()
  for (const fit of FITS) {
    const share = Math.floor((room * mix[fit]) / total)
    for (const c of rest.filter((x) => x.fit === fit).slice(0, share)) taken.add(c.unitid)
  }
  for (const c of rest) {
    if (taken.size >= room) break
    taken.add(c.unitid)
  }
  return [...must, ...rest.filter((c) => taken.has(c.unitid))]
}
