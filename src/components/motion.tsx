// Movement that needs a little help from React: rows that leave a list, panels
// that open and close, a window that closes, the active marker, and the time
// left to undo. The timings and keyframes are all in src/index.css. Nothing
// here waits for an animation before it acts: a decision is made first and
// shown after, and every state is right if the animation never runs.

import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react'

const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

// ── What the device asks for ────────────────────────────────────────────────

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** True while the media query matches. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (changed) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', changed)
      return () => list.removeEventListener('change', changed)
    },
    () => window.matchMedia(query).matches,
  )
}

/** A laptop: the sidebar is beside the page. The same width as Tailwind's `lg`. */
export const useIsLaptop = () => useMediaQuery('(min-width: 64rem)')
/** Wide enough for a table. The same width as Tailwind's `md`. */
export const useIsWide = () => useMediaQuery('(min-width: 48rem)')

// ── Focus that is never lost ────────────────────────────────────────────────

const ROW = 'data-motion-row'

/** The page's heading, or the page: where focus goes when its place is gone. */
export function focusPage(): void {
  const target = document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('main')
  if (!target) return
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1
  target.focus({ preventScroll: true })
}

const usable = (el: Element | null | undefined): el is HTMLElement => el instanceof HTMLElement && el.isConnected && !el.closest('[inert]')

/** Focus goes back to `el`, or to the row after the one it was in, or to the row before, or to the page. */
export function focusNear(el: Element | null): void {
  if (usable(el) && el !== document.body && !el.matches(':disabled')) {
    el.focus({ preventScroll: true })
    if (document.activeElement === el) return
  }
  const row = el?.closest(`[${ROW}]`)
  for (const step of ['nextElementSibling', 'previousElementSibling'] as const) {
    for (let other = row?.[step]; other; other = other[step]) {
      if (other.hasAttribute(ROW) && usable(other)) {
        other.focus({ preventScroll: true })
        return
      }
    }
  }
  // The whole list is going: try the list it sits in, then the page.
  const outer = row?.parentElement?.closest(`[${ROW}]`)
  if (outer) focusNear(outer.hasAttribute('inert') ? outer : null)
  else focusPage()
}

// ── A list whose rows come and go ───────────────────────────────────────────

/** Kept a moment after it has left the data, so it can be seen to leave. Matches `row-out` in index.css. */
const LEAVE_MS = 340

interface Row {
  key: string
  el: ReactElement
  state: 'first' | 'enter' | 'leave'
}

/** The rows on screen: everything in `current`, in its order, with the rows that have just left still in their places. */
function mergeRows(rows: Row[], current: ReactElement[]): Row[] {
  const before = new Map(rows.map((r) => [r.key, r]))
  const keys = new Set(current.map((el) => String(el.key)))
  const next: Row[] = current.map((el) => {
    const was = before.get(String(el.key))
    return { key: String(el.key), el, state: was && was.state !== 'leave' ? was.state : 'enter' }
  })
  rows.forEach((row, i) => {
    if (keys.has(row.key)) return
    const prior = rows
      .slice(0, i)
      .reverse()
      .find((r) => next.some((n) => n.key === r.key))
    next.splice(prior ? next.findIndex((n) => n.key === prior.key) + 1 : 0, 0, { ...row, state: 'leave' })
  })
  return next
}

const sameRows = (a: Row[], b: Row[]) => a.length === b.length && a.every((r, i) => r.key === b[i].key && r.el === b[i].el && r.state === b[i].state)

const LeavingContext = createContext(false)

/** True inside a row that has left the data and is on its way off the screen. */
export const useLeaving = () => useContext(LeavingContext)

/**
 * A list whose rows move in and out, with the rows around them closing the gap.
 * Give it keyed children. A row that leaves cannot be pressed or read again,
 * and if it held focus, focus moves to the row after it. `stagger` brings the
 * first rows in one after another, up to eight.
 */
export function MotionList({
  as: Tag = 'ul',
  children,
  className,
  itemClassName,
  stagger = false,
  label,
}: {
  as?: 'ul' | 'ol' | 'div'
  children: ReactNode
  className?: string
  itemClassName?: string
  stagger?: boolean
  label?: string
}) {
  // Not Children.toArray: it copies each element, and rows are told apart by identity below.
  const current: ReactElement[] = []
  Children.forEach(children, (c) => {
    if (isValidElement(c)) current.push(c)
  })
  const [rows, setRows] = useState<Row[]>(() => current.map((el) => ({ key: String(el.key), el, state: 'first' })))
  const merged = mergeRows(rows, current)
  if (!sameRows(rows, merged)) setRows(merged)

  // A list inside a row that is leaving is leaving too.
  const outer = useLeaving()
  const list = useRef<HTMLElement>(null)
  const focused = useRef<string>(undefined)
  const leaving = merged
    .filter((r) => r.state === 'leave')
    .map((r) => r.key)
    .join('\n')

  useLayoutEffect(() => {
    if (!leaving || !focused.current || !leaving.split('\n').includes(focused.current)) return
    const row = [...(list.current?.children ?? [])].find((el) => el.getAttribute(ROW) === focused.current)
    const active = document.activeElement
    // Someone who has already moved on is left where they are.
    if (!row || (active && active !== document.body && !row.contains(active))) return
    focused.current = undefined
    focusNear(row)
  }, [leaving])

  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setRows((all) => all.filter((r) => r.state !== 'leave')), reducedMotion() ? 0 : LEAVE_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  const Item = Tag === 'div' ? 'div' : 'li'
  const body = merged.map((row, i) => {
    const gone = row.state === 'leave'
    return (
      <Item
        key={row.key}
        {...{ [ROW]: row.key }}
        tabIndex={-1}
        inert={gone}
        aria-hidden={gone || undefined}
        data-state={row.state === 'first' ? (stagger ? 'first' : undefined) : row.state}
        style={{ '--row': Math.min(i, 8) } as CSSProperties}
        className={join('motion-row focus:outline-none', itemClassName)}
        onFocus={() => {
          focused.current = row.key
        }}
      >
        <div className="motion-row-body">
          <LeavingContext.Provider value={gone || outer}>{row.el}</LeavingContext.Provider>
        </div>
      </Item>
    )
  })
  return (
    <Tag ref={list as RefObject<never>} className={className} aria-label={label}>
      {body}
    </Tag>
  )
}

