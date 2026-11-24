// Fills the college directory from the U.S. Department of Education's College
// Scorecard. Run by hand, never by the browser or a server function:
//
//   npm run import:colleges -- --dry-run     fetch and report, write nothing
//   npm run import:colleges                  fetch, then write
//
// Needs SCORECARD_API_KEY (free: https://api.data.gov/signup/), VITE_SUPABASE_URL
// and SUPABASE_SERVICE_ROLE_KEY in .env.local. The service role is the only
// thing that can write the directory. No key is ever printed.
//
// What it keeps: institutions that are currently operating and predominantly
// grant bachelor's degrees. Rows are upserted by UNITID. An institution that is
// no longer in the source is marked is_active = false and never deleted. A
// missing figure is stored as null, never 0. A figure outside what the table
// allows (an SAT section of 0, say) is stored as null and counted.
//
// Re-run after each Scorecard release (two or three a year), and update
// DICTIONARY_RELEASED and DATA_YEARS below first: the API does not say which
// year a field describes. See "The college directory" in the README.

import { createClient } from '@supabase/supabase-js'
import { SCORECARD_SOURCE, type SourceGroup } from '../shared/colleges.js'
import type { Database } from '../src/lib/database.types.js'

// ── The release this import was written against ─────────────────────────────

/** The data dictionary's release date. https://collegescorecard.ed.gov/files/CollegeScorecardDataDictionary.xlsx */
const DICTIONARY_RELEASED = '2026-10-15'

/**
 * The year each group of fields describes, from the dictionary's
 * "Most_Recent_Inst_Cohort_Map" tab. Update on every re-import.
 */
const DATA_YEARS: Record<SourceGroup, string> = {
  identity: '2025-26', // name, alias, city, state, region, location, url, control, level, locale
  size: 'Fall 2024', // UGDS
  admissions: 'Fall 2024', // ADM_RATE, OPENADMP
  tests: 'Fall 2024', // SATVR*, SATMT*, ACTCM*, ADMCON7
  cost: '2025-26', // TUITIONFEE_IN, TUITIONFEE_OUT
  net_price: '2024-25', // NPT4_PUB, NPT4_PRIV
  outcomes: 'Fall 2019 cohort', // C150_4
  earnings: 'Measured 2022 and 2023, in 2024 dollars', // MD_EARN_WNE_P10
  programs: '2023-24', // CIPCODE, CIPDESC, CREDLEV
}

const SOURCES = Object.fromEntries(Object.entries(DATA_YEARS).map(([group, year]) => [group, { source: SCORECARD_SOURCE, year }]))

// ── The request ─────────────────────────────────────────────────────────────

const API = 'https://api.data.gov/ed/collegescorecard/v1/schools'
const PER_PAGE = 100
/** The API allows 1,000 requests an hour. A full import is about twenty. */
const MAX_ATTEMPTS = 6

/** Currently operating, predominantly bachelor's-granting (CURROPER = 1, PREDDEG = 3). */
const FILTER = { 'school.operating': '1', 'school.degrees_awarded.predominant': '3' }

const F = {
  id: 'id',
  name: 'school.name',
  alias: 'school.alias',
  city: 'school.city',
  state: 'school.state',
  region: 'school.region_id',
  lat: 'location.lat',
  lon: 'location.lon',
  url: 'school.school_url',
  control: 'school.ownership',
  level: 'school.institutional_characteristics.level',
  locale: 'school.locale',
  operating: 'school.operating',
  size: 'latest.student.size',
  admitRate: 'latest.admissions.admission_rate.overall',
  satEbrw25: 'latest.admissions.sat_scores.25th_percentile.critical_reading',
  satEbrw50: 'latest.admissions.sat_scores.50th_percentile.critical_reading',
  satEbrw75: 'latest.admissions.sat_scores.75th_percentile.critical_reading',
  satMath25: 'latest.admissions.sat_scores.25th_percentile.math',
  satMath50: 'latest.admissions.sat_scores.50th_percentile.math',
  satMath75: 'latest.admissions.sat_scores.75th_percentile.math',
  act25: 'latest.admissions.act_scores.25th_percentile.cumulative',
  act50: 'latest.admissions.act_scores.50th_percentile.cumulative',
  act75: 'latest.admissions.act_scores.75th_percentile.cumulative',
  testRequirements: 'latest.admissions.test_requirements',
  openAdmissions: 'latest.school.open_admissions_policy',
  tuitionIn: 'latest.cost.tuition.in_state',
  tuitionOut: 'latest.cost.tuition.out_of_state',
  netPricePublic: 'latest.cost.avg_net_price.public',
  netPricePrivate: 'latest.cost.avg_net_price.private',
  completion: 'latest.completion.completion_rate_4yr_150nt',
  earnings: 'latest.earnings.10_yrs_after_entry.median',
} as const

