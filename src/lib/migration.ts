/**
 * Local → Cloud Migration
 *
 * Reads the existing `chrono-v1` localStorage key and offers to import
 * all sessions, categories, and preferences into Supabase on first sign-in.
 *
 * Rules:
 * - Idempotent: uses local_id uniqueness to prevent duplicates
 * - Never deletes localStorage until all records are verified
 * - Preserves all timestamps and durations exactly
 * - Returns a detailed result object for UI feedback
 */

import { supabase } from './supabase'
import { upsertCategory, saveSession, upsertPreferences } from './db'
import type { AppSession, AppCategory, AppPreferences } from './db'

const STORE_KEY = 'chrono-v1'
const MIGRATION_DONE_KEY = 'chrono-migration-done'

export type LocalData = {
  sessions: AppSession[]
  categories: AppCategory[]
  theme: 'light' | 'dark'
  goal: string
}

export type MigrationResult = {
  sessionsImported: number
  categoriesImported: number
  sessionsFailed: number
  categoriesFailed: number
  errors: string[]
}

/** Read and parse localStorage. Returns null if nothing to migrate. */
export function readLocalData(): LocalData | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const sessions: AppSession[] = (parsed.sessions ?? []).map((s: AppSession) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      duration: s.duration,
      category: s.category ?? '',
      subcategory: s.subcategory ?? '',
      source: s.source ?? 'stopwatch',
      notes: s.notes,
    }))
    const categories: AppCategory[] = (parsed.categories ?? []).map((c: AppCategory) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      subs: c.subs ?? [],
    }))
    return {
      sessions,
      categories,
      theme: parsed.theme ?? 'light',
      goal: String(parsed.goal ?? '4'),
    }
  } catch {
    return null
  }
}

/** Returns true if migration was already completed. */
export function isMigrationDone(): boolean {
  return localStorage.getItem(MIGRATION_DONE_KEY) === 'true'
}

/** Returns true if there is local data worth migrating. */
export function hasMigratableData(): boolean {
  if (isMigrationDone()) return false
  const data = readLocalData()
  if (!data) return false
  return data.sessions.length > 0 || data.categories.length > 0
}

/**
 * Perform the full local→cloud migration.
 * Does NOT delete local data — call `markMigrationDone()` after verifying.
 */
export async function migrateLocalToCloud(data: LocalData): Promise<MigrationResult> {
  const result: MigrationResult = {
    sessionsImported: 0,
    categoriesImported: 0,
    sessionsFailed: 0,
    categoriesFailed: 0,
    errors: [],
  }

  // 1. Migrate categories first (sessions reference them)
  const migratedCategories: AppCategory[] = []
  for (let i = 0; i < data.categories.length; i++) {
    const cat = data.categories[i]
    try {
      const cloudId = await upsertCategory(cat, i)
      migratedCategories.push({ ...cat, cloudId })
      result.categoriesImported++
    } catch (err) {
      result.categoriesFailed++
      result.errors.push(`Category "${cat.name}": ${(err as Error).message}`)
    }
  }

  // 2. Migrate sessions
  for (const session of data.sessions) {
    try {
      await saveSession(session, migratedCategories)
      result.sessionsImported++
    } catch (err) {
      result.sessionsFailed++
      result.errors.push(`Session ${session.id}: ${(err as Error).message}`)
    }
  }

  // 3. Migrate preferences
  try {
    await upsertPreferences({
      theme: data.theme,
      dailyGoalHours: Math.max(1, Number(data.goal) || 4),
    })
  } catch (err) {
    result.errors.push(`Preferences: ${(err as Error).message}`)
  }

  return result
}

/**
 * Mark migration as done. Called after successful verification.
 * Does NOT remove localStorage data — user can still export/clear manually.
 */
export function markMigrationDone(): void {
  localStorage.setItem(MIGRATION_DONE_KEY, 'true')
}

/**
 * Verify that the cloud record counts match expectations.
 */
export async function verifyMigration(expected: { sessions: number; categories: number }): Promise<{
  ok: boolean
  cloudSessions: number
  cloudCategories: number
}> {
  const [sessRes, catRes] = await Promise.all([
    supabase.from('sessions').select('id', { count: 'exact', head: true }),
    supabase.from('categories').select('id', { count: 'exact', head: true }),
  ])

  const cloudSessions = sessRes.count ?? 0
  const cloudCategories = catRes.count ?? 0
  return {
    ok: cloudSessions >= expected.sessions && cloudCategories >= expected.categories,
    cloudSessions,
    cloudCategories,
  }
}
