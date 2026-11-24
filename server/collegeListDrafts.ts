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
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { CONTROLS, REGIONS } from '../shared/colleges.js'
import type { FeatureInput, FeatureOutput } from '../shared/contract.js'
import { bandCollege, capCandidates, CANDIDATE_CAP, MAX_PER_BAND, SIZE_BANDS, SIZES, sizeBandOf, type BandCollege, type BandStudent, type Candidate } from '../src/lib/collegeBands.js'
import {
  MAX_EXCLUDE,
  MAX_MUST_INCLUDE,
  MAX_PROGRAMS,
  assembleDraft,
  checkPicks,
  handPickRows,
  normalizePreferences,
  notesForListDraft,
  MAX_LIST_NOTE_CHARS,
  reasonProblem,
  stillNeeded,
  type DraftRow,
  type NoteForList,
  typedListNames,
  typedNameMatches,
} from '../src/lib/collegeListDraft.js'
import type { Database, Json } from '../src/lib/database.types.js'
import type { AiSource, CollegeFit, CollegeListPreferences, DataSource, FitBasis, ID, ListDraftRun, ListMix, Meeting, TestScores } from '../src/types.js'
import { AiError, hasAnthropicKey, runFeature } from './claude.js'

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
  'unitid, name, aliases, state, region, control, undergrad_size, admit_rate, open_admissions, sat_ebrw_25, sat_ebrw_75, sat_math_25, sat_math_75, act_25, act_75, sources'

interface CandidateRow {
  unitid: number
  name: string
  aliases: string[]
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

  // A college already on the student's list is never proposed again, not even as a
  // must-include: by its directory link, or, for a row typed in by hand, when the typed name
  // (brackets and punctuation aside) is the college's name, one of its aliases or its initials.
  const listed = await client.from('colleges').select('name, directory_unitid').eq('student_id', student.id)
  if (listed.error) throw new ListDraftError('database', 'The college list could not be read.')
  const onList = new Set(listed.data.flatMap((c) => (c.directory_unitid === null ? [] : [c.directory_unitid])))
  const typed = typedListNames(listed.data.filter((c) => c.directory_unitid === null).map((c) => c.name))
  const listedByName = (r: CandidateRow) => typedNameMatches(typed, r)

  const mustIds = prefs.mustInclude.map((r) => r.unitid).filter((id) => !onList.has(id))
  const leaveOut = [...new Set([...onList, ...mustIds, ...prefs.exclude.map((r) => r.unitid)])]
  const [found, must] = await Promise.all([findCandidates(client, prefs, leaveOut), readColleges(client, mustIds)])

  const codes = new Set(prefs.programs.map((p) => p.cipCode))
  const all = [...must.filter((r) => !listedByName(r)).map((r) => candidateFrom(r, student, codes, true)), ...found.rows.filter((r) => !listedByName(r)).map((r) => candidateFrom(r, student, codes, false))]
  return { student, preferences: prefs, candidates: capCandidates(all, prefs.mix, CANDIDATE_CAP), matched: found.total }
}

// ── The AI step ─────────────────────────────────────────────────────────────

/**
 * The model call, in one place so a test can stand in for it
 * (scripts/test-isolation.ts does). server/claude.ts is still the only file
 * that calls Claude.
 */
export const listModel = {
  available: (): boolean => hasAnthropicKey(),
  run: (input: FeatureInput<'collegeList'>): Promise<{ draft: FeatureOutput<'collegeList'>; model: string }> => runFeature('collegeList', input),
}

/** The function has 120 seconds (api/colleges.ts). The model gets this much of it in all. */
const AI_BUDGET_MS = 100_000
/** A second ask is only made with at least this much of the budget left. */
const SECOND_ASK_NEEDS_MS = 35_000

class TimedOut extends Error {}
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimedOut()), Math.max(ms, 0))
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

