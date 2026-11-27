// A student's sign-in, as a counselor manages it: its state (none, invited,
// on, turned off) and the actions for that state. Used on the student page and
// in the owner's list, so both do exactly the same thing.
//
// An invitation is a link the counselor copies and sends themselves. Platinum
// does not email it, text it or queue it: nothing here touches the outbox.

import { useEffect, useState, type FormEvent } from 'react'
import { GUARDIAN_CONSENT, INVITE_DAYS, joinLink, type NewInvitation, type StudentSignIn } from '../../../shared/account'
import { formatTimestamp } from '../../lib/dates'
import { copyText } from '../../lib/studentLinks'
import { AccountFailure, inviteStudent, newInvitationLink, revokeInvitation, setStudentSignIn, studentSignIn } from '../../services/account'
import type { Student } from '../../types'
import { Button, CheckRow, Field, Modal, Note, Pill, Skeleton, inputClass, useConfirm, useToast, type Tone } from '../ui'
import { QrCode } from './QrCode'

export const SIGN_IN_LABEL: Record<StudentSignIn['state'], string> = { none: 'No sign-in', invited: 'Invited', on: 'On', off: 'Turned off' }
const SIGN_IN_TONE: Record<StudentSignIn['state'], Tone> = { none: 'neutral', invited: 'accent', on: 'good', off: 'warn' }

/** The state as a pill. An invitation that ran out says so. */
export function SignInPill({ signIn }: { signIn: StudentSignIn }) {
  if (signIn.state === 'invited' && signIn.expired) return <Pill tone="warn">Invitation expired</Pill>
  return <Pill tone={SIGN_IN_TONE[signIn.state]}>{SIGN_IN_LABEL[signIn.state]}</Pill>
}

/** One line under the state: the address, and when an invitation runs out. */
export function signInDetail(signIn: StudentSignIn): string {
  if (signIn.tooYoung && signIn.state === 'none') return 'Below 9th grade. Use the student link instead.'
  if (signIn.state === 'invited') return `${signIn.email ?? ''} · ${signIn.expired ? 'expired' : 'expires'} ${signIn.expiresAt ? formatTimestamp(signIn.expiresAt) : ''}`
  return signIn.email ?? ''
}

/**
 * A new invitation's link, shown once: to copy, or to scan. `scan` adds the QR
 * code, for a student standing next to the counselor.
 */
export function InvitationLink({ made, scan }: { made: NewInvitation; scan?: boolean }) {
  const toast = useToast()
  const link = joinLink(window.location.origin, made.secret)
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent-line bg-accent-soft p-3">
      <Field label={`Invitation link for ${made.email}`}>
        <input className={inputClass} readOnly value={link} onFocus={(e) => e.target.select()} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={() =>
            void copyText(link)
              .then(() => toast('Link copied. Send it yourself.'))
              .catch((e: unknown) => toast(e instanceof Error ? e.message : 'Nothing was copied.'))
          }
        >
          Copy link
        </Button>
        <span className="text-[13px] text-muted">Works once, until {formatTimestamp(made.expiresAt)}.</span>
      </div>
      {scan && <QrCode value={link} label="QR code that opens this invitation" />}
      <p className="text-[13px] leading-relaxed text-ink-soft">
        Platinum does not email this. Copy the link and send it yourself, to {made.email} only. It is shown this once; if it is lost, make a new link.
      </p>
    </div>
  )
}

/** The buttons for the state a sign-in is in, with the windows they open. `onChange` gets the sign-in as it now is. */
export function SignInActions({ signIn, firstName, onChange }: { signIn: StudentSignIn; firstName: string; onChange: (next: StudentSignIn) => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [fresh, setFresh] = useState<NewInvitation>()

  const attempt = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const refresh = async () => onChange(await studentSignIn(signIn.studentId))

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {signIn.state === 'none' && !signIn.tooYoung && (
          <Button disabled={busy} onClick={() => setInviting(true)}>
            Invite
          </Button>
        )}
        {signIn.state === 'invited' && signIn.invitationId && (
          <>
            <Button
              busy={busy}
              onClick={() =>
                void attempt(async () => {
                  setFresh(await newInvitationLink(signIn.invitationId!))
                  await refresh()
                })
              }
            >
              New link
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void attempt(async () => {
                  if (!(await confirm({ title: 'Revoke the invitation', body: `The link sent to ${signIn.email} stops working. ${firstName} keeps their student link, if they have one.`, action: 'Revoke' }))) return
                  await revokeInvitation(signIn.invitationId!)
                  await refresh()
                  toast('Invitation revoked.')
                })
              }
            >
              Revoke
            </Button>
          </>
        )}
        {signIn.state === 'on' && (
          <Button
            disabled={busy}
            onClick={() =>
              void attempt(async () => {
                if (!(await confirm({ title: `Turn off ${firstName}’s sign-in`, body: `${firstName} can no longer open their page by signing in, from their next request. Nothing is deleted, and you can turn it back on. Their student link is not affected.`, action: 'Turn off' }))) return
                onChange(await setStudentSignIn(signIn.studentId, false))
                toast(`${firstName}’s sign-in is off.`)
              })
            }
          >
            Turn off
          </Button>
        )}
        {signIn.state === 'off' && (
          <Button
            busy={busy}
            onClick={() =>
              void attempt(async () => {
                onChange(await setStudentSignIn(signIn.studentId, true))
                toast(`${firstName}’s sign-in is on.`)
              })
            }
          >
            Turn on
          </Button>
        )}
      </div>

      {inviting && (
        <InviteStudent
          studentId={signIn.studentId}
          firstName={firstName}
          onClose={() => {
            setInviting(false)
            void refresh().catch(() => undefined)
          }}
        />
      )}
      {fresh && (
        <Modal title={`New link for ${firstName}`} onClose={() => setFresh(undefined)}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-soft">The previous link has stopped working.</p>
            <InvitationLink made={fresh} scan />
          </div>
        </Modal>
      )}
    </>
  )
}

