// For looking at screens: renders the app from the sample caseload with no
// sign-in and no database. Run `npx vite` and open
// preview.html?theme=light|dark&path=<route>. Kept in the repository; the
// production build starts from index.html and does not include it.
//
// More switches, all optional, for the account screens:
//   account=out|needs|student|off|counselor|owner   who is "signed in" (owner by default)
//   invite=counselor|student|dead|offline           what /join finds behind its link
//   accept=ok|wrong_email|confirm_email|already_member|dead_invitation
//   signup=confirm                                  sign-up answers "confirm your address first"
//   signin=none|invited|expired|on|off|young        one student's sign-in, on the student page
//   lastowner=1                                     the firm page with a single owner
// Every person, firm and address here is invented.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/manrope/wght.css'
import './src/index.css'
import App from './src/App'
import { ToastProvider } from './src/components/ui'
import { buildSeed } from './src/data/seed'
import { supabase } from './src/lib/supabase'
import { useStore } from './src/store/store'
import type { FirmMember, PendingInvitation, StudentSignIn } from './shared/account'
import { maySignIn } from './shared/account'

const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') ?? 'light'
const path = params.get('path') ?? '/app'
const seed = buildSeed()
const who = params.get('account') ?? 'owner'
const student = seed.students[0]
const studentPage = { ...seed, students: [{ ...student, lastName: '', parents: [], counselorNotes: '' }], tasks: seed.tasks.filter((t) => t.studentId === student.id), meetings: seed.meetings.filter((m) => m.studentId === student.id), colleges: seed.colleges.filter((c) => c.studentId === student.id), documents: seed.documents.filter((d) => d.studentId === student.id) }

const day = 86_400_000
const at = (days: number) => new Date(Date.now() + days * day).toISOString()
const SECRET = 'Lka1hSX5xoW6d5u4VfaKiSq-hkmUPMrnHfK0bG63aRY'
const today = new Date().toISOString().slice(0, 10)

// ── The firm, in memory, so the owner's screen can be worked through ─────────
const members: FirmMember[] = [
  { userId: 'u', name: 'Sarah Lindqvist', email: 'sarah@alderandvine.example', role: 'owner', joinedAt: at(-200), you: true },
  ...(params.get('lastowner') ? [] : [{ userId: 'u2', name: 'Marcus Oyelaran', email: 'marcus@alderandvine.example', role: 'owner' as const, joinedAt: at(-150), you: false }]),
  { userId: 'u3', name: 'Dana Whitlock', email: 'dana@alderandvine.example', role: 'counselor', joinedAt: at(-40), you: false },
  { userId: 'u4', name: 'Priya Raman', email: 'priya@alderandvine.example', role: 'counselor', joinedAt: at(-12), you: false },
]
let invitations: PendingInvitation[] = [
  { id: 'i1', kind: 'counselor', email: 'lee.moreno@alderandvine.example', createdAt: at(-2), expiresAt: at(5), expired: false },
  { id: 'i2', kind: 'counselor', email: 'jo.reyes@alderandvine.example', createdAt: at(-9), expiresAt: at(-2), expired: true },
]
const STATES = ['on', 'invited', 'none', 'off', 'none', 'invited'] as const
const signIns: StudentSignIn[] = seed.students
  .filter((s) => !s.archived)
  .map((s, i) => {
    const state = STATES[i % STATES.length]
    const email = `${s.firstName.toLowerCase()}.${s.lastName.toLowerCase()}@students.example`
    const base = { studentId: s.id, name: `${s.firstName} ${s.lastName}`, tooYoung: !maySignIn(s.gradYear, today) }
    if (state === 'invited') return { ...base, state, email, invitationId: `s${i}`, expiresAt: at(i === 1 ? 4 : -1), expired: i !== 1 }
    return state === 'none' ? { ...base, state } : { ...base, state, email }
  })
