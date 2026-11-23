// The one Supabase client in the browser. It carries only the project URL and
// the anon key, both of which are public by design: row level security decides
// what a signed-in person can reach, and the anon key alone reaches nothing.

import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** False when the build has no Supabase settings. Sign-in explains what is missing. */
export const supabaseConfigured = Boolean(url && anonKey)

export const supabase = createClient<Database>(url || 'http://localhost:54321', anonKey || 'missing-anon-key')
