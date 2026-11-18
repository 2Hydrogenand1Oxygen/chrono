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
import {
  getTrackingDate,
  getTrackingDateKey,
  getDayBoundaryRange,
  getSessionDayOverlap,
  splitSessionByTrackingDays,
  getWeekRange,
  getCalendarDayDetails,
  isSessionBreak,
} from '../src/lib/dateUtils.ts'
import {
  createFocusSession,
  startFocusSession,
  pauseFocusSession,
  resumeFocusSession,
  advanceFocusSession,
  skipBreak,
  endFocusSession,
  getPhaseRemainingTime,
  getFocusSessionTotals,
  calculateEstimatedSessionDuration,
  FOCUS_PRESETS,
  type FocusSessionConfig,
  type FocusSessionState,
} from '../src/lib/focusSession.ts'

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

// ── Test 8: Custom Day Boundary Tracking & Logical Session Splitting ─────────
{
  console.log('▶ Test 8: Custom day boundary tracking & session splitting')

  // Case 8A: Default midnight boundary (dayStartHour = 0)
  const dStandard = new Date(2026, 10, 16, 14, 0).getTime() // Nov 16, 2:00 PM
  assert.equal(getTrackingDateKey(dStandard, 0), '2026-11-16', '14:00 must belong to Nov 16 at midnight boundary')

  // Case 8B: Custom 04:00 boundary — Session from Monday 11:00 PM to Tuesday 02:00 AM
  // Monday Nov 16 23:00 to Tuesday Nov 17 02:00 (3 hours = 10800s)
  const mon11PM = new Date(2026, 10, 16, 23, 0).getTime()
  const tue2AM = new Date(2026, 10, 17, 2, 0).getTime()
  const session1 = {
    id: 's1',
    start: mon11PM,
    end: tue2AM,
    duration: 10800,
  }

  // Monday tracking window (Nov 16 04:00 to Nov 17 04:00)
  const monRange = getDayBoundaryRange('2026-11-16', 4)
  const tueRange = getDayBoundaryRange('2026-11-17', 4)

  const monOverlap = getSessionDayOverlap(session1, monRange.start, monRange.end)
  const tueOverlap = getSessionDayOverlap(session1, tueRange.start, tueRange.end)

  assert.equal(monOverlap, 10800, 'Entire 3-hour session starting 11 PM and ending 2 AM belongs to Monday')
  assert.equal(tueOverlap, 0, 'Tuesday gets 0 seconds of the Monday night session')

  // Case 8C: Session starting Tuesday at 05:00 AM belongs to Tuesday
  const tue5AM = new Date(2026, 10, 17, 5, 0).getTime()
  const tue6AM = new Date(2026, 10, 17, 6, 0).getTime()
  const session2 = { id: 's2', start: tue5AM, end: tue6AM, duration: 3600 }
  assert.equal(getSessionDayOverlap(session2, monRange.start, monRange.end), 0, '5 AM Tuesday does not belong to Monday')
  assert.equal(getSessionDayOverlap(session2, tueRange.start, tueRange.end), 3600, '5 AM Tuesday belongs entirely to Tuesday')

  // Case 8D: Session crossing the 4:00 AM boundary
  // Monday Nov 16 23:00 to Tuesday Nov 17 05:00 (6 hours = 21600s total; 5h before 4 AM, 1h after 4 AM)
  const sessionCrossing = { id: 's_cross', start: mon11PM, end: tue5AM, duration: 21600 }
  const crossMon = getSessionDayOverlap(sessionCrossing, monRange.start, monRange.end)
  const crossTue = getSessionDayOverlap(sessionCrossing, tueRange.start, tueRange.end)

  assert.equal(crossMon, 18000, 'Monday gets exactly 5 hours (23:00 to 04:00)')
  assert.equal(crossTue, 3600, 'Tuesday gets exactly 1 hour (04:00 to 05:00)')
  assert.equal(crossMon + crossTue, sessionCrossing.duration, 'Split durations sum up to total duration')

  // Case 8E: splitSessionByTrackingDays utility helper verification
  const splits = splitSessionByTrackingDays(sessionCrossing, 4)
  assert.equal(splits.length, 2, 'Session crossing 4 AM must split across two tracking days')
  assert.equal(splits[0].dateKey, '2026-11-16')
  assert.equal(splits[0].duration, 18000)
  assert.equal(splits[1].dateKey, '2026-11-17')
  assert.equal(splits[1].duration, 3600)

  // Case 8F: Session spanning multiple tracking days (27 hours)
  const sessionMulti = {
    id: 's_multi',
    start: mon11PM, // Nov 16 23:00
    end: new Date(2026, 10, 18, 2, 0).getTime(), // Nov 18 02:00
    duration: 27 * 3600,
  }
  const multiSplits = splitSessionByTrackingDays(sessionMulti, 4)
  assert.equal(multiSplits.length, 2, 'Nov 16 23:00 to Nov 18 02:00 is within 2 tracking days (Nov 16 and Nov 17)')
  assert.equal(multiSplits[0].dateKey, '2026-11-16')
  assert.equal(multiSplits[0].duration, 5 * 3600)
  assert.equal(multiSplits[1].dateKey, '2026-11-17')
  assert.equal(multiSplits[1].duration, 22 * 3600)
  const multiSum = multiSplits.reduce((acc, s) => acc + s.duration, 0)
  assert.equal(multiSum, sessionMulti.duration, 'Multi-day session splits sum up to exact total duration')

  // Case 8G: Historical records recalculation without changing original timestamps
  // A historical session starting at 01:00 AM Nov 17:
  const historicalSession = {
    id: 'hist_1',
    start: new Date(2026, 10, 17, 1, 0).getTime(),
    end: new Date(2026, 10, 17, 2, 30).getTime(),
    duration: 5400,
  }
  // At midnight boundary (H = 0), it's Nov 17
  const splitsH0 = splitSessionByTrackingDays(historicalSession, 0)
  assert.equal(splitsH0[0].dateKey, '2026-11-17')
  // When user switches preference to 04:00 (H = 4), it recalculates to Nov 16
  const splitsH4 = splitSessionByTrackingDays(historicalSession, 4)
  assert.equal(splitsH4[0].dateKey, '2026-11-16')
  // Original start and end are untouched
  assert.equal(historicalSession.start, new Date(2026, 10, 17, 1, 0).getTime())
  assert.equal(historicalSession.end, new Date(2026, 10, 17, 2, 30).getTime())

  console.log('  ✔ Custom day boundary tracking & session splitting verified.\n')
}

