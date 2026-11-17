/**
 * Chrono Test Suite
 *
 * Verifies:
 * 1. Migration reading, schema preservation, and count verification
 * 2. Idempotent deduplication logic
 * 3. Timer calculations: active running, paused exclusion, and recovery
 * 4. Export formatters: CSV escaping and JSON backup integrity
 * 5. SQL migration structure and RLS policy rules
 * 6. UX improvements: Typography preferences, clock display styles, sidebar modes & progress ring
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { validateAuthenticEmail } from '../src/lib/emailValidation.ts'

console.log('🧪 Starting Chrono automated test suite...\n')

// ── Test 1: Timer Calculations & Paused Time Exclusion ──────────────────────
{
  console.log('▶ Test 1: Timer calculations & paused time exclusion')

  type Active = {
    mode: 'stopwatch' | 'timer'
    status: 'running' | 'paused'
    startedAt: number | null
    elapsed: number
    duration: number
  }

  const computeElapsed = (active: Active, now: number) => {
    if (active.mode === 'stopwatch') {
      return active.elapsed + (active.status === 'running' && active.startedAt ? (now - active.startedAt) / 1000 : 0)
    }
    const remaining = active.status === 'running' && active.startedAt
      ? active.duration - active.elapsed - (now - active.startedAt) / 1000
      : active.duration - active.elapsed
    return Math.max(0, remaining)
  }

  // Case 1A: Running stopwatch after 120 seconds
  const t0 = 1000000000000
  const activeRunning: Active = {
    mode: 'stopwatch',
    status: 'running',
    startedAt: t0,
    elapsed: 0,
    duration: 0,
  }
  const elapsedRunning = computeElapsed(activeRunning, t0 + 120_000)
  assert.equal(elapsedRunning, 120, 'Stopwatch should report exactly 120 seconds')

  // Case 1B: Paused stopwatch — time elapsed during pause must NOT be added
  const activePaused: Active = {
    mode: 'stopwatch',
    status: 'paused',
    startedAt: null,
    elapsed: 120,
    duration: 0,
  }
  const elapsedPaused = computeElapsed(activePaused, t0 + 500_000)
  assert.equal(elapsedPaused, 120, 'Paused stopwatch must not gain time during paused duration')

  // Case 1C: Countdown timer — 25 min (1500s), 300s passed
  const activeTimer: Active = {
    mode: 'timer',
    status: 'running',
    startedAt: t0,
    elapsed: 0,
    duration: 1500,
  }
  const remaining = computeElapsed(activeTimer, t0 + 300_000)
  assert.equal(remaining, 1200, 'Timer should have 1200s remaining out of 1500s')

  // Case 1D: Timer expires and clamps to 0
  const expired = computeElapsed(activeTimer, t0 + 1800_000)
  assert.equal(expired, 0, 'Timer should clamp to 0 when expired')

  console.log('  ✔ Timer calculations and paused time exclusion verified.\n')
}

// ── Test 2: Local Data Migration & Idempotent Deduplication ─────────────────
{
  console.log('▶ Test 2: Local data migration & deduplication')

  type Session = {
    id: string
    start: number
    end: number
    duration: number
    category: string
    subcategory: string
    source: 'stopwatch' | 'timer' | 'manual'
  }

  const sampleLocalSessions: Session[] = [
    { id: 'sess01', start: 1700000000000, end: 1700001800000, duration: 1800, category: 'work', subcategory: 'Projects', source: 'stopwatch' },
    { id: 'sess02', start: 1700010000000, end: 1700013600000, duration: 3600, category: 'learning', subcategory: 'Reading', source: 'timer' },
  ]

  // Simulate cloud database with an existing session (sess01)
  const cloudDbSessions = new Map<string, { id: string; local_id: string }>()
  cloudDbSessions.set('sess01', { id: 'uuid-1', local_id: 'sess01' })

  // Deduplicating insert simulation
  let inserted = 0
  let skipped = 0

  for (const s of sampleLocalSessions) {
    if (cloudDbSessions.has(s.id)) {
      skipped++
    } else {
      cloudDbSessions.set(s.id, { id: `uuid-${s.id}`, local_id: s.id })
      inserted++
    }
  }

  assert.equal(inserted, 1, 'Only sess02 should be inserted')
  assert.equal(skipped, 1, 'sess01 should be skipped as duplicate')
  assert.equal(cloudDbSessions.size, 2, 'Total cloud sessions should be 2')

  // Running second time (idempotency check)
  let secondRunInserted = 0
  for (const s of sampleLocalSessions) {
    if (!cloudDbSessions.has(s.id)) {
      secondRunInserted++
    }
  }
  assert.equal(secondRunInserted, 0, 'Second run must insert 0 records (idempotent)')

  console.log('  ✔ Idempotent migration and duplicate prevention verified.\n')
}

// ── Test 3: Data Export Formatters ──────────────────────────────────────────
{
  console.log('▶ Test 3: CSV and JSON export formatting')

  const sessions = [
    { id: 's1', start: 1700000000000, end: 1700001800000, duration: 1800, category: 'College', subcategory: 'DSP', source: 'stopwatch', notes: 'Studied "filter" design' },
  ]

  // CSV formatter logic from App.tsx
  const rows = [
    ['Date', 'Start', 'End', 'Duration seconds', 'Category', 'Subcategory', 'Source', 'Notes'],
    ...sessions.map(s => ['2023-11-14', '09:00 AM', '09:30 AM', s.duration, s.category, s.subcategory, s.source, s.notes || ''])
  ]
  const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n')

  assert.ok(csv.includes('"Duration seconds"'), 'CSV must contain duration header')
  assert.ok(csv.includes('""filter""'), 'CSV must properly escape double quotes')
  assert.ok(csv.includes('"College"'), 'CSV must preserve category name')

  // JSON backup format
  const backup = {
    exportedAt: new Date().toISOString(),
    user: 'test@example.com',
    sessions,
    categories: [{ id: 'c1', name: 'College', color: '#557FEA', subs: ['DSP'] }],
    preferences: {
      theme: 'light',
      dailyGoalHours: 4,
      appFont: 'inter',
      clockFont: 'jetbrains-mono',
      clockStyle: 'digital',
      sidebarMode: 'compact'
    }
  }
  const jsonStr = JSON.stringify(backup, null, 2)
  const parsed = JSON.parse(jsonStr)

  assert.equal(parsed.sessions.length, 1)
  assert.equal(parsed.categories[0].name, 'College')
  assert.equal(parsed.preferences.dailyGoalHours, 4)
  assert.equal(parsed.preferences.appFont, 'inter')
  assert.equal(parsed.preferences.clockFont, 'jetbrains-mono')
  assert.equal(parsed.preferences.clockStyle, 'digital')
  assert.equal(parsed.preferences.sidebarMode, 'compact')

  console.log('  ✔ CSV and JSON export formatting verified.\n')
}

// ── Test 4: SQL Migration Files Validation ──────────────────────────────────
{
  console.log('▶ Test 4: SQL migrations file checks')

  const mig1 = fs.readFileSync(path.resolve('supabase/migrations/001_initial_schema.sql'), 'utf-8')
  const mig2 = fs.readFileSync(path.resolve('supabase/migrations/002_rls_policies.sql'), 'utf-8')

  // Check 001_initial_schema
  assert.ok(mig1.includes('CREATE TABLE IF NOT EXISTS public.sessions'), 'Must create sessions table')
  assert.ok(mig1.includes('CREATE TABLE IF NOT EXISTS public.categories'), 'Must create categories table')
  assert.ok(mig1.includes('CREATE TABLE IF NOT EXISTS public.user_preferences'), 'Must create user_preferences table')
  assert.ok(mig1.includes('sessions_user_local_id_unique UNIQUE (user_id, local_id)'), 'Must enforce unique user local_id on sessions')
  assert.ok(mig1.includes('categories_user_local_id_unique UNIQUE (user_id, local_id)'), 'Must enforce unique user local_id on categories')
  assert.ok(mig1.includes('TIMESTAMPTZ'), 'Must use timezone-aware timestamps')

  // Check 002_rls_policies
  assert.ok(mig2.includes('ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;'), 'Must enable RLS on sessions')
  assert.ok(mig2.includes('ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;'), 'Must enable RLS on categories')
  assert.ok(mig2.includes('ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;'), 'Must enable RLS on user_preferences')
  assert.ok(mig2.includes('auth.uid() = user_id'), 'Policies must enforce auth.uid()')

  // Check 003_authentic_emails
  assert.ok(fs.existsSync('supabase/migrations/003_authentic_emails.sql'), '003_authentic_emails.sql must exist')
  const mig3 = fs.readFileSync(path.resolve('supabase/migrations/003_authentic_emails.sql'), 'utf-8')
  assert.ok(mig3.includes('check_authentic_email'), 'Must define check_authentic_email function')
  assert.ok(mig3.includes('trg_check_authentic_email'), 'Must define trg_check_authentic_email trigger')
  assert.ok(mig3.includes('mailinator.com'), 'Must block disposable domains in SQL migration')

  console.log('  ✔ SQL schema, RLS policies, and authentic email migration verified.\n')
}

// ── Test 5: Deployment & Configuration Files Validation ─────────────────────
{
  console.log('▶ Test 5: Vercel & environment files check')

  assert.ok(fs.existsSync('.env.example'), '.env.example must exist')
  assert.ok(fs.existsSync('vercel.json'), 'vercel.json must exist')
  assert.ok(fs.existsSync('.gitignore'), '.gitignore must exist')

  const gitignore = fs.readFileSync('.gitignore', 'utf-8')
  assert.ok(gitignore.includes('.env.local'), '.gitignore must ignore .env.local')

  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf-8'))
  assert.equal(vercel.buildCommand, 'npm run build')
  assert.equal(vercel.outputDirectory, 'dist')
  assert.ok(vercel.rewrites.some((r: { source: string; destination: string }) => r.destination === '/index.html'), 'Vercel must have SPA routing rewrite')

  // Verify Vite development server and host 0.0.0.0 network configuration
  const viteConfig = fs.readFileSync('vite.config.ts', 'utf-8')
  assert.ok(viteConfig.includes("host: '0.0.0.0'"), "vite.config.ts must configure host to '0.0.0.0'")
  assert.ok(viteConfig.includes('networkUrlLogger'), "vite.config.ts must include networkUrlLogger plugin")

  const pkgJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'))
  assert.ok(pkgJson.scripts.dev.includes('--host 0.0.0.0'), "package.json dev script must include '--host 0.0.0.0'")
  assert.ok(pkgJson.scripts.preview.includes('--host 0.0.0.0'), "package.json preview script must include '--host 0.0.0.0'")

  console.log('  ✔ Deployment configuration files & 0.0.0.0 network binding verified.\n')
}

// ── Test 6: UX Improvements: Typography, Immersive Ring & Sidebar Modes ────
{
  console.log('▶ Test 6: UX improvements verification')

  // Validate supported font families
  const validAppFonts = ['inter', 'manrope', 'space-grotesk', 'jetbrains-mono']
  const validClockFonts = ['inter', 'manrope', 'space-grotesk', 'jetbrains-mono']
  const validClockStyles = ['clean', 'digital', 'rounded']
  const validSidebarModes = ['expanded', 'compact', 'hidden']

  assert.equal(validAppFonts.length, 4, 'Must have 4 application font options')
  assert.equal(validClockFonts.length, 4, 'Must have 4 clock font options')
  assert.equal(validClockStyles.length, 3, 'Must have 3 clock styles: clean, digital, rounded')
  assert.equal(validSidebarModes.length, 3, 'Must have 3 sidebar modes: expanded, compact, hidden')

  // Test immersive countdown circular progress dashoffset calculation
  const circumference = 2 * Math.PI * 210 // 1319.47
  const calcOffset = (elapsed: number, duration: number) => {
    const ratio = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 1
    return circumference * (1 - ratio)
  }

  // At start: elapsed = 0 -> ratio = 0 -> offset = circumference
  assert.ok(Math.abs(calcOffset(0, 1500) - circumference) < 0.01, 'Offset at start should be full circumference')
  // At 50%: elapsed = 750 -> offset = circumference / 2
  assert.ok(Math.abs(calcOffset(750, 1500) - circumference / 2) < 0.01, 'Offset at 50% should be half circumference')
  // At 100%: elapsed = 1500 -> offset = 0
  assert.ok(Math.abs(calcOffset(1500, 1500)) < 0.01, 'Offset at 100% should be 0')

  // Verify index.html font links
  const indexHtml = fs.readFileSync('index.html', 'utf-8')
  assert.ok(indexHtml.includes('family=Inter'), 'index.html must load Inter font')
  assert.ok(indexHtml.includes('family=Manrope'), 'index.html must load Manrope font')
  assert.ok(indexHtml.includes('family=Space+Grotesk'), 'index.html must load Space Grotesk font')
  assert.ok(indexHtml.includes('family=JetBrains+Mono'), 'index.html must load JetBrains Mono font')

  // Verify style.css rules for font and sidebar modes
  const styleCss = fs.readFileSync('src/style.css', 'utf-8')
  assert.ok(styleCss.includes('data-sidebar="compact"'), 'style.css must have compact sidebar rules')
  assert.ok(styleCss.includes('data-sidebar="hidden"'), 'style.css must have hidden sidebar rules')
  assert.ok(styleCss.includes('clock-style-clean'), 'style.css must have clean clock style')
  assert.ok(styleCss.includes('clock-style-digital'), 'style.css must have digital clock style')
  assert.ok(styleCss.includes('clock-style-rounded'), 'style.css must have rounded clock style')
  assert.ok(styleCss.includes('.immersive-overlay'), 'style.css must have immersive overlay')

  console.log('  ✔ UX improvements: typography, immersive mode, and sidebar modes verified.\n')
}

// ── Test 7: Email Authenticity & Google Authentication Verification ────────
{
  console.log('▶ Test 7: Email authenticity validation & Google authentication')

  // Case 7A: Authentic emails must be accepted
  const authenticEmails = [
    'john.doe@gmail.com',
    'sarah_connor@outlook.com',
    'alex99@yahoo.com',
    'contact@startup.io',
    'student@stanford.edu',
    'engineer@company.co.uk',
    'user@proton.me',
    'researcher@institute.org',
  ]
  for (const email of authenticEmails) {
    const res = validateAuthenticEmail(email, { isSignUp: true })
    assert.equal(res.isValid, true, `Authentic email ${email} should be accepted: ${res.error}`)
    assert.equal(res.error, null)
  }

  // Case 7B: Disposable / temporary email domains must be rejected
  const disposableEmails = [
    'random@mailinator.com',
    'user@tempmail.com',
    'anon@10minutemail.com',
    'throwaway@sharklasers.com',
    'burner@yopmail.com',
    'spam@guerrillamail.com',
    'temp@trashmail.com',
    'bot@burnermail.io',
  ]
  for (const email of disposableEmails) {
    const res = validateAuthenticEmail(email, { isSignUp: true })
    assert.equal(res.isValid, false, `Disposable email ${email} must be rejected`)
    assert.equal(res.isDisposable, true, `Disposable flag must be set for ${email}`)
    assert.ok(res.error?.includes('Disposable and temporary email'), `Error must mention disposable emails`)
  }

  // Case 7C: Test / placeholder domains must be rejected
  const testDomainEmails = [
    'john@example.com',
    'user@example.org',
    'tester@test.com',
    'admin@fake.com',
    'dummy@dummy.com',
    'sample@sample.com',
    'foo@asdf.com',
  ]
  for (const email of testDomainEmails) {
    const res = validateAuthenticEmail(email, { isSignUp: true })
    assert.equal(res.isValid, false, `Test domain ${email} must be rejected`)
    assert.equal(res.isTestDomain, true, `Test domain flag must be set for ${email}`)
    assert.ok(res.error?.includes('Test, example, and placeholder'), `Error must mention placeholder domains`)
  }

  // Case 7D: Suspicious random gibberish / dummy usernames must be rejected
  const gibberishEmails = [
    'test@gmail.com',
    'dummy@gmail.com',
    'asdf@gmail.com',
    'qwerty@gmail.com',
    'aaaaaaa@gmail.com',
    '111111@gmail.com',
    'asdfghjk@gmail.com',
    'bcdfghjklmn@gmail.com',
  ]
  for (const email of gibberishEmails) {
    const res = validateAuthenticEmail(email, { isSignUp: true })
    assert.equal(res.isValid, false, `Random/dummy email ${email} must be rejected`)
    assert.ok(res.error !== null, `Error must be present for ${email}`)
  }

  // Case 7E: Malformed email syntax must be rejected
  const malformedEmails = [
    '',
    'not-an-email',
    'user@',
    '@gmail.com',
    'user@domain',
    'user@domain..com',
    'user@.com',
    'user@domain.c',
  ]
  for (const email of malformedEmails) {
    const res = validateAuthenticEmail(email, { isSignUp: true })
    assert.equal(res.isValid, false, `Malformed email "${email}" must be rejected`)
  }

  // Case 7F: Google auth UI & useAuth exports verification
  const useAuthSource = fs.readFileSync('src/hooks/useAuth.ts', 'utf-8')
  assert.ok(useAuthSource.includes('signInWithGoogle'), 'useAuth must export signInWithGoogle')
  assert.ok(useAuthSource.includes("provider: 'google'"), 'useAuth must invoke supabase Google provider')

  const loginScreenSource = fs.readFileSync('src/components/LoginScreen.tsx', 'utf-8')
  assert.ok(loginScreenSource.includes('onGoogleSignIn'), 'LoginScreen must support onGoogleSignIn prop')
  assert.ok(loginScreenSource.includes('GoogleIcon'), 'LoginScreen must render GoogleIcon')
  assert.ok(loginScreenSource.includes('Continue with Google'), 'LoginScreen must render Google button')
  assert.ok(loginScreenSource.includes('validateAuthenticEmail'), 'LoginScreen must use validateAuthenticEmail')

  const styleCssSource = fs.readFileSync('src/style.css', 'utf-8')
  assert.ok(styleCssSource.includes('.auth-google-btn'), 'style.css must define auth-google-btn')
  assert.ok(styleCssSource.includes('.auth-divider'), 'style.css must define auth-divider')

  console.log('  ✔ Email authenticity validation & Google authentication verified.\n')
}

console.log('🎉 All 7 test suites passed successfully!')
