// Firm sign-in. There is no real authentication: any credentials work.

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
  const [email, setEmail] = useState('sarah@alderandvine.example')
  const [password, setPassword] = useState('demo-password')

  if (signedIn) return <Navigate to={from} replace />

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-center text-xl font-semibold tracking-tight text-ink">◆ Platinum</p>
        <form
          className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault()
            signIn(email)
            navigate(from, { replace: true })
          }}
        >
          <div>
            <h1 className="text-lg font-semibold text-ink">Sign in to your firm</h1>
            <p className="mt-1 text-sm text-muted">{data.firm.name}</p>
          </div>
          <Field label="Work email">
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Password">
            <input className={inputClass} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" variant="primary" className="w-full">
            Sign in
          </Button>
          <p className="text-center text-xs text-faint">Demo: any email and password will work.</p>
        </form>
      </div>
    </div>
  )
}
