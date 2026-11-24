// Drafting a college list for one student: the preferences form, then the
// draft to review, grouped by band.
//
// Who decides what, and the screen says so:
//   * our code finds the candidates and sets every band (lib/collegeBands.ts);
//   * every figure is read from the directory and shown with its data year;
//   * the AI chooses among the candidates and writes a short reason for each;
//   * nothing reaches the student's list until the counselor presses "Add to list".
//
// A band is a starting point from public data, not a prediction. Nothing on
// this screen states or implies any student's chance of admission.

import { useState, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { CONTROLS, CONTROL_LABEL, REGIONS, yearOf, type CollegeSummary } from '../../../shared/colleges'
import { CollegeFigures, CollegePicker, DirectorySourceNote, collegePlace } from '../../components/colleges'
import { AiTag, Button, Card, CardHeader, LinkButton, PageHeader, Pill, SectionLabel, Thinking, cx, inputBase, useToast } from '../../components/ui'
import { BAND_RULES, FITS, MAX_PER_BAND, SIZES, SIZE_BANDS, formatRate } from '../../lib/collegeBands'
import { STOCK_REASON, defaultPreferences, draftItems, draftRun, matchMajors, normalMix, normalizePreferences, openListDraft, regeneratePreferences, searchPrograms } from '../../lib/collegeListDraft'
import { formatTimestamp } from '../../lib/dates'
import { findStudent, fullName } from '../../lib/derive'
import { useDirectoryColleges, type DirectoryFigures } from '../../services/colleges'
import { useData, useStore } from '../../store/store'
import type { CollegeFit, CollegeListDraft, CollegeListDraftItem, CollegeListPreferences, CollegeRef, Student } from '../../types'

export default function ListDraft() {
  const data = useData()
  const { studentId } = useParams()
  const student = findStudent(data, studentId)
  const draft = student ? openListDraft(data, student.id) : undefined
  const items = draft ? draftItems(data, draft.id) : []
  const directory = useDirectoryColleges(items.map((i) => i.unitid))
  /** The preferences form, open over a draft that is about to be replaced. */
  const [again, setAgain] = useState<CollegeListPreferences>()
  if (!student) return <Navigate to="/app/students" replace />

  const back = `/app/students/${student.id}`
  return (
    <>
      <PageHeader
        above={
          <>
            <Link to="/app/students" className="font-medium text-accent hover:underline">
              Students
            </Link>{' '}
            /{' '}
            <Link to={back} className="font-medium text-accent hover:underline">
              {fullName(student)}
            </Link>{' '}
            / Draft a college list
          </>
        }
        title={draft && !again ? 'Review the draft list' : 'Draft a college list'}
        sub={`Only counselors see a draft. Nothing here appears on ${student.firstName}’s page or in a parent report.`}
        actions={<LinkButton to={back}>Back to {student.firstName}</LinkButton>}
      />
      <div className="mt-6 flex flex-col gap-6">
        {draft && !again ? (
          <Review student={student} draft={draft} items={items} directory={directory} onRegenerate={() => setAgain(regeneratePreferences(draft, items, (unitid) => directory.college(unitid)?.name ?? `College ${unitid}`))} />
        ) : (
          <PreferencesForm key={draft?.id ?? 'new'} student={student} initial={again ?? defaultPreferences(student)} replaces={draft} onDone={() => setAgain(undefined)} onCancel={again ? () => setAgain(undefined) : undefined} />
        )}
      </div>
    </>
  )
}

// ── Preferences ─────────────────────────────────────────────────────────────

const splitList = (text: string) =>
  text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

function Check({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-accent" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{label}</legend>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </fieldset>
  )
}

function Chip({ children, onRemove, label }: { children: ReactNode; onRemove: () => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-line bg-canvas py-0.5 pl-2.5 pr-0.5 text-[13px]">
      {children}
      <button type="button" aria-label={label} className="flex h-8 w-8 items-center justify-center rounded-md text-base text-muted hover:bg-surface hover:text-ink" onClick={onRemove}>
        ×
      </button>
    </span>
  )
}

/** A list of directory colleges, added by type-ahead. Used for "must include" and "exclude". */
function CollegeRefs({ label, value, onChange, other, hint }: { label: string; value: CollegeRef[]; onChange: (refs: CollegeRef[]) => void; other: CollegeRef[]; hint: string }) {
  const [text, setText] = useState('')
  const pick = (college: CollegeSummary) => {
    if (!value.some((r) => r.unitid === college.unitid) && !other.some((r) => r.unitid === college.unitid)) onChange([...value, { unitid: college.unitid, name: college.name }])
    setText('')
  }
  return (
    <Group label={label} hint={hint}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((r) => (
            <Chip key={r.unitid} label={`Remove ${r.name} from ${label.toLowerCase()}`} onRemove={() => onChange(value.filter((x) => x.unitid !== r.unitid))}>
              {r.name}
            </Chip>
          ))}
        </div>
      )}
      <CollegePicker label={label} value={text} onChange={setText} onPick={pick} />
    </Group>
  )
}

