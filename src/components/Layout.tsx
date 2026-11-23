// App chrome: the demo bar with the Counselor / Student switcher, the counselor
// sidebar layout and the phone-width student layout.

import { NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { findStudent, fullName, pendingApprovals } from '../lib/derive'
import { reminderQueue } from '../lib/reminders'
import { useData, useStore } from '../store/store'
import { Avatar, cx } from './ui'

const DEFAULT_STUDENT = 's-kevin'

/** The student in the current URL, in either view. */
function useCurrentStudentId(): string | undefined {
  const { pathname } = useLocation()
  return pathname.match(/^\/(?:app\/students|student)\/([^/]+)/)?.[1]
}

/** Top bar, present on every signed-in screen. Lets us show both sides of the product on one call. */
export function DemoBar() {
  const data = useData()
  const resetDemo = useStore((s) => s.resetDemo)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const inStudentView = pathname.startsWith('/student')
  const currentId = useCurrentStudentId()
  const studentId = findStudent(data, currentId) ? currentId! : DEFAULT_STUDENT

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur">
      <span className="text-sm font-semibold tracking-tight text-ink">◆ Platinum</span>
      <span className="hidden rounded-full bg-canvas px-2 py-0.5 text-xs text-muted sm:inline">Demo · all data is invented</span>

      <div className="ml-auto flex items-center gap-2">
        <div className="inline-flex items-center rounded-lg border border-line bg-canvas p-0.5 text-sm" role="tablist" aria-label="View">
          <button
            role="tab"
            aria-selected={!inStudentView}
            onClick={() => navigate(inStudentView && currentId ? `/app/students/${currentId}` : '/app')}
            className={cx('rounded-md px-3 py-1 font-medium', !inStudentView ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}
          >
            Counselor
          </button>
          <div className={cx('flex items-center rounded-md', inStudentView ? 'bg-surface text-ink shadow-sm' : 'text-muted')}>
            <button role="tab" aria-selected={inStudentView} onClick={() => navigate(`/student/${studentId}`)} className="py-1 pl-3 pr-1 font-medium hover:text-ink">
              Student
            </button>
            <select
              aria-label="Which student"
              value={studentId}
              onChange={(e) => navigate(`/student/${e.target.value}`)}
              className="max-w-[9.5rem] cursor-pointer bg-transparent py-1 pr-1 text-sm font-medium focus:outline-none"
            >
              {data.students.map((s) => (
                <option key={s.id} value={s.id}>
                  {fullName(s)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          onClick={() => {
            if (window.confirm('Reset the demo? This restores the original sample data.')) resetDemo()
          }}
          className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-canvas hover:text-ink"
        >
          Reset demo
        </button>
      </div>
    </div>
  )
}

export function CounselorLayout() {
  const data = useData()
  const session = useStore((s) => s.session)
  const signOut = useStore((s) => s.signOut)
  const location = useLocation()
  if (!session.signedIn) return <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />

  const approvals = pendingApprovals(data).reduce((n, a) => n + a.count, 0)
  const queued = reminderQueue(data).filter((r) => r.mode === 'needs_approval').length
  const nav = [
    { to: '/app', label: 'Command center', end: true, badge: approvals },
    { to: '/app/students', label: 'Students', end: false, badge: 0 },
    { to: '/app/notes', label: 'Read my notes', end: false, badge: 0 },
    { to: '/app/reports', label: 'Parent reports', end: false, badge: 0 },
    { to: '/app/notifications', label: 'Reminders', end: false, badge: queued },
  ]

  return (
    <div className="min-h-full">
      <DemoBar />
      <div className="mx-auto flex max-w-[1400px] flex-col md:flex-row">
        <aside className="shrink-0 border-line md:sticky md:top-[45px] md:h-[calc(100vh-45px)] md:w-56 md:border-r">
          <div className="flex h-full flex-col p-3">
            <p className="hidden px-2 pb-3 pt-1 text-xs font-medium uppercase tracking-wide text-faint md:block">{data.firm.name}</p>
            <nav className="flex gap-1 overflow-x-auto md:flex-col">
              {nav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cx(
                      'flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium',
                      isActive ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:bg-surface/70 hover:text-ink',
                    )
                  }
                >
                  {item.label}
                  {item.badge > 0 && <span className="rounded-full bg-warn-soft px-1.5 text-xs font-semibold text-warn">{item.badge}</span>}
                </NavLink>
              ))}
            </nav>
            <div className="mt-auto hidden items-center gap-2 px-2 pt-4 md:flex">
              <Avatar name={data.firm.counselorName} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{data.firm.counselorName}</p>
                <button onClick={signOut} className="text-xs text-muted hover:text-ink">
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/** Phone-width column with bottom tabs. Looks right on a phone and as a narrow pane on a laptop. */
export function StudentLayout() {
  const data = useData()
  const { studentId } = useParams()
  const student = findStudent(data, studentId)
  if (!student) return <Navigate to={`/student/${DEFAULT_STUDENT}`} replace />

  const tabs = [
    { to: `/student/${student.id}`, label: 'Tasks', icon: '☑', end: true },
    { to: `/student/${student.id}/recaps`, label: 'Recaps', icon: '✎', end: false },
    { to: `/student/${student.id}/profile`, label: 'Profile', icon: '☺', end: false },
  ]

  return (
    <div className="min-h-full">
      <DemoBar />
      <div className="mx-auto min-h-[calc(100vh-45px)] max-w-md border-line bg-canvas pb-24 sm:border-x">
        <header className="flex items-center gap-3 px-4 pb-2 pt-5">
          <Avatar name={fullName(student)} />
          <div>
            <p className="text-xs text-muted">Student view</p>
            <p className="text-sm font-semibold text-ink">{fullName(student)}</p>
          </div>
        </header>
        <main className="px-4 py-3">
          <Outlet context={student} />
        </main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md border-t border-line bg-surface sm:border-x">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cx('flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium', isActive ? 'text-accent' : 'text-muted')
            }
          >
            <span className="text-base leading-none">{t.icon}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
