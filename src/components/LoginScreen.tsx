/**
 * LoginScreen — Liquid Glass authentication UI
 *
 * Matches Chrono's Apple-inspired design language:
 * - Liquid glass panels, CSS tokens, and LiquidGlass button system
 * - Google OAuth 2.0 authentication + Email/password authentication
 * - Strict email authenticity validation (blocking disposable, temporary, and placeholder domains)
 * - Three modes: sign-in | sign-up | forgot-password
 * - Client-side validation before hitting the network
 * - Separate error (red) and success/info (blue) banners
 * - Show/hide password toggle
 * - Loading spinners and disabled state during requests
 * - Configuration guidance when Supabase credentials are missing
 */

import { useState, useId } from 'react'
import {
  AlertCircle, CheckCircle2, Clock3, Eye, EyeOff,
  KeyRound, LogIn, Mail, ShieldCheck, Sparkles, UserPlus,
} from 'lucide-react'
import { LiquidGlass } from './LiquidGlass'
import { validateAuthenticEmail } from '../lib/emailValidation'

type Mode = 'signin' | 'signup' | 'reset'

type Props = {
  isConfigured: boolean
  onSignIn: (email: string, password: string) => Promise<void>
  onSignUp: (email: string, password: string) => Promise<void>
  onGoogleSignIn?: () => Promise<void>
  onReset: (email: string) => Promise<void>
  onContinueLocal?: () => void
  loading: boolean
  error: string | null
  /** Non-error informational / success message from the hook. */
  success?: string | null
  clearError: () => void
}

function validatePassword(password: string, mode: Mode): string | null {
  if (mode === 'reset') return null
  if (!password) return 'Password is required.'
  if (password.length < 6) return 'Password must be at least 6 characters.'
  return null
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  )
}

