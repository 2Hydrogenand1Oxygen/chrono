/**
 * Supabase client singleton.
 *
 * Uses VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
 * These are the ONLY Supabase variables that should ever appear in
 * browser-side code — never the service-role key.
 *
 * Validates configuration at runtime:
 * - If configured: initializes real Supabase client.
 * - If missing: flags isSupabaseConfigured = false and uses safe placeholder
 *   so the app never crashes with a blank screen.
 */

import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const rawUrl = (
  import.meta.env.VITE_SUPABASE_URL ||
  (import.meta.env as Record<string, string | undefined>).NEXT_PUBLIC_SUPABASE_URL
)?.trim()

const rawKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  (import.meta.env as Record<string, string | undefined>).NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
)?.trim()

export const isSupabaseConfigured = Boolean(
  rawUrl &&
  rawKey &&
  !rawUrl.includes('your-project.supabase.co') &&
  !rawKey.includes('your-anon-key') &&
  (rawUrl.startsWith('https://') || rawUrl.startsWith('http://'))
)

// Safe fallback URL/key so createClient does not throw at module load time
const activeUrl = isSupabaseConfigured ? rawUrl! : 'https://placeholder.supabase.co'
const activeKey = isSupabaseConfigured ? rawKey! : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder'

export const supabase = createClient<Database>(activeUrl, activeKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export type SupabaseClient = typeof supabase