const wanted = params.get('signin')
if (wanted) {
  const first = signIns[0]
  const email = `${student.firstName.toLowerCase()}.${student.lastName.toLowerCase()}@students.example`
  Object.assign(first, { state: wanted === 'expired' ? 'invited' : wanted === 'young' ? 'none' : wanted, email: wanted === 'none' || wanted === 'young' ? undefined : email, invitationId: wanted === 'invited' || wanted === 'expired' ? 's0' : undefined, expiresAt: wanted === 'invited' ? at(6) : wanted === 'expired' ? at(-1) : undefined, expired: wanted === 'expired', tooYoung: wanted === 'young' })
}

const reply = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { headers: { 'content-type': 'application/json' } })
const refuse = (code: string, message: string, status = 400) => new Response(JSON.stringify({ ok: false, code, message }), { status, headers: { 'content-type': 'application/json' } })
const fresh = (email: string) => ({ id: crypto.randomUUID(), email, expiresAt: at(7), secret: SECRET })

function accountApi(body: Record<string, unknown>): Response {
  switch (body.action) {
    case 'preview': {
      const kind = params.get('invite') ?? 'counselor'
      if (kind === 'dead' || body.secret !== SECRET) return refuse('dead_invitation', 'This invitation link does not work.', 404)
      if (kind === 'offline') throw new TypeError('offline')
      return reply(kind === 'student' ? { kind: 'student', firmName: seed.firm.name, email: 'e•••@students.example', studentFirstName: student.firstName } : { kind: 'counselor', firmName: seed.firm.name, email: 'l•••@alderandvine.example' })
    }
    case 'accept': {
      const how = params.get('accept') ?? 'ok'
      if (how === 'ok') return reply({ kind: params.get('invite') === 'student' ? 'student' : 'counselor' })
      return refuse(how, how === 'wrong_email' ? 'This invitation is for another email address.' : how === 'confirm_email' ? 'Confirm your email address first.' : how === 'already_member' ? 'This account already belongs to a firm.' : 'This invitation link does not work.', 403)
    }
    case 'firm':
      return reply({ members, invitations, students: signIns })
    case 'invite_counselor': {
      if (invitations.some((i) => i.email === body.email)) return refuse('pending_exists', 'That address already has an invitation waiting. Make a new link for it instead.', 409)
      const made = fresh(String(body.email))
      invitations = [{ id: made.id, kind: 'counselor', email: made.email, createdAt: at(0), expiresAt: made.expiresAt, expired: false }, ...invitations]
      return reply(made)
    }
    case 'new_link': {
      const old = invitations.find((i) => i.id === body.invitationId)
      const signIn = signIns.find((s) => s.invitationId === body.invitationId)
      const made = fresh(old?.email ?? signIn?.email ?? '')
      if (old) Object.assign(old, { id: made.id, createdAt: at(0), expiresAt: made.expiresAt, expired: false })
      if (signIn) Object.assign(signIn, { invitationId: made.id, expiresAt: made.expiresAt, expired: false })
      return reply(made)
    }
    case 'revoke_invitation': {
      invitations = invitations.filter((i) => i.id !== body.invitationId)
      const signIn = signIns.find((s) => s.invitationId === body.invitationId)
      if (signIn) Object.assign(signIn, { state: 'none', email: undefined, invitationId: undefined, expiresAt: undefined, expired: undefined })
      return reply(null)
    }
    case 'set_role': {
      const member = members.find((m) => m.userId === body.userId)!
      if (body.role === 'counselor' && members.filter((m) => m.role === 'owner').length < 2) return refuse('last_owner', 'You are the only owner. Make someone else an owner first.', 409)
      member.role = body.role as FirmMember['role']
      return reply(null)
    }
    case 'removal_summary':
      return reply(body.userId === 'u3' ? { google: true, phone: true, queued: 2 } : { google: false, phone: false, queued: 0 })
    case 'remove_member':
      members.splice(members.findIndex((m) => m.userId === body.userId), 1)
      return reply({ google: true, phone: true, cancelled: 2 })
    case 'leave':
      if (members.filter((m) => m.role === 'owner').length < 2) return refuse('last_owner', 'You are the only owner. Make someone else an owner first.', 409)
      return reply(null)
    case 'invite_student': {
      const signIn = signIns.find((s) => s.studentId === body.studentId)!
      const made = fresh(String(body.email))
      Object.assign(signIn, { state: 'invited', email: made.email, invitationId: made.id, expiresAt: made.expiresAt, expired: false })
      return reply(made)
    }
    case 'student_signin':
      return reply(signIns.find((s) => s.studentId === body.studentId) ?? signIns[0])
    case 'set_student_signin': {
      const signIn = signIns.find((s) => s.studentId === body.studentId)!
      signIn.state = body.on ? 'on' : 'off'
      return reply(signIn)
    }
    case 'delete_my_signin':
      return reply(null)
    default:
      return refuse('invalid', 'The request was not valid.')
  }
}

