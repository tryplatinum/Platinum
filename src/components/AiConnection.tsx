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
  const live = Boolean(status?.hasKey && status.hasAuth)
  const detail = !status
    ? 'This deployment has no AI endpoint. Drafts are placeholders.'
    : !status.hasKey
      ? 'The server has no API key. Drafts are placeholders.'
      : !status.hasAuth
        ? 'The server cannot check sign-ins. Drafts are placeholders.'
        : status.model

  return (
    <div className="rounded-lg border border-white/15 px-3 py-2.5">
      <p className="flex items-center gap-2 text-sm font-semibold text-white">
        <span className={cx('h-2 w-2 rounded-full', live ? 'bg-[#4ade80]' : 'bg-[#fbbf24]')} aria-hidden />
        AI: {live ? 'connected' : 'placeholders'}
      </p>
      <p className="mt-0.5 text-[13px] leading-relaxed text-sidebar-muted">{detail}</p>
    </div>
  )
}
