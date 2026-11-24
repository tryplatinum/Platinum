// The college tools: plain server functions over the college directory and a
// student's college list. api/colleges.ts exposes two of them to the screens,
// and the central AI will call the same functions later, so nothing here knows
// about HTTP or about any screen.
//
// Every function takes the caller's own Supabase client (the one identify()
// builds from their session), never the service role, so row level security
// decides what it can see: the directory is readable by any signed-in person,
// and a student's list only by a member of that student's firm.
//
// Every figure returned comes from the database, with the year it describes.
// Nothing here estimates anyone's chance of admission.

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  CONTROLS,
  REGIONS,
  type CollegeLookup,
  type CollegeProgram,
  type CollegeRecord,
  type CollegeSearchFilters,
  type CollegeSearchResult,
  type CollegeSummary,
  type Control,
} from '../shared/colleges.js'
import type { Database } from '../src/lib/database.types.js'
import type { CollegeApp, CollegeFit, DataSource, ID, TestPolicy } from '../src/types.js'
import { bandForStudent, draftCollegeList as draftList, listPreferencesInput, ListDraftError, type BandedCollege, type DraftedList } from './collegeListDrafts.js'

type Client = SupabaseClient<Database>
type DirectoryRow = Database['public']['Tables']['college_directory']['Row']

export type CollegeToolErrorCode = 'bad_input' | 'not_found' | 'not_built' | 'database' | 'rate_limited'

/** A failure a caller can act on. `message` is safe to show. */
export class CollegeToolError extends Error {
  code: CollegeToolErrorCode
  constructor(code: CollegeToolErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100
/** How many name matches are read before they are ranked. */
const RANK_POOL = 200

// ── Inputs ──────────────────────────────────────────────────────────────────

const unitid = z.number().int().min(1).max(99_999_999)
const rate = z.number().min(0).max(1)
const size = z.number().int().min(0).max(10_000_000)
/** "1107", "11.07" or a two-digit family "11". */
const cipCode = z
  .string()
  .trim()
  .regex(/^(\d{2}|\d{4}|\d{2}\.\d{2})$/)
  .transform((code) => code.replace('.', ''))

export const searchCollegesInput = z
  .object({
    name: z.string().trim().max(120).optional().describe('Part of a name or an alias, for example "MIT" or "berkeley". Every word must appear.'),
    unitids: z.array(unitid).max(MAX_LIMIT).optional().describe('Exactly these institutions, by federal UNITID. Inactive ones are included.'),
    states: z.array(z.string().trim().regex(/^[A-Za-z]{2}$/)).max(60).optional().describe('Two-letter state codes, for example ["CA", "MA"].'),
    regions: z.array(z.enum(REGIONS)).max(REGIONS.length).optional(),
    control: z.array(z.enum(CONTROLS)).max(CONTROLS.length).optional(),
    sizeMin: size.optional().describe('Fewest undergraduates. Colleges with no size on record are left out.'),
    sizeMax: size.optional().describe('Most undergraduates. Colleges with no size on record are left out.'),
    admitRateMin: rate.optional().describe('Lowest published admit rate, 0 to 1. Colleges with none on record are left out.'),
    admitRateMax: rate.optional().describe('Highest published admit rate, 0 to 1. Colleges with none on record are left out.'),
    cipCodes: z.array(cipCode).max(40).optional().describe('Offers a bachelor\'s program in any of these: four-digit CIP codes ("1107" or "11.07") or two-digit families ("11").'),
    maxNetPrice: z.number().int().min(0).max(2_000_000).optional().describe('Highest average net price in dollars. Colleges with none on record are left out.'),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`How many to return. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.`),
  })
  .strict()

export const getCollegeInput = z
  .object({
    unitidOrName: z.union([unitid, z.string().trim().min(1).max(120)]).describe('The federal UNITID, or the institution\'s name or a well-known alias.'),
  })
  .strict()

export const bandCollegesForStudentInput = z.object({ studentId: z.string().uuid(), unitids: z.array(unitid).min(1).max(MAX_LIMIT) }).strict()

export const getStudentCollegeListInput = z.object({ studentId: z.string().uuid() }).strict()

export const draftCollegeListInput = z.object({ studentId: z.string().uuid(), preferences: listPreferencesInput }).strict()

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input)
  if (!result.success) {
    const first = result.error.issues[0]
    throw new CollegeToolError('bad_input', `That request was not understood${first ? `: ${first.path.join('.') || 'input'} ${first.message.toLowerCase()}` : ''}.`)
  }
  return result.data
}

