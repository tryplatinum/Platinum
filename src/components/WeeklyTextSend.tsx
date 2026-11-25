// Sending a weekly text by hand: Copy, Open in Messages, or, with no number on
// file, a link to add one. The Weekly texts tab and the Inbox both use these,
// so a weekly text is sent the same way from either place. Pressing Copy or
// Open in Messages is the counselor's approval of the text as it stands.

import type { ReactNode } from 'react'
import { previewStudentLink } from '../../shared/dispatch'
import { WEEKLY_TEXT_MAX } from '../lib/reminders'
import { useStore } from '../store/store'
import type { Student, WeeklyText } from '../types'
import { OpenInMessages } from './OpenInMessages'
import { Button, LinkButton, useToast } from './ui'

const SENT_FROM_PHONE = 'You can undo the queued message for 60 seconds.'

/** The text is measured as the counselor sees it, with the link placeholder spelled out. */
export const weeklyTextLength = (text: string) => previewStudentLink(text).length
export const weeklyTextTooLong = (text: string) => weeklyTextLength(text) > WEEKLY_TEXT_MAX

/** `text` is what is on screen, which may not be saved yet. `children` follow the two buttons. */
export function WeeklyTextSend({ draft, student, text, children }: { draft: WeeklyText; student: Student; text: string; children?: ReactNode }) {
  const { updateWeeklyText, sendWeeklyText } = useStore.getState()
  const toast = useToast()
  const phone = student.phone?.trim()
  if (!phone) return <LinkButton to={`/app/students/${student.id}?tab=profile`}>Add a phone number</LinkButton>

  const disabled = !text.trim() || weeklyTextTooLong(text)
  const approve = (via: 'copy' | 'sms') => {
    updateWeeklyText(draft.id, text)
    sendWeeklyText(draft.id, via)
  }
  return (
    <>
      <Button
        variant="primary"
        disabled={disabled}
        onClick={() => {
          void navigator.clipboard?.writeText(text)
          approve('copy')
          toast(`Copied. Paste it into a text to ${student.firstName}. ${SENT_FROM_PHONE}`)
        }}
      >
        Copy
      </Button>
      <OpenInMessages
        phone={phone}
        text={text}
        disabled={disabled}
        onOpen={() => {
          approve('sms')
          toast(`Opening your Messages app. ${SENT_FROM_PHONE}`)
        }}
      />
      {children}
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
