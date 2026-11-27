// Where an invitation link lands: /join#<secret>.
//
// The secret is in the fragment, which a browser never sends to a server, so
// it reaches no server log and no Referer. It is read once, kept in memory for
// this tab, and taken out of the address bar at once.
//
// The page shows what the invitation is for (the firm, the kind, the invited
// address masked, and for a student their first name), then lets the person
// make a password or sign in with the invited address, then accepts. Accepting
// is the server's decision: the address must be the invited one and confirmed.
// A link that is unknown, expired, replaced or used gets one plain message.
//
// No analytics, trackers or third-party scripts run on this page, and nothing
// is asked of a student beyond an email address and a password.

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { COUNSELORS_CAN_SEE, INVITE_SECRET, STUDENT_AGE, STUDENT_SEES, type InvitationPreview } from '../../shared/account'
import { Splash } from '../components/RequireFirm'
import { Button, CheckRow, Field, Note, SegmentedControl, Skeleton, inputClass, usePageTitle } from '../components/ui'
import { AccountFailure, acceptInvitation, previewInvitation } from '../services/account'
import { homeOf, pendingFirm, reenter, signIn, signOut, signUp } from '../store/session'
import { useStore } from '../store/store'
import { ErrorNote, LINK_CLASS, PASSWORD_HINT, PasswordInput, checkPassword, useSubmit } from './counselor/SignIn'

/** The secret of the invitation open in this tab. In memory only: never stored, never in the address after the first render. */
let held: string | undefined

function Box({ title, children }: { title: string; children: ReactNode }) {
  usePageTitle(title)
  // The form was replaced by this message without a change of page: move focus to it, so it is read out.
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [title])
  return (
    <Splash>
      <div className="motion-page flex w-full flex-col gap-3 rounded-card border border-line bg-surface p-6 text-left">
        <h1 ref={heading} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
          {title}
        </h1>
        {children}
      </div>
    </Splash>
  )
}

