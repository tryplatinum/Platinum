// Shared UI pieces. Screens compose these instead of styling from scratch, so
// the look stays consistent. Colours come from the tokens in index.css.

import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { StudentStatus } from '../lib/derive'
import type { OwnerType, Review } from '../types'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// ── Layout ──────────────────────────────────────────────────────────────────

export function Card({
  title,
  action,
  children,
  className,
  tone,
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  /** 'ai' tints the card to mark AI-drafted content. */
  tone?: 'ai'
}) {
  return (
    <section
      className={cx(
        'rounded-xl border bg-surface',
        tone === 'ai' ? 'border-ai/25' : 'border-line',
        className,
      )}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  back?: { to: string; label: string }
  actions?: ReactNode
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link to={back.to} className="mb-2 inline-block text-sm text-muted hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-muted">{children}</p>
}

// ── Buttons and form controls ───────────────────────────────────────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'approve'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
        variant === 'primary' && 'bg-ink text-white hover:bg-black',
        variant === 'approve' && 'bg-good text-white hover:brightness-95',
        variant === 'secondary' && 'border border-line bg-surface text-ink hover:bg-canvas',
        variant === 'ghost' && 'text-muted hover:bg-canvas hover:text-ink',
        className,
      )}
    />
  )
}

export const inputClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none'

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  )
}

// ── Pills and badges ────────────────────────────────────────────────────────

type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'ai' | 'accent'

const TONE: Record<Tone, string> = {
  good: 'bg-good-soft text-good',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info',
  neutral: 'bg-canvas text-muted',
  ai: 'bg-ai-soft text-ai',
  accent: 'bg-accent-soft text-accent',
}

export function Pill({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', TONE[tone], className)}>
      {children}
    </span>
  )
}

const STATUS: Record<StudentStatus, { label: string; tone: Tone; dot: string }> = {
  behind: { label: 'Behind', tone: 'bad', dot: 'bg-bad' },
  slipping: { label: 'Slipping', tone: 'warn', dot: 'bg-warn' },
  on_track: { label: 'On track', tone: 'good', dot: 'bg-good' },
  new: { label: 'Just onboarded', tone: 'info', dot: 'bg-info' },
}

/** How a student is doing. The status itself comes from lib/derive.ts. */
export function StatusPill({ status }: { status: StudentStatus }) {
  const s = STATUS[status]
  return (
    <Pill tone={s.tone}>
      <span className={cx('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </Pill>
  )
}

const OWNER_TONE: Record<OwnerType, Tone> = { student: 'accent', parent: 'warn', counselor: 'neutral' }

/** Who owns a task. Pass the label from derive.ownerLabel(). */
export function OwnerBadge({ owner, label }: { owner: OwnerType; label: string }) {
  return <Pill tone={OWNER_TONE[owner]}>{label}</Pill>
}

/** Marks anything the AI wrote. */
export function AiBadge({ children = 'AI draft' }: { children?: ReactNode }) {
  return <Pill tone="ai">✦ {children}</Pill>
}

/** The review state of an AI draft. */
export function ReviewTag({ review, approvedLabel = 'Approved' }: { review: Review; approvedLabel?: string }) {
  if (review === 'approved') return <Pill tone="good">✓ {approvedLabel}</Pill>
  if (review === 'dismissed') return <Pill tone="neutral">Dismissed</Pill>
  return <Pill tone="warn">Needs your approval</Pill>
}

/** The standing promise, shown wherever AI output appears. */
export function ApprovalNotice({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-ai-soft px-3 py-2 text-sm text-ai">
      <span aria-hidden>🔒</span>
      <span>{children ?? 'AI drafts stay here until you approve them. Nothing reaches a student or a parent without your approval.'}</span>
    </div>
  )
}

// ── Progress ────────────────────────────────────────────────────────────────

/** Done / open / late as one bar, so progress reads at a glance. */
export function ProgressBar({ done, late, total }: { done: number; late: number; total: number }) {
  if (total === 0) return <div className="h-1.5 w-full rounded-full bg-canvas" />
  const pct = (n: number) => `${(n / total) * 100}%`
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-line" title={`${done} of ${total} done, ${late} late`}>
      <div className="bg-good" style={{ width: pct(done) }} />
      <div className="bg-bad" style={{ width: pct(late) }} />
    </div>
  )
}

export function Thinking({ label = 'AI is drafting…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-6 text-sm text-ai">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-ai border-t-transparent" />
      {label}
    </div>
  )
}

/** Runs one of the async AI functions and tracks whether it is in flight. */
export function useBusy(): [boolean, <T>(work: () => Promise<T>) => Promise<T>] {
  const [busy, setBusy] = useState(false)
  const run = async <T,>(work: () => Promise<T>) => {
    setBusy(true)
    try {
      return await work()
    } finally {
      setBusy(false)
    }
  }
  return [busy, run]
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent',
        size === 'sm' ? 'h-7 w-7 text-xs' : size === 'lg' ? 'h-12 w-12 text-base' : 'h-9 w-9 text-sm',
      )}
    >
      {initials}
    </span>
  )
}
