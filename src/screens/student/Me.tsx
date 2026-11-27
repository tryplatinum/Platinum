// A student's own page when they have a sign-in: /me.
//
// The same screens as the student link, fed another way. The page is asked of
// /api/student with the session's token instead of a link's, and the server
// builds the very same slice of data. There is no counselor navigation here,
// and no route under /me reaches a counselor screen.
//
//   /me           the student home (src/screens/student/StudentView.tsx, shared with the link)
//   /me/account   the email, change password, sign out, delete my sign-in,
//                 and what counselors can see
//
// Students will mostly use a phone app later; this page is small on purpose,
// and docs/student-api.md describes what it talks to.
//
// No analytics, trackers or third-party scripts run on this page.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { NavLink, Navigate, Outlet, useOutletContext } from 'react-router-dom'
import { COUNSELORS_CAN_SEE } from '../../../shared/account'
import { Logo } from '../../components/Logo'
import { Splash } from '../../components/RequireFirm'
import { Button, Card, Field, Note, Skeleton, cx, useConfirm, usePageTitle, useToast } from '../../components/ui'
import { deleteMySignIn } from '../../services/account'
import { homeOf, refreshStudentAccount, setPassword, signOut } from '../../store/session'
import type { Student } from '../../types'
import { PASSWORD_HINT, PasswordInput, checkPassword } from '../counselor/SignIn'
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
  const firmName = useStore((s) => s.data.firm.name)

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
      {/* Names the firm and the student, and holds the only two places there are. No counselor navigation. */}
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line pb-3">
        <p className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-muted">
          <Logo variant="symbol" width={32} decorative />
          <span className="min-w-0">
            <span className="block truncate">{firmName}</span>
            {student && <span className="block font-semibold text-ink">{student.firstName}</span>}
          </span>
        </p>
        <nav aria-label="Your pages" className="flex gap-1">
          {[
            { to: '/me', label: 'Home', end: true },
            { to: '/me/account', label: 'Account', end: false },
          ].map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => cx('flex min-h-11 items-center rounded-control px-3 text-sm font-semibold', isActive ? 'bg-accent-soft-2 text-accent-hover' : 'text-accent hover:bg-accent-soft')}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
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

/** The student's own account: the address, a new password, the way out, and deleting the sign-in. */
export function StudentAccount() {
  const student = useOutletContext<Student>()
  const email = useStore((s) => (s.account.status === 'student' ? s.account.email : ''))
  const firmName = useStore((s) => s.data.firm.name)
  const confirm = useConfirm()
  const toast = useToast()
  const [password, setPasswordValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  usePageTitle('Your account')

  const change = (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSaved(false)
    try {
      checkPassword(password)
    } catch (problem) {
      return setError(problem instanceof Error ? problem.message : 'That password is too short.')
    }
    setBusy(true)
    setPassword(password)
      .then(() => {
        setPasswordValue('')
        setSaved(true)
      })
      .catch((problem: unknown) => setError(problem instanceof Error ? problem.message : 'That did not work. Try again.'))
      .finally(() => setBusy(false))
  }

  const remove = async () => {
    const yes = await confirm({
      title: 'Delete my sign-in',
      body: `Your email address and password are removed from Platinum, and you are signed out. This cannot be undone. ${firmName} keeps its record of you: your tasks, meetings and files stay with your counselor, and a link they send you still opens your page.`,
      action: 'Delete my sign-in',
      word: 'DELETE',
      wrongWord: 'Type DELETE to delete your sign-in.',
    })
    if (!yes) return
    try {
      await deleteMySignIn()
      await signOut()
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'That did not work. Try again.')
    }
  }

  return (
    <>
      <h1 tabIndex={-1} className="text-2xl font-semibold focus:outline-none">
        Your account
      </h1>

      <Card className="flex flex-col gap-1 p-4">
        <h2 className="text-[15px] font-semibold">Sign-in</h2>
        <p className="break-all text-sm text-ink-soft">{email}</p>
        <p className="text-[13px] text-muted">
          {student.firstName} at {firmName}. Your email address and a password are all this account holds.
        </p>
      </Card>

      <Card className="p-4">
        <form className="flex flex-col gap-3" onSubmit={change}>
          <h2 className="text-[15px] font-semibold">Change password</h2>
          {/* For a password manager: which account the new password belongs to. */}
          <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
          <Field label="New password" hint={PASSWORD_HINT}>
            <PasswordInput value={password} onChange={setPasswordValue} autoComplete="new-password" />
          </Field>
          {error && (
            <Note tone="bad" role="alert">
              {error}
            </Note>
          )}
          {saved && <Note role="status">Your password was changed.</Note>}
          <div>
            <Button type="submit" variant="primary" busy={busy}>
              Save password
            </Button>
          </div>
        </form>
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="text-[15px] font-semibold">What your counselors can see</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          {COUNSELORS_CAN_SEE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-[13px] text-muted">They cannot see your password. Nothing here tracks you: this page has no analytics and no advertising.</p>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div>
          <Button onClick={() => void signOut()}>Sign out</Button>
        </div>
        <div className="border-t border-line pt-3">
          <h2 className="text-[15px] font-semibold">Delete my sign-in</h2>
          <p className="mt-0.5 text-sm text-ink-soft">Removes your email address and password. {firmName} keeps its record of you, and your counselor can still send you a link to your page.</p>
          <Button variant="danger" className="mt-3" onClick={() => void remove()}>
            Delete my sign-in
          </Button>
        </div>
      </Card>
    </>
  )
}