/** What a student is told before they make a sign-in: what it holds, what they will see, and who can see what they do. */
function StudentNotice({ firmName }: { firmName: string }) {
  const list = 'mt-1 list-disc space-y-0.5 pl-5'
  return (
    <div className="flex flex-col gap-3 rounded-control bg-canvas px-3 py-3 text-[13px] leading-relaxed text-ink-soft">
      <p>
        <span className="font-semibold text-ink">What this account holds.</span> Your email address and a password. Nothing else is asked for.
      </p>
      <div>
        <p className="font-semibold text-ink">What you will see.</p>
        <ul className={list}>
          {STUDENT_SEES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="font-semibold text-ink">What your counselors at {firmName} can see.</p>
        <ul className={list}>
          {COUNSELORS_CAN_SEE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default function Join() {
  const location = useLocation()
  const navigate = useNavigate()
  const account = useStore((s) => s.account)
  const [secret, setSecret] = useState(() => {
    const fromLink = location.hash.slice(1)
    if (fromLink) held = fromLink
    return held ?? ''
  })
  const [preview, setPreview] = useState<InvitationPreview>()
  /** dead: the link does not work. offline: it could not be checked. confirm: the address has to be confirmed first. */
  const [stage, setStage] = useState<'loading' | 'ready' | 'none' | 'dead' | 'offline' | 'confirm' | 'done'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [email, setEmail] = useState('')
  const [password, setPasswordValue] = useState('')
  const [name, setName] = useState('')
  const [age, setAge] = useState(false)
  const [refusal, setRefusal] = useState<'wrong_email' | 'already_member'>()
  const { busy, error, run, clear } = useSubmit()

  // Out of the address bar at once, and out of the history entry with it. Another invitation
  // opened in the same tab arrives here too: it replaces the first, and is removed the same way.
  const arrived = location.hash.slice(1)
  useEffect(() => {
    if (!arrived) return
    if (arrived !== secret) {
      held = arrived
      setSecret(arrived)
      setRefusal(undefined)
    }
    navigate('/join', { replace: true })
  }, [arrived]) // eslint-disable-line react-hooks/exhaustive-deps

  // A firm name left over from an abandoned sign-up must not be made for someone who came to join.
  useEffect(() => pendingFirm.clear(), [])

  useEffect(() => {
    let live = true
    if (!secret) {
      setStage('none')
      return
    }
    if (!INVITE_SECRET.safeParse(secret).success) {
      setStage('dead')
      return
    }
    setStage('loading')
    previewInvitation(secret)
      .then((found) => {
        if (!live) return
        setPreview(found)
        setStage('ready')
      })
      .catch((e) => live && setStage(e instanceof AccountFailure && e.code === 'dead_invitation' ? 'dead' : 'offline'))
    return () => {
      live = false
    }
  }, [secret, attempt])

  const student = preview?.kind === 'student'
  const signedIn = account.status === 'ready' || account.status === 'student' || account.status === 'needs_firm'

  /** Accepts for whoever is signed in now, and turns the server's refusal into the screen that explains it. */
  const accept = async () => {
    try {
      await acceptInvitation(secret, student ? { ageConfirmed: true } : { displayName: name.trim() })
    } catch (e) {
      if (!(e instanceof AccountFailure)) throw e
      if (e.code === 'dead_invitation') return setStage('dead')
      if (e.code === 'confirm_email') return setStage('confirm')
      if (e.code === 'wrong_email' || e.code === 'already_member') return setRefusal(e.code)
      throw e
    }
    held = undefined
    setStage('done')
    await reenter()
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      if (student && !age) throw new Error('Tick “I am 13 or older” to continue.')
      if (!student && !name.trim()) throw new Error('Enter your name.')
      if (!signedIn) {
        const address = email.trim()
        if (mode === 'new') {
          checkPassword(password)
          let made: Awaited<ReturnType<typeof signUp>>
          try {
            made = await signUp(address, password)
          } catch (problem) {
            if (problem instanceof Error && /already registered/i.test(problem.message)) throw new Error('That address already has a sign-in. Choose “I have a sign-in” and use its password.', { cause: problem })
            throw problem
          }
          if (made === 'confirm_email') return setStage('confirm')
        } else {
          await signIn(address, password)
        }
      }
      await accept()
    })
  }

  // Accepted, and the session now knows what kind of account this is.
  if (stage === 'done') {
    const home = homeOf(account)
    return home && home !== '/start' ? <Navigate to={home} replace /> : <Splash><p role="status" className="text-sm text-muted">Setting things up…</p></Splash>
  }

  // Who is signed in is not known yet: the form would ask a signed-in person to sign in.
  if (stage === 'loading' || account.status === 'loading') {
    return (
      <Splash>
        <div role="status" aria-label="Opening your invitation…" className="flex w-full flex-col gap-3 rounded-card border border-line bg-surface p-6">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </Splash>
    )
  }

  // The page was reloaded, or opened without its link: the secret is never stored, so it is asked for again.
  if (stage === 'none') {
    return (
      <Box title="Open your invitation link again">
        <p className="text-sm leading-relaxed text-ink-soft">This page needs the link you were sent, and it does not keep it after a reload. Open the link again from the message it came in. If you already finished setting up, sign in.</p>
        <Link to="/signin" className={LINK_CLASS}>
          Go to sign in
        </Link>
      </Box>
    )
  }

  if (stage === 'dead') {
    return (
      <Box title="This invitation link does not work">
        <p className="text-sm leading-relaxed text-ink-soft">It may have expired, been replaced by a newer one, or been used already. Ask the person who sent it for a new link. If you already finished setting up, sign in.</p>
        <Link to="/signin" className={LINK_CLASS}>
          Go to sign in
        </Link>
      </Box>
    )
  }

  if (stage === 'offline' || !preview) {
    return (
      <Box title="Could not open your invitation">
        <p className="text-sm leading-relaxed text-ink-soft">There may be no connection right now. Your link is still good.</p>
        <div>
          <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      </Box>
    )
  }

  if (stage === 'confirm') {
    return (
      <Box title="Confirm your email first">
        <p className="text-sm leading-relaxed text-ink-soft">
          We sent a confirmation email to the address you gave. Open the link in it, then <span className="font-semibold text-ink">open your invitation link again</span> to finish. The invitation keeps working until it expires.
        </p>
        <p className="text-[13px] text-muted">No email after a few minutes? The address may already have a sign-in: go back and choose “I have a sign-in”. Or check it is the address the invitation was sent to.</p>
        <div>
          <Button
            onClick={() => {
              setMode('existing')
              clear()
              setStage('ready')
            }}
          >
            Back
          </Button>
        </div>
      </Box>
    )
  }

  const what = student ? `A sign-in for ${preview.studentFirstName ?? 'you'}` : `Join ${preview.firmName}`
  const intro = student ? (
    <>
      {preview.firmName} has invited <span className="font-semibold text-ink">{preview.studentFirstName}</span> to make a sign-in for their own page.
    </>
  ) : (
    <>
      You have been invited to join <span className="font-semibold text-ink">{preview.firmName}</span> as a counselor.
    </>
  )
  const invited = (
    <p className="text-[13px] text-muted">
      The invitation was sent to <span className="font-semibold text-ink-soft">{preview.email}</span>.
    </p>
  )

  if (refusal === 'wrong_email' && signedIn) {
    return (
      <Box title="This invitation is for another address">
        <p className="text-sm leading-relaxed text-ink-soft">
          You are signed in as <span className="break-all font-semibold text-ink">{account.email}</span>. The invitation was sent to {preview.email}. Sign out, then sign in or make a password with that address.
        </p>
        <div>
          <Button
            variant="primary"
            onClick={() => {
              setRefusal(undefined)
              clear()
              void signOut()
            }}
          >
            Sign out
          </Button>
        </div>
      </Box>
    )
  }

  // A sign-in that is already a member of a firm, or already a student's, cannot take an invitation.
  if (signedIn && (refusal === 'already_member' || account.status !== 'needs_firm')) {
    return (
      <Box title="This sign-in is already in use">
        <p className="text-sm leading-relaxed text-ink-soft">
          You are signed in as <span className="break-all font-semibold text-ink">{account.email}</span>, which already {account.status === 'student' ? 'is a student’s sign-in' : 'belongs to a firm'}. A sign-in is one or the other. To use this invitation, sign out and use the address it was sent to.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Button
            onClick={() => {
              setRefusal(undefined)
              void signOut()
            }}
          >
            Sign out
          </Button>
          <Link to={homeOf(account) ?? '/signin'} className={LINK_CLASS}>
            Go to my page
          </Link>
        </div>
      </Box>
    )
  }

  return (
    <Splash>
      <form className="motion-page flex w-full flex-col gap-4 rounded-card border border-line bg-surface p-6 text-left" onSubmit={submit}>
        <JoinTitle title={what} />
        <div className="flex flex-col gap-1">
          <p className="text-sm leading-relaxed text-ink-soft">{intro}</p>
          {invited}
        </div>

        {student && <StudentNotice firmName={preview.firmName} />}

        {signedIn ? (
          <Note>
            Signed in as <span className="break-all font-semibold text-ink">{account.email}</span>.
          </Note>
        ) : (
          <>
            <SegmentedControl
              label="How you will sign in"
              value={mode}
              onChange={(next) => {
                setMode(next)
                clear()
              }}
              options={[
                { value: 'new', label: 'Create a password' },
                { value: 'existing', label: 'I have a sign-in' },
              ]}
            />
            <Field label="Your email" hint="Use the address the invitation was sent to.">
              <input className={inputClass} type="email" name="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} />
            </Field>
            <Field label={mode === 'new' ? 'Choose a password' : 'Password'} hint={mode === 'new' ? PASSWORD_HINT : undefined}>
              <PasswordInput value={password} onChange={setPasswordValue} autoComplete={mode === 'new' ? 'new-password' : 'current-password'} />
            </Field>
          </>
        )}

        {!student && (
          <Field label="Your name" hint="Used to sign messages and to record who approved each draft.">
            <input className={inputClass} name="name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
        )}
        {student && (
          <CheckRow checked={age} onChange={setAge}>
            {STUDENT_AGE.text}
          </CheckRow>
        )}

        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" variant="primary" busy={busy}>
          {busy ? 'One moment…' : student ? 'Continue' : `Join ${preview.firmName}`}
        </Button>
        <p className="text-[13px] leading-relaxed text-muted">{student ? 'You can delete this sign-in yourself at any time, from your Account page.' : 'You will be a counselor in this firm. An owner can change that later.'}</p>
      </form>
    </Splash>
  )
}

function JoinTitle({ title }: { title: string }) {
  usePageTitle(title)
  return <h1 className="text-lg font-semibold">{title}</h1>
}
