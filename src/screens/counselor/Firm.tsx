// The owner's page: /app/firm. Who is in the firm, who has been invited, and
// which students have a sign-in.
//
// Only owners are shown the link to it, and a counselor who opens the address
// is sent to Today. Neither is the protection: every action here is refused by
// the server and by the database for anyone who is not an owner of this firm.
//
// There is no student-to-counselor assignment in the data, so nothing here is
// counted per counselor.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { removalWords, type FirmMember, type FirmOverview, type NewInvitation, type PendingInvitation, type StudentSignIn } from '../../../shared/account'
import { InvitationLink, SignInActions, SignInPill, signInDetail } from '../../components/account/StudentSignIn'
import { Button, Card, Empty, Field, FilterChips, Modal, Note, PageHeader, Pill, Skeleton, TabPanel, Tabs, inputClass, useConfirm, usePageTitle, useTab, useToast, type TabItem } from '../../components/ui'
import { formatTimestamp } from '../../lib/dates'
import { AccountFailure, inviteCounselor, leaveFirm, loadFirm, newInvitationLink, removalSummary, removeMember, revokeInvitation, setMemberRole } from '../../services/account'
import { reenter } from '../../store/session'
import { useData } from '../../store/store'

type TabKey = 'team' | 'invitations' | 'students'
const ROW = 'flex flex-col gap-3 border-t border-line px-5 py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between'
const reasonOf = (e: unknown) => (e instanceof Error ? e.message : 'That did not work. Try again.')
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export default function Firm() {
  const firmName = useData().firm.name
  const [firm, setFirm] = useState<FirmOverview>()
  const [error, setError] = useState('')
  usePageTitle('Firm')

  const load = useCallback(
    () =>
      loadFirm()
        .then((found) => {
          setFirm(found)
          setError('')
        })
        .catch((e: unknown) => setError(reasonOf(e))),
    [],
  )
  useEffect(() => void load(), [load])

  const counselorInvitations = firm?.invitations.filter((i) => i.kind === 'counselor') ?? []
  const tabs: TabItem<TabKey>[] = [
    { key: 'team', label: 'Team' },
    { key: 'invitations', label: 'Invitations', count: counselorInvitations.length },
    { key: 'students', label: 'Student sign-ins' },
  ]
  const tab = useTab(tabs)

  const counts = firm && [plural(firm.members.length, 'counselor'), plural(firm.students.length, 'active student'), `${firm.students.filter((s) => s.state === 'on' || s.state === 'off').length} with a sign-in`].join(' · ')

  return (
    <>
      <PageHeader title="Firm" above={firmName} sub={firm ? counts : error ? undefined : 'Loading…'} />
      {error && !firm ? (
        <Card className="flex flex-col gap-3 p-5">
          <p role="alert" className="text-sm text-ink-soft">
            {error}
          </p>
          <div>
            <Button variant="primary" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        </Card>
      ) : !firm ? (
        <div role="status" aria-label="Loading the firm…" className="flex flex-col gap-4">
          <Skeleton className="h-11 w-72" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <Tabs tabs={tabs} label="Firm pages" />
          <TabPanel tab={tab} label={tabs.find((t) => t.key === tab)?.label ?? ''}>
            {tab === 'team' && <Team members={firm.members} firmName={firmName} reload={load} />}
            {tab === 'invitations' && <Invitations invitations={counselorInvitations} reload={load} />}
            {tab === 'students' && <StudentSignIns students={firm.students} onChange={(next) => setFirm({ ...firm, students: firm.students.map((s) => (s.studentId === next.studentId ? next : s)) })} />}
          </TabPanel>
        </>
      )}
    </>
  )
}

// ── Team ────────────────────────────────────────────────────────────────────

