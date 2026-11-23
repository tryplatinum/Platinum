// Sign in, create an account, or ask for a password reset. Accounts are real
// (Supabase Auth, email and password). Two more screens finish the job: firm
// setup on first sign-in, and choosing a new password from a reset link.

import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { Splash } from '../../components/RequireFirm'
import { Button, Field, inputClass } from '../../components/ui'
import { supabaseConfigured } from '../../lib/supabase'
import { sendPasswordReset, setPassword, setUpFirm, signIn, signOut, signUp } from '../../store/session'
import { useStore } from '../../store/store'

const MIN_PASSWORD = 8

/** The page the person asked for before being sent here. */
const useFrom = () => (useLocation().state as { from?: string } | null)?.from ?? '/app'

function Panel({ title, sub, children, onSubmit }: { title: string; sub?: ReactNode; children: ReactNode; onSubmit: (e: FormEvent) => void }) {
  return (
    <Splash>
      <form className="flex w-full flex-col gap-4 rounded-xl bg-surface p-6 text-left" onSubmit={onSubmit}>
        <div>
          <h1 className="text-lg font-bold text-ink">{title}</h1>
          {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
        </div>
        {children}
      </form>
    </Splash>
  )
}

const ErrorNote = ({ children }: { children: ReactNode }) =>
  children ? (
    <p role="alert" className="rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">
      {children}
    </p>
  ) : null

/** Runs one request at a time and keeps its error for the form to show. */
function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run, clear: () => setError('') }
}

export default function SignIn() {
  const account = useStore((s) => s.account)
  const from = useFrom()
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPasswordValue] = useState('')
  const [notice, setNotice] = useState('')
  const { busy, error, run, clear } = useSubmit()

  if (account.status === 'ready') return <Navigate to={from} replace />
  if (account.status === 'needs_firm') return <Navigate to="/setup" replace state={{ from }} />

  const go = (next: typeof mode) => {
    setMode(next)
    setNotice('')
    clear()
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setNotice('')
    void run(async () => {
      const address = email.trim()
      if (mode === 'forgot') {
        await sendPasswordReset(address)
        setNotice(`If ${address} has an account, a link to choose a new password is on its way.`)
      } else if (mode === 'signup') {
        if (password.length < MIN_PASSWORD) throw new Error(`Use a password of at least ${MIN_PASSWORD} characters.`)
        if ((await signUp(address, password)) === 'confirm_email') {
          setMode('signin')
          setNotice(`Check your email. We sent a link to ${address}; open it to confirm your address, then sign in.`)
        }
      } else {
        await signIn(address, password)
      }
    })
  }

  const title = mode === 'signin' ? 'Sign in to your firm' : mode === 'signup' ? 'Create your account' : 'Reset your password'
  const sub = mode === 'signup' ? 'You will name your firm on the next step.' : mode === 'forgot' ? 'We will email you a link to choose a new one.' : undefined
  const linkClass = 'min-h-11 text-sm font-semibold text-accent hover:underline'

  return (
    <Panel title={title} sub={sub} onSubmit={submit}>
      {!supabaseConfigured && <ErrorNote>This build has no Supabase settings. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see the README) and restart.</ErrorNote>}
      {notice && (
        <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-ink">
          {notice}
        </p>
      )}
      <Field label="Work email">
        <input className={inputClass} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@yourfirm.com" />
      </Field>
      {mode !== 'forgot' && (
        <Field label="Password" hint={mode === 'signup' ? `At least ${MIN_PASSWORD} characters.` : undefined}>
          <input
            className={inputClass}
            type="password"
            required
            value={password}
            onChange={(e) => setPasswordValue(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
        </Field>
      )}
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" variant="primary" disabled={busy || account.status === 'loading'}>
        {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        {mode === 'signin' ? (
          <>
            <button type="button" className={linkClass} onClick={() => go('signup')}>
              Create an account
            </button>
            <button type="button" className={linkClass} onClick={() => go('forgot')}>
              Forgot password?
            </button>
          </>
        ) : (
          <button type="button" className={linkClass} onClick={() => go('signin')}>
            Back to sign in
          </button>
        )}
      </div>
    </Panel>
  )
}

/** First sign-in: name the firm and yourself. Creates the firm with you as its owner. */
export function FirmSetup() {
  const account = useStore((s) => s.account)
  const from = useFrom()
  const [firm, setFirm] = useState('')
  const [name, setName] = useState('')
  const { busy, error, run } = useSubmit()

  if (account.status === 'signed_out') return <Navigate to="/signin" replace state={{ from }} />
  if (account.status === 'ready') return <Navigate to={from} replace />
  if (account.status !== 'needs_firm') return <Splash>{account.status === 'error' && <p className="text-sm text-sidebar-muted">{account.message}</p>}</Splash>

  return (
    <Panel
      title="Set up your firm"
      sub={`Signed in as ${account.email}`}
      onSubmit={(e) => {
        e.preventDefault()
        void run(() => setUpFirm(firm.trim(), name.trim()))
      }}
    >
      <Field label="Firm name">
        <input className={inputClass} required value={firm} onChange={(e) => setFirm(e.target.value)} placeholder="Northgate College Counseling" autoComplete="organization" />
      </Field>
      <Field label="Your name" hint="Used to sign messages and to record who approved each draft.">
        <input className={inputClass} required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" variant="primary" disabled={busy || !firm.trim() || !name.trim()}>
        {busy ? 'Creating…' : 'Create firm'}
      </Button>
      <button type="button" className="min-h-11 self-start text-sm font-semibold text-accent hover:underline" onClick={() => void signOut()}>
        Sign out
      </button>
    </Panel>
  )
}

/** Where a password reset link lands. The link signs the person in; this sets the new password. */
export function ResetPassword() {
  const account = useStore((s) => s.account)
  const [password, setPasswordValue] = useState('')
  const [done, setDone] = useState(false)
  const { busy, error, run } = useSubmit()

  if (done) return <Navigate to="/app" replace />
  if (account.status === 'loading') return <Splash>{null}</Splash>
  if (account.status === 'signed_out') {
    return (
      <Splash>
        <div className="flex w-full flex-col gap-3 rounded-xl bg-surface p-6 text-left">
          <h1 className="text-lg font-bold text-ink">This reset link has expired</h1>
          <p className="text-sm text-ink-soft">Reset links work once and for a short time. Ask for a new one from the sign-in page.</p>
          <Link to="/signin" className="min-h-11 text-sm font-semibold text-accent hover:underline">
            Back to sign in
          </Link>
        </div>
      </Splash>
    )
  }

  return (
    <Panel
      title="Choose a new password"
      onSubmit={(e) => {
        e.preventDefault()
        void run(async () => {
          if (password.length < MIN_PASSWORD) throw new Error(`Use a password of at least ${MIN_PASSWORD} characters.`)
          await setPassword(password)
          setDone(true)
        })
      }}
    >
      <Field label="New password" hint={`At least ${MIN_PASSWORD} characters.`}>
        <input className={inputClass} type="password" required value={password} onChange={(e) => setPasswordValue(e.target.value)} autoComplete="new-password" />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save password'}
      </Button>
    </Panel>
  )
}
