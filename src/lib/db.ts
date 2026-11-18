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
  source: 'stopwatch' | 'timer' | 'manual' | 'focus' | 'break'
  notes?: string
  cloudId?: string    // Supabase UUID if synced
  parentSessionId?: string
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
  dayStartHour?: number
  weekStartsOn?: 'monday' | 'sunday'
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
    parentSessionId: (row as any).parent_session_id ?? undefined,
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

// Schema capability flags (memoized to prevent schema cache errors on unmigrated databases)
let supportsParentSessionId: boolean | null = null
let supportsFocusTrackingType: boolean | null = null

/**
 * Probes the remote Supabase PostgreSQL schema once to check if 'parent_session_id' exists.
 */
export async function checkParentSessionIdSupport(): Promise<boolean> {
  if (supportsParentSessionId !== null) return supportsParentSessionId
  try {
    const { error } = await supabase.from('sessions').select('parent_session_id').limit(1)
    supportsParentSessionId = !error
  } catch {
    supportsParentSessionId = false
  }
  return supportsParentSessionId
}

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

  const authUser = (await supabase.auth.getUser()).data.user
  if (!authUser) throw new Error('Not authenticated')

  // Proactively check if remote DB schema supports parent_session_id
  if (supportsParentSessionId === null) {
    await checkParentSessionIdSupport()
  }

  const tryInsert = async (includeParent: boolean, allowFocusType: boolean) => {
    let trackingType = session.source
    let notes = session.notes ?? null

    // If remote DB constraint doesn't allow 'focus' or 'break', map to 'timer' with semantic note
    if (!allowFocusType && (trackingType === 'focus' || trackingType === 'break')) {
      const tag = trackingType === 'focus' ? '[Focus]' : '[Break]'
      notes = notes ? `${tag} ${notes}` : tag
      trackingType = 'timer'
    }

    const payload: Record<string, any> = {
      id: crypto.randomUUID(),
      user_id: authUser.id,
      local_id: session.id,
      start_time: new Date(session.start).toISOString(),
      end_time: new Date(session.end).toISOString(),
      duration: session.duration,
      tracking_type: trackingType,
      category_id: cat?.cloudId ?? null,
      subcategory: session.subcategory || null,
      notes,
    }

    // Only include parent_session_id if supported by the remote database schema
    if (includeParent && session.parentSessionId && supportsParentSessionId !== false) {
      payload.parent_session_id = session.parentSessionId
    }

    return await supabase
      .from('sessions')
      .insert(payload as any)
      .select('id')
      .single()
  }

  const wantParent = supportsParentSessionId === true && !!session.parentSessionId
  const wantFocus = supportsFocusTrackingType !== false

  let { data, error } = await tryInsert(wantParent, wantFocus)

  // Fallback 1: If parent_session_id was sent but column doesn't exist in schema cache
  if (error && (error.message?.includes('parent_session_id') || error.code === 'PGRST204')) {
    supportsParentSessionId = false
    const res = await tryInsert(false, wantFocus)
    data = res.data
    error = res.error
  } else if (!error && wantParent) {
    supportsParentSessionId = true
  }

  // Fallback 2: If tracking_type check constraint fails for 'focus' or 'break'
  if (error && (error.message?.includes('tracking_type') || error.message?.includes('check constraint') || error.code === '23514')) {
    supportsFocusTrackingType = false
    const res = await tryInsert(supportsParentSessionId === true, false)
    data = res.data
    error = res.error
  } else if (!error && (session.source === 'focus' || session.source === 'break')) {
    supportsFocusTrackingType = true
  }

  // Fallback 3: Both parent_session_id and focus tracking type unmigrated
  if (error && (error.message?.includes('parent_session_id') || error.code === 'PGRST204')) {
    supportsParentSessionId = false
    const res = await tryInsert(false, false)
    data = res.data
    error = res.error
  }

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
  return {
    theme: row.theme,
    dailyGoalHours: row.daily_goal_hours,
    dayStartHour: typeof row.day_start_hour === 'number' ? row.day_start_hour : 0,
    weekStartsOn: row.week_start === 'sunday' ? 'sunday' : 'monday',
  }
}

export async function upsertPreferences(prefs: AppPreferences): Promise<void> {
  const uid = (await supabase.auth.getUser()).data.user!.id
  const payload: Record<string, unknown> = {
    user_id: uid,
    theme: prefs.theme,
    daily_goal_hours: prefs.dailyGoalHours,
    updated_at: new Date().toISOString(),
  }

  if (typeof prefs.dayStartHour === 'number') {
    payload.day_start_hour = prefs.dayStartHour
  }
  if (prefs.weekStartsOn) {
    payload.week_start = prefs.weekStartsOn
  }

  const { error } = await supabase.from('user_preferences').upsert(
    payload as any,
    { onConflict: 'user_id' }
  )

  if (error) {
    // If remote schema has not yet added custom columns, fall back to core schema
    const fallback = {
      user_id: uid,
      theme: prefs.theme,
      daily_goal_hours: prefs.dailyGoalHours,
      updated_at: new Date().toISOString(),
    }
    const { error: err2 } = await supabase.from('user_preferences').upsert(
      fallback,
      { onConflict: 'user_id' }
    )
    if (err2) throw err2
  }
}
