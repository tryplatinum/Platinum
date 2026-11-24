// The student's own page, opened from their secret link (/s/:token) on their
// own phone. No login: the token is exchanged with /api/student for the small
// slice of data a student may see, and the usual phone view renders it.

import { useEffect, useState } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { Card } from '../../components/ui'
import { openStudentLink } from '../../store/session'
import { useStore } from '../../store/store'

export function StudentLinkLayout() {
  const { token = '' } = useParams()
  const ready = useStore((s) => s.mode === 'student_link' && s.linkToken === token)
  const student = useStore((s) => s.data.students[0])
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setError('')
    openStudentLink(token).catch((e) => live && setError(e instanceof Error ? e.message : 'This page is not available right now.'))
    return () => {
      live = false
    }
  }, [token])

  // Keep the page current when the student comes back to it.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && useStore.getState().linkToken === token) openStudentLink(token).catch(() => {})
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
        <p role="status" className="py-10 text-center text-sm text-muted">
          Loading…
        </p>
      )}
    </main>
  )
}
