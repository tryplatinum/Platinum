// Gives a dataset fresh uuid ids. The sample caseload and data saved by older
// versions use short readable ids ("s-kevin"); the database needs uuids, and
// two firms loading the sample must not collide.

import type { AppData } from '../types'

/** A copy of `value` with every string that is a key of `ids` replaced by its new id. */
export function swapIds<T>(value: T, ids: Map<string, string>): T {
  const swap = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') {
      // Reminder keys embed ids between colons.
      if (key === 'dedupeKey') return v.split(':').map((part) => ids.get(part) ?? part).join(':')
      return ids.get(v) ?? v
    }
    if (Array.isArray(v)) return v.map((item) => swap(item))
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x, k)]))
    return v
  }
  return swap(value) as T
}

/**
 * A uuid made from a readable id, the same every time. For the preview, so
 * "s-kevin" is always the same uuid: an address copied from one run opens in
 * the next. Not random, so never for the database.
 */
export function stableId(readable: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  let c = 0xdeadbeef
  let d = 0x41c6ce57
  for (let i = 0; i < readable.length; i++) {
    const k = readable.charCodeAt(i)
    a = Math.imul(a ^ k, 0x01000193)
    b = Math.imul(b ^ k, 0x85ebca6b)
    c = Math.imul(c ^ k, 0xc2b2ae35)
    d = Math.imul(d ^ k, 0x27d4eb2f)
  }
  const hex = [a, b, c, d].map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** The dataset with uuid ids. Random by default; `make` can give the same uuid for the same readable id. */
export function withFreshIds(data: AppData, make: (id: string) => string = () => crypto.randomUUID()): AppData {
  const ids = new Map<string, string>()
  const add = (id: string) => ids.set(id, make(id))
  for (const s of data.students) {
    add(s.id)
    s.parents.forEach((p) => add(p.id))
  }
  for (const list of [data.tasks, data.meetings, data.colleges, data.documents, data.reports, data.outbox, data.activity, data.weeklyTexts ?? [], data.personalNotes ?? [], data.reminderSkips ?? [], data.templates ?? [], data.messageDrafts ?? []]) {
    list.forEach((row) => add(row.id))
  }

  // Every reference to one of those ids, wherever it sits (a task's parent, a
  // draft's recipient, report settings), is a string equal to the old id.
  return { ...swapIds({ ...data, firm: undefined, reminderRules: undefined }, ids), firm: data.firm, reminderRules: data.reminderRules }
}
