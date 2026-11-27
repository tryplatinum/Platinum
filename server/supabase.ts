// Supabase on the server. Two clients, kept apart on purpose:
//
//   * asUser(token): acts as the signed-in person. Row level security applies,
//     so it can only see what that person can. identify() returns it to the
//     server functions, which do their reading and writing with it.
//   * serviceClient(): the service role, which bypasses row level security.
//     Used for the student link (no signed-in person), and by the dispatcher
//     for outbox status updates after identify() has checked the caller. Always
//     filtered by firm (and by student on the link path). Also used by scripts
//     run by hand.
//
// The service role key is read from the environment, never logged, and never
// sent to the browser.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../src/lib/database.types.js'

// The URL and anon key are public values; the server reuses the browser's settings.
const url = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const anonKey = () => process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const serverOnly = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }

export const authConfigured = () => Boolean(url() && anonKey())
export const serviceConfigured = () => Boolean(url() && serviceKey())

function asUser(token: string): SupabaseClient<Database> {
  return createClient<Database>(url(), anonKey(), { ...serverOnly, global: { headers: { Authorization: `Bearer ${token}` } } })
}

let service: SupabaseClient<Database> | undefined
export function serviceClient(): SupabaseClient<Database> {
  service ??= createClient<Database>(url(), serviceKey(), serverOnly)
  return service
}

export type Caller =
  | {
      ok: true
      userId: string
      firmId: string
      role: 'owner' | 'counselor'
      /** Acts as this person: row level security applies to everything done with it. */
      client: SupabaseClient<Database>
    }
  | { ok: false; reason: 'unauthorized' | 'no_firm' }

/**
 * Who is making this request. The access token is verified with Supabase (not
 * just decoded), then the person's firm is read as them, through row level
 * security.
 */
export async function identify(request: Request): Promise<Caller> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return { ok: false, reason: 'unauthorized' }
  const client = asUser(token)
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return { ok: false, reason: 'unauthorized' }
  const member = await client.from('firm_members').select('firm_id, role').eq('user_id', data.user.id).maybeSingle()
  if (member.error || !member.data) return { ok: false, reason: 'no_firm' }
  return { ok: true, userId: data.user.id, firmId: member.data.firm_id, role: member.data.role === 'owner' ? 'owner' : 'counselor', client }
}

export type Person = { ok: true; userId: string; email: string; emailConfirmed: boolean } | { ok: false }

/**
 * Who is signed in, without asking which firm they belong to. For the few
 * requests a person makes before they are a member or a student of anything:
 * accepting an invitation. The token is verified with Supabase, and the address
 * and whether it is confirmed are what Supabase reports, never the request's word.
 */
export async function signedIn(request: Request): Promise<Person> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return { ok: false }
  const { data, error } = await asUser(token).auth.getUser(token)
  if (error || !data.user) return { ok: false }
  return { ok: true, userId: data.user.id, email: (data.user.email ?? '').toLowerCase(), emailConfirmed: Boolean(data.user.email_confirmed_at) }
}
