// The student's real link, for a text the counselor sends by hand. A draft holds
// the placeholder {{student_link}}; the server fills it in when it sends, and
// this fills it in when the counselor copies the text or opens Messages.
//
// The address is a secret. It is kept in memory for this session only, one per
// student, and is never stored: what is saved keeps the placeholder.

import { STUDENT_LINK_PLACEHOLDER, fillStudentLink, studentLinkUrl } from '../../shared/dispatch'
import { useStore } from '../store/store'
import type { ID } from '../types'

const ready = new Map<ID, string>()
const making = new Map<ID, Promise<string>>()

/** Forgets one student's link, because it was replaced or revoked. With no id, forgets them all. */
export function forgetStudentLink(studentId?: ID): void {
  if (studentId) {
    ready.delete(studentId)
    making.delete(studentId)
  } else {
    ready.clear()
    making.clear()
  }
}

// Another account, or nobody: the links go with the session that made them.
useStore.subscribe((s, before) => {
  if (s.account !== before.account && s.account.status !== 'ready') forgetStudentLink()
})

function linkFor(studentId: ID): Promise<string> {
  const url = ready.get(studentId)
  if (url) return Promise.resolve(url)
  const pending = making.get(studentId)
  if (pending) return pending
  const made = useStore
    .getState()
    .createStudentLink(studentId)
    .then((token) => {
      const address = studentLinkUrl(window.location.origin, token)
      // Not kept if it was forgotten while it was being made.
      if (making.get(studentId) === made) ready.set(studentId, address)
      return address
    })
    .finally(() => {
      if (making.get(studentId) === made) making.delete(studentId)
    })
  making.set(studentId, made)
  return made
}

/** The text with the student's address in it. A string when nothing has to be made first. */
export function textWithStudentLink(studentId: ID, text: string): string | Promise<string> {
  if (!text.includes(STUDENT_LINK_PLACEHOLDER)) return text
  const url = ready.get(studentId)
  return url ? fillStudentLink(text, url) : linkFor(studentId).then((made) => fillStudentLink(text, made))
}

/**
 * Copies a text that may still be on its way. Safari only allows a clipboard
 * write inside the click, so a promise is handed to it as a ClipboardItem.
 * Rejects, having copied nothing, when the text or the clipboard fails.
 */
export async function copyText(text: string | Promise<string>): Promise<void> {
  const clipboard = navigator.clipboard as Clipboard | undefined
  if (!clipboard) throw new Error('This browser does not allow copying. Nothing was copied.')
  if (typeof text !== 'string' && typeof ClipboardItem !== 'undefined' && typeof clipboard.write === 'function') {
    try {
      await clipboard.write([new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) })])
      return
    } catch {
      // Either the text could not be made, which the line below reports, or this
      // browser does not take a promise, and an ordinary write is tried.
    }
  }
  const value = await text
  try {
    await clipboard.writeText(value)
  } catch {
    throw new Error('This browser did not allow the copy. Nothing was copied.')
  }
}