// ── Rows to shapes ──────────────────────────────────────────────────────────

const u = <T>(value: T | null): T | undefined => (value === null ? undefined : value)

const SUMMARY_COLUMNS =
  'unitid, name, aliases, city, state, region, control, undergrad_size, admit_rate, sat_ebrw_25, sat_ebrw_75, sat_math_25, sat_math_75, act_25, act_75, test_policy, avg_net_price, is_active, sources'

type SummaryRow = Pick<
  DirectoryRow,
  | 'unitid'
  | 'name'
  | 'aliases'
  | 'city'
  | 'state'
  | 'region'
  | 'control'
  | 'undergrad_size'
  | 'admit_rate'
  | 'sat_ebrw_25'
  | 'sat_ebrw_75'
  | 'sat_math_25'
  | 'sat_math_75'
  | 'act_25'
  | 'act_75'
  | 'test_policy'
  | 'avg_net_price'
  | 'is_active'
  | 'sources'
>

const sourcesFrom = (value: unknown): Record<string, DataSource> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, DataSource>) : {})

const summaryFrom = (r: SummaryRow): CollegeSummary => ({
  unitid: r.unitid,
  name: r.name,
  aliases: r.aliases,
  city: u(r.city),
  state: u(r.state),
  region: u(r.region),
  control: u(r.control) as Control | undefined,
  undergradSize: u(r.undergrad_size),
  admitRate: u(r.admit_rate),
  satEbrw25: u(r.sat_ebrw_25),
  satEbrw75: u(r.sat_ebrw_75),
  satMath25: u(r.sat_math_25),
  satMath75: u(r.sat_math_75),
  act25: u(r.act_25),
  act75: u(r.act_75),
  testPolicy: u(r.test_policy) as TestPolicy | undefined,
  avgNetPrice: u(r.avg_net_price),
  isActive: r.is_active,
  sources: sourcesFrom(r.sources),
})

const recordFrom = (r: DirectoryRow, programs: CollegeProgram[]): CollegeRecord => ({
  unitid: r.unitid,
  name: r.name,
  aliases: r.aliases,
  city: u(r.city),
  state: u(r.state),
  region: u(r.region),
  lat: u(r.lat),
  lon: u(r.lon),
  url: u(r.url),
  control: u(r.control) as Control | undefined,
  level: u(r.level),
  locale: u(r.locale),
  undergradSize: u(r.undergrad_size),
  admitRate: u(r.admit_rate),
  satEbrw25: u(r.sat_ebrw_25),
  satEbrw50: u(r.sat_ebrw_50),
  satEbrw75: u(r.sat_ebrw_75),
  satMath25: u(r.sat_math_25),
  satMath50: u(r.sat_math_50),
  satMath75: u(r.sat_math_75),
  act25: u(r.act_25),
  act50: u(r.act_50),
  act75: u(r.act_75),
  pctSubmittingSat: u(r.pct_submitting_sat),
  pctSubmittingAct: u(r.pct_submitting_act),
  testPolicy: u(r.test_policy) as TestPolicy | undefined,
  testPolicyCode: u(r.test_policy_code),
  tuitionInState: u(r.tuition_in_state),
  tuitionOutOfState: u(r.tuition_out_of_state),
  avgNetPrice: u(r.avg_net_price),
  completionRate: u(r.completion_rate),
  medianEarnings: u(r.median_earnings),
  openAdmissions: u(r.open_admissions),
  isActive: r.is_active,
  sources: sourcesFrom(r.sources),
  importedAt: r.imported_at,
  programs,
})

// ── Matching a name ─────────────────────────────────────────────────────────

/** Lower case, punctuation as spaces: how two names are compared. */
const plain = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * The words of a typed name, safe to put in a pattern. search_text holds the
 * name as written and again with punctuation as spaces, so a word may keep its
 * own dots, hyphens, ampersands and apostrophes.
 */
function words(name: string): string[] {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}.&'-]/gu, ''))
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .slice(0, 8)
}