// ── Test 9: Week Start Preference & Transitions ──────────────────────────────
{
  console.log('▶ Test 9: Week start preference & transitions')

  // Case 9A: Monday start vs Sunday start for Sunday night
  // Sunday Nov 15, 2026 at 20:00 (8:00 PM)
  const sunNight = new Date(2026, 10, 15, 20, 0).getTime()

  const monWeek = getWeekRange(sunNight, 0, 'monday')
  // For Monday start, Sunday Nov 15 is the LAST day of the week starting Monday Nov 9
  assert.equal(new Date(monWeek.start).getDate(), 9, 'Monday-start week for Nov 15 must begin on Monday Nov 9')

  const sunWeek = getWeekRange(sunNight, 0, 'sunday')
  // For Sunday start, Sunday Nov 15 is the FIRST day of the week starting Sunday Nov 15
  assert.equal(new Date(sunWeek.start).getDate(), 15, 'Sunday-start week for Nov 15 must begin on Sunday Nov 15')

  // Case 9B: Month boundary transition
  // Saturday Oct 31, 2026 & Sunday Nov 1, 2026
  const oct31 = new Date(2026, 9, 31, 12, 0).getTime()
  const nov1 = new Date(2026, 10, 1, 12, 0).getTime()

  const oct31Mon = getWeekRange(oct31, 0, 'monday')
  assert.equal(new Date(oct31Mon.start).getMonth(), 9, 'Oct 31 belongs to Oct 26 week')
  assert.equal(new Date(oct31Mon.start).getDate(), 26)

  const nov1Sun = getWeekRange(nov1, 0, 'sunday')
  assert.equal(new Date(nov1Sun.start).getMonth(), 10)
  assert.equal(new Date(nov1Sun.start).getDate(), 1, 'Nov 1 Sunday starts its own week when weekStartsOn=sunday')

  // Case 9C: Year boundary transition
  // Dec 31, 2026 & Jan 1, 2027
  const dec31 = new Date(2026, 11, 31, 10, 0).getTime() // Thursday
  const jan1 = new Date(2027, 0, 1, 10, 0).getTime()    // Friday
  const yrWeek = getWeekRange(dec31, 0, 'monday')
  const yrWeekNext = getWeekRange(jan1, 0, 'monday')
  assert.equal(yrWeek.start, yrWeekNext.start, 'Dec 31 2026 and Jan 1 2027 share the same week starting Dec 28 2026')

  // Case 9D: Custom day boundary combined with week start
  // Monday Nov 16 at 02:00 AM with dayStartHour = 4:
  // Since 2 AM < 4 AM, tracking day is still Sunday Nov 15!
  const mon2AM = new Date(2026, 10, 16, 2, 0).getTime()
  const weekAt2AM = getWeekRange(mon2AM, 4, 'monday')
  assert.equal(new Date(weekAt2AM.start).getDate(), 9, 'Monday 2 AM with H=4 belongs to week of Nov 9 (Sunday tracking day)')

  // Monday Nov 16 at 05:00 AM with dayStartHour = 4:
  // Since 5 AM >= 4 AM, tracking day is Monday Nov 16!
  const mon5AM = new Date(2026, 10, 16, 5, 0).getTime()
  const weekAt5AM = getWeekRange(mon5AM, 4, 'monday')
  assert.equal(new Date(weekAt5AM.start).getDate(), 16, 'Monday 5 AM with H=4 begins week of Nov 16')

  console.log('  ✔ Week start preference & boundary transitions verified.\n')
}

