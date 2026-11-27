// A student's own page when they have a sign-in: /me.
//
// The same screens as the student link, fed another way. The page is asked of
// /api/student with the session's token instead of a link's, and the server
// builds the very same slice of data. There is no counselor navigation here,
// and no route under /me reaches a counselor screen.
//
// No analytics, trackers or third-party scripts run on this page.

import { useEffect, type ReactNode } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { Splash } from '../../components/RequireFirm'
import { Button, Card, Skeleton, usePageTitle } from '../../components/ui'
import { homeOf, refreshStudentAccount, signOut } from '../../store/session'
import { useStore } from '../../store/store'

function Column({ children }: { children: ReactNode }) {
  return <main className="student-scale mx-auto flex min-h-full max-w-md flex-col gap-4 px-4 py-6">{children}</main>
}

/** A counselor turned the sign-in off. Said plainly, with the way out. */
function TurnedOff({ email }: { email: string }) {
  usePageTitle('Sign-in turned off')
  return (
    <Column>
      <Card className="flex flex-col gap-3 p-5">
        <h1 className="text-lg font-semibold">This sign-in has been turned off</h1>
        <p className="text-sm leading-relaxed text-ink-soft">Your counselor turned it off, so your page does not open with it right now. Ask them about it. If they sent you a link to your page, that still works.</p>
        <p className="break-all text-[13px] text-muted">Signed in as {email}</p>
        <div>
          <Button onClick={() => void signOut()}>Sign out</Button>
        </div>
      </Card>
    </Column>
  )
}

/** The gate and the frame for /me: a student's sign-in, and their page loaded. */
export function StudentAccountLayout() {
  const account = useStore((s) => s.account)
  const load = useStore((s) => s.load)
  const loadError = useStore((s) => s.loadError)
  const student = useStore((s) => (s.account.status === 'student' && s.mode === 'student_link' ? s.data.students[0] : undefined))

  // Keep the page current, and notice a sign-in that was turned off, when the student comes back to it.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void refreshStudentAccount()
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [])

  if (account.status === 'loading') {
    return (
      <Splash>
        <p role="status" className="text-sm text-muted">
          Loading your page…
        </p>
      </Splash>
    )
  }
  if (account.status === 'signed_out') return <Navigate to="/signin" replace />
  // A member's home is the workspace; someone with no firm is asked what they came for.
  if (account.status !== 'student') return account.status === 'error' ? <Splash><p className="text-sm text-ink-soft">{account.message}</p></Splash> : <Navigate to={homeOf(account)!} replace />
  if (account.off) return <TurnedOff email={account.email} />

  if (load === 'error') {
    return (
      <Column>
        <Card className="flex flex-col gap-3 p-5">
          <h1 className="text-lg font-semibold">Your page could not be loaded</h1>
          <p className="text-sm text-ink-soft">{loadError ?? 'Something went wrong.'}</p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void refreshStudentAccount()}>
              Try again
            </Button>
            <Button onClick={() => void signOut()}>Sign out</Button>
          </div>
        </Card>
      </Column>
    )
  }

  return (
    <Column>
      {load === 'ready' && student ? (
        <Outlet context={student} />
      ) : (
        <div role="status" aria-label="Loading…" className="flex flex-col gap-4">
          <Skeleton className="h-16 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
    </Column>
  )
}
