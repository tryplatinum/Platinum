// App chrome. Counselor: a light sidebar on the canvas colour, with the logo
// and the assistant at the top, and the page beside it. On narrow screens the
// same things are one bar: logo, Assistant, Menu. Student: a slim bar and a
// phone-width column.
//
// Six places in the sidebar, Today first. Activity, Settings and Sign out sit
// in its footer. The Inbox badge is the only count.

import { ArrowLeft, CalendarDays, ClipboardList, FolderOpen, Inbox, LogOut, Menu, Send, Settings, Sun, Users, X, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router-dom'
import { activeStudents, findStudent, fullName } from '../lib/derive'
import { inboxCount } from '../lib/inbox'
import { signOut } from '../store/session'
import { useData, useStore } from '../store/store'
import { AiConnection } from './AiConnection'
import { GOOGLE_RETURN } from './google/GoogleAccount'
import { AgentPanel, useAgentPanel } from './agent/AgentPanel'
import { Logo, Spark } from './Logo'
import { Count, focusPage, useIsLaptop, useMarker } from './motion'
import { Button, Card, cx, usePageTitle, useConfirm, useToast } from './ui'

/** Navigation and button icons: 20px, stroke 1.75. Always beside a text label. */
const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const

const NAV_ITEM = 'relative flex min-h-11 items-center gap-2.5 rounded-control px-3 text-sm'

function NavItem({ to, label, icon: Icon, end = false, badge = 0 }: { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={end}
      data-press
      className={({ isActive }) => cx(NAV_ITEM, isActive ? 'bg-sidebar-active font-semibold text-heading' : 'font-medium hover:bg-chip hover:text-heading')}
    >
      <Icon {...ICON} className="shrink-0" />
      <span className="min-w-0 flex-1 whitespace-nowrap">{label}</span>
      {badge > 0 && <Count value={badge} label={`${badge} waiting for review`} className="inline-block rounded-full bg-primary px-1.5 text-xs font-semibold text-on-primary" />}
    </NavLink>
  )
}

export function CounselorLayout() {
  const data = useData()
  const email = useStore((s) => (s.account.status === 'ready' ? s.account.email : ''))
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const panel = useAgentPanel()
  const laptop = useIsLaptop()
  const menu = useRef<HTMLDivElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  useGoogleReturn()
  useArrival()
  useEffect(() => setMenuOpen(false), [location.pathname, location.search])

  // Escape closes the menu on a phone and returns to the button that opened it.
  useEffect(() => {
    if (!menuOpen || laptop) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setMenuOpen(false)
      menuButton.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen, laptop])

  // The only count in the sidebar, so nothing is counted twice.
  const waiting = useMemo(() => inboxCount(data), [data])
  const nav = [
    { to: '/app/today', label: 'Today', icon: Sun },
    { to: '/app', label: 'Inbox', icon: Inbox, end: true, badge: waiting },
    { to: '/app/students', label: 'Students', icon: Users },
    { to: '/app/meetings', label: 'Meetings', icon: CalendarDays },
    { to: '/app/messages', label: 'Messages', icon: Send },
    { to: '/app/documents', label: 'Documents', icon: FolderOpen },
  ]
  const marker = useMarker(menu, 'a[aria-current="page"]', `${location.pathname}${menuOpen}${laptop}`)
  // On a narrow screen the open assistant is a dialog: the page behind it is out of reach.
  const covered = panel.open && !laptop

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <a
        href="#main"
        inert={covered}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:flex focus:min-h-11 focus:items-center focus:rounded-control focus:bg-primary focus:px-4 focus:text-sm focus:font-semibold focus:text-on-primary"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        Skip to main content
      </a>
      <nav
        aria-label="Main"
        inert={covered}
        className="sticky top-0 z-20 flex max-h-dvh shrink-0 flex-col border-b border-line bg-sidebar text-sidebar-ink lg:h-dvh lg:w-60 lg:overflow-y-auto lg:border-b-0 lg:border-r"
      >
        <div className="flex items-center justify-between gap-1 px-3 py-1.5 lg:flex-col lg:items-stretch lg:gap-4 lg:px-4 lg:pb-4 lg:pt-5">
          <Link to="/app/today" className="flex min-h-11 shrink-0 items-center rounded-control" aria-label="Today">
            <Logo width={laptop ? 148 : 124} />
          </Link>
          <div className="flex items-center gap-1">
            <button
              type="button"
              id="assistant-button"
              className={cx(
                'flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-heading lg:w-full lg:border lg:border-line-strong',
                panel.open ? 'bg-sidebar-active' : 'hover:bg-chip lg:bg-surface lg:hover:bg-surface-2',
              )}
              aria-expanded={panel.open}
              aria-controls="agent-panel"
              aria-keyshortcuts="Meta+J Control+J"
              onClick={panel.toggle}
            >
              <Spark size={16} />
              <span className="lg:flex-1 lg:text-left">Assistant</span>
              <span aria-hidden className="hidden text-xs font-medium text-muted lg:inline">
                ⌘J
              </span>
            </button>
            <button
              ref={menuButton}
              type="button"
              className="flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-heading hover:bg-chip lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="main-menu"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X {...ICON} /> : <Menu {...ICON} />}
              {menuOpen ? 'Close' : 'Menu'}
            </button>
          </div>
        </div>

        <div id="main-menu" ref={menu} className={cx('relative min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4 lg:flex lg:overflow-visible', menuOpen ? 'motion-page flex' : 'hidden')}>
          {/* One marker that moves between the places, so the eye can follow it. */}
          {marker && (
            <span aria-hidden className="motion-marker pointer-events-none absolute left-3 top-0 z-10 h-px w-0.5 bg-primary" style={{ transform: `translateY(${marker.y + 8}px) scaleY(${marker.height - 16})` }} />
          )}
          {nav.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}

          <div className="mt-6 flex flex-col gap-3 lg:mt-auto lg:pt-6">
            <div className="flex flex-col gap-1 border-t border-line pt-3">
              <NavItem to="/app/activity" label="Activity" icon={ClipboardList} />
              <NavItem to="/app/settings" label="Settings" icon={Settings} />
              <button type="button" className={cx(NAV_ITEM, 'w-full text-left font-medium hover:bg-chip hover:text-heading')} onClick={() => void signOut()}>
                <LogOut {...ICON} className="shrink-0" />
                Sign out
              </button>
            </div>
            <AiConnection />
            <p className="px-3 text-[13px] leading-relaxed text-sidebar-muted">
              {data.firm.name}
              <br />
              Signed in as {data.firm.counselorName}
              <br />
              <span className="break-all">{email}</span>
            </p>
          </div>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
        <main id="main" tabIndex={-1} inert={covered} className="min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-10 lg:py-8">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-6">
            <LegacyImport />
            {/* A new page cross-fades in. Filters and tabs change only the query, and do not. */}
            <div key={location.pathname} className="motion-page flex min-w-0 flex-col gap-6">
              <Outlet />
            </div>
          </div>
        </main>
        {/* Stays mounted while closed so each thread survives a toggle. */}
        <AgentPanel open={panel.open} onClose={panel.close} />
      </div>
    </div>
  )
}

