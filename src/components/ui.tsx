// Shared UI pieces. Screens compose these instead of styling from scratch; the
// README's "Design system" section has the rules. Sizes: page title 28, section
// title 18, card title 16 (all Manrope 600), body 14, secondary 13, labels 12.
// Every click target is at least 44px high. Status is always shown with words,
// never by colour alone. /app/styleguide renders everything here in each state.

import { ChevronRight, Inbox, LoaderCircle, Send, X, type LucideIcon } from 'lucide-react'
import { notify, onNotify, type Notice } from '../lib/notify'
import { messageStatusLabel } from '../lib/delivery'
import { runDispatch } from '../services/dispatch'
import { useStore } from '../store/store'
import { undoReminderSkip } from '../data/repo'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { Link, useSearchParams, type LinkProps } from 'react-router-dom'
import { formatTimestamp, parseISODate, type ISODate } from '../lib/dates'
import type { StudentStatus, TaskProgress } from '../lib/derive'
import type { AiSource, Approval, OwnerType, Review } from '../types'
import { PRODUCT_NAME } from '../brand'
import { Spark } from './Logo'
import { Count, Reveal, TimeLeft, focusNear, ghostOf, reducedMotion, useMarker, useReveal } from './motion'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// ── Layout ──────────────────────────────────────────────────────────────────

/** A bordered panel. No shadow: shadows are for things that float. `accent` is the AI panel. */
export function Card({ children, className, tone }: { children: ReactNode; className?: string; tone?: 'accent' | 'bad' }) {
  const arrived = useAiArrival() && tone === 'accent'
  return (
    <section
      className={cx(
        'rounded-card border',
        arrived && 'motion-fade',
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
        <h2 className={size === 'section' ? 'text-lg font-semibold' : 'text-base font-semibold'}>
          {title}
          {count !== undefined && <span className="nums ml-1.5 font-sans font-medium text-ink-soft">· {count}</span>}
        </h2>
        {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}

/** Names the browser tab: "Inbox · Platinum". */
export function usePageTitle(name: string): void {
  useEffect(() => {
    document.title = `${name} · ${PRODUCT_NAME}`
  }, [name])
}

export function PageHeader({ title, above, sub, pill, actions }: { title: ReactNode; above?: ReactNode; sub?: ReactNode; pill?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {above && <p className="mb-1 text-[13px] text-muted">{above}</p>}
        <div className="flex flex-wrap items-center gap-3">
          {/* Focus lands here when the page changes, so a screen reader says where it is. */}
          <h1 tabIndex={-1} className="text-[28px] font-semibold leading-tight tracking-tight focus:outline-none">
            {title}
          </h1>
          {pill}
        </div>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto">{actions}</div>}
    </header>
  )
}

/** Small caps-style label: 12px semibold, muted. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('text-xs font-semibold uppercase tracking-wide text-muted', className)}>{children}</div>
}

/** An empty list, with the action that fills it. */
export function Empty({ title, children, icon: Icon = Inbox }: { title: ReactNode; children?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
      <Icon size={20} strokeWidth={1.75} className="text-muted" aria-hidden />
      <p className="text-sm text-muted">{title}</p>
      {children}
    </div>
  )
}

/** A quiet shape where content is on its way. Give it the size of what will arrive, so nothing moves. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx('motion-skeleton block rounded-control bg-chip', className)} />
}

/** A short notice inside a card or above a list. */
export function Note({ tone = 'neutral', role, className, children }: { tone?: 'neutral' | 'accent' | 'warn' | 'bad'; role?: 'alert' | 'status' | 'note'; className?: string; children: ReactNode }) {
  const look = {
    neutral: 'bg-canvas text-ink-soft',
    accent: 'border border-accent-line bg-accent-soft text-ink-soft',
    warn: 'bg-warn-soft text-warn',
    bad: 'border border-bad-line bg-bad-tint text-bad',
  }[tone]
  return (
    <div role={role} className={cx('rounded-control px-3 py-2 text-[13px]', look, className)}>
      {children}
    </div>
  )
}

// ── Buttons and form controls ───────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'remind' | 'quiet' | 'danger'

const BUTTON_BASE = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm font-semibold transition-[color,background-color,border-color,opacity,transform] disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50'
const BUTTON_VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'border border-line-strong bg-surface text-heading hover:bg-surface-2',
  remind: 'border border-accent bg-surface text-accent hover:bg-accent-soft',
  quiet: 'text-accent hover:bg-accent-soft',
  danger: 'border border-bad bg-surface text-bad hover:bg-bad-tint',
}

/**
 * `busy` is for a button waiting on the server: it turns a small ring beside
 * the label and cannot be pressed again. The button keeps its place and focus.
 */
export function Button({ variant = 'secondary', className, busy, disabled, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled && !busy}
      // Not `disabled` while it works: that would drop the focus it has.
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={busy ? (e) => e.preventDefault() : rest.onClick}
      className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], className)}
    >
      {busy && <LoaderCircle size={16} strokeWidth={1.75} className="motion-spin shrink-0" aria-hidden />}
      {children}
    </button>
  )
}

