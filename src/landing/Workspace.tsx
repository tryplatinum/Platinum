// The student's page, drawn: the eight areas of the workspace as panels that
// can be explored. Each panel has one small live detail, and each of those is
// something the product does: a task that can be ticked, a college that moves
// between Reach, Target and Likely, a file that is sorted into a folder, the
// student's own view on a phone.
//
// The page builds itself as the chapter is scrolled (landing.css reads the
// chapter's data-step): the four drafts arrive first, then the areas, then the
// open panel. Everything is drawn here; no screenshot is used.

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AREAS, DRAFTS, DRAFT_HOME, type AreaId } from './story'

const BANDS = ['Reach', 'Target', 'Likely'] as const

function Check({ done, onToggle, children }: { done: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button type="button" className="lp-check" aria-pressed={done} onClick={onToggle}>
      <i aria-hidden="true" />
      <span style={done ? { textDecoration: 'line-through', color: 'var(--color-muted)' } : undefined}>{children}</span>
    </button>
  )
}

/** The one live detail of each area. Local state only: nothing here is saved or sent. */
function Live({ area }: { area: AreaId }) {
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [band, setBand] = useState(0)
  const [flag, setFlag] = useState(false)
  const toggle = (key: string) => setDone((d) => ({ ...d, [key]: !d[key] }))
  // The college is drawn again in its new band. Focus goes with it.
  const college = useRef<HTMLButtonElement>(null)
  const moved = useRef(false)
  useEffect(() => {
    if (moved.current) college.current?.focus({ preventScroll: true })
    moved.current = false
  }, [band])

  switch (area) {
    case 'today':
      return (
        <div className="lp-ws-live">
          <div className="lp-ws-row">
            <span>Emily Chen · November transcript is 2 days late</span>
            <button type="button" className="lp-btn lp-btn--small" aria-pressed={flag} onClick={() => setFlag(!flag)}>
              {flag ? 'Reminder drafted' : 'Remind'}
            </button>
          </div>
          <span className="lp-small" role="status">
            {flag ? 'A reminder to Emily is drafted and waiting in your Inbox. Nothing was sent.' : 'One click drafts the reminder. You still approve it.'}
          </span>
        </div>
      )
    case 'students':
      return (
        <div className="lp-ws-live">
          {['Revise the personal statement · Dec 8', 'Ask Mr. Alvarez for a math recommendation · Dec 1', 'Upload the November transcript · Dec 4'].map((task) => (
            <div key={task} className="lp-ws-row">
              <Check done={Boolean(done[task])} onToggle={() => toggle(task)}>
                {task}
              </Check>
              <span className="lp-chip">Emily</span>
            </div>
          ))}
          <span className="lp-small">The three tasks from the meeting. Tick one.</span>
        </div>
      )
    case 'meetings':
      return (
        <div className="lp-ws-live">
          <div className="lp-ws-row">
            <span>Next meeting · Nov 29</span>
            <button type="button" className="lp-btn lp-btn--small" aria-expanded={flag} onClick={() => setFlag(!flag)}>
              {flag ? 'Hide the brief' : 'Ask for a brief'}
            </button>
          </div>
          {flag && (
            <ul style={{ display: 'grid', gap: 4 }} className="lp-small">
              <li>Open since Nov 24: personal statement, math recommendation, November transcript</li>
              <li>Changed since: PIQ 2 has a first draft; early plan set to NYU Tandon, ED2</li>
            </ul>
          )}
        </div>
      )
    case 'colleges':
      return (
        <div className="lp-ws-live">
          <div className="lp-bands">
            {BANDS.map((name, i) => (
              <div key={name} className="lp-band">
                <b>{name}</b>
                {band === i && (
                  <button
                    ref={college}
                    type="button"
                    className="lp-btn lp-btn--small"
                    onClick={() => {
                      moved.current = true
                      setBand((band + 1) % BANDS.length)
                    }}
                    aria-label={`NYU Tandon is under ${name}. Move it to ${BANDS[(band + 1) % BANDS.length]}.`}>
                    NYU Tandon
                  </button>
                )}
                {i === 1 && <span className="lp-chip">Northlake State</span>}
              </div>
            ))}
          </div>
          <span className="lp-small" role="status">
            NYU Tandon is under {BANDS[band]}. Press it to move it; in the product each band comes with a reason.
          </span>
        </div>
      )
    case 'documents':
      return (
        <div className="lp-ws-live">
          <div className="lp-ws-row">
            <span>{flag ? 'Academic › Transcripts › transcript_nov.pdf' : 'transcript_nov.pdf · just uploaded'}</span>
            <button type="button" className="lp-btn lp-btn--small" aria-pressed={flag} onClick={() => setFlag(!flag)}>
              {flag ? 'Sorted' : 'Sort it'}
            </button>
          </div>
          <span className="lp-small" role="status">
            {flag ? 'Filed in Emily’s Academic folder. A file it is unsure about waits for you instead.' : 'Each file is sorted into the right student’s folder.'}
          </span>
        </div>
      )
    case 'essays':
      return (
        <div className="lp-ws-live">
          <p style={{ fontFamily: 'var(--lp-serif)', lineHeight: 1.6 }}>
            The gym smelled like solder smoke the morning our robot stopped moving. <span style={flag ? { background: 'var(--lp-mark)', color: '#1b2a44', borderRadius: 3 } : undefined}>I was nervous, more nervous than I had ever been.</span>
          </p>
          <button type="button" className="lp-btn lp-btn--small" aria-pressed={flag} onClick={() => setFlag(!flag)} style={{ justifySelf: 'start' }}>
            Observation 1 of 2
          </button>
          {flag && <span className="lp-small">“This sentence tells us what the first already showed.” Tied to the place in the draft. The words stay Emily’s.</span>}
        </div>
      )
    case 'student':
      return (
        <div className="lp-ws-live">
          <div className="lp-phone" role="group" aria-label="Emily’s page, on her phone">
            <div className="lp-phone-title">Hi Emily</div>
            <Check done={Boolean(done.phone)} onToggle={() => toggle('phone')}>
              Upload the November transcript
            </Check>
            <div className="lp-small" style={{ marginTop: 6 }}>
              Next meeting · Nov 29
            </div>
          </div>
          <span className="lp-small" role="status">
            {done.phone ? 'Emily ticked it on her phone. Her counselor sees it done.' : 'What Emily sees. Tick the task as she would.'}
          </span>
        </div>
      )
    case 'assistant':
      return (
        <div className="lp-ws-live">
          <button type="button" className="lp-btn lp-btn--small" aria-expanded={flag} onClick={() => setFlag(!flag)} style={{ justifySelf: 'start' }}>
            “What is Emily behind on?”
          </button>
          {flag && (
            <>
              <p>One thing: the November transcript, due Dec 4, is not uploaded.</p>
              <div className="lp-inbox-row">
                <span className="lp-chip lp-chip--accent">Task · Upload the November transcript</span>
                <span className="lp-chip lp-chip--accent">Meeting · Nov 24</span>
              </div>
              <span className="lp-small">It can draft a reminder, which then waits in your Inbox.</span>
            </>
          )}
        </div>
      )
  }
}

