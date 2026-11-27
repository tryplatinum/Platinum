// Sign in, start a firm, or ask for a password reset. Accounts are real
// (Supabase Auth, email and password), and a sign-in is one of three kinds: an
// owner or a counselor of a firm, or a student. /signin is for all of them;
// where each goes afterwards is decided in one place, homeOf in store/session.ts.
//
//   /signin          everyone
//   /signup          starts a firm: name, email, password, firm name, ending as its owner
//   /setup           the firm step alone, for someone who signed up and never made a firm
//   /start           signed in, no firm, no student account: start a firm, or open your invitation
//   /reset-password  where a reset link lands
//
// Joining a firm, or getting a student sign-in, is by invitation: src/screens/Join.tsx.

import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { Splash } from '../../components/RequireFirm'
import { MIN_PASSWORD } from '../../../shared/account'
import { Button, Field, LinkButton, inputClass, useConfirm, usePageTitle, useToast } from '../../components/ui'
import { deleteMySignIn } from '../../services/account'
import { supabaseConfigured } from '../../lib/supabase'
import { homeOf, pendingFirm, sendPasswordReset, setPassword, setUpFirm, signIn, signOut, signUp, startFirm } from '../../store/session'
import { useStore } from '../../store/store'

/** The page a member asked for before being sent here. Only counselor pages are honoured, and only for members. */
function useFrom(): string | undefined {
  const from = (useLocation().state as { from?: string } | null)?.from
  return from && /^\/(app|student)(\/|\?|$)/.test(from) ? from : undefined
}

export const LINK_CLASS = 'inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline'

export function Panel({ title, sub, children, onSubmit }: { title: string; sub?: ReactNode; children: ReactNode; onSubmit: (e: FormEvent) => void }) {
  usePageTitle(title)
  return (
    <Splash>
      <form className="motion-page flex w-full flex-col gap-4 rounded-card border border-line bg-surface p-6 text-left" onSubmit={onSubmit}>
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
        </div>
        {children}
      </form>
    </Splash>
  )
}

export const ErrorNote = ({ children }: { children: ReactNode }) =>
  children ? (
    <p role="alert" className="rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad">
      {children}
    </p>
  ) : null

/** A password that can be shown while it is typed. `autoComplete` is what a password manager goes by: current-password or new-password. */
export function PasswordInput({ value, onChange, autoComplete }: { value: string; onChange: (value: string) => void; autoComplete: 'current-password' | 'new-password' }) {
  const [shown, setShown] = useState(false)
  return (
    <span className="relative block">
      <input className={`${inputClass} pr-16!`} type={shown ? 'text' : 'password'} required minLength={autoComplete === 'new-password' ? MIN_PASSWORD : undefined} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} autoCapitalize="none" spellCheck={false} />
      <button type="button" aria-label={shown ? 'Hide the password' : 'Show the password'} className="absolute inset-y-0 right-0 min-w-11 rounded-control px-3 text-[13px] font-semibold text-accent hover:underline" onClick={() => setShown(!shown)}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </span>
  )
}

/** Runs one request at a time and keeps its error for the form to show. */
export function useSubmit() {
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

/** The rule for a new password, said before it is broken. */
export const PASSWORD_HINT = `At least ${MIN_PASSWORD} characters.`

/** Throws the sentence to show when a new password is too short. */
export function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD) throw new Error(`Use a password of at least ${MIN_PASSWORD} characters.`)
}