/** The label of a button that sends something: never shown on one that does not. */
export function SendLabel({ children }: { children: ReactNode }) {
  return (
    <>
      <Send size={20} strokeWidth={1.75} className="shrink-0" aria-hidden />
      <span>{children}</span>
    </>
  )
}

/** A link that looks like a button. */
export function LinkButton({ variant = 'secondary', className, ...rest }: LinkProps & { variant?: Variant }) {
  return <Link {...rest} data-press className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], className)} />
}

/** Input styling without a width. Focus shows a 2px accent ring and the border changes with it. */
export const inputBase =
  'min-h-11 rounded-control border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent disabled:bg-surface-2'
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

/** A checkbox whose whole row can be pressed: at least 44px tall, with the box at 20. */
export function CheckRow({
  checked,
  onChange,
  disabled,
  children,
  hint,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  children: ReactNode
  hint?: ReactNode
  className?: string
}) {
  return (
    <label className={cx('check-row text-sm', className)}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        {children}
        {hint && <span className="block text-[13px] text-muted">{hint}</span>}
      </span>
    </label>
  )
}

/** A heading that opens and closes what is under it. Everything in it is a real button. */
export function Disclosure({ label, children, start = false, className, count }: { label: ReactNode; children: ReactNode; start?: boolean; className?: string; count?: number }) {
  const reveal = useReveal(start)
  return (
    <div className={className}>
      <button type="button" {...reveal.button} className="flex min-h-11 items-center gap-1.5 rounded-control text-[13px] font-semibold text-accent">
        <ChevronRight size={16} strokeWidth={1.75} className="motion-chevron shrink-0" aria-hidden />
        {label}
        {count !== undefined && ` · ${count}`}
      </button>
      <Reveal open={reveal.open} id={reveal.id}>
        {children}
      </Reveal>
    </div>
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
  return (
    <Pill tone="accent" className="pl-1">
      <AiSpark />
      {children ?? (source ? `AI draft · ${source.model}` : 'AI draft')}
    </Pill>
  )
}

/** The spark beside an AI tag. It turns once when the draft has just arrived, and is still otherwise. */
function AiSpark() {
  return <Spark size={14} motion={useAiArrival() ? 'turn' : undefined} />
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
  // Fades in when a draft is approved while it is on screen, not for drafts approved earlier.
  const first = useRef(review)
  if (review === 'approved') return <Pill tone="good" className={first.current !== 'approved' ? 'motion-fade' : undefined}>{approvedLabel}</Pill>
  if (review === 'dismissed') return <Pill tone="neutral">Discarded</Pill>
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
    <div className={cx('nums min-w-[60px] shrink-0 rounded-control px-2 py-1.5 text-center', TONE[tone])}>
      <div className="text-xs font-semibold uppercase">{d.toLocaleDateString('en-US', { month: 'short' })}</div>
      <div className="text-xl font-semibold leading-none">{d.getDate()}</div>
    </div>
  )
}

/** The moving part of a progress bar. `value` is 0 to 1. */
function Fill({ value, className }: { value: number; className: string }) {
  return <div className={cx('motion-progress h-2 w-full', className)} style={{ transform: `scaleX(${Math.min(1, Math.max(0, value))})` }} />
}

/** How far something that takes a while has got. `done` of `total`, or 0 to 1 when `total` is left out. */
export function ProgressBar({ label, done, total = 1, className }: { label: string; done: number; total?: number; className?: string }) {
  const value = total ? done / total : 0
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} className={cx('h-2 overflow-hidden rounded-full bg-track', className)}>
      <Fill value={value} className="bg-accent" />
    </div>
  )
}

