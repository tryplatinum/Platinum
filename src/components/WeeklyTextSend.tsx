// Sending a weekly text by hand: Copy, Open in Messages, or, with no number on
// file, a link to add one. The Weekly texts tab and the Inbox both use these,
// so a weekly text is sent the same way from either place. Pressing Copy or
// Open in Messages is the counselor's approval of the text as it stands.
//
// What is copied has the student's real link in it. What is saved keeps the
// placeholder (see lib/studentLinks.ts). Nothing is marked sent until the text
// is on the clipboard or Messages has been opened.

import { useState, type ReactNode } from 'react'
import { WEEKLY_TEXT_MAX, linkRoom } from '../lib/reminders'
import { copyText, textWithStudentLink } from '../lib/studentLinks'
import { useStore } from '../store/store'
import type { Student, WeeklyText } from '../types'
import { OpenInMessages } from './OpenInMessages'
import { Button, LinkButton, useToast } from './ui'

const SENT_FROM_PHONE = 'You can undo the queued message for 60 seconds.'

/** The text is measured as the student receives it, with their address in place of the placeholder. */
export const weeklyTextLength = (text: string) => text.length + linkRoom(text)
export const weeklyTextTooLong = (text: string) => weeklyTextLength(text) > WEEKLY_TEXT_MAX

/** `text` is what is on screen, which may not be saved yet. `children` follow the two buttons. */
export function WeeklyTextSend({ draft, student, text, children, primary }: { draft: WeeklyText; student: Student; text: string; children?: ReactNode; /** The one filled button of its view. */ primary?: boolean }) {
  const { updateWeeklyText, sendWeeklyText } = useStore.getState()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const phone = student.phone?.trim()
  if (!phone) return <LinkButton to={`/app/students/${student.id}?tab=profile`}>Add a phone number</LinkButton>

  const disabled = busy || !text.trim() || weeklyTextTooLong(text)
  const approve = (via: 'copy' | 'sms') => {
    updateWeeklyText(draft.id, text)
    sendWeeklyText(draft.id, via)
  }
  const copy = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await copyText(textWithStudentLink(student.id, text))
      approve('copy')
      toast(`Copied. Paste it into a text to ${student.firstName}. ${SENT_FROM_PHONE}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nothing was copied. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button variant={primary ? 'primary' : 'secondary'} data-action="approve" disabled={disabled} aria-busy={busy} onClick={() => void copy()}>
        Copy
      </Button>
      <OpenInMessages
        phone={phone}
        text={() => textWithStudentLink(student.id, text)}
        disabled={disabled}
        onError={setError}
        onOpen={() => {
          setError(undefined)
          approve('sms')
          toast(`Opening your Messages app. ${SENT_FROM_PHONE}`)
        }}
      />
      {children}
      {error && (
        <p role="alert" className="basis-full text-[13px] text-bad">
          {error} This text is not marked sent.
        </p>
      )}
    </>
  )
}

/** What the buttons do, or why there are none. */
export function WeeklyTextSendNote({ student }: { student: Student }) {
  return (
    <p className="text-[13px] text-muted">
      {student.phone?.trim()
        ? '“Open in Messages” needs a messaging app on this device. If nothing opens, use Copy. Either one counts as your approval and marks this text sent.'
        : `${student.firstName} has no phone number on file, so there is nowhere to send this.`}
    </p>
  )
}
