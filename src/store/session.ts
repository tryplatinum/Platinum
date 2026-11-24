// Sign-in and the session. Supabase Auth holds the session; this file turns it
// into the store's `account` (who is signed in, which firm) and loads that
// firm's data. Screens call the functions here; none of them touch Supabase.

import type { Session } from '@supabase/supabase-js'
import { createFirm, myMembership } from '../data/repo'
import { supabase } from '../lib/supabase'
import { runDispatch } from '../services/dispatch'
import { studentLinkLoad } from '../services/studentLink'
import { emptyAppData, useStore } from './store'

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.')

/** Finds the person's firm and loads it, or sends them to firm setup. */
async function enter(userId: string, email: string): Promise<void> {
  try {
    const membership = await myMembership(userId)
    if (!membership) {
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
    const onLink = useStore.getState().mode === 'student_link'
    // A student link has no session and keeps its own data.
    useStore.setState(onLink ? { account: { status: 'signed_out' } } : { account: { status: 'signed_out' }, data: emptyAppData(), studentLinks: [], load: 'idle' })
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
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/app` } })
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

/** First sign-in: creates the firm with this person as owner, then loads it. */
export async function setUpFirm(firmName: string, displayName: string): Promise<void> {
  const { account } = useStore.getState()
  if (account.status !== 'needs_firm') return
  await createFirm(firmName, displayName)
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

/** Back to the counselor's own data, if a counselor opened a student link in a signed-in browser. */
export function leaveStudentLink(): void {
  if (useStore.getState().mode !== 'student_link') return
  useStore.setState({ mode: 'firm', linkToken: undefined, data: emptyAppData(), load: 'idle' })
  void useStore.getState().reload()
}
