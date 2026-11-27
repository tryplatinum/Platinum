// The landing page: one meeting, followed down the page.
//
// A single invented student's meeting notes appear in the hero and stay on
// screen while the visitor scrolls. Each chapter changes that page of notes and
// has one thing of its own to try, and every one of those shows something the
// product really does: the 10-second Undo, where a draft line came from, the
// student's page, a parent update in three languages, the three AI rules.
//
// This file and the two beside it import nothing from the workspace: no store,
// no Supabase client, no router. It is its own chunk. Scrolling is the
// browser's own; `useStory` only reads the scroll position and writes it into
// custom properties and data attributes that landing.css turns into motion.
//
// No analytics, no third-party script, no cookie. The early access form sends
// nothing yet (src/services/earlyAccess.ts) and says so.

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { LOGO_FULL, PRODUCT_NAME } from '../brand'
import { checkEarlyAccess, requestEarlyAccess, type EarlyAccessRequest } from '../services/earlyAccess'
import { Workspace } from './Workspace'
import './landing.css'
import { CHAPTERS, DRAFTS, FACTS, LANG_LABEL, NOTES, NOTES_PASTED, OUTCOMES, UNDO_SECONDS, UPDATE, updateText, type ChapterId, type Lang, type PhraseId } from './story'

// ── Small pieces ────────────────────────────────────────────────────────────

/** The four-point star from the logo, drawn here so it can sit on anything and scale. Always decorative. */
export function Spark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <circle cx="12" cy="12" r="12" fill="#11284b" />
      <path d="M12 3.5c.7 4.6 3.4 7.3 8.5 8.5-5.1 1.200-7.8 3.900-8.500 8.500-.7-4.600-3.400-7.300-8.500-8.500 5.100-1.200 7.800-3.900 8.500-8.500z" fill="#f9f8f6" />
    </svg>
  )
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return matches
}

/** Scrolls to a chapter. Native scrolling, smooth unless the visitor asked for less motion. */
function goTo(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
}

function Anchor({ to, className, children }: { to: ChapterId; className?: string; children: ReactNode }) {
  return (
    <a
      href={`#${to}`}
      className={className}
      onClick={(e) => {
        e.preventDefault()
        goTo(to)
      }}
    >
      {children}
    </a>
  )
}

// ── The story: where the visitor is, as numbers the page can draw from ──────

interface Story {
  chapter: ChapterId
  /** How far each scene has played: 0 at its start, up to its number of steps. */
  step: Record<ChapterId, number>
  /** The phrase in the notes, or the fact in the update, being pointed at right now. */
  hot?: string
  setHot: (id: string | undefined, from?: Element | null) => void
  /** The gate in "AI rules": the parent update waits there until it is approved. */
  gate: Hold
}

const StoryContext = createContext<Story | undefined>(undefined)
const useStoryState = () => useContext(StoryContext)!

const NO_STEPS = Object.fromEntries(CHAPTERS.map((c) => [c.id, 0])) as Record<ChapterId, number>

/**
 * Reads the scroll position, at most once a frame, and writes it down:
 * `--page` on the root for the thread, `--p` and `data-step` on each chapter.
 * Scenes are CSS reading those, so they play backwards when scrolled back and
 * are right wherever the page is opened. With reduced motion every scene is
 * held at its end, and only which chapter is on screen is followed.
 */