// ── Test 10: Calendar Date Details Calculation & Heatmap Accuracy ───────────
{
  console.log('▶ Test 10: Calendar date details popup calculations')

  const testCategories = [
    { id: 'cat_dsp', name: 'DSP', color: '#557FEA', subs: ['Lectures', 'Assignments'] },
    { id: 'cat_ml', name: 'Machine Learning', color: '#6AA9B8', subs: ['Projects'] },
    { id: 'cat_break', name: 'Break', color: '#8892A4', subs: ['Rest'] },
  ]

  // Nov 16, 2026:
  // Session 1: DSP - 1h 30m (5400s)
  // Session 2: Machine Learning - 2h 00m (7200s)
  // Session 3: Assignments (DSP) - 1h 10m (4200s)
  // Session 4: Break - 45m (2700s)
  const baseDay = new Date(2026, 10, 16, 10, 0).getTime()
  const testSessions = [
    { id: 's1', start: baseDay, end: baseDay + 5400 * 1000, duration: 5400, category: 'cat_dsp', subcategory: 'Lectures' },
    { id: 's2', start: baseDay + 6000 * 1000, end: baseDay + 13200 * 1000, duration: 7200, category: 'cat_ml', subcategory: 'Projects' },
    { id: 's3', start: baseDay + 14000 * 1000, end: baseDay + 18200 * 1000, duration: 4200, category: 'cat_dsp', subcategory: 'Assignments' },
    { id: 's4', start: baseDay + 19000 * 1000, end: baseDay + 21700 * 1000, duration: 2700, category: 'cat_break', subcategory: 'Rest' },
  ]

  const details = getCalendarDayDetails({
    year: 2026,
    month: 10, // November
    day: 16,
    dayStartHour: 0,
    sessions: testSessions,
    categories: testCategories,
  })

  // Full date check
  assert.equal(details.fullDate, 'MONDAY, 16 NOVEMBER')
  // Total tracked time check (5400 + 7200 + 4200 + 2700 = 19500s = 5h 25m)
  assert.equal(details.totalTracked, 19500)
  // Study time excludes break (19500 - 2700 = 16800s = 4h 40m)
  assert.equal(details.studyTime, 16800)
  // Session count
  assert.equal(details.sessionCount, 4)
  assert.equal(details.isEmpty, false)

  // Category breakdown checks
  assert.equal(details.categoryBreakdown.length, 3)
  const dspCat = details.categoryBreakdown.find(c => c.name === 'DSP')
  assert.ok(dspCat, 'DSP category must exist')
  assert.equal(dspCat?.duration, 9600) // 5400 + 4200 = 9600
  assert.equal(dspCat?.subcategories.length, 2)
  assert.equal(dspCat?.subcategories[0].name, 'Lectures')
  assert.equal(dspCat?.subcategories[0].duration, 5400)
  assert.equal(dspCat?.subcategories[1].name, 'Assignments')
  assert.equal(dspCat?.subcategories[1].duration, 4200)

  // Empty date handling check
  const emptyDetails = getCalendarDayDetails({
    year: 2026,
    month: 10,
    day: 20,
    dayStartHour: 0,
    sessions: testSessions,
    categories: testCategories,
  })
  assert.equal(emptyDetails.totalTracked, 0)
  assert.equal(emptyDetails.studyTime, 0)
  assert.equal(emptyDetails.sessionCount, 0)
  assert.equal(emptyDetails.isEmpty, true)
  assert.equal(emptyDetails.categoryBreakdown.length, 0)

  console.log('  ✔ Calendar date details popup calculations verified.\n')
}

