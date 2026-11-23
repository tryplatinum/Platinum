// Sidebar control showing whether AI drafts are real or placeholders, and
// where the counselor enters the shared passcode. The passcode is a stopgap
// until real accounts exist; it is kept in this browser only.

import { useEffect, useState } from 'react'
import type { AiStatus } from '../../shared/contract'
import { fetchStatus, getPasscode, setPasscode } from '../services/aiClient'
import { cx, inputClass } from './ui'

export function AiConnection() {
  const [status, setStatus] = useState<AiStatus | null>()
  const [passcode, setLocal] = useState(getPasscode)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    void fetchStatus().then((s) => setStatus(s ?? null))
  }, [])

  const serverReady = Boolean(status?.hasKey && status.hasPasscode)
  const live = serverReady && Boolean(passcode)
  const detail =
    status === undefined
      ? 'Checking…'
      : status === null
        ? 'No AI endpoint here. Drafts are placeholders.'
        : !status.hasKey
          ? 'The server has no API key. Drafts are placeholders.'
          : !status.hasPasscode
            ? 'The server has no passcode set. Drafts are placeholders.'
            : passcode
              ? status.model
              : 'Enter the passcode to get real drafts.'

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
        <span className={cx('h-2 w-2 rounded-full', live ? 'bg-good' : 'bg-warn')} />
        AI: {live ? 'Claude connected' : 'placeholders'}
      </p>
      <p className="mt-0.5 text-xs text-muted">{detail}</p>
      {serverReady &&
        (editing ? (
          <form
            className="mt-2 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              setPasscode(draft.trim())
              setLocal(draft.trim())
              setEditing(false)
              setDraft('')
            }}
          >
            <input
              type="password"
              autoFocus
              className={cx(inputClass, 'px-2 py-1 text-xs')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Passcode"
              aria-label="AI passcode"
            />
            <button type="submit" className="rounded-md bg-ink px-2 text-xs font-medium text-white">
              Save
            </button>
          </form>
        ) : (
          <button onClick={() => setEditing(true)} className="mt-1 text-xs text-accent hover:underline">
            {passcode ? 'Change passcode' : 'Enter passcode'}
          </button>
        ))}
    </div>
  )
}
