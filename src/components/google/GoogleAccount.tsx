// The "Google account" row in Firm settings: which Google account is
// connected, Connect, Disconnect, and what the app can do with it. The
// connection is the signed-in person's own, not the firm's. Shown only when
// the server has Google settings.

import { useEffect, useState } from 'react'
import { GoogleFailure, callGoogle, loadGoogleStatus, startGoogleConnect, takeGoogleStatus, useGoogleStatus } from '../../services/google'
import type { GoogleStatus } from '../../../shared/google'
import { Button, Pill, SectionLabel } from '../ui'

const reasonOf = (error: unknown) => (error instanceof GoogleFailure ? error.message : 'Something went wrong. Please try again.')

export function GoogleAccount() {
  const status = useGoogleStatus()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // Settings shows the connection as it is now, not as it was when the app loaded.
  useEffect(() => {
    void loadGoogleStatus(true)
  }, [])
  if (!status?.available) return null

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(undefined)
    try {
      await work()
    } catch (e) {
      setError(reasonOf(e))
      setBusy(false)
    }
  }
  // Reconnecting asks again for everything this connection had, so sending from Gmail is not lost.
  const connect = () => run(() => startGoogleConnect({ gmail: status.gmail }))
  const turnOnGmail = () => run(() => startGoogleConnect({ gmail: true }))
  const disconnect = () => {
    if (!window.confirm('Disconnect Google? Files already imported stay. Linked Drive folders stop syncing until you connect again.')) return
    void run(async () => {
      takeGoogleStatus(await callGoogle<GoogleStatus>('disconnect'))
      setBusy(false)
    })
  }

  return (
    <section aria-labelledby="google-account" className="flex flex-col gap-3 border-t border-line pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel>
            <span id="google-account">Google account</span>
          </SectionLabel>
          {status.connected ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span className="break-all font-semibold">{status.address}</span>
              {status.reconnect ? <Pill tone="warn">Needs reconnecting</Pill> : <Pill tone="good">Connected</Pill>}
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink-soft">Not connected.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {status.connected && status.reconnect && (
            <Button variant="primary" disabled={busy} onClick={() => void connect()}>
              {status.gmail ? 'Reconnect Gmail' : 'Reconnect Google'}
            </Button>
          )}
          {status.connected ? (
            <Button disabled={busy} onClick={disconnect}>
              Disconnect
            </Button>
          ) : (
            <Button variant="primary" disabled={busy} onClick={() => void connect()}>
              Connect Google
            </Button>
          )}
        </div>
      </div>
      <p className="text-[13px] text-muted">
        Platinum can read all files in the connected Drive and never changes them. Files you import are copied here; nothing in Drive is edited, moved or deleted. The connection is yours alone: colleagues connect their own.
      </p>
      {status.connected && status.reconnect && (
        <p role="status" className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Google has ended this connection. Reconnect to browse Drive and to sync linked folders again{status.gmail ? ', and so that approved emails can be sent from your Gmail' : ''}. Files already imported are not affected.
        </p>
      )}
      {status.connected && !status.reconnect && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2">
          <p className="min-w-0 flex-1 text-[13px] text-ink-soft">
            {status.gmail ? (
              <>
                <span className="font-semibold text-heading">Sending from Gmail is on.</span> Emails you approve can be sent from {status.address}. Platinum can send mail from this account; it cannot read your mail.
              </>
            ) : (
              <>
                <span className="font-semibold text-heading">Sending from Gmail is off.</span> Turn it on to let emails you approve be sent from this address. Platinum would be able to send mail; it could not read your mail. Drive keeps working either way.
              </>
            )}
          </p>
          {!status.gmail && (
            <Button disabled={busy} onClick={() => void turnOnGmail()}>
              Turn on sending from Gmail
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-bad-line bg-bad-tint px-3 py-2 text-[13px] text-bad">
          {error}{' '}
          <button type="button" className="font-semibold underline" onClick={() => void loadGoogleStatus(true)}>
            Check again
          </button>
        </p>
      )}
    </section>
  )
}

/** What to say when Google sends the person back to the app. */
export const GOOGLE_RETURN: Record<string, string> = {
  connected: 'Google is connected.',
  gmail_on: 'Sending from Gmail is turned on.',
  declined: 'Google was not connected: the request was cancelled at Google.',
  unchanged: 'Nothing was changed. Drive access has to stay ticked on Google’s screen.',
  failed: 'Google could not be connected. Please try again.',
}