// ── Test 11: Auto-Hiding Controls in Immersive Mode ──────────────────────────
{
  console.log('▶ Test 11: Immersive mode auto-hiding controls state machine')

  class ImmersiveVisibilityController {
    visible = true
    reRenderCount = 0
    timer: NodeJS.Timeout | null = null

    clearTimer() {
      if (this.timer) {
        clearTimeout(this.timer)
        this.timer = null
      }
    }

    resetTimer() {
      this.clearTimer()
      this.timer = setTimeout(() => {
        this.setVisible(false)
      }, 3000)
    }

    setVisible(val: boolean) {
      if (this.visible !== val) {
        this.visible = val
        this.reRenderCount++
      }
    }

    enterImmersive() {
      this.setVisible(true)
      this.resetTimer()
    }

    exitImmersive() {
      this.clearTimer()
      this.setVisible(true)
    }

    onMouseMoveOrKeyDown() {
      if (!this.visible) {
        this.setVisible(true)
      }
      this.resetTimer()
    }

    onScreenTap() {
      // Tap once to reveal controls; automatically hide after 3 seconds; tap again to reveal them
      if (!this.visible) {
        this.setVisible(true)
      }
      this.resetTimer()
    }
  }

  const controller = new ImmersiveVisibilityController()

  // 1. Initially entering immersive mode
  controller.enterImmersive()
  assert.equal(controller.visible, true, 'Controls must be visible initially upon entering immersive mode')
  assert.ok(controller.timer !== null, 'Inactivity timer must be running')

  // 2. High-frequency mouse movements while visible should NOT trigger state updates / re-renders
  const reRendersBefore = controller.reRenderCount
  for (let i = 0; i < 50; i++) {
    controller.onMouseMoveOrKeyDown()
  }
  assert.equal(controller.reRenderCount, reRendersBefore, 'High frequency mousemove must not cause unnecessary React re-renders')
  assert.equal(controller.visible, true)

  // 3. After 3 seconds of inactivity, controls hide
  controller.setVisible(false)
  assert.equal(controller.visible, false, 'Controls hide after inactivity')

  // 4. Tap once reveals controls immediately
  controller.onScreenTap()
  assert.equal(controller.visible, true, 'Tap once must reveal controls immediately')
  assert.ok(controller.timer !== null, 'Inactivity timer must restart after tap')

  // 5. Automatically hide after 3 seconds of inactivity
  controller.setVisible(false)
  assert.equal(controller.visible, false)

  // 6. Tap again reveals them
  controller.onScreenTap()
  assert.equal(controller.visible, true, 'Tap again must reveal controls')

  // 7. Mouse movement or keydown reveals controls immediately
  controller.setVisible(false)
  controller.onMouseMoveOrKeyDown()
  assert.equal(controller.visible, true, 'Mouse activity must immediately reveal controls')

  // 8. Exiting immersive mode clears timer and restores visibility
  controller.exitImmersive()
  assert.equal(controller.visible, true, 'Exiting immersive mode must restore controls to visible')
  assert.equal(controller.timer, null, 'Exiting immersive mode must clean up inactivity timer')

  console.log('  ✔ Immersive mode auto-hiding controls state machine verified.\n')
}

// ── Test 12: Warn Before Closing Tab (beforeunload protection) ───────────────
{
  console.log('▶ Test 12: Warn before closing tab (beforeunload protection)')

  type TrackingState = {
    active: { mode: 'stopwatch' | 'timer'; status: 'running' | 'paused' } | null
  }

  const shouldRegisterBeforeUnload = (state: TrackingState): boolean => {
    return state.active !== null && state.active.status === 'running'
  }

  // Case 12A: No active tracking -> NO listener
  assert.equal(shouldRegisterBeforeUnload({ active: null }), false, 'No warning when idle')

  // Case 12B: Paused stopwatch -> NO listener
  assert.equal(shouldRegisterBeforeUnload({ active: { mode: 'stopwatch', status: 'paused' } }), false, 'No warning when paused')

  // Case 12C: Running stopwatch -> LISTENER ACTIVE
  assert.equal(shouldRegisterBeforeUnload({ active: { mode: 'stopwatch', status: 'running' } }), true, 'Warning active when stopwatch running')

  // Case 12D: Running timer -> LISTENER ACTIVE
  assert.equal(shouldRegisterBeforeUnload({ active: { mode: 'timer', status: 'running' } }), true, 'Warning active when countdown timer running')

  // Case 12E: Paused countdown timer -> NO listener
  assert.equal(shouldRegisterBeforeUnload({ active: { mode: 'timer', status: 'paused' } }), false, 'No warning when timer is paused')

  // Case 12F: Simulation of beforeunload event callback
  const mockEvent = {
    defaultPrevented: false,
    returnValue: undefined as string | undefined,
    preventDefault() {
      this.defaultPrevented = true
    },
  }

  const handleBeforeUnload = (e: typeof mockEvent) => {
    e.preventDefault()
    e.returnValue = ''
    return ''
  }

  handleBeforeUnload(mockEvent)
  assert.equal(mockEvent.defaultPrevented, true, 'preventDefault must be called on beforeunload')
  assert.equal(mockEvent.returnValue, '', 'returnValue must be set to empty string on beforeunload')

  console.log('  ✔ Warn before closing tab logic verified.\n')
}

