// The parts of drafting a college list that are plain functions of data: the
// preferences form's starting values, matching a typed major to the directory's
// programs, the check every model-written reason must pass, turning the
// model's picks into the draft's rows, and which meeting notes the model reads.
//
// No network and no database here, so scripts/test-bands.ts can test all of it.
// The server module that uses these is server/collegeListDrafts.ts.

import { CIP_PROGRAMS, type CipProgram } from '../../shared/cipPrograms'
import type { AiSource, AppData, CollegeFit, CollegeListDraft, CollegeListDraftItem, CollegeListPreferences, CollegeRef, ID, ListDraftRun, ListMix, Meeting, SizeBand } from '../types'
import { byRelevance, DEFAULT_MIX, FITS, MAX_PER_BAND, SIZES, type Candidate } from './collegeBands'

// ── Majors to programs ──────────────────────────────────────────────────────
// A student's intended majors are free text ("Computer Science"). The directory
// knows programs by four-digit CIP code. The match is made here, in code,
// against the titles the directory really has (shared/cipPrograms.ts), and the
// counselor sees and edits the result in the preferences form. The model is
// never asked for a code.

/**
 * Common names for a major that are not the Scorecard's title for it. Each
 * code must exist in the directory (scripts/test-bands.ts checks).
 */
export const MAJOR_ALIASES: Record<string, string[]> = {
  'computer science': ['1107', '1101'],
  cs: ['1107', '1101'],
  business: ['5202', '5201'],
  'business administration': ['5202', '5201'],
  finance: ['5208'],
  accounting: ['5203'],
  'sports management': ['3105'],
  'sport management': ['3105'],
  engineering: ['1401'],
  'electrical engineering': ['1410'],
  math: ['2701'],
  mathematics: ['2701'],
  english: ['2301'],
  'political science': ['4510'],
  'international relations': ['4509'],
  nursing: ['5138'],
  communications: ['0901'],
  communication: ['0901'],
  film: ['5006'],
  neuroscience: ['2615'],
  'pre-med': ['2601', '5111'],
  premed: ['2601', '5111'],
  'pre-law': ['2200'],
}

/** At most this many programs are suggested for one major. */
const PER_MAJOR = 3

const STOP = new Set(['and', 'or', 'of', 'the', 'in', 'for', 'general', 'studies'])
/** Lower case, punctuation as spaces, plural "s" dropped, small words out: how a major and a title are compared. */
const tokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))

export interface MajorMatch {
  major: string
  /** Empty when nothing in the directory matched: the counselor picks programs by hand. */
  programs: CipProgram[]
}

/**
 * The directory programs each typed major most plainly means. An alias wins;
 * then a title that is the major (ignoring "General"); then titles containing
 * every word of the major, most widely offered first.
 */
export function matchMajors(majors: string[], programs: CipProgram[] = CIP_PROGRAMS): MajorMatch[] {
  const byCode = new Map(programs.map((p) => [p.cipCode, p]))
  return majors
    .map((m) => m.trim())
    .filter(Boolean)
    .map((major) => {
      const alias = MAJOR_ALIASES[major.toLowerCase()]
      if (alias) return { major, programs: alias.flatMap((code) => byCode.get(code) ?? []) }
      const want = tokens(major)
      if (want.length === 0) return { major, programs: [] }
      const exact: CipProgram[] = []
      const containing: CipProgram[] = []
      for (const p of programs) {
        const have = tokens(p.cipTitle)
        if (!want.every((w) => have.includes(w))) continue
        if (have.length === want.length) exact.push(p)
        else containing.push(p)
      }
      const byReach = (a: CipProgram, b: CipProgram) => b.colleges - a.colleges
      return { major, programs: exact.length ? exact.sort(byReach).slice(0, PER_MAJOR) : containing.sort(byReach).slice(0, PER_MAJOR) }
    })
}

/** Programs whose title contains every word typed, most widely offered first. For the form's search box. */
export function searchPrograms(text: string, limit = 8, programs: CipProgram[] = CIP_PROGRAMS): CipProgram[] {
  const want = tokens(text)
  if (want.length === 0) return []
  return programs
    .filter((p) => {
      const have = tokens(p.cipTitle)
      return want.every((w) => have.some((h) => h.startsWith(w)))
    })
    .sort((a, b) => b.colleges - a.colleges)
    .slice(0, limit)
}

