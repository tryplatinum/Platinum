// Drafting a college list for one student: everything that creates or records
// the AI's suggestion lives in this one module, as plain functions, so the
// central AI can call them later. server/collegeTools.ts wraps the two entry
// points (bandCollegesForStudent, draftCollegeList) as tools.
//
//   findCandidates       one query: the colleges that pass the hard preferences
//   bandForStudent       Reach, Target or Likely for given colleges, by the rules
//   explainCandidates    the AI step: which candidates, and a short reason each
//   draftCollegeList     all of it, saved as a draft. Never writes to `colleges`.
//
// Who decides what:
//   * our code picks the candidates, sets every band (src/lib/collegeBands.ts)
//     and supplies every figure. The model is not shown a single figure.
//   * the model chooses among the candidates and writes a short reason for
//     each, and its answer is checked here before anything is saved.
//   * a counselor reviews the draft; only "Add to list" (the database function
//     add_draft_to_college_list) puts anything on the student's list.
//
// Every function takes the caller's own Supabase client, never the service
// role, so row level security decides what it can read and write.

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { CONTROLS, REGIONS } from '../shared/colleges.js'
import { bandCollege, capCandidates, CANDIDATE_CAP, MAX_PER_BAND, SIZE_BANDS, SIZES, type BandCollege, type BandStudent, type Candidate } from '../src/lib/collegeBands.js'
import { MAX_EXCLUDE, MAX_MUST_INCLUDE, MAX_PROGRAMS, normalizePreferences } from '../src/lib/collegeListDraft.js'
import type { Database } from '../src/lib/database.types.js'
import type { CollegeFit, CollegeListPreferences, DataSource, FitBasis, ID, TestScores } from '../src/types.js'

type Client = SupabaseClient<Database>

/** A failure a caller can act on. `message` is safe to show. */
export class ListDraftError extends Error {
  code: 'bad_input' | 'not_found' | 'database'
  constructor(code: ListDraftError['code'], message: string) {
    super(message)
    this.code = code
  }
}

// ── Inputs ──────────────────────────────────────────────────────────────────

const unitid = z.number().int().min(1).max(99_999_999)
const collegeRef = z.object({ unitid, name: z.string().trim().max(200) }).strict()
const perBand = z.number().int().min(0).max(MAX_PER_BAND)

/** What a draft may be asked for. Every filter is optional; they are combined with "and". */
export const listPreferencesInput = z
  .object({
    majors: z.array(z.string().trim().min(1).max(80)).max(10).optional().describe('Intended majors as typed. Read by the model; the filter is `programs`.'),
    programs: z
      .array(z.object({ cipCode: z.string().regex(/^\d{4}$/), cipTitle: z.string().trim().max(200) }).strict())
      .max(MAX_PROGRAMS)
      .optional()
      .describe('The college must offer a bachelor\'s program in at least one of these four-digit CIP codes.'),
    states: z.array(z.string().trim().regex(/^[A-Za-z]{2}$/)).max(60).optional().describe('Two-letter state codes. A college passes when it is in one of these states or one of `regions`.'),
    regions: z.array(z.enum(REGIONS)).max(REGIONS.length).optional(),
    control: z.array(z.enum(CONTROLS)).max(CONTROLS.length).optional(),
    sizes: z.array(z.enum(SIZES as [string, ...string[]])).max(SIZES.length).optional().describe('small: under 5,000 undergraduates. medium: 5,000 to 14,999. large: 15,000 or more.'),
    maxNetPrice: z.number().int().min(0).max(2_000_000).optional().describe('Highest average net price in dollars. Colleges with none on record are left out.'),
    includeOpenAdmission: z.boolean().optional().describe('Open-admission colleges are left out unless true.'),
    mix: z.object({ Reach: perBand, Target: perBand, Likely: perBand }).strict().optional().describe('How many colleges per band. Default 3 Reach, 5 Target, 3 Likely.'),
    mustInclude: z.array(collegeRef).max(MAX_MUST_INCLUDE).optional().describe('Always in the draft, banded by the same rules, even when they fail a filter.'),
    exclude: z.array(collegeRef).max(MAX_EXCLUDE).optional(),
  })
  .strict()

function parsePreferences(input: unknown) {
  const result = listPreferencesInput.safeParse(input ?? {})
  if (!result.success) {
    const first = result.error.issues[0]
    throw new ListDraftError('bad_input', `Those preferences were not understood${first ? `: ${first.path.join('.') || 'input'} ${first.message.toLowerCase()}` : ''}.`)
  }
  const prefs = normalizePreferences(result.data as CollegeListPreferences)
  if (prefs.mix.Reach + prefs.mix.Target + prefs.mix.Likely === 0 && prefs.mustInclude.length === 0) throw new ListDraftError('bad_input', 'Ask for at least one college in one band.')
  return prefs
}

type Preferences = ReturnType<typeof parsePreferences>

// ── The student ─────────────────────────────────────────────────────────────