function PreferencesForm({ student, initial, replaces, onDone, onCancel }: { student: Student; initial: CollegeListPreferences; replaces?: CollegeListDraft; onDone: () => void; onCancel?: () => void }) {
  const draftCollegeList = useStore((s) => s.draftCollegeList)
  const toast = useToast()
  const [prefs, setPrefs] = useState(() => normalizePreferences(initial))
  const [majorsText, setMajorsText] = useState(prefs.majors.join(', '))
  const [statesText, setStatesText] = useState(prefs.states.join(', '))
  const [priceText, setPriceText] = useState(prefs.maxNetPrice === undefined ? '' : String(prefs.maxNetPrice))
  const [programText, setProgramText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const set = (patch: Partial<typeof prefs>) => setPrefs((p) => ({ ...p, ...patch }))
  const toggle = <T,>(list: T[], item: T, on: boolean) => (on ? [...list.filter((x) => x !== item), item] : list.filter((x) => x !== item))

  const majors = splitList(majorsText)
  const unmatched = matchMajors(majors).filter((m) => m.programs.length === 0 || !m.programs.some((p) => prefs.programs.some((x) => x.cipCode === p.cipCode)))
  const found = searchPrograms(programText).filter((p) => !prefs.programs.some((x) => x.cipCode === p.cipCode))
  const states = splitList(statesText).map((s) => s.toUpperCase())
  const badStates = states.filter((s) => !/^[A-Z]{2}$/.test(s))
  const price = priceText.trim() === '' ? undefined : Number(priceText)
  const badPrice = price !== undefined && (!Number.isInteger(price) || price < 0)
  const total = prefs.mix.Reach + prefs.mix.Target + prefs.mix.Likely
  const ready = !busy && badStates.length === 0 && !badPrice && (total > 0 || prefs.mustInclude.length > 0)

  const matchPrograms = () => {
    const seen = new Set<string>()
    set({
      programs: matchMajors(majors)
        .flatMap((m) => m.programs)
        .filter((p) => !seen.has(p.cipCode) && seen.add(p.cipCode))
        .map(({ cipCode, cipTitle }) => ({ cipCode, cipTitle })),
    })
  }

  const submit = async () => {
    setBusy(true)
    setError(undefined)
    const { maxNetPrice: _old, ...rest } = prefs
    const wanted: CollegeListPreferences = { ...rest, majors, states, ...(price === undefined ? {} : { maxNetPrice: price }) }
    try {
      const made = await draftCollegeList(student.id, wanted, replaces?.id)
      toast(made.byModel ? 'The draft is ready to review. Nothing has been added to the list.' : 'The AI step did not run. The draft holds the top candidates in each band for you to pick from.')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The list could not be drafted. Please try again.')
      setBusy(false)
    }
  }

  return (
    <Card className="flex flex-col gap-6 p-5">
      <CardHeader
        size="section"
        title="What to look for"
        sub={`Filled in from ${student.firstName}’s record. Change anything. An empty filter means “any”. Colleges already on ${student.firstName}’s list are left out.`}
      />
      {replaces && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          <strong>This replaces the draft you were reviewing.</strong> Colleges you removed are listed under “Exclude” and colleges you added under “Must include”, so those carry over. A band you changed by hand does not: bands are set again by the rule.
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Group label="Intended majors" hint="Separate with commas. The AI reads these. The filter is the list of programs below.">
          <input className={cx(inputBase, 'w-full')} aria-label="Intended majors" value={majorsText} onChange={(e) => setMajorsText(e.target.value)} placeholder="e.g. Computer Science, Data Science" />
        </Group>

        <Group label="Programs a college must offer (any one of them)" hint="Matched in our code from the majors, against the bachelor’s programs in the directory. Remove any that are wrong, or add one. With none, colleges are not filtered by program.">
          {prefs.programs.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {prefs.programs.map((p) => (
                <Chip key={p.cipCode} label={`Remove the program ${p.cipTitle}`} onRemove={() => set({ programs: prefs.programs.filter((x) => x.cipCode !== p.cipCode) })}>
                  {p.cipTitle}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No program filter.</p>
          )}
          {unmatched.length > 0 && (
            <p className="text-[13px] text-ink-soft">
              Not covered by a program above: {unmatched.map((m) => `“${m.major}”`).join(', ')}.{' '}
              {unmatched.some((m) => m.programs.length > 0) ? (
                <button type="button" className="font-semibold text-accent underline" onClick={matchPrograms}>
                  Match programs to the majors again
                </button>
              ) : (
                'The directory has no program by that name: add one below if you want to filter by it.'
              )}
            </p>
          )}
          <input className={cx(inputBase, 'w-full')} aria-label="Add a program" value={programText} onChange={(e) => setProgramText(e.target.value)} placeholder="Add a program, e.g. statistics" />
          {found.length > 0 && (
            <ul className="overflow-hidden rounded-lg border border-line bg-surface" aria-label="Programs in the directory">
              {found.map((p) => (
                <li key={p.cipCode} className="border-t border-line first:border-t-0">
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-surface-2"
                    onClick={() => {
                      set({ programs: [...prefs.programs, { cipCode: p.cipCode, cipTitle: p.cipTitle }] })
                      setProgramText('')
                    }}
                  >
                    <span className="font-semibold">{p.cipTitle}</span>
                    <span className="shrink-0 text-xs text-muted">{p.colleges.toLocaleString('en-US')} colleges</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {programText.trim().length > 1 && found.length === 0 && <p className="text-[13px] text-muted">No program in the directory matches “{programText.trim()}”.</p>}
        </Group>

        <Group label="States" hint="Two-letter codes, separated with commas. A college passes when it is in one of these states or in one of the regions ticked.">
          <input className={cx(inputBase, 'w-full')} aria-label="States" value={statesText} onChange={(e) => setStatesText(e.target.value)} placeholder="e.g. CA, NY, MA" />
          {badStates.length > 0 && (
            <p role="alert" className="text-[13px] text-bad">
              Not a two-letter state code: {badStates.join(', ')}.
            </p>
          )}
        </Group>

        <Group label="Regions">
          <div className="grid grid-cols-2 gap-x-4">
            {REGIONS.map((r) => (
              <Check key={r} checked={prefs.regions.includes(r)} onChange={(on) => set({ regions: toggle(prefs.regions, r, on) })}>
                {r}
              </Check>
            ))}
          </div>
        </Group>

        <Group label="Size (undergraduates)" hint="None ticked means any size.">
          <div className="flex flex-wrap gap-x-5">
            {SIZES.map((s) => (
              <Check key={s} checked={prefs.sizes.includes(s)} onChange={(on) => set({ sizes: SIZES.filter((x) => (x === s ? on : prefs.sizes.includes(x))) })}>
                {SIZE_BANDS[s].label}
              </Check>
            ))}
          </div>
        </Group>

        <Group label="Public or private" hint="None ticked means any.">
          <div className="flex flex-wrap gap-x-5">
            {CONTROLS.map((c) => (
              <Check key={c} checked={prefs.control.includes(c)} onChange={(on) => set({ control: toggle(prefs.control, c, on) })}>
                {CONTROL_LABEL[c]}
              </Check>
            ))}
          </div>
        </Group>

        <Group label="Net price ceiling" hint="The highest average net price per year, in dollars, as the college reports it for all students. Colleges that report none are left out when this is set.">
          <input className={cx(inputBase, 'w-40')} aria-label="Net price ceiling in dollars" inputMode="numeric" value={priceText} onChange={(e) => setPriceText(e.target.value.replace(/[$,\s]/g, ''))} placeholder="No ceiling" />
          {badPrice && (
            <p role="alert" className="text-[13px] text-bad">
              Enter a whole number of dollars, or leave it empty.
            </p>
          )}
          <Check checked={prefs.includeOpenAdmission} onChange={(on) => set({ includeOpenAdmission: on })}>
            Include open-admission colleges
          </Check>
        </Group>

        <Group label="How many in each band" hint={`Up to ${MAX_PER_BAND} each. A band with fewer matching colleges than you ask for comes back shorter.`}>
          <div className="flex flex-wrap gap-4">
            {FITS.map((fit) => (
              <label key={fit} className="flex items-center gap-2 text-sm">
                {fit}
                <input
                  type="number"
                  min={0}
                  max={MAX_PER_BAND}
                  aria-label={`How many ${fit}`}
                  className={cx(inputBase, 'w-20')}
                  value={prefs.mix[fit]}
                  onChange={(e) => set({ mix: normalMix({ ...prefs.mix, [fit]: e.target.value === '' ? 0 : Number(e.target.value) }) })}
                />
              </label>
            ))}
          </div>
        </Group>

        <CollegeRefs label="Must include" value={prefs.mustInclude} other={[]} onChange={(mustInclude) => set({ mustInclude, exclude: prefs.exclude.filter((r) => !mustInclude.some((m) => m.unitid === r.unitid)) })} hint="Always in the draft, banded by the same rules, even when they fail a filter above." />
        <CollegeRefs label="Exclude" value={prefs.exclude} other={prefs.mustInclude} onChange={(exclude) => set({ exclude })} hint="Never in the draft." />
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <p className="max-w-prose text-[13px] text-muted">
          Our code finds the colleges that pass these filters and places each in a band from public figures. The AI then chooses among them and writes a short reason for each. It is sent {student.firstName}’s majors, interests and activities, your three
          most recent approved meeting notes, these preferences, and the candidates’ names, states, bands, sizes and programs. It is not sent {student.firstName}’s name, scores or grades, parent details, documents, or things to remember.
        </p>
        {error && (
          <div role="alert" className="rounded-lg border border-bad-line bg-bad-tint px-3 py-2 text-[13px] text-bad">
            <strong>No draft was made.</strong> {error}
          </div>
        )}
        {busy ? (
          <Thinking label="Finding candidates, setting bands and asking the AI. This can take a minute…" />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!ready} onClick={submit}>
              {replaces ? 'Regenerate the draft' : 'Draft a list'}
            </Button>
            {onCancel && <Button onClick={onCancel}>Cancel</Button>}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Review ──────────────────────────────────────────────────────────────────

/** The entering class the admissions figures describe, read from the directory rows (or, until they load, from each band's basis). */
function admissionsYears(items: CollegeListDraftItem[], directory: DirectoryFigures): string[] {
  const years = items.map((i) => {
    const college = directory.college(i.unitid)
    return (college && yearOf(college.sources, 'admitRate')) ?? i.fitBasis.years?.admissions
  })
  return [...new Set(years.filter((y): y is string => Boolean(y)))]
}

function Review({ student, draft, items, directory, onRegenerate }: { student: Student; draft: CollegeListDraft; items: CollegeListDraftItem[]; directory: DirectoryFigures; onRegenerate: () => void }) {
  const { addDraftToList, addCollegeToDraft, discardListDraft, keepDraftItem } = useStore.getState()
  const toast = useToast()
  const navigate = useNavigate()
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState<'add' | 'college'>()
  const [error, setError] = useState<string>()

  const run = draftRun(draft)
  const byModel = run?.kind === 'claude'
  const kept = items.filter((i) => i.kept)
  const out = items.filter((i) => !i.kept)
  const years = admissionsYears(items, directory)
  // The year the test score ranges describe, as recorded with each band when it was worked out.
  const testYears = [...new Set(items.map((i) => i.fitBasis.years?.tests).filter((y): y is string => Boolean(y)))]
  const dated = (list: string[]) => (list.length ? ` (${list.join(' or ')})` : '')
  const nameOf = (i: CollegeListDraftItem) => directory.college(i.unitid)?.name ?? `College ${i.unitid}`

  const addCollege = async (college: CollegeSummary) => {
    setBusy('college')
    setError(undefined)
    try {
      await addCollegeToDraft(draft.id, college.unitid)
      setAdding('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That college could not be added.')
    }
    setBusy(undefined)
  }

  const addToList = async () => {
    setBusy('add')
    setError(undefined)
    try {
      const added = await addDraftToList(draft.id)
      const skipped = kept.length - added
      toast(`${added === 1 ? '1 college' : `${added} colleges`} added to ${student.firstName}’s list.${skipped > 0 ? ` ${skipped} already on the list ${skipped === 1 ? 'was' : 'were'} skipped.` : ''}`)
      navigate(`/app/students/${student.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The draft could not be added to the list.')
      setBusy(undefined)
    }
  }

  return (
    <>
      <Card tone="accent" className="flex flex-col gap-2 p-5">
        <p className="text-base font-semibold">
          Bands are a starting point from public data for the class that entered in {years.length ? years.join(' or ') : 'the year shown beside each figure'}. They are not a prediction.
        </p>
        <p className="text-sm text-ink-soft">
          What the bands use: each college’s admit rate{dated(years)} and the 25th and 75th percentiles of its enrolled students’ SAT and ACT scores{dated(testYears)}, both from the U.S. Department of Education
          College Scorecard, set against {student.firstName}’s best test score on file. GPA is not used, because the directory has no GPA figures for colleges.
        </p>
        <p className="text-[13px] text-ink-soft">
          Each band is set by a fixed rule in our code, never by the AI: an admit rate under {formatRate(BAND_RULES.reachAdmitRateBelow)} is a Reach; a best test score at or above the college’s 75th percentile with an admit rate of{' '}
          {formatRate(BAND_RULES.likelyAdmitRateAtLeast)} or more is Likely; a score below the 25th percentile is a Reach; anything else is a Target. “Limited data” marks a band
          that rests on the admit rate alone. The admit rate is the college’s own published figure for everyone who applied.
        </p>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {byModel ? <AiTag source={draft.source}>{`Chosen and explained by AI · ${run?.kind === 'claude' ? run.model : ''}`}</AiTag> : <Pill tone="warn">Not chosen by the AI</Pill>}
          <span className="text-xs text-muted">
            Drafted {formatTimestamp(run?.at ?? draft.createdAt)}
            {run?.matched !== undefined && ` · ${run.matched.toLocaleString('en-US')} colleges passed your filters${run.considered !== undefined && run.considered < run.matched ? `, ${run.considered} were considered` : ''}`}
          </span>
        </div>
        {!byModel && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
            <strong>The AI step did not run.</strong> {run?.kind === 'placeholder' ? run.reason : ''} Below are the most relevant candidates in each band, banded by the rule. Press “Keep” on the ones you want, or regenerate to try the AI again.
          </p>
        )}
        {byModel && ((run?.rejectedReasons ?? 0) > 0 || (run?.filled ?? 0) > 0) && (
          <p className="text-[13px] text-ink-soft">
            {(run?.rejectedReasons ?? 0) > 0 && `${run?.rejectedReasons} of the AI’s reasons stated a figure and ${run?.rejectedReasons === 1 ? 'was' : 'were'} thrown away. `}
            {(run?.filled ?? 0) > 0 && `${run?.filled} ${run?.filled === 1 ? 'college was' : 'colleges were'} added by our code to fill a band, marked “${STOCK_REASON}”.`}
          </p>
        )}
        {draft.note && (
          <div>
            <SectionLabel className="mb-1">The AI’s note on this list</SectionLabel>
            <p className="max-w-prose text-sm text-ink-soft">{draft.note}</p>
          </div>
        )}
      </Card>

      {FITS.map((fit) => {
        const rows = kept.filter((i) => i.fit === fit)
        const asked = normalMix(draft.preferences.mix)[fit]
        // How many the draft came with in this band, whatever has been moved or removed since.
        const drafted = items.filter((i) => (i.fitBasis.ruleFit ?? i.fit) === fit && i.fitBasis.addedBy !== 'counselor').length
        return (
          <Card key={fit}>
            <CardHeader size="section" className="px-5 py-4" title={fit} count={rows.length} sub={byModel && drafted < asked ? `You asked for ${asked}. Fewer colleges that pass your filters fall in this band.` : undefined} />
            {rows.length === 0 ? (
              <p className="border-t border-line px-5 py-4 text-sm text-muted">No {fit} colleges in the draft.</p>
            ) : (
              <ul>
                {rows.map((item) => (
                  <DraftItemRow key={item.id} item={item} directory={directory} />
                ))}
              </ul>
            )}
          </Card>
        )
      })}

      {out.length > 0 && (
        <Card>
          <CardHeader size="section" className="px-5 py-4" title={byModel ? 'Removed' : 'Candidates to pick from'} count={out.length} sub={byModel ? 'Not added to the list. Put one back if you change your mind.' : 'Not in the draft until you press Keep.'} />
          <ul>
            {out.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold">{nameOf(item)}</span>
                  <span className="text-muted"> · {item.fit}</span>
                  {item.fitBasis.limitedData && <span className="text-warn"> · limited data</span>}
                  <span className="block text-[13px] text-ink-soft">{item.fitBasis.summary}</span>
                </span>
                <Button aria-label={`${byModel ? 'Put back' : 'Keep'} ${nameOf(item)}`} onClick={() => keepDraftItem(item.id, true)}>
                  {byModel ? 'Put back' : 'Keep'}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="flex flex-col gap-3 p-5">
        <CardHeader title="Add a college from the directory" sub="It is banded by the same rule. The AI writes no reason for it." />
        <CollegePicker label="Add a college to the draft" value={adding} onChange={setAdding} onPick={addCollege} />
        {busy === 'college' && <Thinking label="Setting its band…" />}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        {error && (
          <div role="alert" className="rounded-lg border border-bad-line bg-bad-tint px-3 py-2 text-[13px] text-bad">
            {error}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={kept.length === 0 || busy !== undefined} onClick={addToList}>
            {busy === 'add' ? 'Adding…' : `Add ${kept.length === 1 ? '1 college' : `${kept.length} colleges`} to ${student.firstName}’s list`}
          </Button>
          <Button disabled={busy !== undefined} onClick={onRegenerate}>
            Regenerate
          </Button>
          <Button
            variant="quiet"
            disabled={busy !== undefined}
            onClick={() => {
              if (!window.confirm('Discard this draft? Nothing is added to the list.')) return
              discardListDraft(draft.id)
              toast('The draft was discarded. Nothing was added to the list.')
            }}
          >
            Discard draft
          </Button>
        </div>
        <p className="max-w-prose text-[13px] text-muted">
          “Add to list” puts the colleges above on {student.firstName}’s list as Planning, with no plan or deadline, each with its band, its “why this band” line and the reason shown here as its note. A college already on the list is skipped. Your name
          and the time are recorded. “Regenerate” opens the preferences again and replaces this draft.
        </p>
        <DirectorySourceNote />
      </Card>
    </>
  )
}

function DraftItemRow({ item, directory }: { item: CollegeListDraftItem; directory: DirectoryFigures }) {
  const { keepDraftItem, setDraftItemFit } = useStore.getState()
  const college = directory.college(item.unitid)
  const name = college?.name ?? `College ${item.unitid}`
  const basis = item.fitBasis
  const byCounselor = basis.addedBy === 'counselor'
  return (
    <li className="flex flex-col gap-2 border-t border-line px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold">
            {name}
            {college && collegePlace(college) && <span className="font-normal text-muted"> · {collegePlace(college)}</span>}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {basis.limitedData && <Pill tone="warn">Limited data</Pill>}
            {item.fitSetBy === 'counselor' && <Pill tone="accent">Band set by a counselor</Pill>}
            {byCounselor && <Pill>Added by a counselor</Pill>}
            {!byCounselor && !item.aiExplained && <Pill>Not explained by the AI</Pill>}
            {college && !college.isActive && <Pill tone="bad">No longer listed as operating</Pill>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <select aria-label={`Band for ${name}`} className={inputBase} value={item.fit} onChange={(e) => setDraftItemFit(item.id, e.target.value as CollegeFit)}>
            {FITS.map((fit) => (
              <option key={fit}>{fit}</option>
            ))}
          </select>
          <Button variant="quiet" aria-label={`Remove ${name} from the draft`} onClick={() => keepDraftItem(item.id, false)}>
            Remove
          </Button>
        </div>
      </div>
      {item.reason ? <p className="max-w-prose text-sm">{item.reason}</p> : <p className="text-sm text-muted">No reason: you added this college yourself.</p>}
      {basis.programs && basis.programs.length > 0 && <p className="text-[13px] text-ink-soft">Programs that match: {basis.programs.join('; ')}</p>}
      <div className="rounded-lg bg-canvas px-3 py-2.5">
        {college ? <CollegeFigures college={college} /> : <p className="text-[13px] text-muted">{directory.missing(item.unitid) ? 'The directory has no record for this college.' : (directory.error ?? 'Loading figures…')}</p>}
      </div>
      <p className="max-w-prose text-[13px] text-ink-soft">
        <span className="font-semibold">Why {item.fit}:</span> {basis.summary ?? 'No basis was recorded.'}
      </p>
      {basis.limitedData && (
        <p className="max-w-prose text-[13px] text-warn">
          <span className="font-semibold">Limited data.</span> {basis.limitedReason ?? 'A figure the rule needs is missing.'} Treat this band as a rough placement.
        </p>
      )}
    </li>
  )
}
