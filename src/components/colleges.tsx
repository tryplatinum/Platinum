// The college directory on screen: the type-ahead used to find a college, and
// the figures shown for a list row that is linked to the directory.
//
// Every figure here is read from the directory (services/colleges.ts) and is
// printed with the year it describes. A missing figure is a dash, never zero.
// The admit rate is the institution's own published rate: nothing here says
// anything about one student's chances.

import { useEffect, useId, useRef, useState } from 'react'
import { CONTROL_LABEL, SCORECARD_SOURCE, yearOf, type CollegeSummary, type Figure } from '../../shared/colleges'
import { searchDirectory } from '../services/colleges'
import { cx, inputBase } from './ui'

const DASH = '—'
const RESULTS = 8
const DEBOUNCE_MS = 200

export const collegePlace = (c: CollegeSummary) => [c.city, c.state].filter(Boolean).join(', ')

/** 0.0365 → "3.7%", 0.41 → "41%". */
export const formatRate = (rate: number) => `${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%`
export const formatDollars = (amount: number) => `${amount < 0 ? '-' : ''}$${Math.abs(amount).toLocaleString('en-US')}`
const range = (low?: number, high?: number) => (low === undefined || high === undefined ? undefined : `${low}–${high}`)

// ── Type-ahead ──────────────────────────────────────────────────────────────

/**
 * A text box that searches the directory as you type. Picking a result calls
 * onPick; the text itself stays the caller's, so it can also be kept as a
 * free-text name for a college that is not in the directory.
 */
export function CollegePicker({
  value,
  onChange,
  onPick,
  label,
  autoFocus,
  className,
}: {
  value: string
  onChange: (text: string) => void
  onPick: (college: CollegeSummary) => void
  label: string
  autoFocus?: boolean
  className?: string
}) {
  const listId = useId()
  const [results, setResults] = useState<CollegeSummary[]>()
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string>()
  const [active, setActive] = useState(-1)
  const latest = useRef(0)
  const typed = value.trim()

  useEffect(() => {
    const request = ++latest.current
    if (typed.length < 2) {
      setResults(undefined)
      setError(undefined)
      return
    }
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchDirectory({ name: typed, limit: RESULTS })
        if (request !== latest.current) return
        setResults(found.colleges)
        setTotal(found.total)
        setError(undefined)
      } catch (e) {
        if (request !== latest.current) return
        setResults(undefined)
        setError(e instanceof Error ? e.message : 'The college directory could not be searched.')
      }
      setActive(-1)
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [typed])

  return (
    <div className={className}>
      <input
        className={cx(inputBase, 'w-full')}
        role="combobox"
        aria-label={label}
        aria-expanded={Boolean(results?.length)}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="Start typing a name, e.g. MIT"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (!results?.length) return
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + results.length + (active < 0 && e.key === 'ArrowUp' ? 1 : 0)) % results.length)
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault()
            onPick(results[active])
          }
        }}
      />
      {results && results.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Colleges in the directory" className="mt-1 overflow-hidden rounded-lg border border-line bg-surface">
          {results.map((c, i) => (
            <li key={c.unitid} role="option" aria-selected={i === active} className="border-t border-line first:border-t-0">
              <button type="button" className={cx('flex min-h-11 w-full flex-col items-start justify-center px-3 py-1.5 text-left text-sm hover:bg-surface-2', i === active && 'bg-surface-2')} onClick={() => onPick(c)}>
                <span className="font-semibold">{c.name}</span>
                <span className="text-xs text-muted">
                  {[collegePlace(c), c.control && CONTROL_LABEL[c.control], c.undergradSize !== undefined && `${c.undergradSize.toLocaleString('en-US')} undergraduates`].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
          {total > results.length && <li className="border-t border-line px-3 py-2 text-xs text-muted">Showing the closest {results.length} of {total}. Keep typing to narrow it down.</li>}
        </ul>
      )}
      {results && results.length === 0 && <p className="mt-1 text-[13px] text-muted">No college in the directory matches “{typed}”.</p>}
      {error && (
        <p role="alert" className="mt-1 text-[13px] text-bad">
          {error}
        </p>
      )}
    </div>
  )
}

// ── Figures for a linked row ────────────────────────────────────────────────

function FigureCell({ label, value, year }: { label: string; value?: string; year?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd>
        {value === undefined ? (
          <span className="text-muted" aria-label="Not reported">
            {DASH}
          </span>
        ) : (
          <>
            <span className="font-semibold">{value}</span> <span className="whitespace-nowrap text-[11px] text-muted">{year ?? 'year not recorded'}</span>
          </>
        )}
      </dd>
    </div>
  )
}

/** Admit rate, the SAT and ACT middle ranges and net price, each with its data year. */
export function CollegeFigures({ college }: { college: CollegeSummary }) {
  const year = (figure: Figure) => yearOf(college.sources, figure)
  const ebrw = range(college.satEbrw25, college.satEbrw75)
  const math = range(college.satMath25, college.satMath75)
  const sat = ebrw || math ? [ebrw && `Reading and writing ${ebrw}`, math && `Math ${math}`].filter(Boolean).join(' · ') : undefined
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
      <FigureCell label="Admit rate" value={college.admitRate === undefined ? undefined : formatRate(college.admitRate)} year={year('admitRate')} />
      <FigureCell label="SAT, middle half of enrolled students" value={sat} year={year('satEbrw')} />
      <FigureCell label="ACT, middle half" value={range(college.act25, college.act75)} year={year('act')} />
      <FigureCell label="Average net price" value={college.avgNetPrice === undefined ? undefined : formatDollars(college.avgNetPrice)} year={year('avgNetPrice')} />
    </dl>
  )
}

export function DirectorySourceNote({ className }: { className?: string }) {
  return <p className={cx('text-xs text-muted', className)}>Source: {SCORECARD_SOURCE}. A dash means the college did not report that figure.</p>
}
