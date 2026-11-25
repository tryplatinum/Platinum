// Settings, Your phone: connect the counselor's own iPhone
// so texts they approve are sent from their own number. The phone is the
// signed-in person's own, not the firm's.
//
// Connecting shows a one-time code and a QR code for /phone-setup. The code is
// not a device key, and the URL does not contain one. The phone exchanges the
// code for the key.

import { useEffect, useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { PHONE_NOTICE, jobsCsv, secondsBetween, type JobStatus, type PhoneStatus } from '../../../shared/phoneGateway'
import { callPhone, phoneReason } from '../../services/phone'
import { Button, Card, Field, Pill, SectionLabel, inputClass, useConfirm, useToast, type Tone } from '../ui'

const JOB_LABEL: Record<JobStatus, string> = {
  pending: 'Waiting for your phone',
  claimed: 'Your phone has it',
  submitted: 'Sent from your phone',
  failed: 'Failed',
  unknown: 'Not confirmed',
  expired: 'Phone did not answer',
  cancelled: 'Cancelled',
}

const STATE_TONE: Record<NonNullable<PhoneStatus['device']>['state'], Tone> = { waiting: 'neutral', connected: 'good', not_seen: 'warn', stopped: 'bad' }

/** A QR code as one SVG path. Always dark on white, with a quiet border, so a phone camera reads it in either theme. */
function QrCode({ value }: { value: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const count = qr.getModuleCount()
    let d = ''
    for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (qr.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`
    return { size: count + 8, path: d }
  }, [value])
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-48 w-48 rounded-lg" role="img" aria-label="QR code that opens the setup page on your phone" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}

const seconds = (value: number | undefined) => (value === undefined ? '—' : `${value}s`)

export function YourPhone() {
  const toast = useToast()
  const confirm = useConfirm()
  const [status, setStatus] = useState<PhoneStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [connecting, setConnecting] = useState(false)
  const [label, setLabel] = useState('My iPhone')
  const [setup, setSetup] = useState<{ code: string; expiresAt: string }>()
  const [number, setNumber] = useState('')

  useEffect(() => {
    let live = true
    callPhone('status').then(
      (s) => {
        if (!live) return
        setStatus(s)
        setNumber(s.device?.ownPhone ?? '')
      },
      // No server functions, or nothing configured: the section is not shown.
      () => live && setStatus(undefined),
    )
    return () => {
      live = false
    }
  }, [])

  if (!status?.available) return null

  /** Runs one action and shows the phone as the server now has it. */
  const run = async (work: () => Promise<PhoneStatus>, done?: string) => {
    setBusy(true)
    setError(undefined)
    try {
      setStatus(await work())
      if (done) toast(done)
    } catch (e) {
      setError(phoneReason(e))
    } finally {
      setBusy(false)
    }
  }

  const connect = () =>
    run(async () => {
      const fresh = await callPhone<{ code: string; expiresAt: string }>('connect', { label: label.trim(), noticeShown: true })
      setSetup(fresh)
      setConnecting(false)
      return callPhone('status')
    })

  const disconnect = async () => {
    const yes = await confirm({
      title: 'Revoke this phone',
      body: 'Revoke this phone? The shortcut stops working immediately. Texts you approve go back to “Open in Messages” until you pair a phone again.',
      action: 'Revoke this phone',
    })
    if (!yes) return
    setSetup(undefined)
    void run(() => callPhone('disconnect'), 'Phone revoked.')
  }

  const { device, gmail } = status
  const setupUrl = setup ? `${window.location.origin}/phone-setup` : undefined
  const canConnect = gmail.connected && gmail.allowed

  return (
    <Card className="motion-fade flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Your phone</h2>
          {device ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{device.label}</span>
              <Pill tone={STATE_TONE[device.state]}>{device.stateLabel}</Pill>
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink-soft">No phone connected. Texts you approve are sent by hand with “Open in Messages”.</p>
          )}
        </div>
        {!device && !connecting && (
          <Button variant="primary" disabled={busy} onClick={() => setConnecting(true)}>
            Connect an iPhone
          </Button>
        )}
      </div>

      {!status.on && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-soft">
          Texting from your phone is switched off on this server. You can connect a phone now, but nothing is sent through it until it is switched on.
        </p>
      )}

      {connecting && !device && (
        <form
          className="flex flex-col gap-3 rounded-lg border border-line p-3"
          onSubmit={(e) => {
            e.preventDefault()
            void connect()
          }}
        >
          <Field label="A name for this phone">
            <input className={inputClass} required maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          {gmail.connected ? (
            <p className="text-[13px] text-ink-soft">
              Wake emails will go to <span className="break-all font-semibold">{gmail.address}</span>. This Gmail account must be added to Apple’s Mail app on the phone.
              {!gmail.allowed && ' That address is not on the allowed list yet, so the phone cannot be connected.'}
            </p>
          ) : (
            <p className="text-[13px] text-ink-soft">Connect Gmail first: turn on sending from Gmail in the Google account section above. Platinum wakes your phone with an email from your own Gmail to itself.</p>
          )}
          {!status.noticeShown && (
            <p role="note" className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
              {PHONE_NOTICE}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button disabled={busy} onClick={() => setConnecting(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" busy={busy} disabled={!canConnect || !label.trim()}>
              Connect
            </Button>
          </div>
        </form>
      )}

      {setup && setupUrl && (
        <div className="flex flex-col gap-3 rounded-lg border border-accent-line bg-accent-soft p-3">
          <p className="text-sm font-semibold text-heading">Scan this with your iPhone’s camera, then type this code</p>
          <div className="flex flex-wrap items-start gap-4">
            <QrCode value={setupUrl} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-[13px] text-ink-soft">The page has no key in the address. Type this code there. It works once and expires in 10 minutes.</p>
              <code className="block break-all rounded-lg bg-surface px-3 py-2 text-lg tracking-widest">{setup.code}</code>
              <Button
                className="self-start"
                onClick={() => {
                  void navigator.clipboard?.writeText(setup.code)
                  toast('Code copied.')
                }}
              >
                Copy code
              </Button>
            </div>
          </div>
          <Button className="self-start" variant="quiet" onClick={() => setSetup(undefined)}>
            Hide the code
          </Button>
        </div>
      )}

      {device && (
        <>
          <p className="text-[13px] text-ink-soft">
            Wake emails go to <span className="break-all font-semibold">{device.wakeEmail}</span>.{' '}
            {device.lastSeenAt ? `Last used ${new Date(device.lastSeenAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : 'Not used yet.'}
            {device.state === 'stopped' && ' Three texts in a row got no answer, so new texts go to “Open in Messages” until a test succeeds.'}
          </p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void run(() => callPhone('number', { phone: number }), 'Number saved.')
            }}
          >
            <Field label="Your own number, for the test" className="min-w-0 flex-1 basis-56">
              <input className={inputClass} type="tel" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+1 555 000 0000" />
            </Field>
            <Button type="submit" disabled={busy || number.trim() === (device.ownPhone ?? '')}>
              Save number
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy || !status.on || !device.ownPhone} onClick={() => void run(() => callPhone('test'), 'Test queued. Your phone should text you within a minute.')}>
              Send a test to my own number
            </Button>
            <Button disabled={busy || !status.on} onClick={() => void run(() => callPhone('wake'), 'Wake email sent.')}>
              Wake my phone
            </Button>
            <Button disabled={busy} onClick={() => void run(() => callPhone('status'))}>
              Refresh
            </Button>
            <Button disabled={busy} onClick={() => void disconnect()}>
              Revoke this phone
            </Button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-bad-line bg-bad-tint px-3 py-2 text-[13px] text-bad">
          {error}
        </p>
      )}

      {status.jobs.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionLabel>Recent texts through your phone</SectionLabel>
            <Button
              variant="quiet"
              onClick={() => {
                void navigator.clipboard?.writeText(jobsCsv(status.jobs))
                toast('Copied as CSV.')
              }}
            >
              Copy as CSV
            </Button>
          </div>
          {/* One list at every width: the labels sit with the numbers, so nothing is off the side of a phone. */}
          <ul className="text-[13px]">
            {status.jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 border-t border-line py-2 first:border-t-0">
                <span className="nums w-24 font-semibold">{job.to}</span>
                <span className="min-w-36 flex-1">{JOB_LABEL[job.status]}</span>
                <span className="nums text-muted">{new Date(job.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
                <span className="nums text-muted">To phone {seconds(secondsBetween(job.createdAt, job.claimedAt))}</span>
                <span className="nums text-muted">To report {seconds(secondsBetween(job.claimedAt, job.reportedAt))}</span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-muted">“To phone” is the time from the text being made to your phone taking it. “To report” is from then until your phone said how it went.</p>
        </div>
      )}
    </Card>
  )
}
