// One line, only while a message can still be undone or is waiting for the
// phone. The Inbox and Today show the same line.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { messageOnItsWay } from '../lib/inbox'
import { useData } from '../store/store'
import { cx } from './ui'

export function OnTheirWay({ className }: { className?: string }) {
  const outbox = useData().outbox
  const [now, setNow] = useState(() => Date.now())
  const count = outbox.filter((m) => messageOnItsWay(m, now)).length
  useEffect(() => {
    // A message queued since the last tick is measured from now, not from then.
    setNow(Date.now())
  }, [outbox])
  useEffect(() => {
    if (count === 0) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [count])
  if (count === 0) return null
  return (
    <p className={cx('motion-fade text-sm text-ink-soft', className)}>
      {count} {count === 1 ? 'message is' : 'messages are'} on the way out.{' '}
      <Link to="/app/messages" className="font-semibold text-accent hover:underline">
        Open Messages
      </Link>
    </p>
  )
}
