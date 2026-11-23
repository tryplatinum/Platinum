// Throwaway accounts for the test scripts. Each is a real Supabase user with
// its own firm, made with the service role key and deleted again afterwards.
// Emails are random addresses at example.com; nothing is sent to them.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'
import type { Database } from '../src/lib/database.types.js'

const url = process.env.VITE_SUPABASE_URL ?? ''
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export function requireSettings(): void {
  const missing = Object.entries({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: serviceKey })
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length) {
    console.error(`Missing in .env.local: ${missing.join(', ')}`)
    process.exit(1)
  }
}

const options = { auth: { persistSession: false, autoRefreshToken: false } }

/** A client with only the anon key: what a stranger on the internet has. */
export const anonClient = () => createClient<Database>(url, anonKey, options)
const admin = () => createClient<Database>(url, serviceKey, options)

export interface TestAccount {
  label: string
  userId: string
  firmId: string
  token: string
  /** Signed in as this account. Row level security applies. */
  client: SupabaseClient<Database>
}

export async function createAccount(label: string): Promise<TestAccount> {
  const email = `platinum-test-${randomUUID()}@example.com`
  const password = randomBytes(18).toString('base64url')
  const created = await admin().auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw new Error(`could not create test user: ${created.error.message}`)

  const client = anonClient()
  const signedIn = await client.auth.signInWithPassword({ email, password })
  if (signedIn.error || !signedIn.data.session) throw new Error(`could not sign in test user: ${signedIn.error?.message}`)

  const firm = await client.rpc('create_firm', { name: `Test firm ${label}`, display_name: `Counselor ${label}` })
  if (firm.error) throw new Error(`could not create test firm: ${firm.error.message}`)
  return { label, userId: created.data.user.id, firmId: firm.data, token: signedIn.data.session.access_token, client }
}

/** Removes the firm (and everything in it) and the user. */
export async function removeAccount(account: TestAccount): Promise<void> {
  await admin().from('firms').delete().eq('id', account.firmId)
  await admin().auth.admin.deleteUser(account.userId)
}

/** Reads with the service role, to confirm what really is in the database. */
export const adminClient = admin