/** What the model is given about the request. No figure of any kind: see INPUTS.collegeList in shared/contract.ts. */
export function modelInput(pool: CandidatePool, notes: NoteForList[], candidates: Candidate[] = pool.candidates, mix: ListMix = pool.preferences.mix, problems?: string[]): FeatureInput<'collegeList'> {
  const { student, preferences: p } = pool
  return {
    student: { gradYear: student.gradYear, majors: student.majors.slice(0, 10), interests: student.interests.slice(0, 20), activities: student.activities.slice(0, 30) },
    recentNotes: notes,
    preferences: { majors: p.majors, programs: p.programs.map((x) => x.cipTitle), states: p.states, regions: p.regions, control: p.control, sizes: p.sizes, netPriceCeiling: p.maxNetPrice !== undefined },
    mix,
    candidates: candidates.map((c) => {
      const size = sizeBandOf(c.undergradSize)
      return {
        unitid: c.unitid,
        name: c.name,
        ...(c.state ? { state: c.state } : {}),
        band: c.fit,
        ...(size ? { size } : {}),
        ...(c.control ? { control: c.control } : {}),
        programs: c.programs,
        ...(c.mustInclude ? { mustInclude: true } : {}),
      }
    }),
    ...(problems?.length ? { problems: problems.slice(0, 40) } : {}),
  }
}

export interface Explained {
  rows: DraftRow[]
  /** The model's one overall note, when it passed the check. */
  note?: string
  /** How the draft was made: the model and counts, or why the AI step did not run. */
  source: AiSource & ListDraftRun
  /** False when the rows are the banded candidates to pick from by hand. */
  byModel: boolean
}

/**
 * Asks the model which candidates to put on the list and why, and checks the
 * answer: a unitid that is not a candidate is dropped, a duplicate is dropped,
 * and a reason (or the note) that states a percentage or a four-digit number
 * is thrown away. If a reason was thrown away or a band came back short, the
 * model is asked once more for just what is missing. Whatever is still short
 * is filled from the top candidates of that band with the stock reason. The
 * overall note is taken from the first answer only (the second is about a
 * part of the list), and is dropped if it fails the check.
 *
 * Never throws for a model failure: with no key, an error, a refusal or no
 * answer in time, it returns the top banded candidates for the counselor to
 * pick from by hand, and says why.
 */
export async function explainCandidates(pool: CandidatePool, notes: NoteForList[]): Promise<Explained> {
  const { candidates, preferences } = pool
  const mix = preferences.mix
  const byHand = (reason: string): Explained => ({
    rows: handPickRows(candidates, mix),
    source: { kind: 'placeholder', reason, at: new Date().toISOString(), matched: pool.matched, considered: candidates.length },
    byModel: false,
  })
  if (!listModel.available()) return byHand('The server has no Anthropic API key, so no colleges were chosen or explained by the AI.')

  const started = Date.now()
  const left = () => AI_BUDGET_MS - (Date.now() - started)
  const nameOf = new Map(candidates.map((c) => [c.unitid, c.name]))
  const usableNote = (text: string) => (reasonProblem(text, MAX_LIST_NOTE_CHARS) ? undefined : text.trim())
  try {
    const first = await within(listModel.run(modelInput(pool, notes)), left())
    const checked = checkPicks(first.draft.picks, candidates)
    let accepted = checked.accepted
    let rejected = checked.rejected.map((r) => r.unitid)
    let rejectedReasons = checked.rejected.length
    const note = usableNote(first.draft.note)
    let model = first.model
    let askedTwice = false

    const need = stillNeeded(candidates, mix, accepted)
    const short = need.Reach + need.Target + need.Likely > 0
    const chosen = new Set(accepted.map((p) => p.unitid))
    const remaining = candidates.filter((c) => !chosen.has(c.unitid))
    if ((checked.rejected.length > 0 || short) && remaining.length > 0 && left() > SECOND_ASK_NEEDS_MS) {
      askedTwice = true
      const problems = [
        ...checked.rejected.map((r) => `Your reason for ${nameOf.get(r.unitid)} (${r.unitid}) was discarded because ${r.problem}. A reason may not contain a percentage or a four-digit number.`),
        ...(checked.dropped ? [`${checked.dropped} of your picks were not among the candidates, or were named twice, and were dropped.`] : []),
        `Still needed: Reach ${need.Reach}, Target ${need.Target}, Likely ${need.Likely}.`,
      ]
      try {
        const second = await within(listModel.run(modelInput(pool, notes, remaining, need, problems)), left())
        const again = checkPicks(second.draft.picks, remaining, chosen)
        accepted = [...accepted, ...again.accepted]
        rejected = [...rejected, ...again.rejected.map((r) => r.unitid)]
        rejectedReasons += again.rejected.length
        model = second.model
      } catch {
        // The first answer stands; whatever is short is filled below.
      }
    }

    const rows = assembleDraft(candidates, mix, accepted, rejected)
    return {
      rows,
      note,
      source: { kind: 'claude', model, at: new Date().toISOString(), matched: pool.matched, considered: candidates.length, rejectedReasons, filled: rows.filter((r) => !r.aiExplained).length, askedTwice },
      byModel: true,
    }
  } catch (error) {
    if (error instanceof TimedOut) return byHand('The AI did not answer in time, so no colleges were chosen or explained by it.')
    // An AiError's message is written for the counselor. Anything else is not shown.
    return byHand(`The AI step failed, so no colleges were chosen or explained by it. ${error instanceof AiError ? error.message : 'Something went wrong while drafting.'}`)
  }
}