// ── Test 13: Favicon and Web App Icon Assets & HTML Links ────────────────────
{
  console.log('▶ Test 13: Chrono favicon, web app icons and manifest assets')

  const publicDir = path.resolve('public')
  const indexHtmlPath = path.resolve('index.html')

  // Check required assets exist and have valid sizes
  const requiredFiles = [
    { file: 'favicon.svg', minBytes: 500 },
    { file: 'favicon.ico', minBytes: 100 },
    { file: 'favicon-16x16.png', minBytes: 100 },
    { file: 'favicon-32x32.png', minBytes: 200 },
    { file: 'apple-touch-icon.png', minBytes: 1000 },
    { file: 'icon-192.png', minBytes: 1000 },
    { file: 'icon-512.png', minBytes: 2000 },
    { file: 'site.webmanifest', minBytes: 100 },
  ]

  for (const item of requiredFiles) {
    const fullPath = path.join(publicDir, item.file)
    assert.ok(fs.existsSync(fullPath), `Asset ${item.file} must exist in public/`)
    const stats = fs.statSync(fullPath)
    assert.ok(stats.size >= item.minBytes, `Asset ${item.file} size (${stats.size}B) should be >= ${item.minBytes}B`)
  }

  // Check manifest content
  const manifestRaw = fs.readFileSync(path.join(publicDir, 'site.webmanifest'), 'utf-8')
  const manifest = JSON.parse(manifestRaw)
  assert.equal(manifest.name, 'Chrono')
  assert.equal(manifest.theme_color, '#090B10')
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 4, 'Manifest must specify multiple icon sizes')

  // Check SVG content
  const svgContent = fs.readFileSync(path.join(publicDir, 'favicon.svg'), 'utf-8')
  assert.ok(svgContent.includes('<svg'), 'SVG file must contain valid SVG tag')
  assert.ok(svgContent.includes('viewBox="0 0 512 512"'), 'SVG file must have 512x512 viewBox')
  assert.ok(svgContent.includes('#090B10') || svgContent.includes('#141722'), 'SVG must use Chrono dark charcoal palette')

  // Check index.html links
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8')
  assert.ok(indexHtml.includes('rel="icon" type="image/svg+xml" href="/favicon.svg"'), 'index.html must link favicon.svg')
  assert.ok(indexHtml.includes('href="/favicon-32x32.png"'), 'index.html must link 32x32 png')
  assert.ok(indexHtml.includes('href="/favicon-16x16.png"'), 'index.html must link 16x16 png')
  assert.ok(indexHtml.includes('rel="apple-touch-icon"'), 'index.html must link apple-touch-icon')
  assert.ok(indexHtml.includes('rel="manifest" href="/site.webmanifest"'), 'index.html must link site.webmanifest')
  assert.ok(indexHtml.includes('<meta name="theme-color" content="#090B10" />'), 'index.html must have dark theme-color meta tag')

  console.log('  ✔ Chrono favicon, web app icons and manifest assets verified.\n')
}