// ── Open and close ──────────────────────────────────────────────────────────

/** Content that opens and closes by height without measuring it. Closed, it cannot be reached. */
export function Reveal({ open, id, children, className }: { open: boolean; id?: string; children: ReactNode; className?: string }) {
  return (
    <div id={id} className="motion-reveal" data-open={open} inert={!open}>
      <div className={join('motion-reveal-body', className)}>{children}</div>
    </div>
  )
}

/** Open or closed, for a button and the Reveal it controls. */
export function useReveal(start = false) {
  const [open, setOpen] = useState(start)
  const id = useId()
  return { open, setOpen, id, button: { 'aria-expanded': open, 'aria-controls': id, onClick: () => setOpen(!open) } }
}

// ── A window that has closed ────────────────────────────────────────────────

/** A picture of `el` as it was, fading out. Nothing in it can be pressed, focused or read. Returns what puts it on the page. */
export function ghostOf(el: HTMLElement): () => void {
  const ghost = el.cloneNode(true) as HTMLElement
  // A copy does not carry what was typed, and must not load anything again.
  const typed = el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input:not([type=file]), textarea, select')
  ghost.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input:not([type=file]), textarea, select').forEach((field, i) => {
    field.value = typed[i]?.value ?? ''
    if (field instanceof HTMLInputElement && typed[i] instanceof HTMLInputElement) field.checked = typed[i].checked
  })
  ghost.querySelectorAll('iframe').forEach((frame) => frame.remove())
  ghost.querySelectorAll('[id]').forEach((part) => part.removeAttribute('id'))
  ghost.querySelectorAll('[autofocus]').forEach((part) => part.removeAttribute('autofocus'))
  const box = el.getBoundingClientRect()
  const shade = document.createElement('div')
  return () => {
    const wrap = document.createElement('div')
    wrap.setAttribute('aria-hidden', 'true')
    wrap.inert = true
    wrap.className = 'motion-ghost'
    shade.className = 'motion-ghost-shade'
    const panel = document.createElement('div')
    panel.className = `${ghost.className} motion-ghost-panel`
    panel.style.cssText = `top:${box.top}px;left:${box.left}px;width:${box.width}px;height:${box.height}px`
    panel.append(...ghost.childNodes)
    wrap.append(shade, panel)
    document.body.append(wrap)
    setTimeout(() => wrap.remove(), 160)
  }
}

// ── The active marker ───────────────────────────────────────────────────────

/**
 * Where the marked item is inside `box`, as a transform for one marker that
 * moves between items. Undefined until it has been measured, or when nothing is
 * marked. `current` is anything that changes when the marked item does.
 */
export function useMarker(box: RefObject<HTMLElement | null>, selector: string, current: unknown): { x: number; y: number; width: number; height: number } | undefined {
  const [at, setAt] = useState<{ x: number; y: number; width: number; height: number }>()
  useLayoutEffect(() => {
    const measure = () => {
      const el = box.current?.querySelector<HTMLElement>(selector)
      const next = el && el.offsetWidth > 0 ? { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight } : undefined
      setAt((was) => (was && next && was.x === next.x && was.y === next.y && was.width === next.width && was.height === next.height ? was : next))
    }
    measure()
    const watch = new ResizeObserver(measure)
    if (box.current) watch.observe(box.current)
    return () => watch.disconnect()
  }, [box, selector, current])
  return at
}

// ── Numbers and time ────────────────────────────────────────────────────────

/** A count that settles into a new value instead of jumping. */
export function Count({ value, className, label }: { value: number; className?: string; label?: string }) {
  const [first] = useState(value)
  return (
    <span key={value} className={join('nums', value !== first && 'motion-count', className)} aria-label={label}>
      {value}
    </span>
  )
}

/** The time left before something happens, as a bar that empties. Decorative: the seconds are beside it in words. */
export function TimeLeft({ from, until, className }: { from: string; until: string; className?: string }) {
  // Worked out once for each pair of times: the bar then runs by itself.
  const [start] = useState(() => Date.now())
  const end = Date.parse(until)
  const total = Math.max(1, end - Date.parse(from))
  const left = Math.max(0, end - start)
  return (
    <span key={`${from}${until}`} aria-hidden className={join('motion-time-left-track', className)}>
      <span className="motion-time-left" style={{ '--left': Math.min(1, left / total), animationDuration: `${left}ms` } as CSSProperties} />
    </span>
  )
}