function useStory(root: RefObject<HTMLDivElement | null>): Pick<Story, 'chapter' | 'step'> {
  const [chapter, setChapter] = useState<ChapterId>('top')
  const [step, setStep] = useState(NO_STEPS)

  useEffect(() => {
    const el = root.current
    if (!el) return
    const sections = [...el.querySelectorAll<HTMLElement>('[data-chapter]')]
    const still = reducedMotion()
    let frame = 0

    const measure = () => {
      frame = 0
      const vh = window.innerHeight
      const room = document.documentElement.scrollHeight - vh
      el.style.setProperty('--page', (room > 0 ? clamp(window.scrollY / room) : 0).toFixed(4))
      let current = sections[0].dataset.chapter as ChapterId
      const next = { ...NO_STEPS }
      for (const section of sections) {
        const id = section.dataset.chapter as ChapterId
        const steps = Number(section.dataset.steps ?? 0)
        const rect = section.getBoundingClientRect()
        // 0 when the scene's top comes into the lower part of the screen, 1 when its end does.
        const p = still ? 1 : clamp((vh * 0.7 - rect.top) / Math.max(1, rect.height - vh * 0.3))
        const at = still ? steps : Math.min(steps, Math.floor(p * (steps + 1)))
        section.style.setProperty('--p', p.toFixed(3))
        if (section.dataset.step !== String(at)) section.dataset.step = String(at)
        next[id] = at
        if (rect.top <= vh * 0.45) current = id
      }
      setChapter((was) => (was === current ? was : current))
      setStep((was) => (CHAPTERS.every((c) => was[c.id] === next[c.id]) ? was : next))
    }
    function ask() {
      if (!frame) frame = requestAnimationFrame(measure)
    }

    // A scene holds still while its steps play only when all of it fits on the screen; otherwise it simply scrolls.
    const fit = () => {
      const room = window.innerHeight - 56 - 56
      for (const section of sections) {
        if (!section.classList.contains('lp-ch--pin')) continue
        const body = section.querySelector<HTMLElement>('.lp-ch-body')
        section.dataset.pin = String(!still && window.innerWidth >= 1024 && Boolean(body) && body!.offsetHeight <= room)
      }
      ask()
    }
    fit()
    measure()
    // Type and cards arrive once, when they first come into view.
    const arriving = [...el.querySelectorAll<HTMLElement>('.lp-rv')]
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          ;(entry.target as HTMLElement).dataset.in = 'true'
          seen.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    )
    for (const item of arriving) seen.observe(item)

    // With reduced motion the scenes are already at their end; the page still has to know which chapter is on screen.
    window.addEventListener('scroll', ask, { passive: true })
    window.addEventListener('resize', fit)
    return () => {
      seen.disconnect()
      window.removeEventListener('scroll', ask)
      window.removeEventListener('resize', fit)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [root])

  return { chapter, step }
}

// ── The 10-second hold: approve, then Undo until it sends ───────────────────

interface Hold {
  state: 'draft' | 'holding' | 'sent'
  left: number
  approve: () => void
  undo: () => void
  reset: () => void
}

function useHold(): Hold {
  const [state, setState] = useState<Hold['state']>('draft')
  const [left, setLeft] = useState(UNDO_SECONDS)
  useEffect(() => {
    if (state !== 'holding') return
    const ends = Date.now() + UNDO_SECONDS * 1000
    const timer = setInterval(() => {
      const seconds = Math.ceil((ends - Date.now()) / 1000)
      if (seconds <= 0) setState('sent')
      else setLeft(seconds)
    }, 200)
    return () => clearInterval(timer)
  }, [state])
  return {
    state,
    left,
    approve: () => {
      setLeft(UNDO_SECONDS)
      setState('holding')
    },
    undo: () => setState('draft'),
    reset: () => setState('draft'),
  }
}

/** The row under a draft: Approve, then the countdown with Undo, then Sent. `what` names it for a screen reader. */
function HoldRow({ hold, what, approveLabel = 'Approve' }: { hold: Hold; what: string; approveLabel?: string }) {
  // The button that was pressed is replaced by the next one. Focus follows it, so a keyboard is never left on nothing.
  const row = useRef<HTMLDivElement>(null)
  const acted = useRef(false)
  useEffect(() => {
    if (!acted.current) return
    const lost = !document.activeElement || document.activeElement === document.body || row.current?.contains(document.activeElement)
    if (lost) row.current?.querySelector('button')?.focus({ preventScroll: true })
    if (hold.state !== 'holding') acted.current = false
  }, [hold.state])
  return (
    <div ref={row} onClickCapture={() => (acted.current = true)}>
      {hold.state === 'draft' && (
        <button type="button" className="lp-btn lp-btn--primary" onClick={hold.approve}>
          {approveLabel}
        </button>
      )}
      {hold.state === 'holding' && (
        <div className="lp-hold">
          <span aria-hidden="true">Sending in {hold.left}s</span>
          <button type="button" className="lp-btn lp-btn--small" onClick={hold.undo}>
            Undo
          </button>
          <span className="lp-hold-bar" style={{ animationDuration: `${UNDO_SECONDS}s` }} />
        </div>
      )}
      {hold.state === 'sent' && (
        <div className="lp-hold">
          <span>Sent. It is in the firm’s activity log.</span>
          <button type="button" className="lp-btn lp-btn--small lp-btn--quiet" onClick={hold.reset}>
            Start over
          </button>
        </div>
      )}
      {/* Said once per change, not once a second. */}
      <p className="lp-sr" role="status">
        {hold.state === 'holding' ? `Approved. The ${what} sends in ${UNDO_SECONDS} seconds. Undo is available until then.` : hold.state === 'sent' ? `The ${what} was sent. This is a demonstration: nothing left this page.` : ''}
      </p>
    </div>
  )
}

// ── The page of notes, and what sits with it on the stage ───────────────────

function NotesPage({ lit }: { lit: boolean }) {
  const { hot, chapter, gate } = useStoryState()
  const tag =
    chapter === 'workspace' ? 'Filed under Meetings, on Emily’s page' : chapter === 'rules' ? (gate.state === 'sent' ? 'Update sent' : gate.state === 'holding' ? 'Approved, sending' : 'Update waiting for approval') : chapter === 'early' ? (gate.state === 'sent' ? 'Sent and logged' : 'Still waiting for approval') : ''
  return (
    <div className="lp-notes-wrap">
      <div className="lp-notes">
        <div className="lp-notes-head">
          <span>Emily Chen</span>
          <span>Meeting notes, Nov 24</span>
        </div>
        <ul className="lp-notes-lines" aria-label="The counselor’s notes from the meeting">
          {NOTES.map((line, i) => (
            <li key={i}>
              {line.map((part, j) =>
                typeof part === 'string' ? (
                  part
                ) : (
                  <span key={j} className="lp-phrase" data-phrase={part.id} data-lit={lit} data-hot={hot === part.id}>
                    {part.text}
                  </span>
                ),
              )}
            </li>
          ))}
        </ul>
        <Spark size={22} className="lp-notes-spark" />
        <span className="lp-notes-tag" data-on={Boolean(tag)} aria-hidden="true">
          {tag}
        </span>
      </div>
      {/* The other side of the page: the record a parent update takes its facts from. */}
      <div className="lp-record" aria-hidden={chapter !== 'families'}>
        <p className="lp-h">Emily’s record</p>
        <ul>
          {Object.values(FACTS).map((fact) => (
            <li key={fact.id} data-hot={hot === fact.id}>
              {fact.source}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** Moves the notes a little with the pointer, in the hero only. Transform only, one write a frame. */
function useTilt(ref: RefObject<HTMLDivElement | null>, on: boolean): void {
  useEffect(() => {
    const el = ref.current
    const page = el?.querySelector<HTMLElement>('.lp-notes-wrap')
    if (!el || !page || !on || reducedMotion() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    let frame = 0
    let x = 0
    let y = 0
    const paint = () => {
      frame = 0
      page.style.setProperty('--ry', `${(x * 7).toFixed(2)}deg`)
      page.style.setProperty('--rx', `${(-y * 5).toFixed(2)}deg`)
    }
    const move = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      x = clamp((e.clientX - rect.left) / rect.width) - 0.5
      y = clamp((e.clientY - rect.top) / rect.height) - 0.5
      if (!frame) frame = requestAnimationFrame(paint)
    }
    const rest = () => {
      x = 0
      y = 0
      if (!frame) frame = requestAnimationFrame(paint)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', rest)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', rest)
      if (frame) cancelAnimationFrame(frame)
      page.style.removeProperty('--rx')
      page.style.removeProperty('--ry')
    }
  }, [ref, on])
}

function Stage({ wide, demo }: { wide: boolean; demo: Hold }) {
  const { chapter, step, gate } = useStoryState()
  const ref = useRef<HTMLDivElement>(null)
  useTilt(ref, chapter === 'top')
  return (
    <aside className="lp-stage" aria-label="The meeting this page follows">
      <div className="lp-stage-inner" ref={ref}>
        <NotesPage lit={step.how >= 2 || (chapter !== 'top' && chapter !== 'how')} />
        {wide && (
          <div className="lp-stage-extra">
            <div data-on={chapter === 'top'} inert={chapter !== 'top'}>
              <InboxCard hold={demo} />
            </div>
            <p className="lp-small" data-on={chapter === 'how'} aria-hidden={chapter !== 'how'}>
              Point at a line of a draft, or tap it, to see the words in the notes it came from.
            </p>
            <p className="lp-small" data-on={chapter === 'families'} aria-hidden={chapter !== 'families'}>
              The page has turned over. This is the record. Point at a highlighted fact in the update to see which line it was read from.
            </p>
            <div className="lp-card lp-stage-gate" data-on={chapter === 'rules'} aria-hidden={chapter !== 'rules'}>
              <p className="lp-h">What the gate checks</p>
              <ul>
                <li>
                  <span className="lp-dot" data-ok={gate.state !== 'draft'} />A person approved it
                </li>
                <li>
                  <span className="lp-dot" data-ok="true" />
                  Every fact matches the record
                </li>
                <li>
                  <span className="lp-dot" data-ok="true" />
                  No essay text was written
                </li>
              </ul>
            </div>
            <div className="lp-card lp-stage-log" data-on={chapter === 'early'} aria-hidden={chapter !== 'early'}>
              <p className="lp-h">Activity</p>
              <ul>
                <li>
                  <span className="lp-dot" data-ok="true" />
                  Drafts from “Check-in, Nov 24” are ready for review
                </li>
                <li>
                  <span className="lp-dot" data-ok={gate.state === 'sent'} />
                  {gate.state === 'sent' ? 'Sent a parent update to Chen Chih-hao' : 'Parent update is waiting for approval. Nothing was sent.'}
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

/** The live Inbox card in the hero: approve the drafted parent update, watch the Undo count down, undo it or let it send. */
function InboxCard({ hold }: { hold: Hold }) {
  const [lang, setLang] = useState<Lang>('zh-Hant')
  return (
    <div className="lp-card lp-inbox">
      <div className="lp-inbox-top">
        <span>Inbox · To review</span>
        <span className="lp-chip">Sample data</span>
      </div>
      <div>
        <p className="lp-h">Parent update, drafted</p>
        <span className="lp-inbox-meta">Emily Chen · To Chen Chih-hao · Email</span>
      </div>
      <p className="lp-inbox-body" lang={lang}>
        {updateText(lang)}
      </p>
      <div className="lp-inbox-row">
        <button type="button" className="lp-btn lp-btn--small" aria-pressed={lang === 'zh-Hant'} onClick={() => setLang('zh-Hant')} lang="zh-Hant">
          繁體中文
        </button>
        <button type="button" className="lp-btn lp-btn--small" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
          Show in English
        </button>
      </div>
      <div className="lp-inbox-row">
        <span className="lp-chip lp-chip--accent">Meeting notes, Nov 24</span>
        <span className="lp-chip lp-chip--accent">3 open tasks</span>
        <span className="lp-chip lp-chip--accent">Next meeting, Nov 29</span>
      </div>
      <HoldRow hold={hold} what="parent update" />
      <p className="lp-try">Try it: approve the draft, then undo it. The student and parent are invented.</p>
    </div>
  )
}

// ── The line from a draft back to the notes ─────────────────────────────────

function Trace({ from, hot }: { from: Element | null; hot?: string }) {
  const [shape, setShape] = useState<{ d: string; x: number; y: number }>()
  useEffect(() => {
    if (!from || !hot) {
      setShape(undefined)
      return
    }
    const draw = () => {
      const target = [...document.querySelectorAll<HTMLElement>(`[data-phrase="${hot}"]`)].find((el) => el.getClientRects().length > 0)
      if (!target) return setShape(undefined)
      const a = from.getBoundingClientRect()
      const b = target.getBoundingClientRect()
      // From the side of the draft line nearest the notes, to the start of the phrase.
      const sideways = b.left > a.right
      const x1 = sideways ? a.right : a.left + a.width / 2
      const y1 = sideways ? a.top + a.height / 2 : a.top
      const x2 = sideways ? b.left - 4 : b.left + b.width / 2
      const y2 = sideways ? b.top + b.height / 2 : b.bottom + 2
      const d = sideways ? `M${x1} ${y1} C${x1 + 60} ${y1} ${x2 - 60} ${y2} ${x2} ${y2}` : `M${x1} ${y1} C${x1} ${y1 - 50} ${x2} ${y2 + 50} ${x2} ${y2}`
      setShape({ d, x: x2, y: y2 })
    }
    draw()
    window.addEventListener('scroll', draw, { passive: true })
    window.addEventListener('resize', draw)
    return () => {
      window.removeEventListener('scroll', draw)
      window.removeEventListener('resize', draw)
    }
  }, [from, hot])
  return (
    <svg className="lp-trace" data-on={Boolean(shape)} aria-hidden="true">
      {shape && (
        <>
          <path d={shape.d} />
          <circle cx={shape.x} cy={shape.y} r="4" />
        </>
      )}
    </svg>
  )
}

/** Hover, focus or tap: point at a phrase or a fact. Moving away, or tapping elsewhere, lets go. */
function usePointing(id: string) {
  const { hot, setHot } = useStoryState()
  return {
    'data-hot': hot === id,
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === 'mouse' && setHot(id, e.currentTarget),
    onPointerLeave: (e: React.PointerEvent) => e.pointerType === 'mouse' && setHot(undefined),
    onFocus: (e: React.FocusEvent) => setHot(id, e.currentTarget),
    onBlur: () => setHot(undefined),
    onClick: (e: React.MouseEvent) => setHot(id, e.currentTarget),
  }
}

// ── Chapters ────────────────────────────────────────────────────────────────

function Chapter({ id, steps = 0, pin, alt, hero, children }: { id: ChapterId; steps?: number; pin?: boolean; alt?: boolean; hero?: boolean; children: ReactNode }) {
  return (
    <section id={id} data-chapter={id} data-steps={steps} data-step="0" className={['lp-ch', pin && 'lp-ch--pin', alt && 'lp-ch--alt', hero && 'lp-ch--hero'].filter(Boolean).join(' ')} aria-labelledby={`${id}-title`}>
      <div className="lp-tone" aria-hidden="true" />
      <div className="lp-ch-body">{children}</div>
    </section>
  )
}

const Reveal = ({ d = 0, children, className }: { d?: number; children: ReactNode; className?: string }) => (
  <div className={`lp-rv${className ? ` ${className}` : ''}`} style={{ '--d': d } as React.CSSProperties}>
    {children}
  </div>
)

function Hero({ wide, demo }: { wide: boolean; demo: Hold }) {
  return (
    <Chapter id="top" hero>
      <Reveal>
        <p className="lp-eyebrow">For private college counselors</p>
      </Reveal>
      <Reveal d={1}>
        <h1 id="top-title">
          Your whole caseload in one workspace. The follow-up, <span>already drafted.</span>
        </h1>
      </Reveal>
      <Reveal d={2}>
        <p className="lp-lede">Platinum keeps your students, tasks, college lists, meetings and files in one place. After each meeting it drafts the recap, the next tasks and the parent update. Nothing reaches a family until you approve it.</p>
      </Reveal>
      <Reveal d={3} className="lp-actions">
        <Anchor to="early" className="lp-btn lp-btn--primary">
          Request early access
        </Anchor>
        <Anchor to="how" className="lp-btn">
          See how it works
        </Anchor>
      </Reveal>
      <Reveal d={4}>
        <p className="lp-small">Platinum is in development. We are looking for a few counseling practices to try it first and tell us what is missing.</p>
      </Reveal>
      {/* On a phone the Inbox card is part of the hero. On a laptop it sits with the notes, on the stage. */}
      {!wide && (
        <Reveal d={5}>
          <InboxCard hold={demo} />
        </Reveal>
      )}
    </Chapter>
  )
}

function DraftLines() {
  return (
    <ul className="lp-drafts">
      {DRAFTS.map((draft, d) => (
        <li key={draft.id} className="lp-draft">
          <div className="lp-draft-name">
            {draft.name}
            <span>{draft.summary}</span>
          </div>
          {draft.lines.map((line, i) => (
            <DraftLine key={line.text} line={line} order={d * 2 + i} />
          ))}
        </li>
      ))}
    </ul>
  )
}

function DraftLine({ line, order }: { line: { text: string; from: PhraseId }; order: number }) {
  const pointing = usePointing(line.from)
  return (
    <button type="button" className="lp-draft-line" style={{ '--i': order } as React.CSSProperties} aria-pressed={pointing['data-hot']} {...pointing}>
      {line.text}
      <span className="lp-sr">. Shows where in the notes this came from.</span>
    </button>
  )
}

function How() {
  const { step } = useStoryState()
  const at = step.how
  return (
    <Chapter id="how" steps={3} pin alt>
      <Reveal>
        <p className="lp-eyebrow">After the meeting</p>
        <h2 id="how-title" style={{ marginTop: 8 }}>
          The hour after a meeting is where the work piles up. Start there.
        </h2>
      </Reveal>
      <Reveal d={1}>
        <p className="lp-lede">Recap, tasks, the note to the parents, the profile you meant to update. Platinum drafts all four from your notes so you review instead of retype.</p>
      </Reveal>
      <ol className="lp-steps">
        <li className="lp-card lp-step" data-on={at >= 1}>
          <span className="lp-step-n">1</span>
          <h3>Paste your notes</h3>
          <p>Log the meeting with whatever you have: typed notes or a transcript. No template to fill in first.</p>
          <div className="lp-pasted">{NOTES_PASTED}</div>
        </li>
        <li className="lp-card lp-step" data-on={at >= 2}>
          <span className="lp-step-n">2</span>
          <h3>Review what it drafted</h3>
          <p>Each draft shows what it was built from. Edit any line, drop what you don’t want.</p>
          <DraftLines />
        </li>
        <li className="lp-card lp-step" data-on={at >= 3}>
          <span className="lp-step-n">3</span>
          <h3>Approve, and it goes out as you</h3>
          <p>Approved emails send from your own Gmail address. You get a 10-second Undo on every send.</p>
          <ul className="lp-outcomes">
            {OUTCOMES.map((o) => (
              <li key={o.name}>
                <span className="lp-chip lp-chip--good">{o.name}</span>
                <span>{o.text}</span>
              </li>
            ))}
          </ul>
        </li>
      </ol>
    </Chapter>
  )
}

function WorkspaceChapter() {
  return (
    <Chapter id="workspace" steps={3} pin>
      <Reveal>
        <p className="lp-eyebrow">The workspace</p>
        <h2 id="workspace-title" style={{ marginTop: 8 }}>
          Everything about a student, on one page.
        </h2>
      </Reveal>
      <Reveal d={1}>
        <p className="lp-lede">The record you already keep across a planner, a drive and your inbox, kept together so the assistant can work from it.</p>
      </Reveal>
      <Workspace />
    </Chapter>
  )
}

/** One language's update: the model's sentences letter by letter, the record's facts as marks that can be asked where they came from. */
function Letter({ lang, on }: { lang: Lang; on: boolean }) {
  let n = 0
  return (
    <p lang={lang} data-on={on} inert={!on} aria-hidden={!on}>
      {UPDATE[lang].map((part, i) => {
        if (typeof part !== 'string') return <FactMark key={i} id={part[0]} text={part[1]} />
        const start = n
        n += part.length
        return (
          <span key={i}>
            <span aria-hidden="true">
              {[...part].map((char, j) => (
                <span key={j} className="lp-char" style={{ '--i': start + j } as React.CSSProperties}>
                  {char}
                </span>
              ))}
            </span>
            <span className="lp-sr">{part}</span>
          </span>
        )
      })}
    </p>
  )
}

function FactMark({ id, text }: { id: string; text: string }) {
  const pointing = usePointing(id)
  return (
    <button type="button" className="lp-fact" {...pointing}>
      {text}
      <span className="lp-fact-tip" lang="en">
        <span className="lp-sr">, from the record: </span>
        {FACTS[id].source}
      </span>
    </button>
  )
}

function Families() {
  const { step, hot } = useStoryState()
  // Scrolling turns the update from English into Traditional Chinese. Once the visitor chooses, their choice stays.
  const [chosen, setChosen] = useState<Lang>()
  const lang = chosen ?? (step.families >= 1 ? 'zh-Hant' : 'en')
  return (
    <Chapter id="families" steps={2} pin alt>
      <Reveal>
        <p className="lp-eyebrow">Families</p>
        <h2 id="families-title" style={{ marginTop: 8 }}>
          Parent updates in the language the parent reads.
        </h2>
      </Reveal>
      <Reveal d={1}>
        <p className="lp-lede">Set a language for each parent. Updates are drafted in English, Traditional Chinese or Simplified Chinese, with the English beside it so you always know what you are approving. Parents never need a login.</p>
      </Reveal>
      <Reveal d={2}>
        <div className="lp-card lp-letter">
          <div className="lp-inbox-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <span className="lp-letter-label" style={{ margin: 0 }}>
              Sent to Mr. Chen
            </span>
            <div className="lp-langs" role="group" aria-label="Language of the update">
              {(Object.keys(LANG_LABEL) as Lang[]).map((l) => (
                <button key={l} type="button" className="lp-btn lp-btn--small" aria-pressed={lang === l} onClick={() => setChosen(l)} lang={l}>
                  {LANG_LABEL[l]}
                </button>
              ))}
            </div>
          </div>
          <div className="lp-letter-stack">
            {(Object.keys(UPDATE) as Lang[]).map((l) => (
              <Letter key={l} lang={l} on={lang === l} />
            ))}
          </div>
          {/* The facts do not move while the sentences around them change language. */}
          <ul className="lp-facts-rail" aria-label="Facts placed from Emily’s record">
            {['3 open tasks', 'Due by Dec 8', 'UC essay 2, draft 1', 'NYU Tandon', 'ED2', 'November transcript'].map((fact, i) => (
              <li key={fact} className="lp-chip" data-hot={hot === ['count', 'window', 'essay', 'school', 'plan', 'month'][i]}>
                {fact}
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
      <Reveal d={3}>
        <div className="lp-review">
          <p className="lp-letter-label">What you review</p>
          <p>{updateText('en')}</p>
        </div>
      </Reveal>
      <p className="lp-small">Dates, counts and deadlines in an update are filled in from the student’s record, so the update can’t describe a task that isn’t there.</p>
    </Chapter>
  )
}

const MARGIN_NOTES = {
  Observe: 'The second sentence tells us you were nervous before it shows us. The image of the solder smoke already does that work.',
  Ask: 'What did you do the first time the robot failed in front of the judges? That moment is not on the page yet.',
  Brainstorm: 'Angles to try: what you rebuilt and why; who taught you to solder; what you would not do again.',
} as const

function Rules() {
  const { step, gate } = useStoryState()
  const at = step.rules
  const [count, setCount] = useState('3')
  const [snapped, setSnapped] = useState(false)
  const [notes, setNotes] = useState<(keyof typeof MARGIN_NOTES)[]>([])
  const back = useRef<ReturnType<typeof setTimeout>>(undefined)
  const countId = useId()

  // Whatever is typed, the number goes back to what the record says.
  const change = (value: string) => {
    setCount(value)
    setSnapped(false)
    clearTimeout(back.current)
    if (value !== '3')
      back.current = setTimeout(() => {
        setCount('3')
        setSnapped(true)
      }, 900)
  }
  useEffect(() => () => clearTimeout(back.current), [])

  return (
    <Chapter id="rules" steps={3} pin>
      <Reveal>
        <p className="lp-eyebrow">AI rules</p>
        <h2 id="rules-title" style={{ marginTop: 8 }}>
          Built in, so you don’t have to police it.
        </h2>
      </Reveal>
      <Reveal d={1}>
        <p className="lp-lede">Families pay for your judgment. The assistant does the typing and stays inside three rules.</p>
      </Reveal>
      <div className="lp-rules">
        <div className="lp-card lp-rule" data-on={at >= 1}>
          <h3>You approve everything that leaves</h3>
          <p>The assistant can only propose. Messages, tasks and profile changes wait in your Inbox until you approve them.</p>
          <div className="lp-rule-test">
            <span>The update to Mr. Chen has reached the gate. It stays here until you approve it.</span>
            <div className="lp-gate">
              <span className="lp-lock" data-open={gate.state !== 'draft'}>
                <LockIcon open={gate.state !== 'draft'} />
                {gate.state === 'draft' ? 'Send is locked' : gate.state === 'holding' ? 'Send is unlocked' : 'Sent'}
              </span>
              <HoldRow hold={gate} what="parent update" />
            </div>
          </div>
        </div>

        <div className="lp-card lp-rule" data-on={at >= 2}>
          <h3>Facts come from the record</h3>
          <p>Due dates, late counts and college figures are looked up and calculated, then placed into the draft. The model writes the sentences around them.</p>
          <div className="lp-rule-test">
            <label htmlFor={countId}>
              Try to change the number in the draft:
              <br />
              <input id={countId} className="lp-number" inputMode="numeric" maxLength={2} value={count} data-snap={snapped} onChange={(e) => change(e.target.value.replace(/\D/g, ''))} aria-describedby={`${countId}-why`} />
              things are due in the next two weeks.
            </label>
            <span id={`${countId}-why`} className="lp-small" role="status">
              {snapped ? 'Back to 3. Emily’s record has 3 open tasks, and the draft follows the record.' : 'The record says 3 open tasks.'}
            </span>
          </div>
        </div>

        <div className="lp-card lp-rule" data-on={at >= 3}>
          <h3>It never writes the essay</h3>
          <p>Essay help is limited to observations, questions and brainstormed angles. There is no button that produces or rewrites essay text.</p>
          <div className="lp-rule-test">
            <p className="lp-essay">
              The gym smelled like solder smoke the morning our robot stopped moving. <mark>I was nervous, more nervous than I had ever been.</mark> I had forty minutes and one spare motor controller.
            </p>
            <div className="lp-inbox-row" role="group" aria-label="The only things the assistant can do with an essay">
              {(Object.keys(MARGIN_NOTES) as (keyof typeof MARGIN_NOTES)[]).map((kind) => (
                <button key={kind} type="button" className="lp-btn lp-btn--small" aria-pressed={notes.includes(kind)} onClick={() => setNotes((have) => (have.includes(kind) ? have.filter((k) => k !== kind) : [...have, kind]))}>
                  {kind}
                </button>
              ))}
            </div>
            <div aria-live="polite" style={{ display: 'grid', gap: 8 }}>
              {notes.map((kind) => (
                <p key={kind} className="lp-margin-note">
                  <b>{kind === 'Observe' ? 'Observation' : kind === 'Ask' ? 'Question' : 'Angles'}</b>
                  {MARGIN_NOTES[kind]}
                </p>
              ))}
            </div>
            <span className="lp-small">Emily’s sentences are still exactly as she wrote them.</span>
          </div>
        </div>
      </div>
    </Chapter>
  )
}

function LockIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d={open ? 'M8 11V7a4 4 0 0 1 7.500-2' : 'M8 11V7a4 4 0 0 1 8 0v4'} />
    </svg>
  )
}

const EMPTY: EarlyAccessRequest = { name: '', email: '', practice: '', counselors: 'Just me', usesToday: '' }

function EarlyAccess() {
  const { gate } = useStoryState()
  const [form, setForm] = useState(EMPTY)
  const [problems, setProblems] = useState<ReturnType<typeof checkEarlyAccess>>({})
  const [state, setState] = useState<'idle' | 'sending' | 'not_open' | 'sent'>('idle')
  const box = useRef<HTMLFormElement>(null)
  const id = useId()
  const set = (key: keyof EarlyAccessRequest) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    setState('idle')
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const found = checkEarlyAccess(form)
    setProblems(found)
    const first = (Object.keys(found) as (keyof EarlyAccessRequest)[])[0]
    if (first) {
      box.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus()
      return
    }
    setState('sending')
    // Success is shown only when the request was really sent. Today it never is.
    void requestEarlyAccess(form).then((result) => setState(result.sent ? 'sent' : 'not_open'))
  }

  const field = (key: 'name' | 'email' | 'practice', label: string, type: string, autoComplete: string) => (
    <div className="lp-field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input id={`${id}-${key}`} name={key} type={type} autoComplete={autoComplete} value={form[key]} onChange={set(key)} aria-invalid={Boolean(problems[key])} aria-describedby={problems[key] ? `${id}-${key}-error` : undefined} />
      {problems[key] && (
        <span id={`${id}-${key}-error`} className="lp-error" role="alert">
          {problems[key]}
        </span>
      )}
    </div>
  )

  return (
    <Chapter id="early" steps={1} alt>
      <Reveal>
        <p className="lp-eyebrow">Early access</p>
        <h2 id="early-title" style={{ marginTop: 8 }}>
          Try it with a few of your own students.
        </h2>
      </Reveal>
      <Reveal d={1}>
        <p className="lp-lede">We are two UC Berkeley students who went through private college counseling ourselves. We would rather build this with working counselors than guess.</p>
      </Reveal>
      <Reveal d={2}>
        <ul className="lp-offer">
          <li>A walkthrough on a call, on sample students first</li>
          <li>Help setting up your first students</li>
          <li>A direct line to the two people building it</li>
        </ul>
      </Reveal>
      <p className="lp-small" role="status">
        {gate.state === 'sent' ? 'Emily’s update has been sent and logged. The story ends here.' : 'Emily’s update is still waiting at the gate, because nobody approved it. That is the point.'}
      </p>
      <Reveal d={3}>
        <form className="lp-card lp-form" ref={box} onSubmit={submit} noValidate aria-labelledby="early-title">
          <Spark size={26} className="lp-form-spark" />
          <p className="lp-notice">Requests are not open yet. This form does not send or save anything today.</p>
          {field('name', 'Your name', 'text', 'name')}
          {field('email', 'Work email', 'email', 'email')}
          {field('practice', 'Practice name', 'text', 'organization')}
          <div className="lp-field">
            <label htmlFor={`${id}-counselors`}>Counselors in your practice</label>
            <select id={`${id}-counselors`} name="counselors" value={form.counselors} onChange={set('counselors')}>
              <option>Just me</option>
              <option>2 to 5</option>
              <option>6 to 10</option>
              <option>More than 10</option>
            </select>
          </div>
          <div className="lp-field">
            <label htmlFor={`${id}-uses`}>What you use today</label>
            <textarea id={`${id}-uses`} name="usesToday" rows={3} value={form.usesToday} onChange={set('usesToday')} />
          </div>
          <button type="submit" className="lp-btn lp-btn--primary" aria-disabled={state === 'sending'}>
            Request early access
          </button>
          <div role="status" aria-live="polite">
            {state === 'not_open' && <p className="lp-notice">Nothing was sent. Early access requests are not open yet, so your details were not sent or stored anywhere. Please come back soon.</p>}
            {state === 'sent' && <p className="lp-notice">Your request was sent.</p>}
          </div>
          <p className="lp-small">We will reply by email. No newsletter.</p>
        </form>
      </Reveal>
    </Chapter>
  )
}

// ── The page ────────────────────────────────────────────────────────────────

export default function Landing() {
  const root = useRef<HTMLDivElement>(null)
  const { chapter, step } = useStory(root)
  const wide = useMedia('(min-width: 1024px)')
  const demo = useHold()
  const gate = useHold()
  const [hot, setHotId] = useState<string>()
  const [from, setFrom] = useState<Element | null>(null)
  const setHot = useCallback((id: string | undefined, origin?: Element | null) => {
    setHotId(id)
    setFrom(id ? (origin ?? null) : null)
  }, [])
  const story = useMemo<Story>(() => ({ chapter, step, hot, setHot, gate }), [chapter, step, hot, setHot, gate])
  const reached = CHAPTERS.findIndex((c) => c.id === chapter)

  useEffect(() => {
    const before = document.title
    document.title = `${PRODUCT_NAME}: a workspace for private college counselors`
    return () => {
      document.title = before
    }
  }, [])

  return (
    <StoryContext.Provider value={story}>
      <div className="lp" ref={root} data-ch={chapter}>
        <a href="#how" className="lp-sr" onFocus={(e) => e.currentTarget.classList.remove('lp-sr')} onBlur={(e) => e.currentTarget.classList.add('lp-sr')} style={{ position: 'fixed', zIndex: 50, top: 8, left: 8, padding: 12, background: 'var(--color-primary)', color: 'var(--color-on-primary)', borderRadius: 8 }}>
          Skip to how it works
        </a>
        <header className="lp-header">
          <a href="#top" className="lp-home" aria-label={`${PRODUCT_NAME}, top of the page`} onClick={(e) => (e.preventDefault(), goTo('top'))}>
            <img src={LOGO_FULL.src} srcSet={`${LOGO_FULL.src} 240w, ${LOGO_FULL.src2x} 480w`} sizes="116px" width={116} height={Math.round(116 / LOGO_FULL.ratio)} alt="" />
          </a>
          <select className="lp-jump" aria-label="Jump to a chapter" value={chapter} onChange={(e) => goTo(e.target.value)}>
            {CHAPTERS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <nav className="lp-nav" aria-label="On this page">
            {CHAPTERS.slice(1, 5).map((c) => (
              <Anchor key={c.id} to={c.id}>
                {c.label}
              </Anchor>
            ))}
          </nav>
          <div className="lp-header-end">
            <a className="lp-signin" href="/signin">
              Sign in
            </a>
            <Anchor to="early" className="lp-btn lp-btn--small">
              Request early access
            </Anchor>
          </div>
        </header>

        {/* Reading progress, with the spark travelling it. Decorative: the index beside it is the control. */}
        <div className="lp-thread" aria-hidden="true">
          <div className="lp-thread-fill" />
          <Spark className="lp-thread-spark" />
        </div>
        <nav className="lp-index" aria-label="Chapters">
          {CHAPTERS.map((c, i) => (
            <button key={c.id} type="button" aria-current={c.id === chapter} data-reached={i <= reached} onClick={() => goTo(c.id)}>
              <span>{c.label}</span>
              <span className="lp-sr">{i <= reached ? '' : ', not reached yet'}</span>
            </button>
          ))}
        </nav>

        {/* The stage comes first in the page's order, so the hero's Inbox card is reached by keyboard while the hero is on screen. */}
        <main className="lp-story">
          <Stage wide={wide} demo={demo} />
          <div className="lp-chapters">
            <Hero wide={wide} demo={demo} />
            <How />
            <WorkspaceChapter />
            <Families />
            <Rules />
            <EarlyAccess />
          </div>
        </main>

        <footer className="lp-footer">
          <p>Platinum is a working title for a product in development. The students, parents and messages shown on this page are invented examples.</p>
        </footer>
        <Trace from={from} hot={from ? hot : undefined} />
      </div>
    </StoryContext.Provider>
  )
}