const real = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.includes('/api/student')) return new Response(JSON.stringify({ ok: true, data: studentPage }), { headers: { 'content-type': 'application/json' } })
  if (url.includes('/api/account')) return accountApi(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
  return real(input, init)
}

// ── Supabase Auth, stood in for: nothing here reaches a real project ────────
const emailOf = () => (who === 'student' || who === 'off' ? `${student.firstName.toLowerCase()}.${student.lastName.toLowerCase()}@students.example` : who === 'needs' ? 'lee.moreno@alderandvine.example' : 'sarah@alderandvine.example')
let session: { access_token: string; user: { id: string; email: string } } | null = who === 'out' ? null : { access_token: 'preview', user: { id: 'u', email: emailOf() } }
const auth = supabase.auth as unknown as Record<string, unknown>
auth.getSession = async () => ({ data: { session }, error: null })
auth.signOut = async () => {
  session = null
  useStore.setState({ account: { status: 'signed_out' }, mode: 'firm' })
  return { error: null }
}
const enterAs = (email: string) => {
  session = { access_token: 'preview', user: { id: 'u', email } }
  useStore.setState({ account: { status: 'needs_firm', userId: 'u', email } })
}
auth.signUp = async ({ email }: { email: string }) => {
  if (params.get('signup') === 'confirm') return { data: { session: null, user: { id: 'u' } }, error: null }
  enterAs(email)
  return { data: { session, user: session!.user }, error: null }
}
auth.signInWithPassword = async ({ email, password }: { email: string; password: string }) => {
  if (password === 'wrong') return { data: { session: null }, error: { message: 'Invalid login credentials' } }
  enterAs(email)
  return { data: { session }, error: null }
}
auth.updateUser = async () => ({ data: {}, error: null })
auth.resetPasswordForEmail = async () => ({ data: {}, error: null })

if (path.startsWith('/s/') || path.startsWith('/s#')) {
  // The student link: the page comes from /api/student, answered above.
} else if (who === 'out') {
  useStore.setState({ account: { status: 'signed_out' }, load: 'idle', mode: 'firm' })
} else if (who === 'needs') {
  useStore.setState({ account: { status: 'needs_firm', userId: 'u', email: emailOf() }, load: 'idle', mode: 'firm' })
} else if (who === 'student' || who === 'off') {
  useStore.setState({ account: { status: 'student', userId: 'u', email: emailOf(), off: who === 'off' }, load: 'ready', mode: 'student_link', linkToken: undefined, data: who === 'off' ? { ...seed, students: [] } : studentPage })
} else {
  useStore.setState({ account: { status: 'ready', userId: 'u', email: emailOf(), firmId: 'f', role: who === 'counselor' ? 'counselor' : 'owner' }, load: 'ready', mode: 'firm', data: seed })
}
;(window as never as { seed: unknown }).seed = seed

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </MemoryRouter>
  </StrictMode>,
)
