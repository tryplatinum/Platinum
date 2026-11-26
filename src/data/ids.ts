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

export function withFreshIds(data: AppData): AppData {
  const ids = new Map<string, string>()
  const add = (id: string) => ids.set(id, crypto.randomUUID())
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
