// Sidebar line showing whether AI drafts are real or placeholders. Access to
// the AI endpoint comes from being signed in; there is nothing to enter here.

import { useEffect, useState } from 'react'
import type { AiStatus } from '../../shared/contract'
import { fetchStatus } from '../services/aiClient'
import { cx } from './ui'

export function AiConnection() {
  const [status, setStatus] = useState<AiStatus | null>()

  useEffect(() => {
    let live = true
    void fetchStatus().then((s) => live && setStatus(s ?? null))
    return () => {
      live = false
    }
  }, [])

  if (status === undefined) return null
  // No answer at all says nothing about the key: the request may simply have failed. A built
  // app stays quiet then, so "placeholders" is only ever shown when the server itself says so.
  // Where there really is no endpoint, every draft is marked a placeholder where it appears.
  if (status === null && import.meta.env.PROD) return null
  const live = Boolean(status?.hasKey && status.hasAuth)
  const detail = !status
    ? 'This deployment has no AI endpoint. Drafts are placeholders.'
    : !status.hasKey
      ? 'The server has no API key. Drafts are placeholders.'
      : !status.hasAuth
        ? 'The server cannot check sign-ins. Drafts are placeholders.'
        : status.model

  return (
    <div className="rounded-control border border-line bg-surface px-3 py-2.5">
      <p className="flex items-center gap-2 text-sm font-semibold text-heading">
        <span className={cx('h-2 w-2 rounded-full', live ? 'bg-good' : 'bg-warn')} aria-hidden />
        AI: {live ? 'connected' : 'placeholders'}
      </p>
      <p className="mt-0.5 text-[13px] leading-relaxed text-sidebar-muted">{detail}</p>
    </div>
  )
}