/**
 * Moving to another page moves focus to its heading and starts it at the top.
 * Going back keeps the place the browser restores. A change of filter or tab is
 * the same page, and does neither.
 */
function useArrival() {
  const { pathname, hash } = useLocation()
  const how = useNavigationType()
  const first = useRef(true)
  const last = useRef(pathname)
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (last.current === pathname) return
    last.current = pathname
    if (how !== 'POP' && !hash) window.scrollTo(0, 0)
    // Not while a window is open over the page: focus belongs to it.
    if (!document.querySelector('dialog[open]')) focusPage()
  }, [pathname, how, hash])
}

/**
 * Back from Google's consent screen (/app?google=connected and its other
 * values): say how it went and land on Settings, where the connection is.
 */
function useGoogleReturn() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const returned = params.get('google')
  const told = useRef(false)
  useEffect(() => {
    // Once, even when React runs the effect twice in development.
    if (!returned || told.current) return
    told.current = true
    navigate('/app/settings', { replace: true })
    toast(GOOGLE_RETURN[returned] ?? GOOGLE_RETURN.failed)
  }, [returned]) // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Offered once, to a counselor whose browser still holds data from the version
 * before accounts: copy it into the firm, or leave it behind.
 */
function LegacyImport() {
  const { hasLegacyData, importLegacyData, dismissLegacyData } = useStore.getState()
  const toast = useToast()
  const confirm = useConfirm()
  const [show, setShow] = useState(hasLegacyData)
  if (!show) return null
  return (
    <Card tone="accent" className="flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="min-w-0 flex-1 basis-64 text-sm">
        <span className="font-semibold">This browser has students saved from before accounts existed.</span> Import them into your firm, or leave them behind. Either way they are removed from this browser.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() => {
            toast(importLegacyData() ? 'Imported the data saved in this browser.' : 'There was nothing to import.')
            setShow(false)
          }}
        >
          Import the data saved in this browser
        </Button>
        <Button
          onClick={async () => {
            const yes = await confirm({ title: 'Leave that data behind', body: 'Leave that data behind? It will be removed from this browser and cannot be imported later.', action: 'Leave it behind' })
            if (!yes) return
            dismissLegacyData()
            setShow(false)
          }}
        >
          Not needed
        </Button>
      </div>
    </Card>
  )
}

/** The counselor's preview of a student's own view: a slim bar for getting back, and a phone-width column. */
export function StudentLayout() {
  const data = useData()
  const navigate = useNavigate()
  const { studentId } = useParams()
  const student = findStudent(data, studentId)
  usePageTitle(student ? `${fullName(student)}, as they see it` : 'Student view')
  if (!student) return <Navigate to="/app" replace />

  return (
    <div className="min-h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sidebar px-4 py-1.5 text-sidebar-ink">
        <label className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
          <span className="shrink-0">Student view</span>
          <select
            aria-label="Which student"
            className="min-h-11 min-w-0 rounded-control border border-line-strong bg-surface px-2 text-sm text-ink"
            value={student.id}
            onChange={(e) => navigate(`/student/${e.target.value}`)}
          >
            {activeStudents(data).map((s) => (
              <option key={s.id} value={s.id}>
                {fullName(s)}
              </option>
            ))}
          </select>
        </label>
        <Link to={`/app/students/${student.id}`} className="flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-accent hover:bg-accent-soft">
          <ArrowLeft {...ICON} />
          Back to counselor view
        </Link>
      </div>
      <main className="student-scale mx-auto flex min-h-[calc(100dvh-56px)] max-w-md flex-col gap-4 px-4 py-6">
        <Outlet context={student} />
      </main>
    </div>
  )
}
