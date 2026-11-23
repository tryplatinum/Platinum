// Shared UI pieces for the v2 design. Screens compose these instead of styling
// from scratch. Sizes follow the design: page title 28, section title 18, card
// title 16, body 14, secondary 13, labels 12. Every click target is at least
// 44px high. Status is always shown with words, never by colour alone.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link, useSearchParams, type LinkProps } from 'react-router-dom'
import { formatTimestamp, parseISODate, type ISODate } from '../lib/dates'
import type { StudentStatus, TaskProgress } from '../lib/derive'
import type { AiSource, Approval, OwnerType, Review } from '../types'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/** Shown after every send. Nothing is delivered in v0, and the interface says so each time. */
export const SENT_NOTE = 'Logged in Messages sent. Delivery is not connected in v0.'

// ── Layout ──────────────────────────────────────────────────────────────────

export function Card({ children, className, tone }: { children: ReactNode; className?: string; tone?: 'accent' | 'bad' }) {
  return (
    <section
      className={cx(
        'rounded-xl border',
        tone === 'accent' ? 'border-accent-line bg-accent-soft' : tone === 'bad' ? 'border-bad-line bg-bad-tint' : 'border-line bg-surface',
        className,
      )}
    >
      {children}
    </section>
  )
}

/** Title row for a card or a section: title (18 or 16px), optional count, optional right side. */
export function CardHeader({
  title,
  count,
  sub,
  action,
  size = 'card',
  className,
}: {
  title: ReactNode
  count?: ReactNode
  sub?: ReactNode
  action?: ReactNode
  size?: 'section' | 'card'
  className?: string
}) {
  return (
    <div className={cx('flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className={cx('text-ink', size === 'section' ? 'text-lg font-bold' : 'text-base font-semibold')}>
          {title}
          {count !== undefined && <span className="ml-1.5 font-medium text-ink-soft">· {count}</span>}
        </h2>
        {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}

export function PageHeader({ title, above, sub, pill, actions }: { title: ReactNode; above?: ReactNode; sub?: ReactNode; pill?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {above && <p className="mb-1 text-[13px] text-muted">{above}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink">{title}</h1>
          {pill}
        </div>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

/** Small caps-style label: 12px semibold, muted. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('text-xs font-semibold uppercase tracking-wide text-muted', className)}>{children}</div>
}

/** An empty list, with the action that fills it. */
export function Empty({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
      <p className="text-sm text-muted">{title}</p>
      {children}
    </div>
  )
}

// ── Buttons and form controls ───────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'remind' | 'quiet' | 'danger'

const BUTTON_BASE = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const BUTTON_VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-canvas',
  remind: 'border border-accent bg-surface text-accent hover:bg-accent-soft',
  quiet: 'text-accent hover:bg-accent-soft',
  danger: 'border border-bad-line bg-surface text-bad hover:bg-bad-tint',
}

export function Button({ variant = 'secondary', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" {...rest} className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], className)} />
}

/** A link that looks like a button. */
export function LinkButton({ variant = 'secondary', className, ...rest }: LinkProps & { variant?: Variant }) {
  return <Link {...rest} className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], className)} />
}

/** Input styling without a width. */
export const inputBase =
  'min-h-11 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none disabled:bg-canvas'
/** Full-width input. */
export const inputClass = `${inputBase} w-full`
/** Textareas need vertical padding that a fixed-height input does not. */
export const textareaClass = `${inputClass} py-2.5 leading-relaxed`

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

// ── Pills, chips and tags ───────────────────────────────────────────────────

export type Tone = 'good' | 'warn' | 'bad' | 'neutral' | 'accent'

const TONE: Record<Tone, string> = {
  good: 'bg-good-soft text-good',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  neutral: 'bg-chip text-ink-soft',
  accent: 'bg-accent-soft-2 text-accent-hover',
}

export function Pill({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', TONE[tone], className)}>{children}</span>
}

export const STATUS_LABEL: Record<StudentStatus, string> = { behind: 'Behind', slipping: 'Slipping', on_track: 'On track', new: 'Just onboarded' }
export const STATUS_TONE: Record<StudentStatus, Tone> = { behind: 'bad', slipping: 'warn', on_track: 'good', new: 'neutral' }
const STATUS_BAR: Record<StudentStatus, string> = { behind: 'bg-bad-bar', slipping: 'bg-warn-bar', on_track: 'bg-good-bar', new: 'bg-accent' }
const STATUS_TEXT: Record<StudentStatus, string> = { behind: 'text-bad', slipping: 'text-warn', on_track: 'text-good', new: 'text-ink-soft' }

/** How a student is doing. The status itself comes from lib/derive.ts. */
export function StatusPill({ status }: { status: StudentStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>
}

const OWNER_TONE: Record<OwnerType, Tone> = { student: 'neutral', parent: 'warn', counselor: 'accent' }

/** Who owns a task. Pass the label from derive.ownerLabel(). */
export function OwnerChip({ owner, label }: { owner: OwnerType; label: string }) {
  return <Pill tone={OWNER_TONE[owner]}>{label}</Pill>
}

/** Marks AI-written content and says where it came from. Placeholders are never passed off as AI output. */
export function AiTag({ source, children }: { source?: AiSource; children?: ReactNode }) {
  if (source?.kind === 'placeholder') {
    return (
      <span title={source.reason}>
        <Pill tone="warn">Placeholder draft · not from the AI</Pill>
      </span>
    )
  }
  return <Pill tone="accent">{children ?? (source ? `AI draft · ${source.model}` : 'AI draft')}</Pill>
}

/** One line explaining a placeholder, for the top of a draft. */
export function PlaceholderNote({ source }: { source?: AiSource }) {
  if (source?.kind !== 'placeholder') return null
  return (
    <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
      <strong>This is a placeholder, not AI output.</strong> {source.reason} Sample text is shown so the screen can be used.
    </p>
  )
}

/** The review state of an AI draft. */
export function ReviewTag({ review, approvedLabel = 'Approved' }: { review: Review; approvedLabel?: string }) {
  if (review === 'approved') return <Pill tone="good">{approvedLabel}</Pill>
  if (review === 'dismissed') return <Pill tone="neutral">Dismissed</Pill>
  return <Pill tone="accent">Needs approval</Pill>
}

/** "Approved by Sarah Lindqvist, Nov 22, 3:14 PM". */
export function ApprovalStamp({ approval }: { approval?: Approval }) {
  if (!approval) return null
  return (
    <span className="text-xs text-muted">
      Approved by {approval.by}, {formatTimestamp(approval.at)}
    </span>
  )
}

/** Shown when the AI endpoint answered with an error (a refusal, a cut-off draft, a rate limit). */
export function AiErrorNote({ message }: { message?: string }) {
  if (!message) return null
  return (
    <div role="alert" className="rounded-lg border border-bad-line bg-bad-tint px-3 py-2 text-[13px] text-bad">
      <strong>No draft was produced.</strong> {message}
    </div>
  )
}

// ── Dates, progress, check marks ────────────────────────────────────────────

/** A calendar-style chip: month over day. The easiest thing to read in a row. */
export function DateChip({ date, tone = 'neutral' }: { date: ISODate; tone?: Tone }) {
  const d = parseISODate(date)
  return (
    <div className={cx('min-w-[60px] shrink-0 rounded-lg px-2 py-1.5 text-center', TONE[tone])}>
      <div className="text-[11px] font-semibold uppercase">{d.toLocaleDateString('en-US', { month: 'short' })}</div>
      <div className="text-xl font-bold leading-none">{d.getDate()}</div>
    </div>
  )
}

function Bar({ progress, status }: { progress: TaskProgress; status: StudentStatus }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <div role="img" aria-label={`${progress.done} of ${progress.total} tasks done`} className="h-2 overflow-hidden rounded-full bg-track">
      <div className={cx('h-2', STATUS_BAR[status])} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** "1/5 tasks" and a short status above a bar coloured by the student's status. */
export function ProgressWithCount({ progress, status, text, long = false }: { progress: TaskProgress; status: StudentStatus; text: string; long?: boolean }) {
  return (
    <div>
      <div className="mb-1.5 flex justify-between gap-2 text-[13px] font-semibold">
        <span>{long ? `${progress.done} of ${progress.total} done` : `${progress.done}/${progress.total} tasks`}</span>
        <span className={STATUS_TEXT[status]}>{text}</span>
      </div>
      <Bar progress={progress} status={status} />
    </div>
  )
}

const CHECK = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2.5 6.5l2.5 2.5 4.5-5" />
  </svg>
)

/**
 * A task's check mark. Hollow circle when open, filled green with a check when
 * done, red outline when late. A button when `onToggle` is given.
 */
export function CheckCircle({ done, late, label, onToggle }: { done: boolean; late?: boolean; label: string; onToggle?: () => void }) {
  const circle = (
    <span
      className={cx(
        'flex h-6 w-6 items-center justify-center rounded-full border-2 text-white',
        done ? 'border-good-bar bg-good-bar' : late ? 'border-bad-bar bg-surface' : 'border-line-strong bg-surface',
      )}
    >
      {done && CHECK}
    </span>
  )
  if (!onToggle) return <span className="flex h-6 w-6 shrink-0 items-center justify-center">{circle}</span>
  return (
    <button type="button" onClick={onToggle} aria-label={`${done ? 'Mark not done' : 'Mark done'}: ${label}`} aria-pressed={done} className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
      {circle}
    </button>
  )
}

// ── Tabs, segmented control, filter chips ───────────────────────────────────

/** Moves focus and selection with the arrow keys, Home and End. */
function arrowNav<T extends string>(e: KeyboardEvent, keys: T[], current: T, select: (key: T) => void) {
  const i = keys.indexOf(current)
  const next =
    e.key === 'ArrowRight' || e.key === 'ArrowDown'
      ? keys[(i + 1) % keys.length]
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        ? keys[(i - 1 + keys.length) % keys.length]
        : e.key === 'Home'
          ? keys[0]
          : e.key === 'End'
            ? keys.at(-1)
            : undefined
  if (next === undefined) return
  e.preventDefault()
  select(next)
  const group = e.currentTarget as HTMLElement
  requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-key="${next}"]`)?.focus())
}

export interface TabItem<T extends string = string> {
  key: T
  label: string
  count?: number
}

/** Reads the current tab from the URL (`?tab=`), falling back to the first. */
export function useTab<T extends string>(tabs: TabItem<T>[], param = 'tab'): T {
  const [params] = useSearchParams()
  const value = params.get(param) as T | null
  return value && tabs.some((t) => t.key === value) ? value : tabs[0].key
}

/** Tabs kept in the URL, so a link can point at one. Arrow keys move between them. */
export function Tabs<T extends string>({ tabs, param = 'tab', label }: { tabs: TabItem<T>[]; param?: string; label: string }) {
  const [params, setParams] = useSearchParams()
  const current = useTab(tabs, param)
  const select = (key: T) => {
    const next = new URLSearchParams(params)
    if (key === tabs[0].key) next.delete(param)
    else next.set(param, key)
    setParams(next, { replace: true })
  }
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line" onKeyDown={(e) => arrowNav(e, tabs.map((t) => t.key), current, select)}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          data-key={t.key}
          aria-selected={current === t.key}
          tabIndex={current === t.key ? 0 : -1}
          onClick={() => select(t.key)}
          className={cx(
            '-mb-px min-h-11 whitespace-nowrap border-b-2 px-3 text-sm',
            current === t.key ? 'border-accent font-semibold text-accent' : 'border-transparent font-medium text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="ml-1.5 rounded-full bg-accent-soft-2 px-1.5 text-xs font-semibold text-accent-hover">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** A small set of exclusive choices. Arrow keys move between them. */
export function SegmentedControl<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5" onKeyDown={(e) => arrowNav(e, options.map((o) => o.value), value, onChange)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          data-key={o.value}
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className={cx('min-h-10 rounded-md px-3 text-[13px] font-semibold', value === o.value ? 'bg-ink text-white' : 'text-ink-soft hover:bg-canvas')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Filter chips with counts. One is always selected. */
export function FilterChips<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string; count?: number }[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'min-h-11 rounded-full border px-4 text-[13px] font-semibold',
            value === o.value ? 'border-accent-line bg-accent-soft-2 text-accent-hover' : 'border-line-strong bg-surface text-ink-soft hover:bg-canvas',
          )}
        >
          {o.label}
          {o.count !== undefined && ` · ${o.count}`}
        </button>
      ))}
    </div>
  )
}

// ── Toast ───────────────────────────────────────────────────────────────────

const ToastContext = createContext<(message: string) => void>(() => {})

/** Call with a message to confirm what just happened. */
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([])
  const show = useCallback((message: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000)
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto max-w-md rounded-lg bg-ink px-4 py-3 text-sm font-medium text-white shadow-lg">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// ── Modal ───────────────────────────────────────────────────────────────────

/** A dialog for a form. Uses the native <dialog>, so focus is trapped and Escape closes it. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx('m-auto w-[calc(100%-2rem)] rounded-xl border border-line bg-surface p-0 text-ink shadow-xl', wide ? 'max-w-2xl' : 'max-w-lg')}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-lg font-bold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-lg text-xl text-muted hover:bg-canvas">
          ×
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  )
}

// ── AI helpers ──────────────────────────────────────────────────────────────

export function Thinking({ label = 'AI is drafting…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-3 text-sm font-medium text-accent">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      {label}
    </div>
  )
}

/**
 * Runs one of the async AI functions. Tracks whether it is in flight and keeps
 * the error message if it fails, for <AiErrorNote>.
 */
export function useAi(): { busy: boolean; error?: string; run: (work: () => Promise<void>) => Promise<void> } {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await work()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}
