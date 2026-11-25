// "Open in Messages": hands a text to the messaging app on this device, with
// the number and the words filled in, for the counselor to send themselves.
// The weekly text flow and the Messages screen both use this one link.
// Whoever shows it records the send (note "Sent from your own phone") in onOpen.
//
// The text may hold the student's secret link, which is only made when it is
// asked for. So the address of this link is filled in at the click: at once
// when the text is ready, or as soon as it is. If it cannot be made, Messages
// does not open and onOpen is not called.

import { useState } from 'react'

/** What the sms: link needs: digits, with a leading + kept. */
export const smsNumber = (phone: string) => phone.trim().replace(/(?!^\+)\D/g, '')

export const smsHref = (phone: string, text: string) => `sms:${smsNumber(phone)}?&body=${encodeURIComponent(text)}`

/** Follows an sms: address the way a click on a link would. */
function follow(href: string) {
  const a = document.createElement('a')
  a.href = href
  a.click()
}

export function OpenInMessages({
  phone,
  text,
  disabled = false,
  onOpen,
  onError,
}: {
  phone: string
  text: () => string | Promise<string>
  disabled?: boolean
  onOpen: () => void
  onError: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const off = disabled || busy
  return (
    <button
      type="button"
      disabled={off}
      aria-busy={busy}
      className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
      onClick={() => {
        const open = (value: string) => {
          follow(smsHref(phone, value))
          onOpen()
        }
        const value = text()
        if (typeof value === 'string') return open(value)
        setBusy(true)
        value
          .then(open)
          .catch((e: unknown) => onError(e instanceof Error ? e.message : 'The text could not be prepared. Please try again.'))
          .finally(() => setBusy(false))
      }}
    >
      Open in Messages
    </button>
  )
}