export default function SignIn() {
  const account = useStore((s) => s.account)
  const from = useFrom()
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPasswordValue] = useState('')
  const [notice, setNotice] = useState('')
  const { busy, error, run, clear } = useSubmit()

  // One place decides where a signed-in person belongs. A page asked for before sign-in is honoured for members.
  const home = homeOf(account)
  if (home) return <Navigate to={account.status === 'ready' && from ? from : home} replace />

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
        // The same sentence whether or not the address has an account.
        setNotice(`If ${address} has an account, a link to choose a new password is on its way.`)
      } else {
        await signIn(address, password)
      }
    })
  }

  return (
    <Panel title={mode === 'signin' ? 'Sign in' : 'Reset your password'} sub={mode === 'forgot' ? 'We will email you a link to choose a new one.' : 'For counselors, firm owners and students.'} onSubmit={submit}>
      {!supabaseConfigured && <ErrorNote>This build has no Supabase settings. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see the README) and restart.</ErrorNote>}
      {notice && (
        <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-ink">
          {notice}
        </p>
      )}
      <Field label="Email">
        <input className={inputClass} type="email" name="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" />
      </Field>
      {mode === 'signin' && (
        <Field label="Password">
          <PasswordInput value={password} onChange={setPasswordValue} autoComplete="current-password" />
        </Field>
      )}
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" variant="primary" busy={busy} disabled={account.status === 'loading'}>
        {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Send reset link'}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        {mode === 'signin' ? (
          <>
            <Link to="/signup" className={LINK_CLASS}>
              Start a firm
            </Link>
            <button type="button" className={LINK_CLASS} onClick={() => go('forgot')}>
              Forgot password?
            </button>
          </>
        ) : (
          <button type="button" className={LINK_CLASS} onClick={() => go('signin')}>
            Back to sign in
          </button>
        )}
      </div>
      {mode === 'signin' && <p className="border-t border-line pt-3 text-[13px] leading-relaxed text-muted">Invited by your firm or your counselor? Open the link they sent you. It sets up your sign-in.</p>}
    </Panel>
  )
}

/**
 * Starts a firm in one flow: your name, email, a password and the firm's name,
 * ending as its owner. When the project asks for the address to be confirmed
 * first, the firm's name is kept in this browser and the firm is made on the
 * first sign-in.
 */
export function SignUp() {
  const account = useStore((s) => s.account)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPasswordValue] = useState('')
  const [firm, setFirm] = useState('')
  const [sent, setSent] = useState('')
  const { busy, error, run } = useSubmit()

  // Mid-flow the session reports "no firm yet" for a moment; the form finishes the job itself.
  const home = homeOf(account)
  if (home && !busy) return <Navigate to={account.status === 'needs_firm' ? '/setup' : home} replace />

  if (sent) {
    return (
      <Splash>
        <div className="motion-page flex w-full flex-col gap-3 rounded-card border border-line bg-surface p-6 text-left">
          <h1 className="text-lg font-semibold">Confirm your email</h1>
          <p className="text-sm leading-relaxed text-ink-soft">
            We sent a link to <span className="font-semibold text-ink">{sent}</span>. Open it in this browser to confirm your address, then sign in. {firm.trim()} is made as soon as you do. In another browser you will be asked for the firm’s name once more.
          </p>
          <Link to="/signin" className={LINK_CLASS}>
            Back to sign in
          </Link>
        </div>
      </Splash>
    )
  }

  return (
    <Panel
      title="Start a firm"
      sub="You will be its owner, and can invite counselors and students afterwards."
      onSubmit={(e) => {
        e.preventDefault()
        void run(async () => {
          checkPassword(password)
          const address = email.trim()
          pendingFirm.keep({ firm: firm.trim(), name: name.trim(), email: address })
          if ((await signUp(address, password)) === 'confirm_email') setSent(address)
          else await startFirm()
        })
      }}
    >
      {!supabaseConfigured && <ErrorNote>This build has no Supabase settings. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see the README) and restart.</ErrorNote>}
      <Field label="Your name" hint="Used to sign messages and to record who approved each draft.">
        <input className={inputClass} name="name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Field>
      <Field label="Work email">
        <input className={inputClass} type="email" name="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="you@yourfirm.com" />
      </Field>
      <Field label="Password" hint={PASSWORD_HINT}>
        <PasswordInput value={password} onChange={setPasswordValue} autoComplete="new-password" />
      </Field>
      <Field label="Firm name">
        <input className={inputClass} name="organization" required maxLength={200} value={firm} onChange={(e) => setFirm(e.target.value)} placeholder="Northgate College Counseling" autoComplete="organization" />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" variant="primary" busy={busy} disabled={!firm.trim() || !name.trim()}>
        {busy ? 'Creating…' : 'Create firm'}
      </Button>
      <Link to="/signin" className={`${LINK_CLASS} self-start`}>
        I already have a sign-in
      </Link>
    </Panel>
  )
}

/**
 * Signed in, with no firm, no student account and no invitation open: say so,
 * and offer the two ways forward and the way out.
 */
