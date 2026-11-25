// App chrome. Counselor: a light sidebar on the canvas colour, with the logo at
// the top (a top bar with a menu on narrow screens), and the page. Student: a
// slim bar and a phone-width column.
// Five places in the sidebar. Activity, Settings and Sign out sit in its footer.

import { ArrowLeft, CalendarDays, ClipboardList, FolderOpen, Inbox, LogOut, Menu, Send, Settings, Users, X, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { activeStudents, findStudent, fullName } from '../lib/derive'
import { inboxCount } from '../lib/inbox'
import { signOut } from '../store/session'
import { useData, useStore } from '../store/store'
import { AiConnection } from './AiConnection'
import { GOOGLE_RETURN } from './google/GoogleAccount'
import { AgentPanel, useAgentPanel } from './agent/AgentPanel'
import { Logo, Spark } from './Logo'
import { Button, Card, cx, useToast } from './ui'

/** Navigation and button icons: 20px, stroke 1.75. Always beside a text label. */
const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const

const NAV_ITEM = 'relative flex min-h-11 items-center gap-2.5 rounded-control px-3 text-sm'

function NavItem({ to, label, icon: Icon, end = false, badge = 0 }: { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          NAV_ITEM,
          isActive
            ? 'bg-sidebar-active font-semibold text-heading before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'
            : 'font-medium hover:bg-chip hover:text-heading',
        )
      }
    >
      <Icon {...ICON} className="shrink-0" />
      <span className="min-w-0 flex-1 whitespace-nowrap">{label}</span>
      {badge > 0 && (
        <span className="nums rounded-full bg-primary px-1.5 text-xs font-semibold text-on-primary" aria-label={`${badge} waiting for review`}>
          {badge}
        </span>
      )}
    </NavLink>
  )
}

export function CounselorLayout() {
  const data = useData()
  const email = useStore((s) => (s.account.status === 'ready' ? s.account.email : ''))
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const panel = useAgentPanel()
  useGoogleReturn()
  useEffect(() => setMenuOpen(false), [location.pathname, location.search])

  // The only count in the sidebar, so nothing is counted twice.
  const waiting = useMemo(() => inboxCount(data), [data])
  const nav = [
    { to: '/app', label: 'Inbox', icon: Inbox, end: true, badge: waiting },
    { to: '/app/students', label: 'Students', icon: Users },
    { to: '/app/meetings', label: 'Meetings', icon: CalendarDays },
    { to: '/app/messages', label: 'Messages', icon: Send },
    { to: '/app/documents', label: 'Documents', icon: FolderOpen },
  ]

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <nav aria-label="Main" className="flex shrink-0 flex-col border-b border-line bg-sidebar text-sidebar-ink lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-3 py-2 lg:px-4 lg:pb-4 lg:pt-5">
          <Link to="/app" className="flex min-h-11 items-center rounded-control">
            <Logo width={148} />
          </Link>
          <button
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

        <div id="main-menu" className={cx('flex-1 flex-col gap-1 px-3 pb-4 lg:flex', menuOpen ? 'flex' : 'hidden')}>
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
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="sticky top-0 z-20 flex items-center justify-end border-b border-line bg-canvas px-4 py-1.5 sm:px-6 lg:px-10">
            <button
              type="button"
              className={cx(
                'flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-semibold text-heading',
                panel.open ? 'bg-sidebar-active' : 'hover:bg-chip',
              )}
              aria-expanded={panel.open}
              aria-controls="agent-panel"
              aria-keyshortcuts="Meta+J Control+J"
              onClick={panel.toggle}
            >
              <Spark size={16} />
              Assistant
              <span aria-hidden className="text-xs font-medium text-muted">
                ⌘J
              </span>
            </button>
          </div>
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
            <div className="mx-auto flex max-w-[1240px] flex-col gap-6">
              <LegacyImport />
              <Outlet />
            </div>
          </main>
        </div>
        {/* Stays mounted while closed so each thread survives a toggle. */}
        <AgentPanel open={panel.open} onClose={panel.close} />
      </div>
    </div>
  )
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
  const [show, setShow] = useState(hasLegacyData)
  if (!show) return null
  return (
    <Card tone="accent" className="flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">This browser has students saved from before accounts existed.</span> Import them into your firm, or leave them behind. Either way they are removed from this browser.
      </p>
      <div className="flex gap-2">
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
          onClick={() => {
            if (!window.confirm('Leave that data behind? It will be removed from this browser and cannot be imported later.')) return
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
  if (!student) return <Navigate to="/app" replace />

  return (
    <div className="min-h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sidebar px-4 py-1.5 text-sidebar-ink">
        <label className="flex items-center gap-2 text-[13px] font-medium">
          Student view
          <select
            aria-label="Which student"
            className="min-h-11 rounded-control border border-line-strong bg-surface px-2 text-sm text-ink"
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
      <main className="student-scale mx-auto flex min-h-[calc(100vh-56px)] max-w-md flex-col gap-4 px-4 py-6">
        <Outlet context={student} />
      </main>
    </div>
  )
}