function Bar({ progress, status }: { progress: TaskProgress; status: StudentStatus }) {
  return (
    <div role="img" aria-label={`${progress.done} of ${progress.total} tasks done`} className="h-2 overflow-hidden rounded-full bg-track">
      <Fill value={progress.total ? progress.done / progress.total : 0} className={STATUS_BAR[status]} />
    </div>
  )
}

/** "1/5 tasks" and a short status above a bar coloured by the student's status. */
export function ProgressWithCount({ progress, status, text, long = false }: { progress: TaskProgress; status: StudentStatus; text: string; long?: boolean }) {
  return (
    <div>
      <div className="nums mb-1.5 flex justify-between gap-2 text-[13px] font-semibold">
        <span>{long ? `${progress.done} of ${progress.total} done` : `${progress.done}/${progress.total} tasks`}</span>
        <span className={STATUS_TEXT[status]}>{text}</span>
      </div>
      <Bar progress={progress} status={status} />
    </div>
  )
}

/** The check mark is always there, and is drawn (see `motion-check`) when the task is ticked. */
const check = (done: boolean) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path className="motion-check" data-done={done} d="M2.5 6.5l2.5 2.5 4.5-5" />
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
        'flex h-6 w-6 items-center justify-center rounded-full border-2 text-surface',
        done ? 'border-good-bar bg-good-bar' : late ? 'border-bad-bar bg-surface' : 'border-line-strong bg-surface',
      )}
    >
      {check(done)}
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
  const list = useRef<HTMLDivElement>(null)
  const marker = useMarker(list, '[aria-selected="true"]', current)
  // On a phone the chosen tab can be past the edge: bring it into the row, without moving the page.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    const box = list.current
    if (el && box && (el.offsetLeft < box.scrollLeft || el.offsetLeft + el.offsetWidth > box.scrollLeft + box.clientWidth)) box.scrollLeft = el.offsetLeft - 16
  }, [current])
  return (
    <div ref={list} role="tablist" aria-label={label} className="relative flex gap-1 overflow-x-auto border-b border-line" onKeyDown={(e) => arrowNav(e, tabs.map((t) => t.key), current, select)}>
      {marker && <span aria-hidden className="motion-marker absolute bottom-0 left-0 h-0.5 w-px bg-accent" style={{ transform: `translateX(${marker.x}px) scaleX(${marker.width})` }} />}
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
            'min-h-11 shrink-0 whitespace-nowrap px-3 text-sm',
            current === t.key ? 'font-semibold text-accent' : 'font-medium text-muted hover:text-heading',
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <Count value={t.count} className="ml-1.5 inline-block rounded-full bg-accent-soft-2 px-1.5 text-xs font-semibold text-accent-hover" />}
        </button>
      ))}
    </div>
  )
}

/** What a tab shows. It cross-fades when the tab changes. */
export function TabPanel({ tab, label, children }: { tab: string; label: string; children: ReactNode }) {
  return (
    <div key={tab} role="tabpanel" aria-label={label} className="motion-page flex min-w-0 flex-col gap-6">
      {children}
    </div>
  )
}

/** A small set of exclusive choices. Arrow keys move between them. */
export function SegmentedControl<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-control border border-line-strong bg-surface p-0.5" onKeyDown={(e) => arrowNav(e, options.map((o) => o.value), value, onChange)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          data-key={o.value}
          aria-checked={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className={cx('min-h-11 rounded-md px-3 text-[13px] font-semibold', value === o.value ? 'bg-primary text-on-primary' : 'text-ink-soft hover:bg-surface-2')}
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
            'nums min-h-11 rounded-control border px-3 text-[13px] font-semibold',
            value === o.value ? 'border-accent bg-accent-soft-2 text-accent-hover' : 'border-line-strong bg-surface text-ink-soft hover:bg-surface-2',
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

const TOAST = 'pointer-events-auto flex max-w-md items-center gap-3 rounded-control bg-primary px-4 py-3 text-sm font-medium text-on-primary shadow-float'

function QueueToast({ messageId, sendAfter, onClose }: { messageId: string; sendAfter: string; onClose: () => void }) {
  const [now, setNow] = useState(Date.now())
  const [opened] = useState(() => new Date().toISOString())
  const [busy, setBusy] = useState(false)
  const [dispatched, setDispatched] = useState(false)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const open = Date.parse(sendAfter) > now
  // Undone somewhere else, on the approval card.
  const cancelled = useStore((s) => s.data.outbox.some((m) => m.id === messageId && m.status === 'cancelled'))
  useEffect(() => {
    if (cancelled) onClose()
  }, [cancelled]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open || dispatched || cancelled) return
    setDispatched(true)
    void runDispatch()
  }, [open, dispatched, cancelled])
  // On a channel that is not connected, the toast says it was approved to send by hand, never that it is being sent.
  const channel = useStore((s) => s.data.outbox.find((m) => m.id === messageId)?.channel) ?? 'text'
  const label = messageStatusLabel({ channel, status: 'queued', sendAfter }, now)
  return (
    <>
      <span className="flex flex-col gap-1">
        <span className="nums">{label}</span>
        {open && <TimeLeft from={opened} until={sendAfter} className="opacity-60" />}
      </span>
      {open && (
        <button
          type="button"
          disabled={busy}
          className="min-h-11 rounded-control bg-surface px-3 font-semibold text-ink"
          onClick={() => {
            setBusy(true)
            void useStore
              .getState()
              .cancelQueued(messageId)
              .then(onClose)
              .catch((error: unknown) => {
                setBusy(false)
                notify(error instanceof Error ? error.message : 'Could not undo the message.')
              })
          }}
        >
          Undo
        </button>
      )}
    </>
  )
}

