// Settings, Google: which Google account is
// connected, Connect, Disconnect, and what the app can do with it. The
// connection is the signed-in person's own, not the firm's. Shown only when
// the server has Google settings.

import { useLastCalendarRead } from '../../lib/calendarSync'
import { formatTimestamp } from '../../lib/dates'
import { useEffect, useState } from 'react'
import { GoogleFailure, callGoogle, loadGoogleStatus, startGoogleConnect, takeGoogleStatus, useGoogleStatus } from '../../services/google'
import type { GoogleStatus } from '../../../shared/google'
import { Button, Card, Pill, useConfirm } from '../ui'

const reasonOf = (error: unknown) => (error instanceof GoogleFailure ? error.message : 'Something went wrong. Please try again.')

export function GoogleAccount() {
  const status = useGoogleStatus()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const lastRead = useLastCalendarRead()
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
  // Asked for on its own, like Gmail: never part of the first Drive consent.
  const turnOnCalendar = () => run(() => startGoogleConnect({ calendar: true }))
  const turnOffCalendar = async () => {
    const yes = await confirm({ title: 'Turn off Google Calendar', body: 'Platinum stops reading and writing your calendar. Your meetings here are not touched, and events already on your calendar stay there.', action: 'Turn off' })
    if (!yes) return
    void run(async () => {
      takeGoogleStatus(await callGoogle<GoogleStatus>('calendar_off'))
      setBusy(false)
    })
  }
  const disconnect = async () => {
    const yes = await confirm({ title: 'Disconnect Google', body: 'Disconnect Google? Files already imported stay. Linked Drive folders stop syncing until you connect again.', action: 'Disconnect Google' })
    if (!yes) return
    void run(async () => {
      takeGoogleStatus(await callGoogle<GoogleStatus>('disconnect'))
      setBusy(false)
    })
  }

  return (
    <Card className="motion-fade flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Google account</h2>
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
          {status.connected && status.driveReconnect && !status.reconnect && (
            <Button variant="primary" busy={busy} onClick={() => void connect()}>
              Reconnect Google Drive
            </Button>
          )}
          {status.connected && status.reconnect && (
            <Button variant="primary" disabled={busy} onClick={() => void connect()}>
              {status.gmail ? 'Reconnect Gmail' : 'Reconnect Google'}
            </Button>
          )}
          {status.connected ? (
            <Button disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </Button>
          ) : (
            <Button variant="primary" busy={busy} onClick={() => void connect()}>
              Connect Google
            </Button>
          )}
        </div>
      </div>
      <p className="text-[13px] text-muted">
        Platinum can open files you pick in Google Drive and never changes them. It cannot browse the rest of your Drive. Files you import are copied here. The connection is yours alone: colleagues connect their own.
      </p>
      {status.connected && status.driveReconnect && !status.reconnect && (
        <p role="status" className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Reconnect Google Drive. This connection can still read every file in Drive, and Platinum will not use it until you connect again. Files already imported are not affected.
        </p>
      )}
      {status.connected && status.reconnect && (
        <p role="status" className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Google has ended this connection. Reconnect to choose files in Drive again{status.gmail ? ', and so that approved emails can be sent from your Gmail' : ''}. Files already imported are not affected.
        </p>
      )}
      {status.connected && !status.reconnect && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2">
          <p className="min-w-0 flex-1 basis-64 text-[13px] text-ink-soft">
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
            <Button busy={busy} onClick={() => void turnOnGmail()}>
              Turn on sending from Gmail
            </Button>
          )}
        </div>
      )}
      {status.connected && !status.reconnect && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2">
          <div className="min-w-0 flex-1 basis-64 text-[13px] text-ink-soft">
            {status.calendar ? (
              <>
                <p>
                  <span className="font-semibold text-heading">Google Calendar is on.</span> Platinum uses your main calendar ({status.address}).{' '}
                  {lastRead ? `Last read ${formatTimestamp(lastRead)}.` : 'Not read yet in this tab: it is read when you open Today or the Meetings calendar.'}
                </p>
                <p className="mt-1">
                  <span className="font-semibold text-heading">It reads</span> the events on calendars you own, to show them beside your meetings. They are not stored unless you link one to a student.{' '}
                  <span className="font-semibold text-heading">It writes</span> one event for each meeting you schedule here: the student’s first name, the meeting’s title, time and place, and a link back. No notes. It never adds a guest and never lets Google email anyone.
                </p>
              </>
            ) : (
              <p>
                <span className="font-semibold text-heading">Google Calendar is off.</span> Turn it on to see your calendar beside your meetings and to put each meeting you schedule here on it. Platinum would see and change events on calendars you own; it never invites anyone. Drive keeps working either way.
              </p>
            )}
          </div>
          {status.calendar ? (
            <Button busy={busy} onClick={() => void turnOffCalendar()}>
              Turn off Google Calendar
            </Button>
          ) : (
            <Button busy={busy} onClick={() => void turnOnCalendar()}>
              Turn on Google Calendar
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-bad-line bg-bad-tint px-3 py-2 text-[13px] text-bad">
          {error}{' '}
          <button type="button" className="min-h-11 font-semibold underline" onClick={() => void loadGoogleStatus(true)}>
            Check again
          </button>
        </p>
      )}
    </Card>
  )
}

/** What to say when Google sends the person back to the app. */
export const GOOGLE_RETURN: Record<string, string> = {
  connected: 'Google is connected.',
  gmail_on: 'Sending from Gmail is turned on.',
  calendar_on: 'Google Calendar is turned on.',
  declined: 'Google was not connected: the request was cancelled at Google.',
  unchanged: 'Nothing was changed. Drive access has to stay ticked on Google’s screen.',
  failed: 'Google could not be connected. Please try again.',
}
