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
 * Counts every decision about who is signed in. A lookup that finishes after a
 * newer one has started (or after a sign-out) finds the number has moved on
 * and writes nothing, so an older answer never replaces a newer one.
 */
let generation = 0

/** True while a student link's page is open in this tab. The link's page is the link's: an account lookup never replaces it. */
const onLink = () => Boolean(useStore.getState().linkToken)

/**
 * Works out which kind of account this is and loads what belongs to it: a
 * member's firm, a student's own page, or nothing yet. The database allows a
 * sign-in to be only one of them.
 */
async function enter(userId: string, email: string): Promise<void> {
  const mine = ++generation
  const current = () => mine === generation
  try {
    const membership = await myMembership(userId)
    if (!current()) return
    if (!membership) {
      const student = await myStudentAccount(userId)
      if (!current()) return
      if (student) {
        await openStudentAccount(userId, email, student.off, current)
        return
      }
      // Someone who named a firm at sign-up and has just confirmed their address: the firm is made now, as the screen said.
      const making = makePendingFirm(email)
      if (making) {
        const made = await making.then(
          () => true,
          () => false,
        )
        if (!current()) return
        if (made) return enter(userId, email)
      }
      useStore.setState(onLink() ? { account: { status: 'needs_firm', userId, email } } : { account: { status: 'needs_firm', userId, email }, mode: 'firm', linkToken: undefined, data: emptyAppData(), studentLinks: [], load: 'idle' })
      return
    }
    // A counselor looking at a student link keeps it until they leave it (RequireFirm then loads the firm).
    if (onLink()) {
      useStore.setState({ account: { status: 'ready', userId, email, ...membership } })
      return
    }
    useStore.setState({ account: { status: 'ready', userId, email, ...membership }, mode: 'firm', linkToken: undefined })
    await useStore.getState().reload()
    // Catch anything whose undo window already passed while the app was closed.
    if (current()) void runDispatch()
  } catch (error) {
    if (current()) useStore.setState({ account: { status: 'error', message: reasonOf(error) } })
  }
}

