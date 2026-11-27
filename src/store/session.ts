// Sign-in and the session. Supabase Auth holds the session; this file turns it
// into the store's `account` (who is signed in, which firm) and loads that
// firm's data. Screens call the functions here; none of them touch Supabase.

import type { Session } from '@supabase/supabase-js'
import { createFirm, myMembership, myStudentAccount } from '../data/repo'
import { supabase } from '../lib/supabase'
import { runDispatch } from '../services/dispatch'
import { StudentPageError, studentLinkLoad } from '../services/studentLink'
import { emptyAppData, useStore, type Account } from './store'

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.')

/**
 * Where a signed-in person belongs. The one place that decides it: a member's
 * home is Today, a student's is their own page, and someone who is neither is
 * asked whether they are starting a firm or were invited. Undefined while that
 * is not known yet, or for nobody.
 */
export function homeOf(account: Account): string | undefined {
  if (account.status === 'ready') return '/app/today'
  if (account.status === 'student') return '/me'
  if (account.status === 'needs_firm') return '/start'
  return undefined
}

/**
 * Works out which kind of account this is and loads what belongs to it: a
 * member's firm, a student's own page, or nothing yet. The database allows a
 * sign-in to be only one of them.
 */
async function enter(userId: string, email: string): Promise<void> {
  try {
    const membership = await myMembership(userId)
    if (!membership) {
      const student = await myStudentAccount(userId)
      if (student) {
        await openStudentAccount(userId, email, student.off)
        return
      }
      useStore.setState({ account: { status: 'needs_firm', userId, email }, mode: 'firm', linkToken: undefined, data: emptyAppData(), studentLinks: [], load: 'idle' })
      return
    }
    useStore.setState({ account: { status: 'ready', userId, email, ...membership }, mode: 'firm', linkToken: undefined })
    await useStore.getState().reload()
    // Catch anything whose undo window already passed while the app was closed.
    void runDispatch()
  } catch (error) {
    useStore.setState({ account: { status: 'error', message: reasonOf(error) } })
  }
}

function onSession(session: Session | null): void {
  const { account } = useStore.getState()
  if (!session) {
    if (account.status === 'signed_out') return
    // A student link has no session and keeps its own data; a signed-in student's page goes with their session.
    const onLink = useStore.getState().mode === 'student_link' && account.status !== 'student'
    useStore.setState(onLink ? { account: { status: 'signed_out' } } : { account: { status: 'signed_out' }, mode: 'firm', linkToken: undefined, data: emptyAppData(), studentLinks: [], load: 'idle' })
    return
  }
  // Token refreshes and tab focus fire this again for the same person: nothing to do.
  if ('userId' in account && account.userId === session.user.id) return
  // At startup Supabase reports the same session twice in a row; load once.
  if (entering === session.user.id) return
  entering = session.user.id
  void enter(session.user.id, session.user.email ?? '').finally(() => {
    entering = undefined
  })
}

/** The user whose firm is being looked up and loaded right now. */
let entering: string | undefined

let started = false

/** Call once at startup. Follows the Supabase session and refreshes data when the window regains focus. */
export function startSession(): void {
  if (started) return
  started = true
  // Supabase asks that nothing awaits inside this callback, so the work is deferred.
  supabase.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => onSession(session), 0)
  })

  // Keeps two devices reasonably in step without realtime: refetch on return.
  let last = 0
  const refresh = () => {
    if (document.visibilityState !== 'visible' || Date.now() - last < 5_000) return
    last = Date.now()
    const { account, mode, load } = useStore.getState()
    if (account.status === 'ready' && mode === 'firm' && load === 'ready') void useStore.getState().reload(true)
    // A student's page, and whether their sign-in is still on.
    if (account.status === 'student') void refreshStudentAccount()
  }
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', refresh)
}

/** Try again after the account lookup failed (say, no connection). */
export async function retrySession(): Promise<void> {
  useStore.setState({ account: { status: 'loading' } })
  const { data } = await supabase.auth.getSession()
  if (data.session) await enter(data.session.user.id, data.session.user.email ?? '')
  else useStore.setState({ account: { status: 'signed_out' } })
}

// ── What the sign-in screens call ───────────────────────────────────────────

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message === 'Email not confirmed' ? 'Confirm your email first: open the link we sent you, then sign in.' : error.message)
}