// ── Preferences ─────────────────────────────────────────────────────────────

export const MAX_MUST_INCLUDE = 20
export const MAX_EXCLUDE = 100
export const MAX_PROGRAMS = 40

const clampCount = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 0), MAX_PER_BAND) : fallback)

export const normalMix = (mix: Partial<ListMix> | undefined): ListMix => ({
  Reach: clampCount(mix?.Reach, DEFAULT_MIX.Reach),
  Target: clampCount(mix?.Target, DEFAULT_MIX.Target),
  Likely: clampCount(mix?.Likely, DEFAULT_MIX.Likely),
})

const uniqueRefs = (refs: CollegeRef[] | undefined, max: number): CollegeRef[] => {
  const seen = new Set<number>()
  return (refs ?? []).filter((r) => !seen.has(r.unitid) && seen.add(r.unitid)).slice(0, max)
}

/** Preferences with every field present, duplicates out, and a college that is both wanted and excluded kept as wanted. */
export function normalizePreferences(p: CollegeListPreferences): Required<Omit<CollegeListPreferences, 'maxNetPrice'>> & { maxNetPrice?: number } {
  const mustInclude = uniqueRefs(p.mustInclude, MAX_MUST_INCLUDE)
  const wanted = new Set(mustInclude.map((r) => r.unitid))
  const codes = new Set<string>()
  return {
    majors: [...new Set((p.majors ?? []).map((m) => m.trim()).filter(Boolean))].slice(0, 10),
    programs: (p.programs ?? []).filter((x) => !codes.has(x.cipCode) && codes.add(x.cipCode)).slice(0, MAX_PROGRAMS),
    states: [...new Set((p.states ?? []).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)))],
    regions: [...new Set(p.regions ?? [])],
    control: [...new Set(p.control ?? [])],
    sizes: SIZES.filter((s) => (p.sizes ?? []).includes(s)) as SizeBand[],
    ...(p.maxNetPrice === undefined ? {} : { maxNetPrice: p.maxNetPrice }),
    includeOpenAdmission: p.includeOpenAdmission ?? false,
    mix: normalMix(p.mix),
    mustInclude,
    exclude: uniqueRefs(p.exclude, MAX_EXCLUDE).filter((r) => !wanted.has(r.unitid)),
  }
}

/** What the preferences form starts from: the student's majors and the programs they match. Nothing else is assumed. */
export function defaultPreferences(student: { majors: string[] }): CollegeListPreferences {
  const majors = student.majors.map((m) => m.trim()).filter(Boolean)
  const seen = new Set<string>()
  const programs = matchMajors(majors)
    .flatMap((m) => m.programs)
    .filter((p) => !seen.has(p.cipCode) && seen.add(p.cipCode))
    .map(({ cipCode, cipTitle }) => ({ cipCode, cipTitle }))
  return { majors, programs, mix: { ...DEFAULT_MIX } }
}

// ── The check on everything the model writes ────────────────────────────────

export const STOCK_REASON = 'Matches your filters'
/** Longer than this is not "two sentences at most". The table allows 600. */
export const MAX_REASON_CHARS = 400
/** The overall note is a short paragraph; it passes the same check with this length. */
export const MAX_LIST_NOTE_CHARS = 900

/**
 * Why a model-written reason or note cannot be used, or undefined when it can.
 *
 * GUARDRAIL: every figure on a draft comes from the database. A reason that
 * states a percentage or a four-digit number (a test score, or a year a
 * figure could hide behind) is thrown away, not edited. The prompt also tells
 * the model not to state figures or chances; this check is the guarantee.
 */
export function reasonProblem(text: string, maxChars = MAX_REASON_CHARS): string | undefined {
  const reason = text.trim()
  if (!reason) return 'it was empty'
  if (reason.length > maxChars) return 'it was too long'
  if (/\d\s*(%|％|percent\b|per cent\b)/i.test(reason)) return 'it stated a percentage'
  if (/(?<!\d)\d{4}(?!\d)/.test(reason) || /(?<![\d,])\d,\d{3}(?![\d,])/.test(reason)) return 'it stated a four-digit number, which could be read as a test score'
  return undefined
}

export interface ModelPick {
  unitid: number
  reason: string
}