export interface ListStudent extends BandStudent {
  id: ID
  firmId: ID
  gradYear: number
  majors: string[]
  interests: string[]
  activities: { name: string; role: string; detail?: string }[]
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [])

/** The parts of a student's record that list drafting may read. No name, no contact details, no parents, no private notes. */
export async function readListStudent(client: Client, studentId: ID): Promise<ListStudent> {
  if (!z.string().uuid().safeParse(studentId).success) throw new ListDraftError('bad_input', 'That request was not understood: studentId is not valid.')
  const found = await client.from('students').select('id, firm_id, grad_year, gpa, gpa_weighted, tests, majors, interests, activities').eq('id', studentId).maybeSingle()
  if (found.error) throw new ListDraftError('database', 'The student could not be read.')
  if (!found.data) throw new ListDraftError('not_found', 'There is no such student.')
  const s = found.data
  const tests = (s.tests && typeof s.tests === 'object' && !Array.isArray(s.tests) ? s.tests : {}) as Partial<TestScores>
  const activities = Array.isArray(s.activities) ? (s.activities as { name?: unknown; role?: unknown; detail?: unknown }[]) : []
  return {
    id: s.id,
    firmId: s.firm_id,
    gradYear: s.grad_year,
    gpa: s.gpa ?? undefined,
    gpaWeighted: s.gpa_weighted ?? undefined,
    sat: typeof tests.sat === 'number' ? tests.sat : undefined,
    act: typeof tests.act === 'number' ? tests.act : undefined,
    majors: strings(s.majors),
    interests: strings(s.interests),
    activities: activities.flatMap((a) => (typeof a?.name === 'string' ? [{ name: a.name, role: typeof a.role === 'string' ? a.role : '', detail: typeof a.detail === 'string' ? a.detail : undefined }] : [])),
  }
}

// ── Candidates ──────────────────────────────────────────────────────────────

const CANDIDATE_COLUMNS =
  'unitid, name, state, region, control, undergrad_size, admit_rate, open_admissions, sat_ebrw_25, sat_ebrw_75, sat_math_25, sat_math_75, act_25, act_75, sources'

interface CandidateRow {
  unitid: number
  name: string
  state: string | null
  region: string | null
  control: string | null
  undergrad_size: number | null
  admit_rate: number | null
  open_admissions: boolean | null
  sat_ebrw_25: number | null
  sat_ebrw_75: number | null
  sat_math_25: number | null
  sat_math_75: number | null
  act_25: number | null
  act_75: number | null
  sources: unknown
  college_programs?: { cip_code: string; cip_title: string }[]
}

/** The most rows one request to the database returns. Past it, the largest colleges are the ones read. */
const QUERY_LIMIT = 1000

const u = <T>(value: T | null): T | undefined => (value === null ? undefined : value)

const figuresOf = (r: CandidateRow): BandCollege => ({
  admitRate: u(r.admit_rate),
  openAdmissions: u(r.open_admissions),
  satEbrw25: u(r.sat_ebrw_25),
  satEbrw75: u(r.sat_ebrw_75),
  satMath25: u(r.sat_math_25),
  satMath75: u(r.sat_math_75),
  act25: u(r.act_25),
  act75: u(r.act_75),
  sources: r.sources && typeof r.sources === 'object' && !Array.isArray(r.sources) ? (r.sources as Record<string, DataSource>) : {},
})

function candidateFrom(r: CandidateRow, student: BandStudent, wantedCodes: ReadonlySet<string>, mustInclude: boolean): Candidate {
  const band = bandCollege(student, figuresOf(r))
  const programs = [...new Set((r.college_programs ?? []).filter((p) => wantedCodes.has(p.cip_code)).map((p) => p.cip_title))]
  return {
    unitid: r.unitid,
    name: r.name,
    state: u(r.state),
    control: u(r.control) as Candidate['control'],
    undergradSize: u(r.undergrad_size),
    fit: band.fit,
    basis: { ...band.basis, ...(programs.length ? { programs } : {}) },
    programs,
    ...(mustInclude ? { mustInclude: true } : {}),
  }
}

/** Digits and letters only by the time they reach a filter string (the schema checked them). */
const quoted = (values: readonly string[]) => values.map((v) => `"${v.replace(/"/g, '')}"`).join(',')

/**
 * The colleges that pass every hard preference, in ONE query: states or
 * regions, control, size, programs, net price ceiling, and open-admission
 * colleges only if asked. Active institutions only, largest first.
 *
 * `total` is how many matched; `rows` holds at most 1,000 of them. Bands are
 * set afterwards in code and the list is then cut to 300 by capCandidates, so
 * the cut is made knowing each college's band and cannot leave a band empty.
 */
