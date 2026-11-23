// Carries saved data forward when the data shapes change, so a counselor's own
// students survive an update. Add one step per schema bump; never discard.

import type { AppData, Channel, DocCategory, DocumentKind, EssayStatus, Meeting, Parent, Student, StudentDocument } from '../types'

export const SCHEMA = 3

export const CATEGORY_FOR_KIND: Record<DocumentKind, DocCategory> = {
  essay: 'application',
  transcript: 'academic',
  score_report: 'testing',
  recommendation: 'recommendation',
  resume: 'application',
  other: 'other',
}

/** Schema 2 kept one free-text `contact` per parent. Sort it into the right field. */
export function splitContact(contact: string | undefined): Pick<Parent, 'phone' | 'email' | 'wechatId' | 'lineId'> {
  const value = contact?.trim()
  if (!value) return {}
  const tagged = value.match(/^(wechat|line)\s*:\s*(.+)$/i)
  if (tagged) return tagged[1].toLowerCase() === 'wechat' ? { wechatId: tagged[2] } : { lineId: tagged[2] }
  return value.includes('@') ? { email: value } : { phone: value }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- old shapes are untyped by nature */

function from2to3(old: any): AppData {
  const students: Student[] = (old.students ?? []).map((s: any) => {
    const parents: Parent[] = (s.parents ?? []).map((p: any, i: number) => {
      const { contact, ...rest } = p
      return { ...rest, ...splitContact(contact), isPrimary: i === 0 }
    })
    return {
      ...s,
      parents,
      preferredChannel: 'text' as Channel,
      reportSettings: { schedule: 'after_meetings', recipientIds: parents.map((p) => p.id) },
    }
  })

  const documents: StudentDocument[] = (old.documents ?? []).map((d: any) => {
    const { essayText, ...rest } = d
    const doc: StudentDocument = { ...rest, category: CATEGORY_FOR_KIND[d.kind as DocumentKind] ?? 'other' }
    if (d.kind === 'essay') {
      const status: EssayStatus = d.feedback?.review === 'approved' ? 'revising' : essayText ? 'needs_feedback' : 'drafting'
      doc.essayGroup = 'college'
      doc.target = ''
      doc.status = status
      doc.drafts = essayText ? [{ n: 1, text: essayText, savedOn: d.addedOn }] : []
    }
    return doc
  })

  const meetings: Meeting[] = (old.meetings ?? []).map((m: any) => {
    const { aiAttended: _aiAttended, counselorNotes, ...rest } = m
    const meeting: Meeting = { ...rest, transcript: m.transcript ?? counselorNotes }
    if (m.ai) {
      // Old drafts had one list of notes and no approval on them. Treat notes on a
      // fully reviewed meeting as already accepted.
      const somethingPending =
        [...m.ai.draftTasks, ...m.ai.parentUpdates, ...m.ai.profileChanges].some((x: any) => x.review === 'pending') || m.recap?.review === 'pending'
      meeting.ai = { ...m.ai, decided: [], progress: [], watch: [], notesReview: somethingPending ? 'pending' : 'approved' }
    }
    return meeting
  })

  return { ...old, students, documents, meetings }
}

/** Returns data in the current shape, or undefined if it cannot be read at all. */
export function migrate(schema: unknown, data: unknown): AppData | undefined {
  if (!data || typeof data !== 'object') return undefined
  try {
    if (schema === SCHEMA) return data as AppData
    if (schema === 2) return from2to3(data)
    return undefined
  } catch (error) {
    console.error('[platinum] could not migrate saved data', error)
    return undefined
  }
}