function onSession(session: Session | null): void {
  const { account } = useStore.getState()
  if (!session) {
    // Whatever was being looked up is no longer wanted.
    generation++
    if (account.status === 'signed_out') return
    // A student link has no session and keeps its own page; everything else goes with the session.
    useStore.setState(onLink() ? { account: { status: 'signed_out' } } : { account: { status: 'signed_out' }, mode: 'firm', linkToken: undefined, data: emptyAppData(), studentLinks: [], load: 'idle' })
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

/**
 * Asks for a reset email. Resolves the same way whether or not the address has
 * an account, and whatever Supabase answers (it answers differently for a
 * second request to a real address): only having no connection is reported.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
  if (error && (error.name === 'AuthRetryableFetchError' || !error.status)) throw new Error('There is no connection right now. Try again in a moment.')
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
 * The firm and the name typed at sign-up, kept in this browser while the
 * address is being confirmed (the confirmation link usually opens a new tab),
 * so the firm step does not ask twice. Neither is a secret. Cleared once the
 * firm is made.
 */
export const pendingFirm = {
  keep(value: { firm: string; name: string; email: string }): void {
    try {
      localStorage.setItem('pending-firm', JSON.stringify(value))
    } catch {
      // No storage: the firm step asks again.
    }
  },
  /** What was kept. With `email`, only if it was kept for that address. */
  read(email?: string): { firm: string; name: string; email: string } | undefined {
    try {
      const value = JSON.parse(localStorage.getItem('pending-firm') ?? 'null') as { firm?: unknown; name?: unknown; email?: unknown } | null
      if (!value || typeof value.firm !== 'string' || typeof value.name !== 'string' || typeof value.email !== 'string') return undefined
      if (email !== undefined && value.email.toLowerCase() !== email.toLowerCase()) return undefined
      return { firm: value.firm, name: value.name, email: value.email }
    } catch {
      return undefined
    }
  },
  clear(): void {
    try {
      localStorage.removeItem('pending-firm')
    } catch {
      // Nothing to clear.
    }
  },
}

/** The firm being made from what was typed at sign-up, so two lookups running at once make it once. */
let makingFirm: Promise<void> | undefined

/**
 * Makes the firm that was named at sign-up, for the person it was named by.
 * Undefined when there is none to make. If it fails, what was typed is kept
 * and the firm step shows it again.
 */
function makePendingFirm(email: string): Promise<void> | undefined {
  if (makingFirm) return makingFirm
  const kept = pendingFirm.read(email)
  if (!kept) return undefined
  pendingFirm.clear()
  makingFirm = createFirm(kept.firm, kept.name)
    .then(() => undefined)
    .catch((error: unknown) => {
      pendingFirm.keep(kept)
      throw error
    })
    .finally(() => {
      makingFirm = undefined
    })
  return makingFirm
}

/** Right after sign-up with a session: makes the firm that was just named, then loads it. */
export async function startFirm(): Promise<void> {
  const { data } = await supabase.auth.getSession()
  await makePendingFirm(data.session?.user.email ?? '')
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
 * sign-in off there is no page, and the account says so. While a student link
 * is open in this tab only the account is noted: the link's page stays.
 */
async function openStudentAccount(userId: string, email: string, off: boolean, current: () => boolean): Promise<void> {
  if (onLink()) {
    useStore.setState({ account: { status: 'student', userId, email, off } })
    return
  }
  const base = { mode: 'student_link' as const, linkToken: undefined, studentLinks: [] }
  if (off) {
    useStore.setState({ ...base, account: { status: 'student', userId, email, off: true }, data: emptyAppData(), load: 'ready' })
    return
  }
  useStore.setState({ ...base, account: { status: 'student', userId, email }, data: emptyAppData(), load: 'loading' })
  try {
    const data = await studentLinkLoad()
    if (!current() || onLink()) return
    useStore.setState({ data, load: 'ready', loadError: undefined })
  } catch (error) {
    if (!current() || onLink()) return
    // Turned off between the account lookup and the page: the same screen as above.
    if (error instanceof StudentPageError && error.code === 'signin_off') useStore.setState({ account: { status: 'student', userId, email, off: true }, load: 'ready' })
    else useStore.setState({ load: 'error', loadError: reasonOf(error) })
  }
}

/**
 * The signed-in student's page again: on return to the tab, and after "Try
 * again". Says so when the sign-in has been turned off. Writes nothing if
 * someone else is signed in by the time the answer comes, or a link is open.
 */
export async function refreshStudentAccount(showLoading = false): Promise<void> {
  const { account } = useStore.getState()
  if (account.status !== 'student' || onLink()) return
  const mine = generation
  const same = () => {
    const now = useStore.getState().account
    return mine === generation && now.status === 'student' && now.userId === account.userId && !onLink()
  }
  if (showLoading) useStore.setState({ load: 'loading' })
  try {
    const data = await studentLinkLoad()
    if (same()) useStore.setState({ mode: 'student_link', data, load: 'ready', loadError: undefined, account: { ...account, off: false } })
  } catch (error) {
    if (!same()) return
    if (error instanceof StudentPageError && error.code === 'signin_off') useStore.setState({ account: { ...account, off: true }, data: emptyAppData(), load: 'ready' })
    else if (error instanceof StudentPageError && error.code === 'unauthorized') await supabase.auth.signOut()
    else if (useStore.getState().load !== 'ready') useStore.setState({ load: 'error', loadError: reasonOf(error) })
  }
}

/**
 * A signed-in student arriving at their own page from a student link opened in
 * the same tab: the link is let go of, and their own page is loaded.
 */
export function leaveLinkForMyPage(): void {
  const state = useStore.getState()
  if (state.account.status !== 'student' || !state.linkToken) return
  useStore.setState({ linkToken: undefined, mode: 'student_link', data: emptyAppData(), load: state.account.off ? 'ready' : 'loading' })
  if (!state.account.off) void refreshStudentAccount()
}

/** Looks again at what kind of account this is: after an invitation was accepted, or a firm was left. */
export async function reenter(): Promise<void> {
  const { data } = await supabase.auth.getSession()
  if (data.session) await enter(data.session.user.id, data.session.user.email ?? '')
  else {
    generation++
    useStore.setState({ account: { status: 'signed_out' } })
  }
}

/** Back to the counselor's own data, if a counselor opened a student link in a signed-in browser. */
export function leaveStudentLink(): void {
  // A signed-in student's page is theirs: there is no counselor's data to go back to.
  if (useStore.getState().mode !== 'student_link' || useStore.getState().account.status !== 'ready') return
  useStore.setState({ mode: 'firm', linkToken: undefined, data: emptyAppData(), load: 'idle' })
  void useStore.getState().reload()
}
