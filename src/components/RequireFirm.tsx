// The gate in front of every counselor screen: a session, a firm, and that
// firm's data loaded. Sends people to sign-in or firm setup and remembers the
// page they asked for.

import { useEffect, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { leaveStudentLink, retrySession, signOut } from '../store/session'
import { useStore } from '../store/store'
import { Button } from './ui'

/** A centred message on the sign-in background, for loading and for failures. */
export function Splash({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-sidebar px-4 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <p className="text-2xl font-bold text-white">Platinum</p>
        {children}
      </div>
    </div>
  )
}

function Problem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Splash>
      <div className="flex w-full flex-col gap-3 rounded-xl bg-surface p-6 text-left">
        <h1 className="text-lg font-bold text-ink">Could not load your workspace</h1>
        <p className="text-sm text-ink-soft">{message}</p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
          <Button onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
    </Splash>
  )
}

export function RequireFirm() {
  const account = useStore((s) => s.account)
  const load = useStore((s) => s.load)
  const loadError = useStore((s) => s.loadError)
  const mode = useStore((s) => s.mode)
  const reload = useStore((s) => s.reload)
  const location = useLocation()
  const from = location.pathname + location.search

  // A counselor who opened a student link in this browser comes back to their own data.
  useEffect(() => {
    if (mode === 'student_link') leaveStudentLink()
  }, [mode])

  const loading = (
    <Splash>
      <p role="status" className="text-sm text-sidebar-muted">
        Loading your workspace…
      </p>
    </Splash>
  )

  if (account.status === 'loading') return loading
  if (account.status === 'signed_out') return <Navigate to="/signin" replace state={{ from }} />
  if (account.status === 'needs_firm') return <Navigate to="/setup" replace state={{ from }} />
  if (account.status === 'error') return <Problem message={account.message} onRetry={() => void retrySession()} />
  if (load === 'error') return <Problem message={loadError ?? 'Unknown error.'} onRetry={() => void reload()} />
  if (load !== 'ready' || mode !== 'firm') return loading
  return <Outlet />
}