/** Programs come back as one array under this key, whichever sub-fields are asked for. */
const PROGRAMS = 'latest.programs.cip_4_digit'
const PROGRAM_FIELDS = [`${PROGRAMS}.code`, `${PROGRAMS}.title`, `${PROGRAMS}.credential.level`]
const BACHELORS = 3

// ── Codes to our values ─────────────────────────────────────────────────────

const REGION: Record<number, string> = {
  0: 'U.S. Service Schools',
  1: 'New England',
  2: 'Mid East',
  3: 'Great Lakes',
  4: 'Plains',
  5: 'Southeast',
  6: 'Southwest',
  7: 'Rocky Mountains',
  8: 'Far West',
  9: 'Outlying Areas',
}
const CONTROL: Record<number, string> = { 1: 'public', 2: 'private_nonprofit', 3: 'private_for_profit' }
const LEVEL: Record<number, string> = { 1: '4-year', 2: '2-year', 3: 'less-than-2-year' }
const LOCALE: Record<number, string> = {
  11: 'City: Large',
  12: 'City: Midsize',
  13: 'City: Small',
  21: 'Suburb: Large',
  22: 'Suburb: Midsize',
  23: 'Suburb: Small',
  31: 'Town: Fringe',
  32: 'Town: Distant',
  33: 'Town: Remote',
  41: 'Rural: Fringe',
  42: 'Rural: Distant',
  43: 'Rural: Remote',
}
/**
 * ADMCON7. 2 "Recommended" and 5 "Considered but not required" are both
 * 'optional'; 3 "Neither required nor recommended" is 'not_required'. 'blind'
 * is never set: the Scorecard does not say whether scores are ignored.
 */
const TEST_POLICY: Record<number, string> = { 1: 'required', 2: 'optional', 3: 'not_required', 4: 'unknown', 5: 'optional' }
const TEST_POLICY_MEANING: Record<number, string> = {
  1: 'Required',
  2: 'Recommended',
  3: 'Neither required nor recommended',
  4: 'Do not know',
  5: 'Considered but not required',
}

/** Printed after every run, so the codes can be compared with what is known about these schools. */
const POLICY_CHECK = [
  'University of California-Berkeley',
  'California Institute of Technology',
  'Massachusetts Institute of Technology',
  'University of Chicago',
  'Bowdoin College',
  'Wake Forest University',
]

// ── Turning one API row into one table row ──────────────────────────────────

type DirectoryRow = Database['public']['Tables']['college_directory']['Insert']
type ProgramRow = Database['public']['Tables']['college_programs']['Insert']
type ApiRow = Record<string, unknown>

/** Values the table would refuse, by column. They are stored as null. */
const outOfRange: Record<string, number> = {}
const unknownCodes: Record<string, number> = {}
const bump = (counts: Record<string, number>, key: string) => (counts[key] = (counts[key] ?? 0) + 1)

const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

function within(column: string, value: unknown, min: number, max: number, whole = false): number | null {
  const n = number(value)
  if (n === null) return null
  if (n < min || n > max) {
    bump(outOfRange, column)
    return null
  }
  return whole ? Math.round(n) : n
}

function coded(column: string, value: unknown, table: Record<number, string>): string | null {
  const n = number(value)
  if (n === null) return null
  const label = table[n]
  if (label === undefined) {
    bump(unknownCodes, `${column} = ${n}`)
    return null
  }
  return label
}