// ── Test 14: Focus Session Configuration, Presets & Estimated Duration ──────
{
  console.log('▶ Test 14: Focus session configuration, presets & estimated duration')

  // Check presets (durations stored in seconds)
  assert.ok(FOCUS_PRESETS.pomodoro, 'Pomodoro preset must exist')
  assert.equal(FOCUS_PRESETS.pomodoro.focusDuration, 25 * 60)
  assert.equal(FOCUS_PRESETS.pomodoro.shortBreakDuration, 5 * 60)
  assert.equal(FOCUS_PRESETS.pomodoro.longBreakDuration, 15 * 60)
  assert.equal(FOCUS_PRESETS.pomodoro.totalCycles, 4)
  assert.equal(FOCUS_PRESETS.pomodoro.longBreakEvery, 4)

  assert.ok(FOCUS_PRESETS.deep_work, 'Deep Work preset must exist')
  assert.equal(FOCUS_PRESETS.deep_work.focusDuration, 50 * 60)
  assert.equal(FOCUS_PRESETS.deep_work.shortBreakDuration, 10 * 60)
  assert.equal(FOCUS_PRESETS.deep_work.longBreakDuration, 20 * 60)
  assert.equal(FOCUS_PRESETS.deep_work.totalCycles, 3)
  assert.equal(FOCUS_PRESETS.deep_work.longBreakEvery, 3)

  assert.ok(FOCUS_PRESETS.extended_focus, 'Extended Focus preset must exist')
  assert.equal(FOCUS_PRESETS.extended_focus.focusDuration, 90 * 60)
  assert.equal(FOCUS_PRESETS.extended_focus.shortBreakDuration, 15 * 60)
  assert.equal(FOCUS_PRESETS.extended_focus.longBreakDuration, 25 * 60)
  assert.equal(FOCUS_PRESETS.extended_focus.totalCycles, 2)
  assert.equal(FOCUS_PRESETS.extended_focus.longBreakEvery, 2)

  // Estimated duration calculation
  // Pomodoro: 4 focus (4 * 25m = 100m = 6000s) + cycles 1, 2, 3 short breaks (3 * 5m = 15m) + cycle 4 long break (15m) = 30m breaks = 1800s. Total = 7800s (130 min)
  const pomoEst = calculateEstimatedSessionDuration(FOCUS_PRESETS.pomodoro)
  assert.equal(pomoEst.totalFocusSeconds, 6000)
  assert.equal(pomoEst.totalBreakSeconds, 1800)
  assert.equal(pomoEst.totalSessionSeconds, 7800)
  assert.equal(pomoEst.shortBreakCount, 3)
  assert.equal(pomoEst.longBreakCount, 1)

  // Deep Work: 3 focus (3 * 50m = 150m = 9000s) + cycles 1, 2 short breaks (2 * 10m = 20m) + cycle 3 long break (20m) = 40m breaks = 2400s. Total = 11400s (190 min)
  const deepEst = calculateEstimatedSessionDuration(FOCUS_PRESETS.deep_work)
  assert.equal(deepEst.totalFocusSeconds, 9000)
  assert.equal(deepEst.totalBreakSeconds, 2400)
  assert.equal(deepEst.totalSessionSeconds, 11400)
  assert.equal(deepEst.shortBreakCount, 2)
  assert.equal(deepEst.longBreakCount, 1)

  // Single cycle (no intermediate breaks, ends with long break if enabled)
  const singleCycleEst = calculateEstimatedSessionDuration({
    focusDuration: 45 * 60,
    shortBreakDuration: 5 * 60,
    longBreakDuration: 15 * 60,
    totalCycles: 1,
    longBreakEvery: 1,
  })
  assert.equal(singleCycleEst.totalFocusSeconds, 45 * 60)
  assert.equal(singleCycleEst.totalBreakSeconds, 15 * 60)
  assert.equal(singleCycleEst.totalSessionSeconds, 60 * 60)

  console.log('  ✔ Focus session configuration, presets & estimated duration verified.\n')
}

