// /phone-setup: the page a counselor opens ON THEIR PHONE, by scanning the QR
// code shown in Firm settings. The address holds no key. The counselor types
// the one-time code from Firm settings; the page exchanges it at /api/phone for
// a device key and shows that key once, for the shortcut.

import { useState } from 'react'
import { PHONE_ENDPOINT } from '../../shared/phoneGateway'
import { Button, Card, SectionLabel, inputClass } from '../components/ui'
import setup from '../../docs/phone-gateway/ios-setup.md?raw'

/** The numbered lines of docs/phone-gateway/ios-setup.md. */
const STEPS = setup
  .split('\n')
  .map((line) => line.match(/^\d+\.\s+(.*)$/)?.[1])
  .filter((step): step is string => Boolean(step))

function CopyRow({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>{label}</SectionLabel>
      <code className="block break-all rounded-lg bg-canvas px-3 py-2 text-[13px]">{value}</code>
      <Button
        variant={big ? 'primary' : 'secondary'}
        className={big ? 'min-h-14 text-base' : undefined}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => setCopied(true))
        }}
      >
        {copied ? 'Copied' : big ? 'Copy key' : 'Copy'}
      </Button>
    </div>
  )
}

export default function PhoneSetup() {
  const [code, setCode] = useState('')
  const [key, setKey] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const shortcut = (import.meta.env.VITE_PHONE_SHORTCUT_URL as string | undefined)?.trim()

  const pair = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const res = await fetch(PHONE_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'pair', code: code.trim() }) })
      const reply = (await res.json().catch(() => undefined)) as { ok?: boolean; data?: { key: string }; message?: string } | undefined
      if (!res.ok || !reply?.ok || !reply.data?.key) throw new Error(reply?.message ?? 'That code did not work. Pair your phone again.')
      setKey(reply.data.key)
      setCode('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code did not work. Pair your phone again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 px-4 py-6">
      <h1 className="text-xl font-semibold text-heading">Set up this iPhone</h1>
      <p className="text-sm text-ink-soft">This page is for the phone that will send your texts. Keep it open while you build the shortcut.</p>

      <Card className="flex flex-col gap-4 p-4">
        {key ? (
          <>
            <CopyRow label="Device key" value={key} big />
            <p className="text-[13px] text-muted">Treat this key like a password. It is shown only here and only now. It expires in 90 days, or as soon as you revoke this phone in Firm settings. Then pair the phone again.</p>
          </>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void pair()
            }}
          >
            <label className="flex flex-col gap-2">
              <SectionLabel>Setup code from Firm settings</SectionLabel>
              <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="one-time-code" maxLength={16} required />
            </label>
            <Button type="submit" variant="primary" disabled={busy || code.trim().length < 4}>
              Get the device key
            </Button>
            {error && (
              <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                {error}
              </p>
            )}
          </form>
        )}
        <CopyRow label="Site address for the shortcut" value={`${window.location.origin}${PHONE_ENDPOINT}`} />
        {shortcut ? (
          <a href={shortcut} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
            Get the shortcut
          </a>
        ) : (
          <p className="text-sm text-muted">Shortcut link not set yet.</p>
        )}
      </Card>

      <Card className="p-4">
        <SectionLabel>Steps</SectionLabel>
        <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed">
          {STEPS.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </Card>
    </main>
  )
}
