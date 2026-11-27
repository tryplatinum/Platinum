// Throwaway accounts for the test scripts. Each is a real Supabase user with
// its own firm, made with the service role key and deleted again afterwards.
// Emails are random addresses at example.com; nothing is sent to them.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'
import type { Database } from '../src/lib/database.types.js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export function requireSettings(): void {
  const missing = [
    !url ? 'SUPABASE_URL or VITE_SUPABASE_URL' : '',
    !anonKey ? 'SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY' : '',
    !serviceKey ? 'SUPABASE_SERVICE_ROLE_KEY' : '',
  ].filter(Boolean)
  if (missing.length) {
    console.error(`Missing in .env: ${missing.join(', ')}`)
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

/** A second person in an existing test firm, as a counselor who is not its owner. */
export async function createMember(firm: TestAccount, label: string): Promise<TestAccount> {
  const email = `platinum-test-${randomUUID()}@example.com`
  const password = randomBytes(18).toString('base64url')
  const created = await admin().auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error) throw new Error(`could not create test user: ${created.error.message}`)
  const joined = await admin().from('firm_members').insert({ firm_id: firm.firmId, user_id: created.data.user.id, role: 'counselor', display_name: `Counselor ${label}` })
  if (joined.error) throw new Error(`could not add the test member: ${joined.error.message}`)
  const client = anonClient()
  const signedIn = await client.auth.signInWithPassword({ email, password })
  if (signedIn.error || !signedIn.data.session) throw new Error(`could not sign in test user: ${signedIn.error?.message}`)
  return { label, userId: created.data.user.id, firmId: firm.firmId, token: signedIn.data.session.access_token, client }
}

export interface TestPerson {
  userId: string
  email: string
  token: string
  /** Signed in as this person. Row level security applies. */
  client: SupabaseClient<Database>
}

/** A sign-in that belongs to nothing yet: no firm and no student account. `confirmed: false` leaves the address unconfirmed. */
export async function createPerson(confirmed = true): Promise<TestPerson> {
  const email = `platinum-test-${randomUUID()}@example.com`
  const password = randomBytes(18).toString('base64url')
  const created = await admin().auth.admin.createUser({ email, password, email_confirm: confirmed })
  if (created.error) throw new Error(`could not create test user: ${created.error.message}`)
  const client = anonClient()
  const signedIn = confirmed ? await client.auth.signInWithPassword({ email, password }) : undefined
  if (confirmed && (signedIn?.error || !signedIn?.data.session)) throw new Error(`could not sign in test user: ${signedIn?.error?.message}`)
  return { userId: created.data.user.id, email, token: signedIn?.data.session?.access_token ?? '', client }
}

/** Removes the firm (and everything in it) and the user. */
export async function removeAccount(account: TestAccount): Promise<void> {
  await admin().from('firms').delete().eq('id', account.firmId)
  await admin().auth.admin.deleteUser(account.userId)
}

/** Reads with the service role, to confirm what really is in the database. */
export const adminClient = admin