/** The window that makes a student's invitation: the address, and the tick that a parent or guardian knows. */
function InviteStudent({ studentId, firstName, onClose }: { studentId: string; firstName: string; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [knows, setKnows] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState<NewInvitation>()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!knows) return setError(`Tick the box first: a parent or guardian of ${firstName} has to know about this account and agree to it.`)
    setBusy(true)
    setError('')
    inviteStudent(studentId, email.trim())
      .then(setMade)
      .catch((problem: unknown) => setError(problem instanceof AccountFailure && problem.code === 'invalid' ? 'That does not look like an email address.' : problem instanceof Error ? problem.message : 'That did not work. Try again.'))
      .finally(() => setBusy(false))
  }

  return (
    <Modal title={made ? `Invitation for ${firstName}` : `Invite ${firstName} to make a sign-in`} onClose={onClose}>
      {made ? (
        <div className="flex flex-col gap-3">
          <InvitationLink made={made} scan />
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <p className="text-sm leading-relaxed text-ink-soft">
            With a sign-in, {firstName} opens the same page their student link opens, with an email address and a password of their own. It adds nothing they can see or do. The invitation works once, for {INVITE_DAYS} days.
          </p>
          <Field label={`${firstName}’s email`} hint="The sign-in has to be made with this address.">
            <input className={inputClass} type="email" required data-autofocus value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
          </Field>
          <CheckRow checked={knows} onChange={setKnows} hint="Your name, the time and this wording are kept on record.">
            {GUARDIAN_CONSENT.text(firstName)}
          </CheckRow>
          {error && (
            <Note tone="bad" role="alert">
              {error}
            </Note>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy}>
              Make invitation link
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

/** What a sign-in is, in the state it is in, with its actions. */
export function SignInPanel({ signIn, firstName, onChange }: { signIn: StudentSignIn; firstName: string; onChange: (next: StudentSignIn) => void }) {
  const words: Record<StudentSignIn['state'], string> = {
    none: signIn.tooYoung
      ? `${firstName} is below 9th grade, so cannot have a sign-in yet. Use the student link instead: it opens the same page with no account.`
      : `${firstName} has no sign-in. They can use their student link, or you can invite them to make a sign-in with their own email address and a password.`,
    invited: signIn.expired ? `The invitation sent to ${signIn.email} has expired. Make a new link, or revoke it.` : `An invitation is waiting for ${signIn.email}. It works once, until ${signIn.expiresAt ? formatTimestamp(signIn.expiresAt) : 'it expires'}.`,
    on: `${firstName} signs in as ${signIn.email ?? 'their own address'} and sees exactly what their student link shows.`,
    off: `${firstName}’s sign-in is turned off. Signing in opens nothing until you turn it back on. Their student link is not affected.`,
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SignInPill signIn={signIn} />
      </div>
      <p className="text-sm leading-relaxed text-ink-soft">{words[signIn.state]}</p>
      <SignInActions signIn={signIn} firstName={firstName} onChange={onChange} />
    </div>
  )
}

/** The Sign-in window on a student's page, beside their student link. */
export function StudentSignInModal({ student, onClose }: { student: Student; onClose: () => void }) {
  const [signIn, setSignIn] = useState<StudentSignIn>()
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    studentSignIn(student.id)
      .then((found) => live && setSignIn(found))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'This is not available right now.'))
    return () => {
      live = false
    }
  }, [student.id])
  return (
    <Modal title={`${student.firstName}’s sign-in`} onClose={onClose}>
      {error ? (
        <Note tone="bad" role="alert">
          {error}
        </Note>
      ) : signIn ? (
        <SignInPanel signIn={signIn} firstName={student.firstName} onChange={setSignIn} />
      ) : (
        <div role="status" aria-label="Loading…" className="flex flex-col gap-3">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
    </Modal>
  )
}