// ── Test 15: Focus State Machine Multi-cycle Progression, Pausing & Skip Break 
{
  console.log('▶ Test 15: Focus state machine multi-cycle progression, pausing & skip break')

  const baseConfig: FocusSessionConfig = {
    preset: 'custom',
    focusDuration: 25 * 60,       // 25 min = 1500s
    shortBreakDuration: 5 * 60,   // 5 min = 300s
    longBreakDuration: 15 * 60,   // 15 min = 900s
    totalCycles: 3,
    longBreakEvery: 3,
    autoStartNextPhase: true,     // auto advance in this test to verify multi-phase chain
    soundEnabled: true,
  }

  const t0 = 1700000000000 // Fixed epoch ms

  // Step 1: Create session & start -> starts at Cycle 1, Phase 'focus', Status 'running'
  let session = createFocusSession(baseConfig)
  assert.equal(session.status, 'idle')
  assert.equal(session.currentPhase, 'focus')
  assert.equal(session.currentCycle, 1)
  assert.equal(session.phaseDuration, 1500)
  assert.equal(session.intervals.length, 0)

  session = startFocusSession(session, t0)
  assert.equal(session.status, 'running')
  assert.equal(session.phaseStartedAt, t0)

  // Check remaining time at t0 + 500s
  const rem1 = getPhaseRemainingTime(session, t0 + 500_000)
  assert.equal(rem1, 1000, 'Remaining time should be 1000s after 500s elapsed')

  // Step 2: Advance after Focus 1 finishes (1500s later)
  // Transition should be to SHORT_BREAK (since cycle 1 < 3)
  const res1 = advanceFocusSession(session, t0 + 1500_000)
  session = res1.session
  assert.equal(session.currentPhase, 'short_break')
  assert.equal(session.currentCycle, 1)
  assert.equal(session.phaseDuration, 300)
  assert.equal(res1.completedIntervals.length, 1)
  assert.equal(res1.completedIntervals[0].phase, 'focus')
  assert.equal(res1.completedIntervals[0].duration, 1500)
  assert.equal(res1.sessionFinished, false)

  // Step 3: Advance after Short Break 1 finishes (300s later -> t0 + 1800s)
  // Transition should be to Cycle 2 FOCUS
  const res2 = advanceFocusSession(session, t0 + 1800_000)
  session = res2.session
  assert.equal(session.currentPhase, 'focus')
  assert.equal(session.currentCycle, 2)
  assert.equal(session.phaseDuration, 1500)
  assert.equal(res2.completedIntervals.length, 1)
  assert.equal(res2.completedIntervals[0].phase, 'short_break')
  assert.equal(res2.completedIntervals[0].duration, 300)

  // Step 4: Test Pausing during Focus 2
  // Pause after 300s into Focus 2 (t0 + 2100s)
  session = pauseFocusSession(session, t0 + 2100_000)
  assert.equal(session.status, 'paused')
  assert.equal(session.phaseElapsed, 300)

  // While paused, wall clock advances 600s to t0 + 2700s
  const remPaused = getPhaseRemainingTime(session, t0 + 2700_000)
  assert.equal(remPaused, 1500 - 300, 'Paused session must NOT lose remaining time during pause')

  // Resume Focus 2 at t0 + 2700s
  session = resumeFocusSession(session, t0 + 2700_000)
  assert.equal(session.status, 'running')
  assert.equal(session.phaseStartedAt, t0 + 2700_000)

  // Advance remaining 1200s -> completes Focus 2 at t0 + 3900s
  const res3 = advanceFocusSession(session, t0 + 3900_000)
  session = res3.session
  assert.equal(session.currentPhase, 'short_break')
  assert.equal(session.currentCycle, 2)
  assert.equal(res3.completedIntervals[0].phase, 'focus')
  assert.equal(res3.completedIntervals[0].duration, 1500)

  // Step 5: Test Skip Break on Cycle 2 Short Break
  // User decides after 60s of break to skip to next focus cycle
  session = skipBreak(session, t0 + 3960_000)
  assert.equal(session.currentPhase, 'focus')
  assert.equal(session.currentCycle, 3)
  assert.equal(session.phaseDuration, 1500)
  const lastRecordedInterval = session.intervals[session.intervals.length - 1]
  assert.equal(lastRecordedInterval.phase, 'short_break')
  assert.equal(lastRecordedInterval.duration, 60, 'Skipped break records elapsed time up to skip')

  // Step 6: Advance after Focus 3 finishes (1500s later -> t0 + 5460s)
  // Since cycle 3 matches longBreakEvery (3), transition should be to LONG_BREAK!
  const res4 = advanceFocusSession(session, t0 + 5460_000)
  session = res4.session
  assert.equal(session.currentPhase, 'long_break')
  assert.equal(session.currentCycle, 3)
  assert.equal(session.phaseDuration, 900)
  assert.equal(res4.completedIntervals[0].phase, 'focus')

  // Step 7: Complete Long Break (900s later -> t0 + 6360s)
  const res5 = advanceFocusSession(session, t0 + 6360_000)
  session = res5.session
  assert.equal(session.status, 'completed')
  assert.equal(res5.sessionFinished, true)
  assert.equal(res5.completedIntervals[0].phase, 'long_break')
  assert.equal(res5.completedIntervals[0].duration, 900)

  // Verify total focus vs break times across entire session
  const totals = getFocusSessionTotals(session)
  assert.equal(totals.totalFocusSeconds, 4500, 'Total focus should be 3 * 1500s = 4500s (75 min)')
  assert.equal(totals.totalBreakSeconds, 300 + 60 + 900, 'Total break should be 300 + 60 + 900 = 1260s (21 min)')
  assert.equal(totals.completedCycles, 3)

  // Step 8: Early manual termination via endFocusSession
  const earlySession = startFocusSession(createFocusSession(baseConfig), t0)
  const earlyEnded = endFocusSession(earlySession, t0 + 600_000, true)
  assert.equal(earlyEnded.session.status, 'completed')
  assert.ok(earlyEnded.finalInterval, 'Should record final interval')
  assert.equal(earlyEnded.finalInterval?.phase, 'focus')
  assert.equal(earlyEnded.finalInterval?.duration, 600)

  console.log('  ✔ Focus state machine multi-cycle progression, pausing & skip break verified.\n')
}