/** Lower is better: the exact name, an exact alias, a whole-word match, then anything else. */
function rank(college: SummaryRow, typed: string): number {
  const name = plain(college.name)
  const aliases = college.aliases.map(plain)
  if (name === typed) return 0
  if (aliases.includes(typed)) return 1
  if ([name, ...aliases].some((text) => ` ${text} `.includes(` ${typed} `))) return 2
  return 3
}

const bySize = (a: SummaryRow, b: SummaryRow) => (b.undergrad_size ?? -1) - (a.undergrad_size ?? -1) || a.name.localeCompare(b.name)

// ── The tools ───────────────────────────────────────────────────────────────

/**
 * Colleges in the directory that match every filter given. With a name, the
 * closest matches come first; otherwise the largest. Active institutions only,
 * unless asked for by UNITID.
 */
export async function searchColleges(client: Client, filters: CollegeSearchFilters): Promise<CollegeSearchResult> {
  const f = parse(searchCollegesInput, filters ?? {})
  const limit = f.limit ?? DEFAULT_LIMIT
  const typed = f.name ? words(f.name) : []
  if (f.name && typed.length === 0) return { colleges: [], total: 0 }
  if (f.unitids && f.unitids.length === 0) return { colleges: [], total: 0 }

  const byProgram = Boolean(f.cipCodes?.length)
  const select: string = byProgram ? `${SUMMARY_COLUMNS}, college_programs!inner(cip_code)` : SUMMARY_COLUMNS
  let query = client.from('college_directory').select(select, { count: 'exact' })

  for (const word of typed) query = query.ilike('search_text', `%${word}%`)
  if (f.unitids) query = query.in('unitid', f.unitids)
  else query = query.eq('is_active', true)
  if (f.states?.length) query = query.in('state', f.states.map((s) => s.toUpperCase()))
  if (f.regions?.length) query = query.in('region', f.regions)
  if (f.control?.length) query = query.in('control', f.control)
  if (f.sizeMin !== undefined) query = query.gte('undergrad_size', f.sizeMin)
  if (f.sizeMax !== undefined) query = query.lte('undergrad_size', f.sizeMax)
  if (f.admitRateMin !== undefined) query = query.gte('admit_rate', f.admitRateMin)
  if (f.admitRateMax !== undefined) query = query.lte('admit_rate', f.admitRateMax)
  if (f.maxNetPrice !== undefined) query = query.lte('avg_net_price', f.maxNetPrice)
  if (byProgram) {
    // Digits only by now (see cipCode above), so this is safe to put in a filter.
    const exact = f.cipCodes!.filter((code) => code.length === 4)
    const families = f.cipCodes!.filter((code) => code.length === 2)
    const parts = [...(exact.length ? [`cip_code.in.(${exact.join(',')})`] : []), ...families.map((family) => `cip_code.like.${family}*`)]
    query = query.or(parts.join(','), { referencedTable: 'college_programs' })
  }

  const result = await query
    .order('undergrad_size', { ascending: false, nullsFirst: false })
    .order('name')
    .limit(typed.length ? Math.max(limit, RANK_POOL) : limit)
  if (result.error) throw new CollegeToolError('database', 'The college directory could not be read.')

  let rows = (result.data ?? []) as unknown as SummaryRow[]
  if (typed.length) {
    const whole = plain(f.name!)
    rows = rows
      .map((row) => ({ row, score: rank(row, whole) }))
      .sort((a, b) => a.score - b.score || bySize(a.row, b.row))
      .map((x) => x.row)
      .slice(0, limit)
  }
  return { colleges: rows.map(summaryFrom), total: result.count ?? rows.length }
}

/**
 * One college's full record, with its sources and bachelor's programs. Given a
 * name that does not settle on one institution, returns the closest candidates
 * instead of guessing.
 */
