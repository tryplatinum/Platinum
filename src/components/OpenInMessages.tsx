// "Open in Messages": hands a text to the messaging app on this device, with
// the number and the words filled in, for the counselor to send themselves.
// The weekly text flow and the Messages screen both use this one link.
// Whoever shows it records the send (note "Sent from your own phone") in onOpen.

import { cx } from './ui'

/** What the sms: link needs: digits, with a leading + kept. */
export const smsNumber = (phone: string) => phone.trim().replace(/(?!^\+)\D/g, '')

export const smsHref = (phone: string, text: string) => `sms:${smsNumber(phone)}?&body=${encodeURIComponent(text)}`

export function OpenInMessages({ phone, text, disabled = false, onOpen }: { phone: string; text: string; disabled?: boolean; onOpen: () => void }) {
  return (
    <a
      href={disabled ? undefined : smsHref(phone, text)}
      aria-disabled={disabled}
      className={cx('inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-2', disabled && 'pointer-events-none opacity-50')}
      onClick={onOpen}
    >
      Open in Messages
    </a>
  )
}