export async function findCandidates(client: Client, prefs: Preferences, leaveOut: number[]): Promise<{ rows: CandidateRow[]; total: number }> {
  const codes = prefs.programs.map((p) => p.cipCode)
  const select = codes.length ? `${CANDIDATE_COLUMNS}, college_programs!inner(cip_code, cip_title)` : CANDIDATE_COLUMNS
  let query = client.from('college_directory').select(select, { count: 'exact' }).eq('is_active', true)

  if (codes.length) query = query.in('college_programs.cip_code', codes)
  if (prefs.states.length && prefs.regions.length) query = query.or(`state.in.(${prefs.states.join(',')}),region.in.(${quoted(prefs.regions)})`)
  else if (prefs.states.length) query = query.in('state', prefs.states)
  else if (prefs.regions.length) query = query.in('region', prefs.regions)
  if (prefs.control.length) query = query.in('control', prefs.control)
  if (prefs.sizes.length && prefs.sizes.length < SIZES.length) {
    // A college with no size on record is left out when a size is asked for.
    const ranges = prefs.sizes.map((s) => {
      const { min, max } = SIZE_BANDS[s]
      return max === undefined ? `undergrad_size.gte.${min}` : `and(undergrad_size.gte.${min},undergrad_size.lte.${max})`
    })
    query = query.or(ranges.join(','))
  }
  if (prefs.maxNetPrice !== undefined) query = query.lte('avg_net_price', prefs.maxNetPrice)
  if (!prefs.includeOpenAdmission) query = query.or('open_admissions.is.null,open_admissions.eq.false')
  if (leaveOut.length) query = query.not('unitid', 'in', `(${leaveOut.join(',')})`)

  const result = await query.order('undergrad_size', { ascending: false, nullsFirst: false }).order('name').limit(QUERY_LIMIT)
  if (result.error) throw new ListDraftError('database', 'The college directory could not be read.')
  const rows = (result.data ?? []) as unknown as CandidateRow[]
  return { rows, total: result.count ?? rows.length }
}

/** Directory rows by UNITID, with all their programs, whatever the filters say. For must-includes and for banding named colleges. */
async function readColleges(client: Client, unitids: number[]): Promise<CandidateRow[]> {
  if (unitids.length === 0) return []
  const result = await client.from('college_directory').select(`${CANDIDATE_COLUMNS}, college_programs(cip_code, cip_title)`).in('unitid', unitids).order('name')
  if (result.error) throw new ListDraftError('database', 'The college directory could not be read.')
  return (result.data ?? []) as unknown as CandidateRow[]
}

export interface BandedCollege {
  unitid: number
  name: string
  state?: string
  fit: CollegeFit
  /** The figures and the rule used, with data years. */
  basis: FitBasis
  /** The "why this band" line: basis.summary. */
  reason: string
}

/**
 * Reach, Target or Likely for one student at each of the given colleges, by
 * the rules in src/lib/collegeBands.ts. A UNITID the directory does not have is
 * left out of the answer.
 */
export async function bandForStudent(client: Client, studentId: ID, unitids: number[]): Promise<BandedCollege[]> {
  const ids = z.array(unitid).min(1).max(100).safeParse(unitids)
  if (!ids.success) throw new ListDraftError('bad_input', 'That request was not understood: unitids must be 1 to 100 college ids.')
  const student = await readListStudent(client, studentId)
  const rows = await readColleges(client, [...new Set(ids.data)])
  return rows.map((r) => {
    const c = candidateFrom(r, student, new Set(), false)
    return { unitid: c.unitid, name: c.name, state: c.state, fit: c.fit, basis: c.basis, reason: c.basis.summary ?? '' }
  })
}

export interface CandidatePool {
  student: ListStudent
  preferences: Preferences
  /** Banded, at most 300, must-includes first. */
  candidates: Candidate[]
  /** How many colleges passed the filters (must-includes aside). */
  matched: number
}

/** The student, the checked preferences, and the banded candidates a draft will choose from. Reads only; saves nothing. */
export async function candidatePool(client: Client, studentId: ID, preferences: unknown): Promise<CandidatePool> {
  const prefs = parsePreferences(preferences)
  const student = await readListStudent(client, studentId)

  // Colleges already on the student's list are not proposed again.
  const listed = await client.from('colleges').select('directory_unitid').eq('student_id', student.id).not('directory_unitid', 'is', null)
  if (listed.error) throw new ListDraftError('database', 'The college list could not be read.')
  const onList = new Set(listed.data.map((c) => c.directory_unitid!))

  const mustIds = prefs.mustInclude.map((r) => r.unitid).filter((id) => !onList.has(id))
  const leaveOut = [...new Set([...onList, ...mustIds, ...prefs.exclude.map((r) => r.unitid)])]
  const [found, must] = await Promise.all([findCandidates(client, prefs, leaveOut), readColleges(client, mustIds)])

  const codes = new Set(prefs.programs.map((p) => p.cipCode))
  const all = [...must.map((r) => candidateFrom(r, student, codes, true)), ...found.rows.map((r) => candidateFrom(r, student, codes, false))]
  return { student, preferences: prefs, candidates: capCandidates(all, prefs.mix, CANDIDATE_CAP), matched: found.total }
}
