// The college directory, as the browser, the server and the import script all
// see it. No imports, so the browser can use this file without pulling in Zod.
//
// Every figure in the directory comes from the U.S. Department of Education's
// College Scorecard. A missing figure is absent (undefined or null), never 0.

import type { DataSource, DirectoryCollege, TestPolicy } from '../src/types'

export const COLLEGES_ENDPOINT = '/api/colleges'

export const SCORECARD_SOURCE = 'U.S. Department of Education College Scorecard'

/**
 * The groups of fields that share a data year. `sources` on a directory row has
 * one entry per group: { source, year }. The years themselves are set by the
 * import script (DATA_YEARS in scripts/import-colleges.ts).
 */
export const SOURCE_GROUPS = ['identity', 'size', 'admissions', 'tests', 'cost', 'net_price', 'outcomes', 'earnings', 'programs'] as const
export type SourceGroup = (typeof SOURCE_GROUPS)[number]

/** Which group each figure belongs to, so a screen can print the right year beside it. */
export const FIGURE_GROUP = {
  undergradSize: 'size',
  admitRate: 'admissions',
  openAdmissions: 'admissions',
  satEbrw: 'tests',
  satMath: 'tests',
  act: 'tests',
  testPolicy: 'tests',
  tuitionInState: 'cost',
  tuitionOutOfState: 'cost',
  avgNetPrice: 'net_price',
  completionRate: 'outcomes',
  medianEarnings: 'earnings',
} as const satisfies Record<string, SourceGroup>

export type Figure = keyof typeof FIGURE_GROUP

/** The data year of one figure on one directory row, or undefined when the row does not say. */
export function yearOf(sources: Record<string, DataSource> | undefined, figure: Figure): string | undefined {
  return sources?.[FIGURE_GROUP[figure]]?.year
}

export const REGIONS = ['New England', 'Mid East', 'Great Lakes', 'Plains', 'Southeast', 'Southwest', 'Rocky Mountains', 'Far West', 'Outlying Areas', 'U.S. Service Schools'] as const
export type Region = (typeof REGIONS)[number]

export const CONTROLS = ['public', 'private_nonprofit', 'private_for_profit'] as const
export type Control = (typeof CONTROLS)[number]

export const CONTROL_LABEL: Record<Control, string> = { public: 'Public', private_nonprofit: 'Private nonprofit', private_for_profit: 'Private for-profit' }

/** 'not_required' is the Scorecard's "Neither required nor recommended". */
export const TEST_POLICY_LABEL: Record<TestPolicy, string> = {
  required: 'Required',
  optional: 'Optional',
  not_required: 'Not required or recommended',
  blind: 'Not considered',
  unknown: 'Not known',
}

/** What searchColleges accepts. Every filter is optional; they are combined with "and". */
export interface CollegeSearchFilters {
  /** Part of a name or an alias ("MIT", "berkeley"). Every word must appear. */
  name?: string
  /** Exactly these institutions, by UNITID. Inactive ones are included. */
  unitids?: number[]
  /** Two-letter state codes. */
  states?: string[]
  regions?: Region[]
  control?: Control[]
  /** Undergraduates. A college with no size on record is left out when either bound is set. */
  sizeMin?: number
  sizeMax?: number
  /** 0 to 1. A college with no admit rate on record is left out when either bound is set. */
  admitRateMin?: number
  admitRateMax?: number
  /** Four-digit CIP codes ("1107" or "11.07"), or a two-digit family ("11"). Bachelor's programs only. */
  cipCodes?: string[]
  /** Average net price, in dollars. A college with none on record is left out. */
  maxNetPrice?: number
  /** Default 25, at most 100. */
  limit?: number
}

/** One short row from a search: enough for a result list and for a row on a student's list. */
export interface CollegeSummary {
  unitid: number
  name: string
  aliases: string[]
  city?: string
  state?: string
  region?: string
  control?: Control
  undergradSize?: number
  /** The institution's published admit rate, 0 to 1. Not a chance of admission for anyone. */
  admitRate?: number
  satEbrw25?: number
  satEbrw75?: number
  satMath25?: number
  satMath75?: number
  act25?: number
  act75?: number
  testPolicy?: TestPolicy
  avgNetPrice?: number
  isActive: boolean
  /** The data year of each group of figures. */
  sources: Record<string, DataSource>
}

export interface CollegeSearchResult {
  colleges: CollegeSummary[]
  /** How many institutions matched in all; more than colleges.length when the limit cut the list. */
  total: number
}

export interface CollegeProgram {
  cipCode: string
  cipTitle: string
}

/** The full record, as getCollege returns it. */
export interface CollegeRecord extends DirectoryCollege {
  /** The Scorecard's own test requirement code (ADMCON7), as reported. */
  testPolicyCode?: number
  importedAt: string
  /** Bachelor's programs, by four-digit CIP code. */
  programs: CollegeProgram[]
}

export type CollegeLookup = { found: true; college: CollegeRecord } | { found: false; candidates: CollegeSummary[] }