/** Returns 'confirm_email' when the project requires the address to be confirmed before signing in. */
export async function signUp(email: string, password: string): Promise<'signed_in' | 'confirm_email'> {
  // Whoever confirms their address lands where every kind of account is sorted out.
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/signin` } })
  if (error) throw new Error(error.message)
  return data.session ? 'signed_in' : 'confirm_email'
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
  if (error) throw new Error(error.message)
}

/** Sets a new password for the signed-in person (who arrived through a reset link). */
export async function setPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw new Error(error.message)
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

/**
 * The firm and the name typed at sign-up, kept in this tab while the address is
 * being confirmed, so the firm step does not ask twice. Neither is a secret.
 */
export const pendingFirm = {
  keep(value: { firm: string; name: string }): void {
    try {
      sessionStorage.setItem('pending-firm', JSON.stringify(value))
    } catch {
      // No storage: the firm step asks again.
    }
  },
  read(): { firm: string; name: string } | undefined {
    try {
      const value = JSON.parse(sessionStorage.getItem('pending-firm') ?? 'null') as { firm?: unknown; name?: unknown } | null
      return value && typeof value.firm === 'string' && typeof value.name === 'string' ? { firm: value.firm, name: value.name } : undefined
    } catch {
      return undefined
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem('pending-firm')
    } catch {
      // Nothing to clear.
    }
  },
}

/** Creates the firm with the signed-in person as its owner, then loads it. Used right after sign-up. */
export async function startFirm(firmName: string, displayName: string): Promise<void> {
  await createFirm(firmName, displayName)
  pendingFirm.clear()
  await reenter()
}

/** The firm step alone, for someone signed in with no firm: creates the firm with this person as owner, then loads it. */
export async function setUpFirm(firmName: string, displayName: string): Promise<void> {
  const { account } = useStore.getState()
  if (account.status !== 'needs_firm') return
  await createFirm(firmName, displayName)
  pendingFirm.clear()
  await enter(account.userId, account.email)
}

/** The current access token, for the AI endpoint. `refresh` forces a new one. */
export async function accessToken(refresh = false): Promise<string | undefined> {
  const { data } = refresh ? await supabase.auth.refreshSession() : await supabase.auth.getSession()
  return data.session?.access_token
}

// ── The student link ────────────────────────────────────────────────────────

/** Opens a student's page from their secret link. Throws when the link does not work. */
export async function openStudentLink(token: string): Promise<void> {
  const data = await studentLinkLoad(token)
  useStore.setState({ mode: 'student_link', linkToken: token, data, studentLinks: [], load: 'ready' })
}

/**
 * A student's own sign-in: their page is asked for with the session's token,
 * and held exactly as a student link's page is. When a counselor has turned the
 * sign-in off there is no page, and the account says so.
 */
async function openStudentAccount(userId: string, email: string, off: boolean): Promise<void> {
  const base = { mode: 'student_link' as const, linkToken: undefined, studentLinks: [] }
  if (off) {
    useStore.setState({ ...base, account: { status: 'student', userId, email, off: true }, data: emptyAppData(), load: 'ready' })
    return
  }
  useStore.setState({ ...base, account: { status: 'student', userId, email }, data: emptyAppData(), load: 'loading' })
  try {
    const data = await studentLinkLoad()
    useStore.setState({ data, load: 'ready', loadError: undefined })
  } catch (error) {
    // Turned off between the account lookup and the page: the same screen as above.
    if (error instanceof StudentPageError && error.code === 'signin_off') useStore.setState({ account: { status: 'student', userId, email, off: true }, load: 'ready' })
    else useStore.setState({ load: 'error', loadError: reasonOf(error) })
  }
}

/** The signed-in student's page again: on return to the tab, and after "Try again". Says so when the sign-in has been turned off. */
export async function refreshStudentAccount(): Promise<void> {
  const { account } = useStore.getState()
  if (account.status !== 'student') return
  try {
    const data = await studentLinkLoad()
    if (useStore.getState().account.status === 'student') useStore.setState({ data, load: 'ready', loadError: undefined, account: { ...account, off: false } })
  } catch (error) {
    if (error instanceof StudentPageError && error.code === 'signin_off') useStore.setState({ account: { ...account, off: true }, data: emptyAppData(), load: 'ready' })
    else if (error instanceof StudentPageError && error.code === 'unauthorized') await supabase.auth.signOut()
    else if (useStore.getState().load !== 'ready') useStore.setState({ load: 'error', loadError: reasonOf(error) })
  }
}

/** Looks again at what kind of account this is: after an invitation was accepted, or a firm was left. */
export async function reenter(): Promise<void> {
  const { data } = await supabase.auth.getSession()
  if (data.session) await enter(data.session.user.id, data.session.user.email ?? '')
  else useStore.setState({ account: { status: 'signed_out' } })
}

/** Back to the counselor's own data, if a counselor opened a student link in a signed-in browser. */
export function leaveStudentLink(): void {
  // A signed-in student's page is theirs: there is no counselor's data to go back to.
  if (useStore.getState().mode !== 'student_link' || useStore.getState().account.status === 'student') return
  useStore.setState({ mode: 'firm', linkToken: undefined, data: emptyAppData(), load: 'idle' })
  void useStore.getState().reload()
}