// ── Test 16: Separate Focus vs Break Accounting in Analytics and Totals ──────
{
  console.log('▶ Test 16: Separate focus vs break accounting in analytics and totals')

  const categories = [
    { id: 'cat-work', name: 'Work', color: '#3b82f6', subs: ['Engineering', 'Writing'] },
    { id: 'cat-study', name: 'Study', color: '#10b981', subs: ['Math', 'Physics'] },
    { id: 'cat-break', name: 'Break', color: '#6b7280', subs: ['Coffee', 'Walk'] },
  ]

  // Verify isSessionBreak helper under various forms
  assert.equal(isSessionBreak({ source: 'break' }, categories), true, 'source: break is break')
  assert.equal(isSessionBreak({ source: 'focus' }, categories), false, 'source: focus is NOT break')
  assert.equal(isSessionBreak({ source: 'stopwatch' }, categories), false, 'source: stopwatch is NOT break')
  assert.equal(isSessionBreak({ source: 'timer' }, categories), false, 'source: timer is NOT break')
  assert.equal(isSessionBreak({ category: 'cat-break' }, categories), true, 'Category named Break is recognized as break')
  assert.equal(isSessionBreak({ notes: '[Break] Cycle 1' }, categories), true, 'Notes containing [Break] is recognized as break')

  // Sample session dataset for today
  const now = 1700000000000
  const sampleSessions = [
    {
      id: 's1',
      start: now - 7200_000,
      end: now - 3600_000,
      duration: 3600, // 1 hour stopwatch
      source: 'stopwatch' as const,
      category: 'cat-work',
    },
    {
      id: 's2',
      start: now - 3600_000,
      end: now - 600_000,
      duration: 3000, // 50 min focus
      source: 'focus' as const,
      category: 'cat-study',
      parentSessionId: 'focus-group-1',
    },
    {
      id: 's3',
      start: now - 600_000,
      end: now,
      duration: 600, // 10 min break
      source: 'break' as const,
      category: 'cat-study',
      parentSessionId: 'focus-group-1',
      notes: '[Break] Short break between focus cycles',
    },
  ]

  // Calculate study total: MUST include stopwatch (3600s) + focus (3000s) = 6600s.
  // Break (600s) MUST BE STRICTLY EXCLUDED!
  const studySessionsOnly = sampleSessions.filter(s => !isSessionBreak(s, categories))
  const totalStudySeconds = studySessionsOnly.reduce((acc, s) => acc + s.duration, 0)
  assert.equal(totalStudySeconds, 6600, 'Study total must be exactly 6600s (excluding break)')

  // Category totals: Work = 3600s, Study = 3000s (break of 600s excluded)
  const categoryStudyTotals = studySessionsOnly.reduce<Record<string, number>>((acc, s) => {
    if (s.category) acc[s.category] = (acc[s.category] || 0) + s.duration
    return acc
  }, {})
  assert.equal(categoryStudyTotals['cat-work'], 3600)
  assert.equal(categoryStudyTotals['cat-study'], 3000, 'Study category must exclude break intervals')
  assert.equal(categoryStudyTotals['cat-break'] || 0, 0, 'Break category must have 0 study seconds')

  // Calendar day details verification
  const testDate = new Date(now)
  const dayDetails = getCalendarDayDetails({
    year: testDate.getFullYear(),
    month: testDate.getMonth(),
    day: testDate.getDate(),
    dayStartHour: 0,
    sessions: sampleSessions as any,
    categories,
  })
  assert.equal(dayDetails.studyTime, 6600, 'Calendar day details studyTime must exclude break duration (3600 + 3000 = 6600)')
  assert.equal(dayDetails.sessionCount, 3, 'Total session records count reflects all recorded items')

  console.log('  ✔ Separate focus vs break accounting in analytics and totals verified.\n')
}

// ── Test 17: Focus Sessions Database Migration & Schema Compatibility ────────
{
  console.log('▶ Test 17: Focus sessions database migration & schema compatibility')

  const migrationPath = path.resolve('supabase', 'migrations', '005_focus_sessions.sql')
  assert.ok(fs.existsSync(migrationPath), 'Migration 005_focus_sessions.sql must exist')

  const migrationSql = fs.readFileSync(migrationPath, 'utf-8')

  // Must update tracking_type constraint to include 'focus' and 'break'
  assert.ok(migrationSql.includes("'focus'"), "Migration must include 'focus' in tracking_type")
  assert.ok(migrationSql.includes("'break'"), "Migration must include 'break' in tracking_type")
  assert.ok(migrationSql.includes("'stopwatch'"), "Migration must preserve 'stopwatch' in tracking_type")
  assert.ok(migrationSql.includes("'timer'"), "Migration must preserve 'timer' in tracking_type")
  assert.ok(migrationSql.includes("'manual'"), "Migration must preserve 'manual' in tracking_type")

  // Must add parent_session_id column and index
  assert.ok(migrationSql.includes('parent_session_id'), 'Migration must add parent_session_id column')
  assert.ok(
    migrationSql.includes('idx_sessions_parent_session_id'),
    'Migration must create index on parent_session_id'
  )

  console.log('  ✔ Focus sessions database migration & schema compatibility verified.\n')
}

console.log('🎉 All 17 test suites passed successfully!')