export function Workspace() {
  const [open, setOpen] = useState<AreaId>('students')
  const [fresh, setFresh] = useState(false)
  const id = useId()
  const choose = (area: AreaId) => {
    setOpen(area)
    setFresh(true)
  }
  // Left and right move between the areas, as tabs do.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const at = AREAS.findIndex((a) => a.id === open)
    const next = AREAS[(at + (e.key === 'ArrowRight' ? 1 : AREAS.length - 1)) % AREAS.length]
    choose(next.id)
    document.getElementById(`${id}-${next.id}`)?.focus()
  }
  const area = AREAS.find((a) => a.id === open)!

  return (
    <div className="lp-card lp-ws" data-used={fresh}>
      <div className="lp-ws-head">
        <strong>Emily Chen</strong>
        <span className="lp-chip">Class of 2027 · sample student</span>
      </div>
      {/* The four drafts from the meeting, arriving where they live. */}
      <ul className="lp-ws-flying" aria-label="The four drafts from the meeting, and where each one lives">
        {DRAFTS.map((draft, i) => (
          <li key={draft.id} className="lp-chip lp-chip--accent" style={{ '--i': i, '--fx': (i - 1.5) * 40 } as React.CSSProperties}>
            {draft.name} → {AREAS.find((a) => a.id === DRAFT_HOME[draft.id])?.name}
          </li>
        ))}
      </ul>
      <div className="lp-ws-tabs" role="tablist" aria-label="Areas of the workspace" onKeyDown={onKey}>
        {AREAS.map((a, i) => (
          <button key={a.id} id={`${id}-${a.id}`} type="button" role="tab" className="lp-ws-tab" aria-selected={a.id === open} aria-controls={`${id}-panel`} tabIndex={a.id === open ? 0 : -1} style={{ '--i': i } as React.CSSProperties} onClick={() => choose(a.id)}>
            {a.name}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${open}`} className="lp-ws-panel" data-fresh={fresh}>
        <p>
          <strong style={{ color: 'var(--color-heading)' }}>{area.name}</strong>
          <br />
          {area.text}
        </p>
        <Live key={open} area={open} />
      </div>
      {/* The seven that are not open, as plain text, for anyone who does not use the tabs. */}
      <ul className="lp-sr">
        {AREAS.filter((a) => a.id !== open).map((a) => (
          <li key={a.id}>
            {a.name}: {a.text}
          </li>
        ))}
      </ul>
    </div>
  )
}
