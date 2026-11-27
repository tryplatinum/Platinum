// The student's own page, opened from their secret link on their own phone.
// No login: the token is exchanged with /api/student for the small slice of
// data a student may see, and the usual phone view renders it.
//
// The address is /s#<secret>. The secret is in the fragment, which a browser
// never sends to a server, so it reaches no server log and no Referer. It is
// read once and removed from the address bar at once. Links sent before this
// were /s/<secret>: those still open, and are replaced in the address bar the
// same way.
//
// So that the page survives a reload (a phone reloads a tab it has put to
// sleep), the token is kept for this tab only, in sessionStorage, and is gone
// when the tab closes. It is never put in localStorage or a cookie.

import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { STUDENT_TOKEN } from '../../../shared/student'
import { Card, Skeleton } from '../../components/ui'
import { StudentPageError } from '../../services/studentLink'
import { openStudentLink } from '../../store/session'
import { useStore } from '../../store/store'

const KEPT = 'student-link'

const keep = (token: string) => {
  try {
    sessionStorage.setItem(KEPT, token)
  } catch {
    // No storage: the page works until it is reloaded.
  }
}
const forget = () => {
  try {
    sessionStorage.removeItem(KEPT)
  } catch {
    // Nothing to forget.
  }
}
const kept = () => {
  try {
    return sessionStorage.getItem(KEPT) ?? ''
  } catch {
    return ''
  }
}

export function StudentLinkLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { token: inPath } = useParams()
  // From the fragment (links made now), from the path (links already sent), or this tab's own memory after a reload.
  const [token, setToken] = useState(() => {
    const arrived = location.hash.slice(1) || inPath || ''
    if (STUDENT_TOKEN.safeParse(arrived).success) keep(arrived)
    return arrived || kept()
  })
  const ready = useStore((s) => s.mode === 'student_link' && s.linkToken === token)
  const student = useStore((s) => s.data.students[0])
  const [error, setError] = useState('')

  // Out of the address bar, and out of this history entry, before anything else happens. A second
  // link pasted into the same tab arrives here too: it replaces the first, and is removed the same way.
  const arrived = location.hash.slice(1) || inPath || ''
  useEffect(() => {
    if (!arrived) return
    if (arrived !== token) {
      if (STUDENT_TOKEN.safeParse(arrived).success) keep(arrived)
      setToken(arrived)
    }
    navigate('/s', { replace: true })
  }, [arrived]) // eslint-disable-line react-hooks/exhaustive-deps

  // Whatever this page links to or loads is told nothing about where the visitor came from.
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  useEffect(() => {
    let live = true
    setError('')
    if (!token) {
      setError('This link does not work. Ask your counselor for a new one.')
      return
    }
    openStudentLink(token).catch((e) => {
      // A link the server does not know is not kept for the next reload.
      if (e instanceof StudentPageError && e.status === 404 && kept() === token) forget()
      if (live) setError(e instanceof Error ? e.message : 'This page is not available right now.')
    })
    return () => {
      live = false
    }
  }, [token])

  // Keep the page current when the student comes back to it.
  useEffect(() => {
    const refresh = () => {
      if (token && document.visibilityState === 'visible' && useStore.getState().linkToken === token) openStudentLink(token).catch(() => {})
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [token])

  return (
    <main className="student-scale mx-auto flex min-h-full max-w-md flex-col gap-4 px-4 py-6">
      {error ? (
        <Card className="p-5">
          <h1 className="text-lg font-semibold">This page is not available</h1>
          <p className="mt-1 text-sm text-ink-soft">{error}</p>
        </Card>
      ) : ready && student ? (
        <Outlet context={student} />
      ) : (
        <div role="status" aria-label="Loading…" className="flex flex-col gap-4">
          <Skeleton className="h-16 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
    </main>
  )
}