/** The alias field is one string. Names are separated by commas, semicolons or bars. */
function splitAliases(alias: unknown): string[] {
  const raw = text(alias)
  if (!raw) return []
  const seen = new Set<string>()
  return raw
    .split(/[|;,]/)
    .map((part) => part.trim())
    .filter((part) => part && !seen.has(part.toLowerCase()) && Boolean(seen.add(part.toLowerCase())))
}

/**
 * What type-ahead searches: the name, the name again with punctuation as spaces
 * (so "california berkeley" finds "University of California-Berkeley"), and the
 * aliases as the Scorecard wrote them. All lower case.
 */
function searchText(name: string, alias: unknown): string {
  const plain = name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const parts = [name, plain === name ? '' : plain, text(alias) ?? '']
  return parts.filter(Boolean).join(' | ').toLowerCase()
}

const MAX_MONEY = 2_000_000

function directoryRow(r: ApiRow, importedAt: string): DirectoryRow | undefined {
  const unitid = number(r[F.id])
  const name = text(r[F.name])
  if (unitid === null || !Number.isInteger(unitid) || !name) return undefined
  const control = coded('control', r[F.control], CONTROL)
  const state = text(r[F.state])
  const policyCode = number(r[F.testRequirements])
  // OPENADMP: 1 yes, 2 no, 3 does not enroll first-time students (stored as null).
  const open = number(r[F.openAdmissions])
  // NPT4_PUB for public institutions, NPT4_PRIV for private ones.
  const netPrice = control === 'public' ? r[F.netPricePublic] : control ? r[F.netPricePrivate] : (r[F.netPricePublic] ?? r[F.netPricePrivate])
  if (state && !/^[A-Z]{2}$/.test(state)) bump(outOfRange, 'state')
  return {
    unitid,
    name,
    aliases: splitAliases(r[F.alias]),
    search_text: searchText(name, r[F.alias]),
    city: text(r[F.city]),
    state: state && /^[A-Z]{2}$/.test(state) ? state : null,
    region: coded('region', r[F.region], REGION),
    lat: within('lat', r[F.lat], -90, 90),
    lon: within('lon', r[F.lon], -180, 180),
    url: text(r[F.url]),
    control,
    level: coded('level', r[F.level], LEVEL),
    locale: coded('locale', r[F.locale], LOCALE),
    undergrad_size: within('undergrad_size', r[F.size], 0, 10_000_000, true),
    admit_rate: within('admit_rate', r[F.admitRate], 0, 1),
    sat_ebrw_25: within('sat_ebrw_25', r[F.satEbrw25], 200, 800, true),
    sat_ebrw_50: within('sat_ebrw_50', r[F.satEbrw50], 200, 800, true),
    sat_ebrw_75: within('sat_ebrw_75', r[F.satEbrw75], 200, 800, true),
    sat_math_25: within('sat_math_25', r[F.satMath25], 200, 800, true),
    sat_math_50: within('sat_math_50', r[F.satMath50], 200, 800, true),
    sat_math_75: within('sat_math_75', r[F.satMath75], 200, 800, true),
    act_25: within('act_25', r[F.act25], 1, 36, true),
    act_50: within('act_50', r[F.act50], 1, 36, true),
    act_75: within('act_75', r[F.act75], 1, 36, true),
    // pct_submitting_sat and pct_submitting_act are not sent: the Scorecard has
    // no field for them. They stay null on a new row and untouched on an old one.
    test_policy: policyCode === null ? null : coded('test_policy_code', policyCode, TEST_POLICY),
    test_policy_code: policyCode === null ? null : within('test_policy_code', policyCode, 0, 32767, true),
    tuition_in_state: within('tuition_in_state', r[F.tuitionIn], 0, MAX_MONEY, true),
    tuition_out_of_state: within('tuition_out_of_state', r[F.tuitionOut], 0, MAX_MONEY, true),
    // A net price can be negative (grants above the cost of attendance), so there is no floor at 0.
    avg_net_price: within('avg_net_price', netPrice, -MAX_MONEY, MAX_MONEY, true),
    completion_rate: within('completion_rate', r[F.completion], 0, 1),
    median_earnings: within('median_earnings', r[F.earnings], 0, 100_000_000, true),
    open_admissions: open === 1 ? true : open === 2 ? false : null,
    is_active: true,
    sources: SOURCES,
    imported_at: importedAt,
  }
}

