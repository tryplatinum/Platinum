// /phone-setup: the page a counselor opens ON THEIR PHONE, by scanning the QR
// code shown once in Firm settings. Public and static: it asks the server for
// nothing.
//
// The device key arrives in the URL fragment (#k=…). A fragment is never sent
// to a server, so the key reaches this page without passing through ours
// again. The page only shows it, with a button to copy it into the shortcut.

import { useState } from 'react'
import { PHONE_ENDPOINT } from '../../shared/phoneGateway'
import { Button, Card, SectionLabel } from '../components/ui'
import setup from '../../docs/phone-gateway/ios-setup.md?raw'

/** The numbered lines of docs/phone-gateway/ios-setup.md. */
const STEPS = setup
  .split('\n')
  .map((line) => line.match(/^\d+\.\s+(.*)$/)?.[1])
  .filter((step): step is string => Boolean(step))

const KEY = /^[A-Za-z0-9_-]{43}$/

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
  const [key] = useState(() => new URLSearchParams(window.location.hash.replace(/^#/, '')).get('k') ?? '')
  const shortcut = (import.meta.env.VITE_PHONE_SHORTCUT_URL as string | undefined)?.trim()
  const valid = KEY.test(key)

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 px-4 py-6">
      <h1 className="text-xl font-semibold text-heading">Set up this iPhone</h1>
      <p className="text-sm text-ink-soft">This page is for the phone that will send your texts. Keep it open while you build the shortcut.</p>

      <Card className="flex flex-col gap-4 p-4">
        {valid ? (
          <>
            <CopyRow label="Device key" value={key} big />
            <p className="text-[13px] text-muted">Treat this key like a password. It is shown only here and only now. If it is lost or seen by someone else, connect the phone again in Firm settings to get a new one.</p>
          </>
        ) : (
          <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            There is no device key in this link. In Platinum on your computer, open Firm settings, connect your iPhone, and scan the code it shows.
          </p>
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
