// Sign-in. A stand-in: there are no accounts in v0, and the screen says so.

import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Button, Field, inputClass } from '../../components/ui'
import { useData, useStore } from '../../store/store'

export default function SignIn() {
  const data = useData()
  const signedIn = useStore((s) => s.session.signedIn)
  const signIn = useStore((s) => s.signIn)
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/app'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  if (signedIn) return <Navigate to={from} replace />

  return (
    <div className="flex min-h-full items-center justify-center bg-sidebar px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-2xl font-bold text-white">Platinum</p>
        <form
          className="flex flex-col gap-4 rounded-xl bg-surface p-6"
          onSubmit={(e) => {
            e.preventDefault()
            signIn(email.trim() || 'counselor@example.com')
            navigate(from, { replace: true })
          }}
        >
          <div>
            <h1 className="text-lg font-bold text-ink">Sign in to your firm</h1>
            <p className="mt-0.5 text-[13px] text-muted">{data.firm.name}</p>
          </div>
          <Field label="Work email">
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" placeholder="you@yourfirm.com" />
          </Field>
          <Field label="Password">
            <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" variant="primary">
            Sign in
          </Button>
          <p className="text-xs leading-relaxed text-muted">
            This sign-in is a stand-in. v0 has no accounts: any email and password open the workspace, and your data stays in this browser.
          </p>
        </form>
      </div>
    </div>
  )
}