export interface CheckedPicks {
  /** Usable as they are, in the model's order. */
  accepted: ModelPick[]
  /** A known candidate whose reason failed the check. */
  rejected: { unitid: number; problem: string }[]
  /** Not a candidate, or named twice. */
  dropped: number
}

/** Sorts the model's picks into usable, unusable reason, and not ours at all. `already` holds picks accepted from an earlier answer. */
export function checkPicks(picks: ModelPick[], candidates: Candidate[], already: ReadonlySet<number> = new Set()): CheckedPicks {
  const known = new Set(candidates.map((c) => c.unitid))
  const seen = new Set(already)
  const result: CheckedPicks = { accepted: [], rejected: [], dropped: 0 }
  for (const pick of picks) {
    if (!known.has(pick.unitid) || seen.has(pick.unitid)) {
      result.dropped++
      continue
    }
    seen.add(pick.unitid)
    const problem = reasonProblem(pick.reason)
    if (problem) result.rejected.push({ unitid: pick.unitid, problem })
    else result.accepted.push({ unitid: pick.unitid, reason: pick.reason.trim() })
  }
  return result
}

export interface DraftRow {
  candidate: Candidate
  reason: string
  aiExplained: boolean
}

/** How many more colleges each band still needs from the model, given what has been accepted so far. */
export function stillNeeded(candidates: Candidate[], mix: ListMix, accepted: ModelPick[]): ListMix {
  const band = new Map(candidates.map((c) => [c.unitid, c.fit]))
  const have: ListMix = { Reach: 0, Target: 0, Likely: 0 }
  const chosen = new Set(accepted.map((p) => p.unitid))
  for (const id of chosen) have[band.get(id)!]++
  // A must-include is in the draft with or without a reason from the model.
  for (const c of candidates) if (c.mustInclude && !chosen.has(c.unitid)) have[c.fit]++
  const available = (fit: CollegeFit) => candidates.filter((c) => c.fit === fit).length
  return Object.fromEntries(FITS.map((fit) => [fit, Math.max(Math.min(mix[fit], available(fit)) - have[fit], 0)])) as ListMix
}

/**
 * The draft's rows, Reach then Target then Likely. In each band: every
 * must-include; then the model's accepted picks up to the mix; then, if the
 * band is still short, colleges the model picked but explained badly and after
 * them the most relevant remaining candidates, each with the stock reason and
 * marked as not AI-explained.
 */
export function assembleDraft(candidates: Candidate[], mix: ListMix, accepted: ModelPick[], rejected: number[] = []): DraftRow[] {
  const reasonOf = new Map(accepted.map((p) => [p.unitid, p.reason]))
  const order = new Map(accepted.map((p, i) => [p.unitid, i]))
  const badly = new Set(rejected)
  const row = (candidate: Candidate): DraftRow => {
    const reason = reasonOf.get(candidate.unitid)
    return reason ? { candidate, reason, aiExplained: true } : { candidate, reason: STOCK_REASON, aiExplained: false }
  }
  return FITS.flatMap((fit) => {
    const inBand = candidates.filter((c) => c.fit === fit)
    const must = inBand.filter((c) => c.mustInclude)
    const room = Math.max(mix[fit] - must.length, 0)
    const others = inBand.filter((c) => !c.mustInclude)
    const picked = others.filter((c) => order.has(c.unitid)).sort((a, b) => order.get(a.unitid)! - order.get(b.unitid)!)
    const fill = [...others.filter((c) => !order.has(c.unitid) && badly.has(c.unitid)).sort(byRelevance), ...others.filter((c) => !order.has(c.unitid) && !badly.has(c.unitid)).sort(byRelevance)]
    return [...must, ...[...picked, ...fill].slice(0, room)].map(row)
  })
}

/** When the AI step did not run: the most relevant candidates in each band, for the counselor to pick from by hand. */
export const HAND_PICK_PER_BAND = 10
export function handPickRows(candidates: Candidate[], mix: ListMix): DraftRow[] {
  return FITS.flatMap((fit) => {
    const inBand = candidates.filter((c) => c.fit === fit)
    const must = inBand.filter((c) => c.mustInclude)
    const others = mix[fit] > 0 ? inBand.filter((c) => !c.mustInclude).sort(byRelevance).slice(0, HAND_PICK_PER_BAND) : []
    return [...must, ...others].map((candidate) => ({ candidate, reason: STOCK_REASON, aiExplained: false }))
  })
}