export function LoginScreen({
  isConfigured,
  onSignIn,
  onSignUp,
  onGoogleSignIn,
  onReset,
  onContinueLocal,
  loading,
  error,
  success,
  clearError,
}: Props) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const emailId = useId()
  const passwordId = useId()

  const switchMode = (m: Mode) => {
    setMode(m)
    setLocalError(null)
    setTestResult(null)
    clearError()
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const url = import.meta.env.VITE_SUPABASE_URL || (import.meta.env as any).NEXT_PUBLIC_SUPABASE_URL
      const res = await fetch(`${url}/auth/v1/health`, { method: 'GET' })
      setTestResult(`Connection successful (Supabase returned HTTP ${res.status})`)
    } catch (err: any) {
      setTestResult(`Failed: ${err?.message || err}. An ad-blocker, browser extension, or firewall may be blocking supabase.co.`)
    } finally {
      setTesting(false)
    }
  }

  const handleGoogleSignIn = async () => {
    if (!onGoogleSignIn || loading || googleLoading || !isConfigured) return
    setLocalError(null)
    clearError()
    setGoogleLoading(true)
    try {
      await onGoogleSignIn()
    } catch (err: any) {
      setLocalError(err?.message || 'Failed to initiate Google sign-in.')
      setGoogleLoading(false)
    }
  }

  const displayError = localError || error

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setLocalError(null)

    // Strict email authenticity validation
    const emailValidation = validateAuthenticEmail(email, { isSignUp: mode === 'signup' })
    if (!emailValidation.isValid) {
      setLocalError(emailValidation.error || 'Please enter an authentic email address.')
      return
    }

    const passErr = validatePassword(password, mode)
    if (passErr) {
      setLocalError(passErr)
      return
    }

    try {
      if (mode === 'signin') await onSignIn(email.trim(), password)
      else if (mode === 'signup') await onSignUp(email.trim(), password)
      else await onReset(email.trim())
    } catch (err: any) {
      console.error('[LoginScreen submit error]', err)
      setLocalError(err?.message || 'An error occurred during submission.')
    }
  }

  const isBusy = loading || googleLoading

  return (
    <div className="auth-shell">
      <div className="auth-bg-orb auth-orb-1" />
      <div className="auth-bg-orb auth-orb-2" />

      <div className="auth-card">

        {/* ── Brand ──────────────────────────────────────────────────── */}
        <div className="auth-brand">
          <div className="auth-brand-mark">
            <Clock3 size={24} />
          </div>
          <div>
            <b>Chrono</b>
            <span>TIME TRACKER</span>
          </div>
        </div>

        {/* ── Title ──────────────────────────────────────────────────── */}
        <div className="auth-title">
          <h1>
            {mode === 'signin' && 'Welcome back'}
            {mode === 'signup' && 'Create account'}
            {mode === 'reset' && 'Reset password'}
          </h1>
          <p>
            {mode === 'signin' && 'Sign in to your personal time tracker.'}
            {mode === 'signup' && 'Join with your authentic email address.'}
            {mode === 'reset' && "We'll email you a password reset link."}
          </p>
        </div>

        {/* ── Missing config guidance ─────────────────────────────────── */}
        {!isConfigured && (
          <div className="auth-banner info" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
              <AlertCircle size={15} />
              <span>Supabase Not Configured</span>
            </div>
            <p style={{ margin: 0, fontSize: '11px', lineHeight: 1.5 }}>
              Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to
              your <code>.env.local</code> file, then restart the dev server.
            </p>
            {onContinueLocal && (
              <LiquidGlass
                as="button"
                type="button"
                className="soft-btn"
                onClick={onContinueLocal}
                style={{ marginTop: '4px', width: '100%', height: '36px' }}
                radius={999}
                bevelDepth={6}
                scale={18}
              >
                <Sparkles size={14} /> Continue in Local Mode
              </LiquidGlass>
            )}
          </div>
        )}

        {/* ── Success / info banner ───────────────────────────────────── */}
        {success && !displayError && (
          <div className="auth-banner info auth-banner-success">
            <CheckCircle2 size={14} style={{ flexShrink: 0 }} />
            <span>{success}</span>
          </div>
        )}

        {/* ── Error banner ────────────────────────────────────────────── */}
        {displayError && (
          <div className="auth-banner error" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', width: '100%' }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{displayError}</span>
            </div>
            {testResult && (
              <div style={{ fontSize: '11px', padding: '6px 10px', borderRadius: '6px', background: 'rgba(0,0,0,0.12)', width: '100%', lineHeight: 1.4 }}>
                {testResult}
              </div>
            )}
            <button
              type="button"
              className="auth-link"
              onClick={testConnection}
              disabled={testing}
              style={{ fontSize: '11px', textDecoration: 'underline', alignSelf: 'flex-start' }}
            >
              {testing ? 'Checking connection...' : 'Diagnose connection to Supabase'}
            </button>
          </div>
        )}

        {/* ── Google Authentication ─────────────────────────────────────── */}
        {mode !== 'reset' && onGoogleSignIn && (
          <div className="auth-oauth-wrap">
            <LiquidGlass
              as="button"
              type="button"
              className="soft-btn full auth-google-btn"
              onClick={handleGoogleSignIn}
              disabled={isBusy || !isConfigured}
              radius={999}
              bevelDepth={8}
              scale={22}
            >
              {googleLoading ? (
                <>
                  <span className="auth-spinner" style={{ width: 15, height: 15 }} />
                  <span>Connecting to Google...</span>
                </>
              ) : (
                <>
                  <GoogleIcon />
                  <span>{mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}</span>
                </>
              )}
            </LiquidGlass>

            <div className="auth-divider">
              <span>or continue with email</span>
            </div>
          </div>
        )}

        {/* ── Form ────────────────────────────────────────────────────── */}
        <form className="auth-form" action="javascript:void(0)" onSubmit={submit} noValidate>

          {/* Email field */}
          <label className="auth-field" htmlFor={emailId}>
            <span>Email</span>
            <div className="auth-input-wrap">
              <Mail size={15} className="auth-input-icon" />
              <input
                id={emailId}
                type="email"
                autoComplete="email"
                placeholder="you@gmail.com"
                value={email}
                onChange={e => { setEmail(e.target.value); setLocalError(null); clearError() }}
                required
                disabled={isBusy || !isConfigured}
                aria-describedby={displayError ? 'auth-error' : undefined}
              />
            </div>
            {mode === 'signup' && (
              <div className="auth-field-hint">
                <ShieldCheck size={13} />
                <span>Only authentic emails permitted (disposable/burner domains blocked).</span>
              </div>
            )}
          </label>

          {/* Password field (hidden in reset mode) */}
          {mode !== 'reset' && (
            <label className="auth-field" htmlFor={passwordId}>
              <span>Password</span>
              <div className="auth-input-wrap">
                <KeyRound size={15} className="auth-input-icon" />
                <input
                  id={passwordId}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setLocalError(null); clearError() }}
                  required
                  minLength={6}
                  disabled={isBusy || !isConfigured}
                />
                <button
                  type="button"
                  className="auth-eye"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                  disabled={isBusy}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
          )}

          {/* Forgot password link */}
          {mode === 'signin' && (
            <button
              type="button"
              className="auth-link auth-link-right"
              onClick={() => switchMode('reset')}
              disabled={!isConfigured || isBusy}
            >
              Forgot password?
            </button>
          )}

          {/* Submit */}
          <LiquidGlass
            as="button"
            type="submit"
            className="primary-btn full auth-submit"
            disabled={isBusy || !isConfigured}
            radius={999}
            bevelDepth={12}
            scale={32}
          >
            {loading && !googleLoading ? (
              <span className="auth-spinner" />
            ) : mode === 'signin' ? (
              <><LogIn size={16} /> Sign in</>
            ) : mode === 'signup' ? (
              <><UserPlus size={16} /> Create account</>
            ) : (
              <><Mail size={16} /> Send reset link</>
            )}
          </LiquidGlass>
        </form>

        {/* ── Mode switch ─────────────────────────────────────────────── */}
        <div className="auth-switch">
          {mode === 'signin' ? (
            <>
              <span>Don't have an account?</span>
              <button
                type="button"
                className="auth-link"
                onClick={() => switchMode('signup')}
                disabled={!isConfigured || isBusy}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              <span>Already have an account?</span>
              <button
                type="button"
                className="auth-link"
                onClick={() => switchMode('signin')}
                disabled={isBusy}
              >
                Sign in
              </button>
            </>
          )}
        </div>

        {onContinueLocal && isConfigured && (
          <div style={{ marginTop: '14px', textAlign: 'center' }}>
            <button
              type="button"
              className="auth-link"
              onClick={onContinueLocal}
              disabled={isBusy}
              style={{ fontSize: '12px', opacity: 0.85, display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            >
              <Sparkles size={13} /> Continue in Local Mode (Offline)
            </button>
          </div>
        )}

        <p className="auth-note">Your data is private and protected with Row Level Security.</p>
      </div>
    </div>
  )
}