/** How long a closed toast is kept to be seen leaving. */
const TOAST_LEAVE_MS = 120

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<({ id: number; leaving?: boolean } & Notice)[]>([])
  const close = useCallback((id: number) => {
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), reducedMotion() ? 0 : TOAST_LEAVE_MS)
  }, [])
  const show = useCallback(
    (message: string) => {
      const id = Date.now() + Math.random()
      setToasts((t) => [...t, { id, kind: 'text', message }])
      setTimeout(() => close(id), 6000)
    },
    [close],
  )
  const push = useCallback(
    (notice: Notice) => {
      if (notice.kind === 'text') {
        show(notice.message)
        return
      }
      const id = Date.now() + Math.random()
      setToasts((t) => [...t, { id, ...notice }])
      setTimeout(() => close(id), notice.kind === 'queue' ? Math.max(1000, Date.parse(notice.sendAfter) - Date.now() + 1500) : 10_000)
    },
    [show, close],
  )
  // The store reports failed saves and queued messages through lib/notify.
  useEffect(() => onNotify(push), [push])
  return (
    <ToastContext.Provider value={show}>
      <ConfirmProvider>{children}</ConfirmProvider>
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 pb-[env(safe-area-inset-bottom)]">
        {toasts.map((t) => (
          <div key={t.id} inert={t.leaving} className={cx(TOAST, t.leaving ? 'motion-toast-out' : 'motion-toast')}>
            {t.kind === 'text' ? (
              t.message
            ) : t.kind === 'skip_undo' ? (
              <SkipUndoToast skipId={t.skipId} message={t.message} onClose={() => close(t.id)} />
            ) : (
              <QueueToast messageId={t.messageId} sendAfter={t.sendAfter} onClose={() => close(t.id)} />
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function SkipUndoToast({ skipId, message, onClose }: { skipId: string; message: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <>
      <span>{message}</span>
      <button
        type="button"
        disabled={busy}
        className="min-h-11 rounded-control bg-surface px-3 font-semibold text-ink"
        onClick={() => {
          setBusy(true)
          void undoReminderSkip(skipId)
            .then(() => {
              useStore.setState((s) => ({ data: { ...s.data, reminderSkips: s.data.reminderSkips.filter((x) => x.id !== skipId) } }))
              onClose()
            })
            .catch((error: unknown) => {
              setBusy(false)
              notify(error instanceof Error ? error.message : 'Could not undo the skip.')
            })
        }}
      >
        Undo skip
      </button>
    </>
  )
}

// ── Modal ───────────────────────────────────────────────────────────────────

/**
 * A dialog for a form. Uses the native <dialog>, so focus is trapped and Escape
 * closes it. Focus starts on the element marked `data-autofocus`, and goes back
 * to what opened the dialog, or near it if that is gone. With `typed`, a press
 * outside does not close it, so what has been typed is not lost by a slip.
 */
export function Modal({ title, onClose, children, wide, typed, describedBy }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; typed?: boolean; describedBy?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const opener = useRef<Element>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog || dialog.open) return
    opener.current ??= document.activeElement
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [])
  useLayoutEffect(() => {
    const dialog = ref.current
    return () => {
      if (!dialog?.open) return
      const leave = reducedMotion() ? undefined : ghostOf(dialog)
      // After the dialog is really gone. In development React runs this once more while it is still there.
      queueMicrotask(() => {
        if (dialog.isConnected) return
        leave?.()
        if (!document.activeElement || document.activeElement === document.body) focusNear(opener.current)
      })
    }
  }, [])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Closed by whoever opened it, like every other way out.
      onCancel={(e) => {
        if (e.target !== ref.current) return
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => e.target === ref.current && !typed && onClose()}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      className={cx('m-auto w-[calc(100%-2rem)] rounded-modal border border-line bg-surface p-0 text-ink shadow-float', wide ? 'max-w-2xl' : 'max-w-lg')}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 id={titleId} className="min-w-0 text-lg font-semibold">
          {title}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted hover:bg-surface-2 hover:text-heading">
          <X size={20} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  )
}

// ── Asking before something is lost ─────────────────────────────────────────

export interface ConfirmRequest {
  title: string
  /** What is lost, in words. */
  body: string
  /** The button: the action itself, such as "Delete file". */
  action: string
  /** A word that has to be typed first, and what is said when it is not right. */
  word?: string
  wrongWord?: string
}

/** Cancel has the focus, so pressing Enter by habit changes nothing. */
export function ConfirmDialog({ title, body, action, word, wrongWord, onAnswer }: ConfirmRequest & { onAnswer: (yes: boolean) => void }) {
  const [typed, setTyped] = useState('')
  const [wrong, setWrong] = useState(false)
  const bodyId = useId()
  const ready = !word || typed.trim() === word
  return (
    <Modal title={title} describedBy={bodyId} onClose={() => onAnswer(false)}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onAnswer(true)
        }}
      >
        <p id={bodyId} className="text-sm leading-relaxed text-ink-soft">
          {body}
        </p>
        {word && (
          <Field label={`Type ${word} to confirm.`}>
            <input
              className={inputClass}
              value={typed}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={wrong && !ready}
              onChange={(e) => {
                setTyped(e.target.value)
                setWrong(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !ready) setWrong(true)
              }}
            />
          </Field>
        )}
        {wrong && !ready && (
          <p role="alert" className="text-[13px] text-bad">
            {wrongWord}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button data-autofocus onClick={() => onAnswer(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={!ready}>
            {action}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

const ConfirmContext = createContext<(request: ConfirmRequest) => Promise<boolean>>(() => Promise.resolve(false))

/** Asks, and resolves to true when the person says yes: `if (!(await confirm({ … }))) return`. */
export const useConfirm = () => useContext(ConfirmContext)

function ConfirmProvider({ children }: { children: ReactNode }) {
  const [asking, setAsking] = useState<ConfirmRequest & { answer: (yes: boolean) => void }>()
  const confirm = useCallback((request: ConfirmRequest) => new Promise<boolean>((answer) => setAsking({ ...request, answer })), [])
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {asking && (
        <ConfirmDialog
          {...asking}
          onAnswer={(yes) => {
            asking.answer(yes)
            setAsking(undefined)
          }}
        />
      )}
    </ConfirmContext.Provider>
  )
}

// ── AI helpers ──────────────────────────────────────────────────────────────

/** When the AI last finished. A draft that appears just after this has "arrived". */
let aiFinishedAt = 0
const ARRIVAL_MS = 1500

/**
 * True for a piece mounted just after the AI finished: the panel fades in and
 * the spark turns once. A draft that was already there when the page opened
 * does not animate.
 */
function useAiArrival(): boolean {
  const [arrived, setArrived] = useState(false)
  useLayoutEffect(() => {
    if (Date.now() - aiFinishedAt < ARRIVAL_MS) setArrived(true)
  }, [])
  return arrived
}

/**
 * Shown while the AI works: the spark pulsing slowly, and what it is doing in
 * words. `inline` is the small version for a line inside a row.
 */
export function Thinking({ label = 'AI is drafting…', inline }: { label?: string; inline?: boolean }) {
  useLayoutEffect(
    () => () => {
      aiFinishedAt = Date.now()
    },
    [],
  )
  return (
    <div role="status" className={cx('flex items-center gap-2 font-medium text-accent', inline ? 'text-[13px]' : 'py-3 text-sm')}>
      <Spark size={inline ? 14 : 16} motion="pulse" />
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
      aiFinishedAt = Date.now()
      setBusy(false)
    }
  }
  return { busy, error, run }
}