function Team({ members, firmName, reload }: { members: FirmMember[]; firmName: string; reload: () => Promise<void> }) {
  const confirm = useConfirm()
  const toast = useToast()
  const [busy, setBusy] = useState('')
  /** What the server said when the only owner tried to step down or leave. */
  const [stuck, setStuck] = useState('')
  const owners = members.filter((m) => m.role === 'owner').length

  const act = async (key: string, work: () => Promise<void>) => {
    setBusy(key)
    setStuck('')
    try {
      await work()
    } catch (e) {
      if (e instanceof AccountFailure && e.code === 'last_owner') setStuck(e.message)
      else toast(reasonOf(e))
    } finally {
      setBusy('')
    }
  }

  const makeOwner = (m: FirmMember) =>
    act(m.userId, async () => {
      if (!(await confirm({ title: `Make ${m.name} an owner`, body: `${m.name} will be able to invite and remove counselors, change roles, delete students, and open owner-only files. Only they can undo this, by stepping down themselves.`, action: 'Make owner' }))) return
      await setMemberRole(m.userId, 'owner')
      await reload()
      toast(`${m.name} is now an owner.`)
    })

  const stepDown = (m: FirmMember) =>
    act(m.userId, async () => {
      if (!(await confirm({ title: 'Step down to counselor', body: 'You will no longer be able to open this page, invite or remove counselors, delete students, or open owner-only files. Another owner can make you an owner again.', action: 'Step down' }))) return
      await setMemberRole(m.userId, 'counselor')
      toast('You are now a counselor.')
      // The role is part of the session: look again, and this page closes itself.
      await reenter()
    })

  const leave = (m: FirmMember) =>
    act(m.userId, async () => {
      if (!(await confirm({ title: `Leave ${firmName}`, body: 'You will no longer be able to open this firm. Your Google connection is disconnected, your phone is revoked, and messages of yours still queued are cancelled. Your sign-in is not deleted, and what you approved keeps your name.', action: 'Leave firm', word: 'LEAVE', wrongWord: 'Type LEAVE to leave the firm.' }))) return
      await leaveFirm()
      await reenter()
    })

  const remove = (m: FirmMember) =>
    act(m.userId, async () => {
      const summary = await removalSummary(m.userId)
      if (!(await confirm({ title: `Remove ${m.name}`, body: `${m.name} will no longer be able to open ${firmName}. ${removalWords(summary)} Their sign-in is not deleted, and what they approved and logged keeps their name.`, action: 'Remove' }))) return
      const done = await removeMember(m.userId)
      await reload()
      toast(`${m.name} was removed.${done.cancelled ? ` ${plural(done.cancelled, 'queued message')} cancelled.` : ''}`)
    })

  return (
    <Card>
      {stuck && (
        <div className="px-5 pt-4">
          <Note tone="warn" role="alert">
            {stuck} Use “Make owner” on a counselor below, then try again.
          </Note>
        </div>
      )}
      <ul>
        {members.map((m) => (
          <li key={m.userId} className={ROW}>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                {m.name}
                {m.you && <Pill tone="accent">You</Pill>}
                <Pill tone={m.role === 'owner' ? 'good' : 'neutral'}>{m.role === 'owner' ? 'Owner' : 'Counselor'}</Pill>
              </p>
              <p className="break-all text-[13px] text-muted">
                {m.email} · joined {formatTimestamp(m.joinedAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {m.you ? (
                <>
                  <Button busy={busy === m.userId} onClick={() => void stepDown(m)}>
                    Step down
                  </Button>
                  <Button variant="danger" disabled={busy === m.userId} onClick={() => void leave(m)}>
                    Leave firm
                  </Button>
                </>
              ) : m.role === 'counselor' ? (
                <>
                  <Button busy={busy === m.userId} onClick={() => void makeOwner(m)}>
                    Make owner
                  </Button>
                  <Button variant="danger" disabled={busy === m.userId} onClick={() => void remove(m)}>
                    Remove
                  </Button>
                </>
              ) : (
                <span className="text-[13px] text-muted">An owner steps down themselves.</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {owners === 1 && <p className="border-t border-line px-5 py-3 text-[13px] text-muted">A firm always has at least one owner. You are the only one, so you cannot step down or leave until someone else is an owner.</p>}
    </Card>
  )
}

// ── Invitations ─────────────────────────────────────────────────────────────

function Invitations({ invitations, reload }: { invitations: PendingInvitation[]; reload: () => Promise<void> }) {
  const confirm = useConfirm()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  /** Shown once, right after it is made. */
  const [fresh, setFresh] = useState<NewInvitation>()
  /** The invitation an address already has waiting, when the owner asked for a second. */
  const [waiting, setWaiting] = useState<PendingInvitation>()

  const invite = (e: FormEvent) => {
    e.preventDefault()
    const address = email.trim().toLowerCase()
    setBusy('new')
    setError('')
    setWaiting(undefined)
    inviteCounselor(address)
      .then(async (made) => {
        setFresh(made)
        setEmail('')
        await reload()
      })
      .catch((problem: unknown) => {
        if (problem instanceof AccountFailure && problem.code === 'pending_exists') setWaiting(invitations.find((i) => i.email === address) ?? { id: '', kind: 'counselor', email: address, createdAt: '', expiresAt: '', expired: false })
        else setError(problem instanceof AccountFailure && problem.code === 'invalid' ? 'That does not look like an email address.' : reasonOf(problem))
      })
      .finally(() => setBusy(''))
  }

  const renew = (i: PendingInvitation) => {
    setBusy(i.id)
    setWaiting(undefined)
    newInvitationLink(i.id)
      .then(async (made) => {
        setFresh(made)
        await reload()
      })
      .catch((e: unknown) => toast(reasonOf(e)))
      .finally(() => setBusy(''))
  }

  const revoke = async (i: PendingInvitation) => {
    if (!(await confirm({ title: 'Revoke the invitation', body: `The link sent to ${i.email} stops working. You can invite them again later.`, action: 'Revoke' }))) return
    setBusy(i.id)
    try {
      await revokeInvitation(i.id)
      await reload()
      toast('Invitation revoked.')
    } catch (e) {
      toast(reasonOf(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-[15px] font-semibold">Invite a counselor</h2>
          <p className="mt-0.5 text-sm text-ink-soft">You get a link to send them yourself. Platinum does not email it. They join as a counselor, and you can make them an owner afterwards.</p>
        </div>
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={invite}>
          <Field label="Their work email" className="min-w-0 flex-1">
            <input className={inputClass} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="name@yourfirm.com" />
          </Field>
          <Button type="submit" variant="primary" busy={busy === 'new'}>
            Make invitation link
          </Button>
        </form>
        {error && (
          <Note tone="bad" role="alert">
            {error}
          </Note>
        )}
        {waiting && (
          <Note tone="warn" role="alert" className="flex flex-wrap items-center justify-between gap-3">
            <span>{waiting.email} already has an invitation waiting. A new link replaces it, and the old one stops working.</span>
            {waiting.id && (
              <Button busy={busy === waiting.id} onClick={() => renew(waiting)}>
                New link
              </Button>
            )}
          </Note>
        )}
      </Card>

      <Card>
        <h2 className="px-5 pt-4 text-[15px] font-semibold">Waiting</h2>
        {invitations.length === 0 ? (
          <div className="p-5">
            <Empty title="No invitations are waiting.">An invitation leaves this list when it is accepted or revoked.</Empty>
          </div>
        ) : (
          <ul className="mt-2">
            {invitations.map((i) => (
              <li key={i.id} className={ROW}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 break-all text-[15px] font-semibold">
                    {i.email}
                    {i.expired ? <Pill tone="warn">Expired</Pill> : <Pill tone="accent">Waiting</Pill>}
                  </p>
                  <p className="text-[13px] text-muted">
                    Invited {formatTimestamp(i.createdAt)} · {i.expired ? 'expired' : 'expires'} {formatTimestamp(i.expiresAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button busy={busy === i.id} onClick={() => renew(i)}>
                    New link
                  </Button>
                  <Button variant="danger" disabled={busy === i.id} onClick={() => void revoke(i)}>
                    Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {fresh && (
        <Modal title="Invitation link" onClose={() => setFresh(undefined)}>
          <div className="flex flex-col gap-3">
            <InvitationLink made={fresh} />
            <div className="flex justify-end">
              <Button onClick={() => setFresh(undefined)}>Done</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Student sign-ins ────────────────────────────────────────────────────────

type Filter = 'all' | StudentSignIn['state']

function StudentSignIns({ students, onChange }: { students: StudentSignIn[]; onChange: (next: StudentSignIn) => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const count = (state: StudentSignIn['state']) => students.filter((s) => s.state === state).length
  const shown = useMemo(() => (filter === 'all' ? students : students.filter((s) => s.state === filter)), [students, filter])
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-ink-soft">A sign-in lets a student open their own page with an email address and a password. It shows exactly what their student link shows. Any counselor can invite a student, or turn a sign-in off, from the student’s page.</p>
      <FilterChips<Filter>
        label="Filter by sign-in"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All', count: students.length },
          { value: 'none', label: 'No sign-in', count: count('none') },
          { value: 'invited', label: 'Invited', count: count('invited') },
          { value: 'on', label: 'On', count: count('on') },
          { value: 'off', label: 'Turned off', count: count('off') },
        ]}
      />
      <Card>
        {shown.length === 0 ? (
          <div className="p-5">
            <Empty title={students.length === 0 ? 'There are no active students yet.' : 'No student matches this filter.'} />
          </div>
        ) : (
          <ul>
            {shown.map((s) => (
              <li key={s.studentId} className={ROW}>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                    {s.name}
                    <SignInPill signIn={s} />
                  </p>
                  {signInDetail(s) && <p className="break-all text-[13px] text-muted">{signInDetail(s)}</p>}
                </div>
                <SignInActions signIn={s} firstName={s.name.split(' ')[0]} onChange={onChange} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
