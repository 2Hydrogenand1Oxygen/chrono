/**
 * useAuth — React hook for Supabase authentication state.
 *
 * Provides: isConfigured, user, session, loading, error, success,
 *           signIn, signUp, signOut, resetPassword, clearError.
 *
 * Session lifecycle:
 *   - Restores session on page refresh via getSession() on mount.
 *   - Subscribes to onAuthStateChange to handle login, logout, token refresh,
 *     and email confirmation redirect (SIGNED_IN event from URL hash).
 *   - Cleans up the subscription on unmount.
 *
 * Error messages are mapped from Supabase's raw API errors to human-readable
 * strings so users never see raw HTTP status codes.
 */

import { useEffect, useState, useCallback } from 'react'
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { validateAuthenticEmail } from '../lib/emailValidation'

// ── Human-readable error mapping ─────────────────────────────────────────────

const AUTH_ERROR_MAP: Record<string, string> = {
  'Invalid login credentials': 'Incorrect email or password. Please try again.',
  'Email not confirmed': 'Please confirm your email address before signing in. Check your inbox.',
  'User already registered': 'An account with this email already exists. Try signing in instead.',
  'Signup requires a valid password': 'Password must be at least 6 characters.',
  'Password should be at least 6 characters': 'Password must be at least 6 characters.',
  'Unable to validate email address: invalid format': 'Please enter a valid email address.',
  'Email rate limit exceeded': 'Supabase email rate limit reached (free tier limit is ~3-4 emails/hr). In Supabase Dashboard → Auth → Providers → Email, turn OFF "Confirm email" for instant login without emails.',
  'over_email_send_rate_limit': 'Supabase email rate limit reached. In Supabase Dashboard → Auth → Providers → Email, turn OFF "Confirm email" for instant login without emails.',
  'For security purposes, you can only request this after': 'Please wait before requesting another reset email.',
  'Token has expired or is invalid': 'This link has expired. Please request a new one.',
  'Failed to fetch': 'Unable to connect to Supabase. Please check your internet connection or any browser ad-blockers blocking Supabase.',
  'NetworkError': 'Network connection error. Please check your internet connection.',
  'popup_closed_by_user': 'Google sign-in was closed before completion. Please try again.',
  'access_denied': 'Access denied during Google sign-in.',
  'provider_disabled': 'Google provider is not enabled in your Supabase project. Enable Google under Authentication → Providers.',
  'Unsupported provider': 'Google provider is not configured in your Supabase project.',
}

function humaniseError(raw: string): string {
  for (const [key, friendly] of Object.entries(AUTH_ERROR_MAP)) {
    if (raw.includes(key)) return friendly
  }
  // Capitalise and return as-is for unknown errors
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuthState = {
  isConfigured: boolean
  user: User | null
  session: Session | null
  loading: boolean
  /** Readable error message, or null. */
  error: string | null
  /** Non-error informational message (e.g. "Check your email"). */
  success: string | null
}

export type AuthActions = {
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  clearError: () => void
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthState & AuthActions {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    // Restore session on mount (handles page refresh)
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) {
        // Session retrieval errors are non-fatal — the user just needs to sign in
        console.warn('[useAuth] getSession error:', sessionError.message)
      } else {
        setSession(data.session)
        setUser(data.session?.user ?? null)
      }
      setLoading(false)
    }).catch(err => {
      console.warn('[useAuth] getSession threw:', err)
      setLoading(false)
    })

    // Subscribe to auth state changes (login, logout, token refresh, email confirm)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, s: Session | null) => {
        setSession(s)
        setUser(s?.user ?? null)
        setLoading(false)

        // Clear error/success banners when user successfully signs in
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          setError(null)
          setSuccess(null)
          // Clean up OAuth tokens / code from the address bar if present
          if (
            typeof window !== 'undefined' &&
            (window.location.hash.includes('access_token=') ||
              window.location.search.includes('code='))
          ) {
            window.history.replaceState({}, document.title, window.location.pathname)
          }
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  // ── signIn ────────────────────────────────────────────────────────────────

  const signIn = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to your .env.local file.')
      return
    }
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) {
        setError(humaniseError(err.message))
      } else if (data.session) {
        setSession(data.session)
        setUser(data.session.user)
      }
    } catch (e: any) {
      setError(humaniseError(e?.message || 'An unexpected error occurred during sign in.'))
    } finally {
      setLoading(false)
    }
  }, [])

  // ── signUp ────────────────────────────────────────────────────────────────

  const signUp = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to your .env.local file.')
      return
    }

    // Verify email authenticity before submitting
    const check = validateAuthenticEmail(email, { isSignUp: true })
    if (!check.isValid) {
      setError(check.error || 'Please enter an authentic email address.')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const { data, error: err } = await supabase.auth.signUp({ email, password })
      if (err) {
        setError(humaniseError(err.message))
      } else if (data.session) {
        // Email confirmation is disabled in Supabase — user is immediately signed in
        setSession(data.session)
        setUser(data.session.user)
      } else {
        // Email confirmation is required — inform the user
        setSuccess('Account created! Please check your email inbox and click the confirmation link to sign in.')
      }
    } catch (e: any) {
      setError(humaniseError(e?.message || 'An unexpected error occurred during sign up.'))
    } finally {
      setLoading(false)
    }
  }, [])

  // ── signInWithGoogle ──────────────────────────────────────────────────────

  const signInWithGoogle = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to your .env.local file.')
      return
    }
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      })
      if (err) {
        setError(humaniseError(err.message))
        setLoading(false)
      }
      // Note: The browser will redirect to Google accounts
    } catch (e: any) {
      setError(humaniseError(e?.message || 'Failed to initiate Google sign-in.'))
      setLoading(false)
    }
  }, [])

  // ── signOut ───────────────────────────────────────────────────────────────

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) return
    setLoading(true)
    try {
      await supabase.auth.signOut()
      setSession(null)
      setUser(null)
    } catch (e) {
      console.warn('[useAuth] signOut error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── resetPassword ─────────────────────────────────────────────────────────

  const resetPassword = useCallback(async (email: string) => {
    if (!isSupabaseConfigured) {
      setError('Supabase is not configured.')
      return
    }
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/`,
      })
      if (err) {
        setError(humaniseError(err.message))
      } else {
        setSuccess('Password reset email sent! Check your inbox and click the link to set a new password.')
      }
    } catch (e: any) {
      setError(humaniseError(e?.message || 'Failed to send password reset email.'))
    } finally {
      setLoading(false)
    }
  }, [])

  // ── clearError ────────────────────────────────────────────────────────────

  const clearError = useCallback(() => {
    setError(null)
    setSuccess(null)
  }, [])

  return {
    isConfigured: isSupabaseConfigured,
    user,
    session,
    loading,
    error,
    success,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    resetPassword,
    clearError,
  }
}