let programsSkipped = 0

/** Bachelor's programs only, one row per code. The API lists each code once per credential level and sometimes twice. */
function programRows(unitid: number, r: ApiRow): ProgramRow[] {
  const list = r[PROGRAMS]
  if (!Array.isArray(list)) return []
  const byCode = new Map<string, ProgramRow>()
  for (const item of list as { code?: unknown; title?: unknown; credential?: { level?: unknown } }[]) {
    if (item?.credential?.level !== BACHELORS) continue
    const code = typeof item.code === 'string' ? item.code : typeof item.code === 'number' ? String(item.code).padStart(4, '0') : ''
    const title = text(item.title)?.replace(/\.$/, '')
    if (!/^[0-9]{4}$/.test(code) || !title) {
      programsSkipped++
      continue
    }
    if (!byCode.has(code)) byCode.set(code, { unitid, cip_code: code, cip_title: title, credential_level: BACHELORS })
  }
  return [...byCode.values()]
}

// ── Fetching ────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchPage(key: string, page: number): Promise<{ total: number; results: ApiRow[] }> {
  const url = new URL(API)
  for (const [name, value] of Object.entries(FILTER)) url.searchParams.set(name, value)
  url.searchParams.set('fields', [...Object.values(F), ...PROGRAM_FIELDS].join(','))
  url.searchParams.set('per_page', String(PER_PAGE))
  url.searchParams.set('page', String(page))
  url.searchParams.set('sort', 'id')

  for (let attempt = 1; ; attempt++) {
    let status = 0
    let wait = 0
    try {
      // The key travels in a header, so it is in no URL that an error could print.
      const res = await fetch(url, { headers: { 'x-api-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(120_000) })
      status = res.status
      if (res.ok) {
        const body = (await res.json()) as { metadata?: { total?: number }; results?: ApiRow[] }
        if (typeof body.metadata?.total !== 'number' || !Array.isArray(body.results)) throw new Error('the response was not in the expected shape')
        return { total: body.metadata.total, results: body.results }
      }
      if (status === 401 || status === 403) throw new Fatal(`The Scorecard API refused the key (HTTP ${status}). Check SCORECARD_API_KEY in .env.local.`)
      if (status !== 429 && status < 500) throw new Fatal(`The Scorecard API answered HTTP ${status} for page ${page}.`)
      // Back off: as long as the API asks, or 5s, 10s, 20s, ... when it does not say.
      const asked = Number(res.headers.get('retry-after'))
      wait = Number.isFinite(asked) && asked > 0 ? asked * 1000 : 5000 * 2 ** (attempt - 1)
    } catch (error) {
      if (error instanceof Fatal) throw error
      wait = 5000 * 2 ** (attempt - 1)
      if (attempt >= MAX_ATTEMPTS) throw new Fatal(`Page ${page} failed ${attempt} times: ${error instanceof Error ? error.message : 'network error'}`)
    }
    if (attempt >= MAX_ATTEMPTS) throw new Fatal(`Page ${page} failed ${attempt} times (last answer: HTTP ${status}).${status === 429 ? ' The hourly limit is 1,000 requests: wait and run it again.' : ''}`)
    console.log(`  page ${page}: ${status === 429 ? 'rate limited' : status ? `HTTP ${status}` : 'no answer'}, waiting ${Math.round(wait / 1000)}s (attempt ${attempt} of ${MAX_ATTEMPTS})`)
    await sleep(wait)
  }
}

class Fatal extends Error {}

// ── Run ─────────────────────────────────────────────────────────────────────

const dryRun = process.argv.includes('--dry-run')
const force = process.argv.includes('--force')

async function main(): Promise<void> {
  const key = process.env.SCORECARD_API_KEY ?? ''
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!key) {
    throw new Fatal(
      'SCORECARD_API_KEY is not set.\n' +
        'Get a free key at https://api.data.gov/signup/ (it arrives by email), add the line\n' +
        '  SCORECARD_API_KEY=<your key>\n' +
        'to .env.local, and run this again. Nothing was fetched or written.',
    )
  }
  const missing = Object.entries({ VITE_SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: serviceKey })
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length) throw new Fatal(`Missing in .env.local: ${missing.join(', ')}. Nothing was fetched or written.`)

  console.log(`College Scorecard import${dryRun ? ' (dry run: nothing will be written)' : ''}`)
  console.log(`Dictionary release ${DICTIONARY_RELEASED}. Keeping: currently operating, predominantly bachelor's-granting.\n`)

  // 1. Fetch every page.
  const fetched: ApiRow[] = []
  let total = 0
  for (let page = 0; ; page++) {
    const body = await fetchPage(key, page)
    total = body.total
    fetched.push(...body.results)
    console.log(`  page ${page + 1} of ${Math.max(1, Math.ceil(total / PER_PAGE))}: ${fetched.length} of ${total}`)
    if (body.results.length === 0 || fetched.length >= total) break
  }
  if (fetched.length !== total) throw new Fatal(`The API reported ${total} institutions but returned ${fetched.length}. Nothing was written. Run it again.`)

  // 2. Map.
  const importedAt = new Date().toISOString()
  const rows = new Map<number, DirectoryRow>()
  const programs: ProgramRow[] = []
  let unusable = 0
  let duplicates = 0
  for (const r of fetched) {
    const row = directoryRow(r, importedAt)
    if (!row) unusable++
    else if (rows.has(row.unitid)) duplicates++
    else {
      rows.set(row.unitid, row)
      programs.push(...programRows(row.unitid, r))
    }
  }
  const list = [...rows.values()]

  // 3. Compare with what is in the directory now.
  const db = createClient<Database>(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const existing = new Map<number, boolean>()
  for (let from = 0; ; from += 1000) {
    const page = await db.from('college_directory').select('unitid, is_active').order('unitid').range(from, from + 999)
    if (page.error) throw new Fatal(`Could not read the directory: ${page.error.message}`)
    for (const r of page.data) existing.set(r.unitid, r.is_active)
    if (page.data.length < 1000) break
  }
  const inserted = list.filter((r) => !existing.has(r.unitid)).length
  const updated = list.length - inserted
  const toDeactivate = [...existing].filter(([unitid, active]) => active && !rows.has(unitid)).map(([unitid]) => unitid)
  const activeBefore = [...existing.values()].filter(Boolean).length
  // A source that suddenly returns far fewer institutions is more likely a fault than a mass closure.
  const suspicious = activeBefore >= 100 && toDeactivate.length > activeBefore * 0.2

  // 4. Write.
  let programsRemoved = 0
  if (!dryRun) {
    if (suspicious && !force) {
      throw new Fatal(`This run would deactivate ${toDeactivate.length} of ${activeBefore} active institutions, which looks like a fault in the source. Nothing was written. Run with --force if it is right.`)
    }
    for (let i = 0; i < list.length; i += 200) {
      const result = await db.from('college_directory').upsert(list.slice(i, i + 200), { onConflict: 'unitid' })
      if (result.error) throw new Fatal(`Writing institutions ${i + 1} to ${Math.min(i + 200, list.length)} failed: ${result.error.message}`)
    }
    for (let i = 0; i < toDeactivate.length; i += 200) {
      const result = await db.from('college_directory').update({ is_active: false }).in('unitid', toDeactivate.slice(i, i + 200))
      if (result.error) throw new Fatal(`Deactivating institutions failed: ${result.error.message}`)
    }
    for (let i = 0; i < programs.length; i += 1000) {
      const result = await db.from('college_programs').upsert(programs.slice(i, i + 1000), { onConflict: 'unitid,cip_code,credential_level' })
      if (result.error) throw new Fatal(`Writing programs ${i + 1} to ${Math.min(i + 1000, programs.length)} failed: ${result.error.message}`)
    }
    // Programs an institution in this import no longer reports are removed.
    const current = new Set(programs.map((p) => `${p.unitid}:${p.cip_code}`))
    const stale = new Map<number, string[]>()
    for (let from = 0; ; from += 1000) {
      const page = await db.from('college_programs').select('unitid, cip_code').order('unitid').order('cip_code').range(from, from + 999)
      if (page.error) throw new Fatal(`Could not read the programs: ${page.error.message}`)
      for (const p of page.data) if (rows.has(p.unitid) && !current.has(`${p.unitid}:${p.cip_code}`)) stale.set(p.unitid, [...(stale.get(p.unitid) ?? []), p.cip_code])
      if (page.data.length < 1000) break
    }
    for (const [unitid, codes] of stale) {
      const result = await db.from('college_programs').delete().eq('unitid', unitid).in('cip_code', codes)
      if (result.error) throw new Fatal(`Removing old programs failed: ${result.error.message}`)
      programsRemoved += codes.length
    }
  }

  // 5. Report.
  const would = dryRun ? 'would be ' : ''
  console.log(`\nInstitutions kept (operating, predominantly bachelor's): ${list.length}`)
  if (unusable) console.log(`  left out, no id or name: ${unusable}`)
  if (duplicates) console.log(`  repeated by the API and counted once: ${duplicates}`)
  console.log(`  ${would}inserted:    ${inserted}`)
  console.log(`  ${would}updated:     ${updated}`)
  console.log(`  ${would}deactivated: ${toDeactivate.length}${suspicious ? '  <- more than a fifth of the directory: the real run will stop unless --force' : ''}`)
  console.log(`Bachelor's programs: ${programs.length} across ${new Set(programs.map((p) => p.unitid)).size} institutions${programsSkipped ? ` (${programsSkipped} skipped: no four-digit code or no title)` : ''}`)
  if (!dryRun) console.log(`  programs no longer reported, removed: ${programsRemoved}`)

  console.log('\nNull counts per column (a missing figure is null, never 0):')
  const columns = Object.keys(list[0] ?? {}).filter((c) => !['unitid', 'name', 'search_text', 'is_active', 'sources', 'imported_at'].includes(c))
  for (const column of columns) {
    const nulls = list.filter((r) => {
      const value = (r as Record<string, unknown>)[column]
      return value === null || value === undefined || (Array.isArray(value) && value.length === 0)
    }).length
    console.log(`  ${column.padEnd(22)} ${String(nulls).padStart(5)}${column === 'aliases' ? '  (no alias)' : ''}`)
  }
  console.log(`  ${'pct_submitting_sat'.padEnd(22)} ${String(list.length).padStart(5)}  (the Scorecard has no field for this)`)
  console.log(`  ${'pct_submitting_act'.padEnd(22)} ${String(list.length).padStart(5)}  (the Scorecard has no field for this)`)

  const show = (title: string, counts: Record<string, number>) => {
    if (!Object.keys(counts).length) return
    console.log(`\n${title}`)
    for (const [name, count] of Object.entries(counts).sort()) console.log(`  ${name.padEnd(22)} ${String(count).padStart(5)}`)
  }
  show('Values outside what the table allows, stored as null:', outOfRange)
  show('Codes with no meaning in the dictionary, stored as null:', unknownCodes)

  console.log('\nTest requirement (ADMCON7) across the directory:')
  for (const code of [1, 2, 3, 4, 5]) {
    console.log(`  ${code} ${TEST_POLICY_MEANING[code].padEnd(34)} -> ${TEST_POLICY[code].padEnd(13)} ${String(list.filter((r) => r.test_policy_code === code).length).padStart(5)}`)
  }
  console.log(`  ${'missing'.padEnd(36)} -> ${'null'.padEnd(13)} ${String(list.filter((r) => r.test_policy_code === null).length).padStart(5)}`)

  console.log(`\nTest policy for six schools, to compare with what you know (data year ${DATA_YEARS.tests}):`)
  for (const name of POLICY_CHECK) {
    const row = list.find((r) => r.name === name)
    if (!row) console.log(`  ${name}: not in this import`)
    else {
      const code = row.test_policy_code
      console.log(`  ${name}: test_policy_code = ${code ?? 'null'}${code != null && TEST_POLICY_MEANING[code] ? ` ("${TEST_POLICY_MEANING[code]}")` : ''}, test_policy = ${row.test_policy ?? 'null'}`)
    }
  }

  console.log(dryRun ? '\nDry run: nothing was written.' : '\nDone.')
}

main().catch((error) => {
  // Only our own messages are printed in full; anything else could carry a URL or a header.
  console.error(`\n${error instanceof Fatal ? error.message : `The import stopped: ${error instanceof Error ? error.message : 'unknown error'}`}`)
  process.exit(1)
})
