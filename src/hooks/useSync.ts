/**
 * useSync — sync state manager for cloud data.
 *
 * Tracks: idle | saving | synced | offline | error
 * Refreshes data on window focus and after login.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { fetchSessions, fetchCategories, fetchPreferences, saveSession, upsertCategory, upsertPreferences, deleteSession, deleteCategory } from '../lib/db'
import type { AppSession, AppCategory, AppPreferences } from '../lib/db'

export type SyncStatus = 'idle' | 'loading' | 'saving' | 'synced' | 'offline' | 'error'

export type SyncState = {
  status: SyncStatus
  errorMessage: string | null
  lastSynced: Date | null
}

export type SyncActions = {
  refresh: () => Promise<void>
  pushSession: (session: AppSession) => Promise<string | null>
  pushCategory: (cat: AppCategory, sortOrder: number) => Promise<string | null>
  pushCategoryDelete: (cloudId: string) => Promise<void>
  pushSessionDelete: (cloudId: string) => Promise<void>
  pushPreferences: (prefs: AppPreferences) => Promise<void>
}

export function useSync(
  user: User | null,
  onData: (sessions: AppSession[], categories: AppCategory[], prefs: AppPreferences | null) => void
): SyncState & SyncActions {
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

  const refresh = useCallback(async () => {
    if (!user) return
    if (!navigator.onLine) { setStatus('offline'); return }
    setStatus('loading')
    setErrorMessage(null)
    try {
      const [rawCategories, prefs] = await Promise.all([
        fetchCategories(),
        fetchPreferences(),
      ])
      const sessions = await fetchSessions(rawCategories)
      if (isMounted.current) {
        onData(sessions, rawCategories, prefs)
        setStatus('synced')
        setLastSynced(new Date())
      }
    } catch (err) {
      if (isMounted.current) {
        setStatus('error')
        setErrorMessage((err as Error).message)
      }
    }
  }, [user, onData])

  // Auto-refresh on login and on window focus
  useEffect(() => {
    if (!user) return
    refresh()
    const onFocus = () => { if (navigator.onLine) refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [user, refresh])

  // Online/offline detection
  useEffect(() => {
    const goOffline = () => setStatus('offline')
    const goOnline = () => { if (user) refresh() }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [user, refresh])

  const pushSession = useCallback(async (session: AppSession): Promise<string | null> => {
    if (!user) return null
    setStatus('saving')
    try {
      const [cats] = await Promise.all([fetchCategories()])
      const id = await saveSession(session, cats)
      setStatus('synced')
      setErrorMessage(null)
      setLastSynced(new Date())
      return id
    } catch (err) {
      setStatus('error')
      setErrorMessage((err as Error).message)
      return null
    }
  }, [user])

  const pushCategory = useCallback(async (cat: AppCategory, sortOrder: number): Promise<string | null> => {
    if (!user) return null
    setStatus('saving')
    try {
      const id = await upsertCategory(cat, sortOrder)
      setStatus('synced')
      setLastSynced(new Date())
      return id
    } catch (err) {
      setStatus('error')
      setErrorMessage((err as Error).message)
      return null
    }
  }, [user])

  const pushCategoryDelete = useCallback(async (cloudId: string): Promise<void> => {
    if (!user) return
    try {
      await deleteCategory(cloudId)
    } catch (err) {
      setStatus('error')
      setErrorMessage((err as Error).message)
    }
  }, [user])

  const pushSessionDelete = useCallback(async (cloudId: string): Promise<void> => {
    if (!user) return
    try {
      await deleteSession(cloudId)
    } catch (err) {
      setStatus('error')
      setErrorMessage((err as Error).message)
    }
  }, [user])

  const pushPreferences = useCallback(async (prefs: AppPreferences): Promise<void> => {
    if (!user) return
    try {
      await upsertPreferences(prefs)
    } catch {
      // preferences sync failures are silent — localStorage still works
    }
  }, [user])

  return {
    status,
    errorMessage,
    lastSynced,
    refresh,
    pushSession,
    pushCategory,
    pushCategoryDelete,
    pushSessionDelete,
    pushPreferences,
  }
}
