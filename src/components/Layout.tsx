// App chrome. Counselor: a light sidebar on the canvas colour, with the logo at
// the top (a top bar with a menu on narrow screens), and the page. Student: a
// slim bar and a phone-width column.
// The Counselor / Student switcher and the demo controls live in the sidebar
// footer so they do not compete with the page.

import { ArrowLeft, CalendarDays, ChevronDown, ClipboardList, FolderOpen, Inbox, LayoutDashboard, Menu, Send, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { activeStudents, findStudent, fullName } from '../lib/derive'
import { inboxCount } from '../lib/inbox'
import { signOut } from '../store/session'
import { setAppearance, useAppearance } from '../theme'
import { useData, useStore } from '../store/store'
import { AiConnection } from './AiConnection'
import { FolderSettings } from './files/FolderSettings'
import { GOOGLE_RETURN, GoogleAccount } from './google/GoogleAccount'
import { YourPhone } from './phone/YourPhone'
import { AgentPanel, useAgentPanel } from './agent/AgentPanel'
import { Logo, Spark } from './Logo'
import { Button, Card, Field, Modal, SegmentedControl, cx, inputClass, useToast } from './ui'

/** Navigation and button icons: 20px, stroke 1.75. Always beside a text label. */
const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const

export function CounselorLayout() {
  const data = useData()
  const email = useStore((s) => (s.account.status === 'ready' ? s.account.email : ''))
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const panel = useAgentPanel()
  useEffect(() => setMenuOpen(false), [location.pathname, location.search])

  // The only count in the sidebar, so nothing is counted twice.
  const waiting = useMemo(() => inboxCount(data), [data])
  const nav = [
    { to: '/app', label: 'Inbox', icon: Inbox, end: true, badge: waiting, badgeLabel: 'waiting for review' },
    { to: '/app/overview', label: 'Overview', icon: LayoutDashboard, end: false, badge: 0, badgeLabel: '' },
    { to: '/app/students', label: 'Students', icon: Users, end: false, badge: 0, badgeLabel: '' },
    { to: '/app/meetings', label: 'Meetings', icon: CalendarDays, end: false, badge: 0, badgeLabel: '' },
    { to: '/app/messages', label: 'Messages sent', icon: Send, end: false, badge: 0, badgeLabel: '' },
    { to: '/app/documents', label: 'Documents', icon: FolderOpen, end: false, badge: 0, badgeLabel: '' },
    { to: '/app/activity', label: 'Activity', icon: ClipboardList, end: false, badge: 0, badgeLabel: '' },
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
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx(
                  'relative flex min-h-11 items-center gap-2.5 rounded-control px-3 text-sm',
                  isActive
                    ? 'bg-sidebar-active font-semibold text-heading before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'
                    : 'font-medium hover:bg-chip hover:text-heading',
                )
              }
            >
              <item.icon {...ICON} className="shrink-0" />
              <span className="min-w-0 flex-1 whitespace-nowrap">{item.label}</span>
              {item.badge > 0 && (
                <span className="nums rounded-full bg-primary px-1.5 text-xs font-semibold text-on-primary" aria-label={`${item.badge} ${item.badgeLabel}`}>
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}

          <div className="mt-6 flex flex-col gap-3 lg:mt-auto">
            <AiConnection />
            <SidebarMenu />
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

/** Student view switcher, demo data controls, firm settings and sign out. */
function SidebarMenu() {
  const data = useData()
  const navigate = useNavigate()
  const toast = useToast()
  const { resetDemo, startEmpty } = useStore.getState()
  const [settings, setSettings] = useState(false)
  const menu = useRef<HTMLDetailsElement>(null)
  const [params, setParams] = useSearchParams()
  const students = activeStudents(data)

  // Back from Google's consent screen (/app?google=connected): say how it went and show the Google row in Firm settings.
  const returned = params.get('google')
  const told = useRef(false)
  useEffect(() => {
    // Once, even when React runs the effect twice in development.
    if (!returned || told.current) return
    told.current = true
    const next = new URLSearchParams(params)
    next.delete('google')
    setParams(next, { replace: true })
    toast(GOOGLE_RETURN[returned] ?? GOOGLE_RETURN.failed)
    if (menu.current) menu.current.open = true
    setSettings(true)
  }, [returned]) // eslint-disable-line react-hooks/exhaustive-deps
  const item = 'flex min-h-11 w-full items-center rounded-control px-3 text-left text-sm font-medium hover:bg-surface-2 hover:text-heading'

  return (
    <details ref={menu} className="group rounded-control border border-line bg-surface">
      <summary className="flex min-h-11 list-none items-center justify-between gap-2 rounded-control px-3 text-sm font-semibold text-heading [&::-webkit-details-marker]:hidden">
        View and settings
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-muted group-open:rotate-180" />
      </summary>
      <div className="motion-rise flex flex-col gap-1 border-t border-line p-2">
        <label className="px-3 pt-1 text-xs font-semibold text-sidebar-muted" htmlFor="student-view">
          Open the student view as
        </label>
        <select
          id="student-view"
          className="mx-1 min-h-11 rounded-control border border-line-strong bg-surface px-2 text-sm text-ink disabled:bg-surface-2"
          value=""
          disabled={students.length === 0}
          onChange={(e) => e.target.value && navigate(`/student/${e.target.value}`)}
        >
          <option value="">{students.length ? 'Choose a student…' : 'No students yet'}</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {fullName(s)}
            </option>
          ))}
        </select>
        <button type="button" className={item} onClick={() => setSettings(true)}>
          Firm settings
        </button>
        <button
          type="button"
          className={item}
          onClick={() => {
            // Deleting a firm's data cannot be undone, so it takes a typed word, not a click.
            const typed = window.prompt('Reset to the sample caseload? This permanently deletes every student, task, meeting and message in your firm and loads the invented demo students.\n\nType RESET to confirm.')
            if (typed === null) return
            if (typed.trim() !== 'RESET') return toast('Nothing was changed. Type RESET exactly to confirm.')
            // Said only once it has happened: a counselor who is not the owner can be refused.
            void resetDemo().then((done) => {
              if (!done) return
              navigate('/app')
              toast('Sample caseload loaded.')
            })
          }}
        >
          Reset demo
        </button>
        <button
          type="button"
          className={item}
          onClick={() => {
            const typed = window.prompt('Start with an empty firm? This permanently deletes every student, task, meeting and message in your firm.\n\nType DELETE to confirm.')
            if (typed === null) return
            if (typed.trim() !== 'DELETE') return toast('Nothing was changed. Type DELETE exactly to confirm.')
            void startEmpty().then((done) => {
              if (!done) return
              navigate('/app/students')
              toast('Empty firm ready. Add your first student.')
            })
          }}
        >
          Start empty
        </button>
        <button type="button" className={item} onClick={() => void signOut()}>
          Sign out
        </button>
        <AppearanceSetting />
      </div>
      {settings && <FirmSettings onClose={() => setSettings(false)} />}
    </details>
  )
}

