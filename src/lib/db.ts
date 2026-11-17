/**
 * Database helper functions — all Supabase read/write operations.
 * Every function expects an authenticated supabase client.
 */

import { supabase } from './supabase'
import type { DbSession, DbCategory, DbUserPreferences } from './database.types'

// ── App-side types (mirror App.tsx) ─────────────────────────────────────────
export type AppSession = {
  id: string
  start: number       // Unix ms
  end: number         // Unix ms
  duration: number    // seconds
  category: string    // local category id or empty
  subcategory: string
  source: 'stopwatch' | 'timer' | 'manual'
  notes?: string
  cloudId?: string    // Supabase UUID if synced
}

export type AppCategory = {
  id: string          // local id (8-char random or UUID)
  name: string
  color: string
  subs: string[]
  cloudId?: string    // Supabase UUID if synced
}

export type AppPreferences = {
  theme: 'light' | 'dark'
  dailyGoalHours: number
}

// ── Conversion helpers ───────────────────────────────────────────────────────

function dbSessionToApp(
  row: DbSession,
  categories: AppCategory[]
): AppSession {
  // Map cloud category UUID back to the local category id
  const cat = categories.find(c => c.cloudId === row.category_id)
  return {
    id: row.local_id ?? row.id,
    cloudId: row.id,
    start: new Date(row.start_time).getTime(),
    end: new Date(row.end_time).getTime(),
    duration: row.duration,
    category: cat?.id ?? '',
    subcategory: row.subcategory ?? '',
    source: row.tracking_type,
    notes: row.notes ?? undefined,
  }
}

function dbCategoryToApp(row: DbCategory): AppCategory {
  return {
    id: row.local_id ?? row.id,
    cloudId: row.id,
    name: row.name,
    color: row.color,
    subs: row.subs ?? [],
  }
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function fetchSessions(categories: AppCategory[]): Promise<AppSession[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .order('start_time', { ascending: false })

  if (error) throw error
  return (data as DbSession[]).map(row => dbSessionToApp(row, categories))
}

export async function saveSession(
  session: AppSession,
  categories: AppCategory[]
): Promise<string> {
  const cat = categories.find(c => c.id === session.category)
  const { data: existing } = await supabase
    .from('sessions')
    .select('id')
    .eq('local_id', session.id)
    .maybeSingle()

  if (existing) return existing.id as string

  const { data, error } = await supabase
    .from('sessions')
    .insert({
      id: crypto.randomUUID(),
      user_id: (await supabase.auth.getUser()).data.user!.id,
      local_id: session.id,
      start_time: new Date(session.start).toISOString(),
      end_time: new Date(session.end).toISOString(),
      duration: session.duration,
      tracking_type: session.source,
      category_id: cat?.cloudId ?? null,
      subcategory: session.subcategory || null,
      notes: session.notes ?? null,
    })
    .select('id')
    .single()

  if (error) throw error
  return (data as { id: string }).id
}

export async function deleteSession(cloudId: string): Promise<void> {
  const { error } = await supabase.from('sessions').delete().eq('id', cloudId)
  if (error) throw error
}

// ── Categories ───────────────────────────────────────────────────────────────

export async function fetchCategories(): Promise<AppCategory[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data as DbCategory[]).map(dbCategoryToApp)
}

export async function upsertCategory(
  cat: AppCategory,
  sortOrder: number
): Promise<string> {
  const uid = (await supabase.auth.getUser()).data.user!.id

  if (cat.cloudId) {
    // Update existing
    const { error } = await supabase
      .from('categories')
      .update({
        name: cat.name,
        color: cat.color,
        subs: cat.subs,
        sort_order: sortOrder,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cat.cloudId)
    if (error) throw error
    return cat.cloudId
  }

  // Check if already exists by local_id
  const { data: existing } = await supabase
    .from('categories')
    .select('id')
    .eq('local_id', cat.id)
    .maybeSingle()

  if (existing) {
    await supabase.from('categories').update({
      name: cat.name,
      color: cat.color,
      subs: cat.subs,
      sort_order: sortOrder,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id as string)
    return existing.id as string
  }

  const { data, error } = await supabase
    .from('categories')
    .insert({
      id: crypto.randomUUID(),
      user_id: uid,
      local_id: cat.id,
      name: cat.name,
      color: cat.color,
      subs: cat.subs,
      sort_order: sortOrder,
    })
    .select('id')
    .single()

  if (error) throw error
  return (data as { id: string }).id
}

export async function deleteCategory(cloudId: string): Promise<void> {
  const { error } = await supabase.from('categories').delete().eq('id', cloudId)
  if (error) throw error
}

// ── User Preferences ─────────────────────────────────────────────────────────

export async function fetchPreferences(): Promise<AppPreferences | null> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  const row = data as DbUserPreferences
  return { theme: row.theme, dailyGoalHours: row.daily_goal_hours }
}

export async function upsertPreferences(prefs: AppPreferences): Promise<void> {
  const uid = (await supabase.auth.getUser()).data.user!.id
  const { error } = await supabase.from('user_preferences').upsert(
    {
      user_id: uid,
      theme: prefs.theme,
      daily_goal_hours: prefs.dailyGoalHours,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )
  if (error) throw error
}
