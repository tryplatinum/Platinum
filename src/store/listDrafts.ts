// The store's actions for draft college lists. They are part of the one store
// (store.ts spreads them in); they live here to keep that file readable.
//
// A draft is made by the server and added to the list by a database function,
// so those two ask, then take what was saved into memory with `absorb`. What a
// counselor does while reviewing (remove, put back, change a band, add a
// college, discard) is an ordinary change, saved like any other.
//
// Nothing here writes to `colleges` except addDraftToList, and that only
// through the database function a counselor's "Add to list" calls.

import { ACTIVITY_LIMIT, addDraftToCollegeList, loadAfterListApproval, loadListDraft } from '../data/repo'
import { counselorBasis } from '../lib/collegeBands'
import { bandColleges, requestListDraft } from '../services/colleges'
import type { AppData, CollegeFit, CollegeListDraft, CollegeListDraftItem, CollegeListPreferences, ID } from '../types'

export interface ListDraftActions {
  /**
   * Drafts a list on the server and brings the saved draft into memory. With
   * `replaces`, that earlier draft is discarded once the new one exists.
   * Throws with a message to show; nothing is left behind when it does.
   */
  draftCollegeList: (studentId: ID, preferences: CollegeListPreferences, replaces?: ID) => Promise<{ draftId: ID; byModel: boolean }>
  /** Remove a college from a draft (false) or put it back (true). The row stays, so it can be put back. */
  keepDraftItem: (itemId: ID, kept: boolean) => void
  /** A counselor sets the band. Recorded as theirs, with what the rule gave; choosing the rule's own band again undoes that. */
  setDraftItemFit: (itemId: ID, fit: CollegeFit) => void
  /** Adds a directory college to a draft, banded by the same rules. Throws with a message to show. */
  addCollegeToDraft: (draftId: ID, unitid: number) => Promise<void>
  discardListDraft: (draftId: ID) => void
  /**
   * "Add to list": the kept colleges go onto the student's list in one database
   * call, the draft is marked approved with who and when, and the activity log
   * says so. Resolves with how many were added (ones already listed are skipped).
   */
  addDraftToList: (draftId: ID) => Promise<number>
}

interface Tools {
  get: () => { data: AppData; mode: 'firm' | 'student_link' }
  absorb: (fn: (data: AppData) => AppData) => void
  change: (fn: (data: AppData) => AppData) => void
  /** Resolves once every change made so far has been written. */
  saved: () => Promise<void>
}

const patchItem = (data: AppData, itemId: ID, fn: (item: CollegeListDraftItem) => CollegeListDraftItem): AppData => {
  const item = data.collegeListDraftItems.find((i) => i.id === itemId)
  // Only a draft still under review can be edited.
  if (!item || data.collegeListDrafts.find((d) => d.id === item.draftId)?.status !== 'draft') return data
  return { ...data, collegeListDraftItems: data.collegeListDraftItems.map((i) => (i.id === itemId ? fn(i) : i)) }
}

/** A draft and its rows as the database has them, replacing whatever memory held for that draft. */
const withDraft = (draft: CollegeListDraft, items: CollegeListDraftItem[]) => (data: AppData): AppData => ({
  ...data,
  collegeListDrafts: data.collegeListDrafts.some((d) => d.id === draft.id) ? data.collegeListDrafts.map((d) => (d.id === draft.id ? draft : d)) : [...data.collegeListDrafts, draft],
  collegeListDraftItems: [...data.collegeListDraftItems.filter((i) => i.draftId !== draft.id), ...items],
})

export function listDraftActions({ get, absorb, change, saved }: Tools): ListDraftActions {
  const discard = (draftId: ID) =>
    change((data) => (data.collegeListDrafts.some((d) => d.id === draftId && d.status === 'draft') ? { ...data, collegeListDrafts: data.collegeListDrafts.map((d) => (d.id === draftId ? { ...d, status: 'discarded' as const } : d)) } : data))

  return {
    draftCollegeList: async (studentId, preferences, replaces) => {
      const made = await requestListDraft(studentId, preferences)
      const { draft, items } = await loadListDraft(made.draftId)
      absorb(withDraft(draft, items))
      if (replaces) discard(replaces)
      return { draftId: made.draftId, byModel: made.byModel }
    },

    keepDraftItem: (itemId, kept) => change((data) => patchItem(data, itemId, (i) => (i.kept === kept ? i : { ...i, kept }))),

    setDraftItemFit: (itemId, fit) =>
      change((data) =>
        patchItem(data, itemId, (i) => {
          if (i.fit === fit) return i
          const next = counselorBasis(i.fitBasis, fit)
          return { ...i, fit, fitBasis: next.basis, fitSetBy: next.fitSetBy }
        }),
      ),

    addCollegeToDraft: async (draftId, unitid) => {
      const draft = get().data.collegeListDrafts.find((d) => d.id === draftId)
      if (!draft || draft.status !== 'draft') throw new Error('That draft is no longer open.')
      const existing = get().data.collegeListDraftItems.find((i) => i.draftId === draftId && i.unitid === unitid)
      if (existing) {
        // Already in the draft (perhaps removed earlier): put it back.
        change((data) => patchItem(data, existing.id, (i) => ({ ...i, kept: true })))
        return
      }
      const [band] = await bandColleges(draft.studentId, [unitid])
      if (!band) throw new Error('The directory has no such college.')
      change((data) => {
        const items = data.collegeListDraftItems.filter((i) => i.draftId === draftId)
        if (items.some((i) => i.unitid === unitid) || data.collegeListDrafts.find((d) => d.id === draftId)?.status !== 'draft') return data
        const item: CollegeListDraftItem = {
          id: crypto.randomUUID(),
          draftId,
          unitid,
          fit: band.fit,
          fitBasis: { ...band.basis, addedBy: 'counselor' },
          fitSetBy: 'rule',
          // The counselor chose it: there is no reason from the AI, and none is made up.
          reason: '',
          aiExplained: false,
          kept: true,
          position: Math.max(-1, ...items.map((i) => i.position)) + 1,
        }
        return { ...data, collegeListDraftItems: [...data.collegeListDraftItems, item] }
      })
    },

    discardListDraft: discard,

    addDraftToList: async (draftId) => {
      const draft = get().data.collegeListDrafts.find((d) => d.id === draftId)
      if (!draft || draft.status !== 'draft') throw new Error('That draft has already been added or discarded.')
      // The database function reads the draft's rows, so every review edit must have landed first.
      await saved()
      const added = await addDraftToCollegeList(draftId)
      const after = await loadAfterListApproval(draft.studentId, draftId)
      absorb((data) => {
        const have = new Set(data.colleges.map((c) => c.id))
        const logged = new Set(data.activity.map((a) => a.id))
        return {
          ...data,
          colleges: [...data.colleges, ...after.colleges.filter((c) => !have.has(c.id))],
          collegeListDrafts: data.collegeListDrafts.map((d) => (d.id === draftId ? after.draft : d)),
          // Newest first, like the rest of the log.
          activity: [...after.activity.filter((a) => !logged.has(a.id)), ...data.activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, ACTIVITY_LIMIT),
        }
      })
      return added
    },
  }
}