export async function getCollege(client: Client, unitidOrName: number | string): Promise<CollegeLookup> {
  const { unitidOrName: key } = parse(getCollegeInput, { unitidOrName })
  let id: number | undefined = typeof key === 'number' ? key : /^\d{1,8}$/.test(key) ? Number(key) : undefined
  let candidates: CollegeSummary[] = []

  if (id === undefined) {
    const name = key as string
    // Asked for by name: inactive institutions are not offered.
    const found = await searchColleges(client, { name, limit: 5 })
    candidates = found.colleges
    const typed = plain(name)
    const exact = candidates.filter((c) => plain(c.name) === typed)
    const alias = candidates.filter((c) => c.aliases.some((a) => plain(a) === typed))
    if (exact.length === 1) id = exact[0].unitid
    else if (exact.length === 0 && alias.length === 1) id = alias[0].unitid
    else if (found.total === 1) id = candidates[0].unitid
    if (id === undefined) return { found: false, candidates }
  }

  const [college, programs] = await Promise.all([
    client.from('college_directory').select('*').eq('unitid', id).maybeSingle(),
    client.from('college_programs').select('cip_code, cip_title').eq('unitid', id).order('cip_code').limit(1000),
  ])
  if (college.error || programs.error) throw new CollegeToolError('database', 'The college directory could not be read.')
  if (!college.data) return { found: false, candidates }
  return { found: true, college: recordFrom(college.data, programs.data.map((p) => ({ cipCode: p.cip_code, cipTitle: p.cip_title }))) }
}

/** One college banded for one student: the band, the figures and rule behind it (`basis`), and the "why this band" line (`reason`). */
export type CollegeBand = BandedCollege

/** List drafting has its own error type (server/collegeListDrafts.ts); the tools speak CollegeToolError. */
async function asTool<T>(work: Promise<T>): Promise<T> {
  try {
    return await work
  } catch (error) {
    if (error instanceof ListDraftError) throw new CollegeToolError(error.code, error.message)
    throw error
  }
}

/**
 * Reach, Target or Likely for one student at each of the given colleges. The
 * band is set by the rules in src/lib/collegeBands.ts from the student's best
 * test score and the college's published figures; no model is involved and
 * nothing here estimates a chance of admission. Throws 'not_found' when the
 * caller's firm has no such student.
 */
export async function bandCollegesForStudent(client: Client, studentId: ID, unitids: number[]): Promise<CollegeBand[]> {
  parse(bandCollegesForStudentInput, { studentId, unitids })
  return asTool(bandForStudent(client, studentId, unitids))
}

export interface StudentCollegeListRow extends CollegeApp {
  /** The linked directory row's figures. Absent on a free-text row, or when the link no longer resolves. */
  directory?: CollegeSummary
}

/**
 * The colleges on one student's list, in the order they were added, each with
 * the directory figures for its link when it has one. Throws 'not_found' when
 * the caller's firm has no such student.
 */
export async function getStudentCollegeList(client: Client, studentId: ID): Promise<{ studentId: ID; colleges: StudentCollegeListRow[] }> {
  parse(getStudentCollegeListInput, { studentId })
  const [student, list] = await Promise.all([
    client.from('students').select('id').eq('id', studentId).maybeSingle(),
    client.from('colleges').select('id, student_id, name, plan, deadline, status, fit, note, directory_unitid, fit_reason, fit_set_by').eq('student_id', studentId).order('seq'),
  ])
  if (student.error || list.error) throw new CollegeToolError('database', 'The college list could not be read.')
  if (!student.data) throw new CollegeToolError('not_found', 'There is no such student.')

  const linked = [...new Set(list.data.flatMap((c) => (c.directory_unitid === null ? [] : [c.directory_unitid])))]
  const directory = new Map<number, CollegeSummary>()
  for (let i = 0; i < linked.length; i += MAX_LIMIT) {
    const found = await searchColleges(client, { unitids: linked.slice(i, i + MAX_LIMIT), limit: MAX_LIMIT })
    for (const college of found.colleges) directory.set(college.unitid, college)
  }

  return {
    studentId,
    colleges: list.data.map((c) => ({
      id: c.id,
      studentId: c.student_id,
      name: c.name,
      plan: u(c.plan) as CollegeApp['plan'],
      deadline: u(c.deadline),
      status: c.status as CollegeApp['status'],
      fit: c.fit as CollegeFit,
      note: u(c.note),
      directoryUnitid: u(c.directory_unitid),
      fitReason: u(c.fit_reason),
      fitSetBy: u(c.fit_set_by) as CollegeApp['fitSetBy'],
      directory: c.directory_unitid === null ? undefined : directory.get(c.directory_unitid),
    })),
  }
}

