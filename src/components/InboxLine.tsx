// One thing waiting, as two lines: what it is and who it goes to, then one
// line of the message. The Inbox list and Today both show this row, and both
// open the whole draft from it, so nothing is approved from the short form.

import type { InboxRow } from '../lib/inbox'
import { useLeaving } from './motion'
import { Pill, cx } from './ui'

export function InboxLine({ row, student, className }: { row: InboxRow; /** A name to put first, where no heading above gives it. */ student?: string; className?: string }) {
  const leaving = useLeaving()
  const who = [student, row.who].filter(Boolean).join(' · ')
  return (
    <span className={cx('flex min-w-0 flex-col gap-1', leaving && 'opacity-60', className)}>
      <span className="flex min-w-0 items-center gap-2">
        <Pill className="shrink-0">{row.pill}</Pill>
        {who && <span className="truncate text-[13px] text-muted">{who}</span>}
      </span>
      <span lang={row.item?.language} className="truncate text-sm text-ink">
        {row.line}
      </span>
    </span>
  )
}