// ── The draft ───────────────────────────────────────────────────────────────

const MEETINGS_READ = 12

/** The approved meeting records the model reads for this student. See notesForListDraft for what is and is not included. */
export async function readNotesForList(client: Client, studentId: ID): Promise<NoteForList[]> {
  // The transcript column is not selected: a transcript is never sent for this.
  const found = await client.from('meetings').select('title, date, status, ai, recap').eq('student_id', studentId).eq('status', 'completed').order('date', { ascending: false }).limit(MEETINGS_READ)
  if (found.error) throw new ListDraftError('database', 'The meeting notes could not be read.')
  return notesForListDraft(
    found.data.map((m) => ({
      title: m.title,
      date: m.date,
      status: m.status as Meeting['status'],
      ai: (m.ai ?? undefined) as unknown as Meeting['ai'],
      recap: (m.recap ?? undefined) as unknown as Meeting['recap'],
    })),
  )
}

export interface DraftedList {
  draftId: ID
  /** How many colleges the draft holds. */
  items: number
  /** False when the AI step did not run and the draft is the banded candidates to pick from. */
  byModel: boolean
}

/**
 * Drafts a college list for one student and saves it as a draft for review:
 * candidates by the hard preferences, bands by the rules, the model's choice
 * and reasons (checked), all in `college_list_drafts` and
 * `college_list_draft_items`. Returns the new draft's id.
 *
 * It NEVER writes to `colleges`. Only a counselor's "Add to list" does that
 * (the database function add_draft_to_college_list).
 */
export async function draftCollegeList(client: Client, studentId: ID, preferences: unknown, options: { userId?: ID } = {}): Promise<DraftedList> {
  const pool = await candidatePool(client, studentId, preferences)
  if (pool.candidates.length === 0) throw new ListDraftError('bad_input', 'No college in the directory matches these preferences that is not already on the list. Loosen a filter and try again.')
  const notes = await readNotesForList(client, studentId)
  const explained = await explainCandidates(pool, notes)

  const draftId = randomUUID()
  const firmId = pool.student.firmId
  const draft = await client.from('college_list_drafts').insert({
    id: draftId,
    firm_id: firmId,
    student_id: pool.student.id,
    created_by: options.userId ?? null,
    preferences: pool.preferences as unknown as Json,
    note: explained.note ?? null,
    source: explained.source as unknown as Json,
    status: 'draft',
  })
  if (draft.error) throw new ListDraftError('database', 'The draft could not be saved.')

  const items = explained.rows.map((row, position) => ({
    firm_id: firmId,
    draft_id: draftId,
    unitid: row.candidate.unitid,
    fit: row.candidate.fit,
    fit_basis: row.candidate.basis as unknown as Json,
    fit_set_by: 'rule',
    reason: row.reason.slice(0, 600),
    ai_explained: row.aiExplained,
    // Chosen by the model, or asked for by the counselor: kept. Offered to pick from by hand: not kept until picked.
    kept: explained.byModel || Boolean(row.candidate.mustInclude),
    position,
  }))
  const saved = await client.from('college_list_draft_items').insert(items)
  if (saved.error) {
    // Nothing half-made is left behind.
    await client.from('college_list_drafts').delete().eq('id', draftId)
    throw new ListDraftError('database', 'The draft could not be saved.')
  }
  return { draftId, items: items.length, byModel: explained.byModel }
}