/**
 * Light or dark. Follows the device until that is switched off; then the
 * counselor chooses. Kept in this browser, not with the firm.
 */
function AppearanceSetting() {
  const { appearance, theme } = useAppearance()
  const auto = appearance === 'auto'
  return (
    <div className="mt-1 flex flex-col gap-2 border-t border-line px-3 pb-1 pt-3">
      <span className="text-xs font-semibold text-muted">Appearance</span>
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
        <input type="checkbox" className="h-5 w-5 shrink-0" checked={auto} onChange={(e) => setAppearance(e.target.checked ? 'auto' : theme)} />
        <span>
          Match this device
          <span className="block text-xs font-normal text-muted">{auto ? `Showing ${theme} now` : 'Off: choose below'}</span>
        </span>
      </label>
      {!auto && (
        <SegmentedControl
          label="Appearance"
          value={theme}
          onChange={setAppearance}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      )}
    </div>
  )
}

function FirmSettings({ onClose }: { onClose: () => void }) {
  const firm = useData().firm
  const updateFirm = useStore((s) => s.updateFirm)
  const [name, setName] = useState(firm.name)
  const [counselor, setCounselor] = useState(firm.counselorName)
  return (
    <Modal title="Firm settings" onClose={onClose} wide>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          updateFirm({ name: name.trim() || firm.name, counselorName: counselor.trim() || firm.counselorName })
          onClose()
        }}
      >
        <Field label="Firm name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Your name" hint="Used to sign messages and to record who approved each draft.">
          <input className={inputClass} value={counselor} onChange={(e) => setCounselor(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
      {/* Outside the form above: folders are saved as they are changed. */}
      <div className="mt-5">
        <FolderSettings />
      </div>
      <div className="mt-5">
        <GoogleAccount />
      </div>
      <div className="mt-5">
        <YourPhone />
      </div>
    </Modal>
  )
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