export function Start() {
  const account = useStore((s) => s.account)
  const confirm = useConfirm()
  const toast = useToast()
  usePageTitle('Welcome')
  // For a sign-in that is left over: a student whose firm removed their record, or a sign-up that was a mistake.
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this sign-in', body: 'Your email address and password are removed from Platinum. This cannot be undone. An invitation sent to this address can still be used to make a new sign-in.', action: 'Delete sign-in' }))) return
    try {
      await deleteMySignIn()
      await signOut()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not work. Try again.')
    }
  }
  const home = homeOf(account)
  if (account.status === 'loading') return <Splash>{null}</Splash>
  if (account.status === 'signed_out') return <Navigate to="/signin" replace />
  if (account.status === 'error') return <Splash><p className="text-sm text-ink-soft">{account.message}</p></Splash>
  if (account.status !== 'needs_firm') return <Navigate to={home ?? '/signin'} replace />

  return (
    <Splash>
      <div className="motion-page flex w-full flex-col gap-4 rounded-card border border-line bg-surface p-6 text-left">
        <div>
          <h1 className="text-lg font-semibold">You are signed in, but not part of a firm yet</h1>
          <p className="mt-0.5 break-all text-[13px] text-muted">Signed in as {account.email}</p>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Starting your own practice?</h2>
          <LinkButton to="/setup" variant="primary" className="self-start">
            Start a firm
          </LinkButton>
        </div>
        <div className="flex flex-col gap-1 border-t border-line pt-4">
          <h2 className="text-sm font-semibold">I was invited</h2>
          <p className="text-sm leading-relaxed text-ink-soft">Open the link your firm sent you. It finishes setting up this sign-in. If you cannot find it, ask them for a new one.</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 border-t border-line pt-2">
          <button type="button" className={LINK_CLASS} onClick={() => void signOut()}>
            Sign out
          </button>
          <button type="button" className="inline-flex min-h-11 items-center text-sm font-semibold text-bad hover:underline" onClick={() => void remove()}>
            Delete this sign-in
          </button>
        </div>
      </div>
    </Splash>
  )
}

/** The firm step alone: for someone who signed up and never made a firm. Creates the firm with them as its owner. */
export function FirmSetup() {
  const account = useStore((s) => s.account)
  const kept = pendingFirm.read(account.status === 'needs_firm' ? account.email : undefined)
  const [firm, setFirm] = useState(kept?.firm ?? '')
  const [name, setName] = useState(kept?.name ?? '')
  const { busy, error, run } = useSubmit()

  if (account.status === 'signed_out') return <Navigate to="/signin" replace />
  if (account.status === 'ready' || account.status === 'student') return <Navigate to={homeOf(account)!} replace />
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
        <input className={inputClass} required maxLength={200} value={firm} onChange={(e) => setFirm(e.target.value)} placeholder="Northgate College Counseling" autoComplete="organization" />
      </Field>
      <Field label="Your name" hint="Used to sign messages and to record who approved each draft.">
        <input className={inputClass} required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" variant="primary" busy={busy} disabled={!firm.trim() || !name.trim()}>
        {busy ? 'Creating…' : 'Create firm'}
      </Button>
      <Link to="/start" className={`${LINK_CLASS} self-start`}>
        I was invited instead
      </Link>
      <button type="button" className={`${LINK_CLASS} self-start`} onClick={() => void signOut()}>
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

  // Whatever kind of account this is, back to where it belongs.
  if (done) return <Navigate to={homeOf(account) ?? '/signin'} replace />
  if (account.status === 'loading') return <Splash>{null}</Splash>
  if (account.status === 'signed_out') {
    return (
      <Splash>
        <div className="flex w-full flex-col gap-3 rounded-card border border-line bg-surface p-6 text-left">
          <h1 className="text-lg font-semibold">This reset link has expired</h1>
          <p className="text-sm text-ink-soft">Reset links work once and for a short time. Ask for a new one from the sign-in page.</p>
          <Link to="/signin" className={LINK_CLASS}>
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
          checkPassword(password)
          await setPassword(password)
          setDone(true)
        })
      }}
    >
      <Field label="New password" hint={PASSWORD_HINT}>
        <PasswordInput value={password} onChange={setPasswordValue} autoComplete="new-password" />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" variant="primary" busy={busy}>
        {busy ? 'Saving…' : 'Save password'}
      </Button>
    </Panel>
  )
}
