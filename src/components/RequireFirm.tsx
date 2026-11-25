// The gate in front of every counselor screen: a session, a firm, and that
// firm's data loaded. Sends people to sign-in or firm setup and remembers the
// page they asked for.

import { useEffect, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { leaveStudentLink, retrySession, signOut } from '../store/session'
import { useStore } from '../store/store'
import { Logo } from './Logo'
import { Button, Skeleton } from './ui'

/**
 * A centred message under the logo, on the canvas: sign-in, loading and
 * failures. `reveal` is for the sign-in screen only: the logo fades and rises once.
 */
export function Splash({ children, reveal }: { children: ReactNode; reveal?: boolean }) {
  return (
    <main className="flex min-h-full items-center justify-center bg-canvas px-4 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <Logo width={200} className={reveal ? 'motion-logo' : undefined} />
        {children}
      </div>
    </main>
  )
}

function Problem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Splash>
      <div className="flex w-full flex-col gap-3 rounded-card border border-line bg-surface p-6 text-left">
        <h1 className="text-lg font-semibold">Could not load your workspace</h1>
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

/** The sidebar and a page, before there is anything to put in them. */
function WorkspaceLoading() {
  return (
    <div role="status" aria-label="Loading your workspace…" className="flex min-h-full flex-col lg:flex-row">
      <div className="flex items-center justify-between border-b border-line bg-sidebar px-3 py-1.5 lg:h-dvh lg:w-60 lg:flex-col lg:items-stretch lg:justify-start lg:gap-3 lg:border-b-0 lg:border-r lg:px-4 lg:py-5">
        <span className="flex min-h-11 items-center">
          <Logo width={124} />
        </span>
        <span className="hidden flex-col gap-3 lg:flex">
          {['a', 'b', 'c', 'd', 'e', 'f'].map((k) => (
            <Skeleton key={k} className="h-8 w-full" />
          ))}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
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
      <p role="status" className="text-sm text-muted">
        Loading your workspace…
      </p>
    </Splash>
  )

  if (account.status === 'loading') return loading
  if (account.status === 'signed_out') return <Navigate to="/signin" replace state={{ from }} />
  if (account.status === 'needs_firm') return <Navigate to="/setup" replace state={{ from }} />
  if (account.status === 'error') return <Problem message={account.message} onRetry={() => void retrySession()} />
  if (load === 'error') return <Problem message={loadError ?? 'Unknown error.'} onRetry={() => void reload()} />
  // Signed in, and the rows are on their way: the shape of the page, so nothing jumps when they arrive.
  if (load !== 'ready' || mode !== 'firm') return <WorkspaceLoading />
  return <Outlet />
}
