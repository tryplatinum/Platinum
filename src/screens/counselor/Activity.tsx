// Activity log for the firm: newest first, filterable, with Load more beyond
// the 300 rows kept in memory.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, CardHeader, Empty, PageHeader, inputBase, usePageTitle } from '../../components/ui'
import { loadOlderActivity } from '../../data/repo'
import { formatTimestamp } from '../../lib/dates'
import { activeStudents, findStudent, fullName } from '../../lib/derive'
import { useData, useStore } from '../../store/store'
import type { ActivityEvent, Actor, ID } from '../../types'

const PAGE = 50

type ActionFilter = 'all' | 'approved' | 'discarded' | 'sent' | 'failed' | 'other'

const ACTION_OPTIONS: { value: ActionFilter; label: string }[] = [
  { value: 'all', label: 'All actions' },
  { value: 'approved', label: 'Approvals' },
  { value: 'discarded', label: 'Discards / cancels' },
  { value: 'sent', label: 'Sends' },
  { value: 'failed', label: 'Failures' },
  { value: 'other', label: 'Other' },
]

function actionOf(text: string): ActionFilter {
  const t = text.toLowerCase()
  if (t.startsWith('approved') || t.includes('approved a ')) return 'approved'
  if (t.startsWith('cancelled') || t.startsWith('canceled') || t.includes('discard')) return 'discarded'
  if (t.startsWith('sent a ') || t.startsWith('sent ')) return 'sent'
  if (t.startsWith('failed')) return 'failed'
  return 'other'
}

function whoDidIt(actor: Actor, counselorName: string): string {
  if (actor === 'system') return 'System'
  if (actor === 'counselor') return counselorName || 'Counselor'
  if (actor === 'ai') return 'AI'
  if (actor === 'student') return 'Student'
  if (actor === 'parent') return 'Parent'
  return actor
}

export default function Activity() {
  const data = useData()
  const account = useStore((s) => s.account)
  const firmId = account.status === 'ready' ? account.firmId : undefined
  const [studentId, setStudentId] = useState('')
  const [action, setAction] = useState<ActionFilter>('all')
  const [extra, setExtra] = useState<ActivityEvent[]>([])
  const [busy, setBusy] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [failed, setFailed] = useState(false)
  usePageTitle('Activity')
  const [shown, setShown] = useState(PAGE)

  const merged = useMemo(() => {
    const byId = new Map<string, ActivityEvent>()
    for (const e of [...extra, ...data.activity]) byId.set(e.id, e)
    return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at))
  }, [data.activity, extra])

  const filtered = useMemo(() => {
    return merged.filter((e) => {
      if (studentId && e.studentId !== studentId) return false
      if (action !== 'all' && actionOf(e.text) !== action) return false
      return true
    })
  }, [merged, studentId, action])

  const visible = filtered.slice(0, shown)
  const canShowMoreInMemory = shown < filtered.length

  const loadMore = async () => {
    if (canShowMoreInMemory) {
      setShown((n) => n + PAGE)
      return
    }
    if (!firmId || exhausted || busy) return
    const oldest = merged[merged.length - 1]
    if (!oldest) {
      setExhausted(true)
      return
    }
    setBusy(true)
    setFailed(false)
    try {
      const rows = await loadOlderActivity(firmId, oldest.at, PAGE, studentId || undefined)
      if (rows.length === 0) setExhausted(true)
      else {
        setExtra((prev) => [...prev, ...rows])
        setShown((n) => n + PAGE)
      }
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Activity" sub="What the firm has done, newest first." />
      <Card>
        <CardHeader
          size="section"
          className="border-b border-line px-5 py-4"
          title="Log"
          count={filtered.length}
          action={
            <>
              <select aria-label="Filter by student" className={inputBase} value={studentId} onChange={(e) => { setStudentId(e.target.value); setShown(PAGE); setExhausted(false) }}>
                <option value="">All students</option>
                {activeStudents(data).map((s) => (
                  <option key={s.id} value={s.id}>
                    {fullName(s)}
                  </option>
                ))}
              </select>
              <select aria-label="Filter by action" className={inputBase} value={action} onChange={(e) => { setAction(e.target.value as ActionFilter); setShown(PAGE) }}>
                {ACTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </>
          }
        />
        {visible.length === 0 ? (
          <Empty title={studentId || action !== 'all' ? 'No activity matches these filters.' : 'Nothing has happened yet. Approvals, sends and edits appear here.'}>
            {(studentId || action !== 'all') && (
              <Button
                onClick={() => {
                  setStudentId('')
                  setAction('all')
                  setShown(PAGE)
                }}
              >
                Clear filters
              </Button>
            )}
          </Empty>
        ) : (
          <ul>
            {visible.map((e) => (
              <ActivityRow key={e.id} event={e} counselorName={data.firm.counselorName} />
            ))}
          </ul>
        )}
        {(canShowMoreInMemory || (!exhausted && firmId)) && visible.length > 0 && (
          <div className="border-t border-line px-5 py-3">
            <Button onClick={() => void loadMore()} busy={busy}>
              {busy ? 'Loading…' : 'Load more'}
            </Button>
            {failed && (
              <p role="alert" className="mt-2 text-[13px] text-bad">
                Older activity could not be loaded. Please try again.
              </p>
            )}
          </div>
        )}
      </Card>
    </>
  )
}

function ActivityRow({ event, counselorName }: { event: ActivityEvent; counselorName: string }) {
  const student = findStudent(useData(), event.studentId as ID)
  return (
    <li className="flex flex-col gap-0.5 border-t border-line px-5 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed">
          <span className="font-semibold">{whoDidIt(event.actor, counselorName)}</span>
          {student && (
            <>
              {' · '}
              <Link to={`/app/students/${student.id}`} className="tap-link font-medium text-accent hover:underline">
                {fullName(student)}
              </Link>
            </>
          )}
          <span className="text-ink-soft"> · {event.text}</span>
        </p>
      </div>
      <span className="shrink-0 text-[13px] text-muted">{formatTimestamp(event.at)}</span>
    </li>
  )
}