// ── Which notes the model reads ─────────────────────────────────────────────

export const NOTES_FOR_DRAFT = 3
const MAX_NOTE_CHARS = 1_500

export interface NoteForList {
  date: string
  title: string
  text: string
}

/**
 * "The three most recent notes": the record of the student's three most recent
 * completed meetings that a counselor has approved. For each meeting that is
 * its approved meeting notes (decided, progress, to watch, and the fuller
 * notes), or, when those are not approved, its approved recap.
 *
 * GUARDRAIL: never a transcript or pasted raw notes (`transcript`), never a
 * draft nobody approved, never the counselor's private notes on the Profile
 * tab (those go only to the pre-meeting brief), and never "things to remember".
 */
export function notesForListDraft(meetings: Pick<Meeting, 'title' | 'date' | 'status' | 'ai' | 'recap'>[]): NoteForList[] {
  const notes: NoteForList[] = []
  for (const m of [...meetings].filter((x) => x.status === 'completed').sort((a, b) => b.date.localeCompare(a.date))) {
    const lines: string[] = []
    if (m.ai?.notesReview === 'approved') {
      const list = (label: string, items: string[] | undefined) => items?.length && lines.push(`${label}: ${items.join('; ')}`)
      list('Decided', m.ai.decided)
      list('Progress', m.ai.progress)
      list('To watch', m.ai.watch)
      list('Notes', m.ai.notes)
    } else if (m.recap?.review === 'approved') {
      if (m.recap.summary) lines.push(m.recap.summary)
      if (m.recap.nextSteps?.length) lines.push(`Next steps: ${m.recap.nextSteps.join('; ')}`)
    }
    if (lines.length === 0) continue
    notes.push({ date: m.date, title: m.title, text: lines.join('\n').slice(0, MAX_NOTE_CHARS) })
    if (notes.length === NOTES_FOR_DRAFT) break
  }
  return notes
}

// ── Reading drafts out of the store's data ──────────────────────────────────

/** The draft a counselor is reviewing for this student: the newest one not yet added or discarded. */
export function openListDraft(data: Pick<AppData, 'collegeListDrafts'>, studentId: ID): CollegeListDraft | undefined {
  return data.collegeListDrafts.filter((d) => d.studentId === studentId && d.status === 'draft').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
}

/** A draft's colleges, Reach then Target then Likely, each band in its saved order. */
export function draftItems(data: Pick<AppData, 'collegeListDraftItems'>, draftId: ID): CollegeListDraftItem[] {
  return data.collegeListDraftItems.filter((i) => i.draftId === draftId).sort((a, b) => FITS.indexOf(a.fit) - FITS.indexOf(b.fit) || a.position - b.position)
}

/** How a draft was made: the model or why not, when, and our counts. */
export const draftRun = (draft: CollegeListDraft): (AiSource & ListDraftRun) | undefined => draft.source

/**
 * The preferences a regenerated draft starts from: the ones the draft was made
 * with, plus what the counselor did to it. Colleges they removed become
 * exclusions and colleges they added become must-includes, so those two kinds
 * of edit carry over. A band they changed does not: bands are set again by the rule.
 */
export function regeneratePreferences(draft: CollegeListDraft, items: CollegeListDraftItem[], nameOf: (unitid: number) => string): CollegeListPreferences {
  const p = draft.preferences
  // In a draft the AI did not make, "not kept" means "not picked yet", not "removed".
  const removed = draft.source?.kind === 'placeholder' ? [] : items.filter((i) => !i.kept)
  const added = items.filter((i) => i.kept && i.fitBasis.addedBy === 'counselor')
  const ref = (i: CollegeListDraftItem): CollegeRef => ({ unitid: i.unitid, name: nameOf(i.unitid) })
  const gone = new Set(removed.map((i) => i.unitid))
  return {
    ...p,
    mustInclude: uniqueRefs([...(p.mustInclude ?? []).filter((r) => !gone.has(r.unitid)), ...added.map(ref)], MAX_MUST_INCLUDE),
    exclude: uniqueRefs([...(p.exclude ?? []), ...removed.map(ref)], MAX_EXCLUDE),
  }
}
