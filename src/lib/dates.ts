// Date helpers. Dates in the data are plain 'YYYY-MM-DD' strings in local time
// (ISODate); timestamps are full ISO strings. Keeping calendar dates as strings
// avoids timezone drift and makes them trivially sortable.

export type ISODate = string

const pad = (n: number) => String(n).padStart(2, '0')

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseISODate(iso: ISODate): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayISO(): ISODate {
  return toISODate(new Date())
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/** Whole days from `from` to `to`. Positive when `to` is later. */
export function daysBetween(from: ISODate, to: ISODate): number {
  const ms = parseISODate(to).getTime() - parseISODate(from).getTime()
  return Math.round(ms / 86_400_000)
}

/** Days from today until `iso`. Negative means it is in the past. */
export function daysFromToday(iso: ISODate): number {
  return daysBetween(todayISO(), iso)
}

/** "Nov 28" (adds the year only when it is not the current year). */
export function formatDate(iso: ISODate): string {
  const d = parseISODate(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** "Tue, Nov 28" */
export function formatDateLong(iso: ISODate): string {
  return parseISODate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** "11月28日" for Chinese-language messages. */
export function formatDateZh(iso: ISODate): string {
  const d = parseISODate(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function formatRelative(iso: ISODate): string {
  const n = daysFromToday(iso)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n === -1) return 'yesterday'
  if (n > 1) return n < 14 ? `in ${n} days` : `in ${Math.round(n / 7)} weeks`
  const ago = -n
  return ago < 14 ? `${ago} days ago` : `${Math.round(ago / 7)} weeks ago`
}

/** "4:00 PM" from "16:00". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${((h + 11) % 12) + 1}:${pad(m)} ${suffix}`
}

/** "Nov 28, 4:00 PM" from a full ISO timestamp. */
export function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function nowTimestamp(): string {
  return new Date().toISOString()
}

/** A timestamp `daysOffset` days from today at the given local time. */
export function timestampAt(daysOffset: number, hhmm: string): string {
  const d = parseISODate(addDays(todayISO(), daysOffset))
  const [h, m] = hhmm.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}
