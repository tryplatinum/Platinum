// App chrome. Counselor: a dark sidebar (a top bar with a menu on narrow
// screens) and the page. Student: a slim bar and a phone-width column.
// The Counselor / Student switcher and the demo controls live in the sidebar
// footer so they do not compete with the page.

import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { activeStudents, findStudent, fullName, pendingApprovalCount, pendingApprovals } from '../lib/derive'
import { filesWaitingCount } from '../lib/files'
import { reminderQueue } from '../lib/reminders'
import { signOut } from '../store/session'
import { useData, useStore } from '../store/store'
import { AiConnection } from './AiConnection'
import { FolderSettings } from './files/FolderSettings'
import { Button, Card, Field, Modal, cx, inputClass, useToast } from './ui'

export function CounselorLayout() {
  const data = useData()
  const email = useStore((s) => (s.account.status === 'ready' ? s.account.email : ''))
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => setMenuOpen(false), [location.pathname, location.search])

  const nav = [
    { to: '/app', label: 'Command center', end: true, badge: pendingApprovalCount(data), badgeLabel: 'waiting for approval' },
    { to: '/app/students', label: 'Students', end: false, badge: 0, badgeLabel: '' },
    { to: '/app/meetings', label: 'Meetings', end: false, badge: pendingApprovals(data).filter((a) => a.kind === 'meeting').length, badgeLabel: 'to review' },
    { to: '/app/messages', label: 'Messages sent', end: false, badge: reminderQueue(data).filter((r) => r.mode === 'needs_approval').length, badgeLabel: 'reminders waiting' },
    { to: '/app/documents', label: 'Documents', end: false, badge: filesWaitingCount(data), badgeLabel: 'files waiting or to check' },
  ]

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <nav aria-label="Main" className="on-dark flex shrink-0 flex-col bg-sidebar text-sidebar-ink lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 lg:px-7 lg:pb-5 lg:pt-6">
          <Link to="/app" className="text-lg font-bold text-white">
            Platinum
          </Link>
          <button
            type="button"
            className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-white hover:bg-sidebar-active lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="main-menu"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>

        <div id="main-menu" className={cx('flex-1 flex-col gap-1 px-4 pb-4 lg:flex', menuOpen ? 'flex' : 'hidden')}>
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx('flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-sm', isActive ? 'bg-sidebar-active font-semibold text-white' : 'font-medium hover:bg-sidebar-active/60')
              }
            >
              {item.label}
              {item.badge > 0 && (
                <span className="rounded-full bg-white px-2 text-xs font-bold text-sidebar" aria-label={`${item.badge} ${item.badgeLabel}`}>
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

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-6">
          <LegacyImport />
          <Outlet />
        </div>
      </main>
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
  const students = activeStudents(data)
  const item = 'flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-medium hover:bg-sidebar-active'

  return (
    <details className="rounded-lg border border-white/15">
      <summary className="flex min-h-11 items-center px-3 text-sm font-medium text-white">View and settings</summary>
      <div className="flex flex-col gap-1 border-t border-white/15 p-2">
        <label className="px-3 pt-1 text-xs font-semibold text-sidebar-muted" htmlFor="student-view">
          Open the student view as
        </label>
        <select
          id="student-view"
          className="mx-1 min-h-11 rounded-lg border border-white/20 bg-sidebar px-2 text-sm text-white"
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
      </div>
      {settings && <FirmSettings onClose={() => setSettings(false)} />}
    </details>
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
      <div className="on-dark flex flex-wrap items-center justify-between gap-2 bg-sidebar px-4 py-1.5 text-sidebar-ink">
        <label className="flex items-center gap-2 text-[13px]">
          Student view
          <select
            aria-label="Which student"
            className="min-h-11 rounded-lg border border-white/20 bg-sidebar px-2 text-sm text-white"
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
        <Link to={`/app/students/${student.id}`} className="flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-white hover:bg-sidebar-active">
          Back to counselor view
        </Link>
      </div>
      <main className="mx-auto flex min-h-[calc(100vh-56px)] max-w-md flex-col gap-4 px-4 py-6">
        <Outlet context={student} />
      </main>
    </div>
  )
}