/**
 * Drafts a college list for one student from the counselor's preferences and
 * saves it as a draft for the counselor to review. Returns the draft's id.
 * The work is in server/collegeListDrafts.ts: candidates and bands by our code,
 * the choice and a short reason each by the model, checked before saving.
 *
 * It never writes to the student's college list. Only a counselor pressing
 * "Add to list" on the draft does that.
 */
export async function draftCollegeList(client: Client, studentId: ID, preferences: unknown, options: { userId?: ID } = {}): Promise<DraftedList> {
  return asTool(draftList(client, studentId, preferences, options))
}

// ── What the central AI is told about them ──────────────────────────────────

export interface CollegeToolDefinition {
  name: string
  description: string
  /** JSON Schema for the tool's input. */
  inputSchema: Record<string, unknown>
}

const jsonSchema = (schema: z.ZodType): Record<string, unknown> => z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>

export const collegeToolDefinitions: CollegeToolDefinition[] = [
  {
    name: 'searchColleges',
    description:
      'Search the college directory (U.S. Department of Education College Scorecard: operating, predominantly bachelor\'s-granting institutions). Filters are combined with "and". Returns short rows with each figure\'s data year in `sources`, and `total`, the number that matched before the limit. With a name the closest matches come first; otherwise the largest colleges. A missing figure is absent, not zero. The admit rate is the institution\'s published rate, not any student\'s chance of admission.',
    inputSchema: jsonSchema(searchCollegesInput),
  },
  {
    name: 'getCollege',
    description:
      'The full directory record for one college, by UNITID or by name or alias: location, size, published admit rate, SAT and ACT 25th, 50th and 75th percentiles, test policy, tuition, average net price, completion rate, median earnings, bachelor\'s programs by CIP code, and the source and data year of each group of figures. When a name does not settle on one institution it returns `found: false` with the closest candidates.',
    inputSchema: jsonSchema(getCollegeInput),
  },
  {
    name: 'bandCollegesForStudent',
    description:
      'Sorts the given colleges into Reach, Target and Likely for one student, by fixed rules in code: the student\'s best test score against the college\'s 25th and 75th percentiles, and the college\'s published admit rate. Each answer carries `basis` (the figures used, the rule, the data years, and `limitedData` when a score or a figure was missing) and `reason`, the same thing in one sentence. A band is a starting point from public data, not a prediction, and never a chance of admission.',
    inputSchema: jsonSchema(bandCollegesForStudentInput),
  },
  {
    name: 'getStudentCollegeList',
    description:
      'The colleges on one student\'s list: name, application plan and deadline when set, status, band (Reach, Target or Likely) and who set it, and the directory figures for each row that is linked to the directory.',
    inputSchema: jsonSchema(getStudentCollegeListInput),
  },
  {
    name: 'draftCollegeList',
    description:
      'Drafts a college list for one student and saves it as a draft for the counselor to review; returns the draft\'s id. Our code filters the directory by the preferences, sets each band by fixed rules and supplies every figure; a model chooses among the candidates and writes a short reason for each, which is checked before saving. It never adds anything to the student\'s college list: a counselor does that from the draft. Makes one or two model calls and can take a minute.',
    inputSchema: jsonSchema(draftCollegeListInput),
  },
]

/** Runs a tool by its name in collegeToolDefinitions, with unchecked input. Throws CollegeToolError. */
export async function runCollegeTool(client: Client, name: string, input: unknown): Promise<unknown> {
  switch (name) {
    case 'searchColleges':
      return searchColleges(client, parse(searchCollegesInput, input))
    case 'getCollege':
      return getCollege(client, parse(getCollegeInput, input).unitidOrName)
    case 'bandCollegesForStudent': {
      const { studentId, unitids } = parse(bandCollegesForStudentInput, input)
      return bandCollegesForStudent(client, studentId, unitids)
    }
    case 'getStudentCollegeList':
      return getStudentCollegeList(client, parse(getStudentCollegeListInput, input).studentId)
    case 'draftCollegeList': {
      const { studentId, preferences } = parse(draftCollegeListInput, input)
      return draftCollegeList(client, studentId, preferences)
    }
    default:
      throw new CollegeToolError('bad_input', 'There is no such college tool.')
  }
}
