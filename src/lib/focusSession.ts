/**
 * Focus Session State Machine & Calculation Engine
 *
 * Implements:
 * 1. Dedicated, deterministic focus session state machine
 * 2. Multi-cycle focus and break tracking (Focus -> Short Break -> ... -> Long Break)
 * 3. Exact timestamp-based phase transitions (resilient to background tab throttling and device sleep)
 * 4. Separate accounting for focus time vs break time
 * 5. Preset configurations (Pomodoro, Deep Work, Extended Focus, Custom)
 * 6. Session recovery and persistence
 */

export type FocusPreset = 'pomodoro' | 'deep_work' | 'extended_focus' | 'custom'

export type FocusPhase = 'focus' | 'short_break' | 'long_break'

export type FocusSessionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled'

export interface FocusSessionConfig {
  preset: FocusPreset
  focusDuration: number       // Seconds (e.g. 50 * 60 = 3000)
  shortBreakDuration: number  // Seconds (e.g. 10 * 60 = 600)
  longBreakDuration: number   // Seconds (e.g. 20 * 60 = 1200)
  totalCycles: number         // Positive integer >= 1
  longBreakEvery: number      // Positive integer >= 1
  autoStartNextPhase: boolean // Default false
  soundEnabled: boolean       // Default true
}

export interface FocusIntervalRecord {
  id: string
  phase: FocusPhase
  cycle: number
  startTime: number           // Unix ms
  endTime: number             // Unix ms
  duration: number            // Elapsed duration in seconds
  completed: boolean          // Whether the phase completed its full planned time
}

export interface FocusSessionState {
  id: string                  // Unique session ID
  config: FocusSessionConfig
  status: FocusSessionStatus
  currentPhase: FocusPhase
  currentCycle: number        // 1-based (1, 2, ... totalCycles)
  phaseStartedAt: number | null // Unix ms when current phase started or resumed
  phaseElapsed: number        // Accumulated elapsed seconds in current phase before last pause
  phaseDuration: number       // Total planned duration in seconds for current phase
  category: string            // Category ID
  subcategory: string         // Subcategory name
  intervals: FocusIntervalRecord[]
  createdAt: number           // Unix ms
  completedAt?: number        // Unix ms
}

// ── Default Presets ──────────────────────────────────────────────────────────

export const FOCUS_PRESETS: Record<Exclude<FocusPreset, 'custom'>, Omit<FocusSessionConfig, 'preset' | 'autoStartNextPhase' | 'soundEnabled'>> = {
  pomodoro: {
    focusDuration: 25 * 60,
    shortBreakDuration: 5 * 60,
    longBreakDuration: 15 * 60,
    totalCycles: 4,
    longBreakEvery: 4,
  },
  deep_work: {
    focusDuration: 50 * 60,
    shortBreakDuration: 10 * 60,
    longBreakDuration: 20 * 60,
    totalCycles: 3,
    longBreakEvery: 3,
  },
  extended_focus: {
    focusDuration: 90 * 60,
    shortBreakDuration: 15 * 60,
    longBreakDuration: 25 * 60,
    totalCycles: 2,
    longBreakEvery: 2,
  },
}

export const DEFAULT_FOCUS_CONFIG: FocusSessionConfig = {
  preset: 'deep_work',
  focusDuration: 50 * 60,
  shortBreakDuration: 10 * 60,
  longBreakDuration: 20 * 60,
  totalCycles: 3,
  longBreakEvery: 3,
  autoStartNextPhase: false,
  soundEnabled: true,
}

// ── Validation & Estimation Helpers ──────────────────────────────────────────

export function validateFocusConfig(config: {
  focusMinutes?: number
  shortBreakMinutes?: number
  longBreakMinutes?: number
  totalCycles?: number
  longBreakEvery?: number
}): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (typeof config.focusMinutes === 'number') {
    if (config.focusMinutes <= 0 || !Number.isFinite(config.focusMinutes)) {
      errors.push('Focus duration must be greater than 0 minutes.')
    } else if (config.focusMinutes > 720) {
      errors.push('Focus duration cannot exceed 720 minutes (12 hours).')
    }
  }

  if (typeof config.shortBreakMinutes === 'number') {
    if (config.shortBreakMinutes <= 0 || !Number.isFinite(config.shortBreakMinutes)) {
      errors.push('Short break duration must be greater than 0 minutes.')
    } else if (config.shortBreakMinutes > 180) {
      errors.push('Short break cannot exceed 180 minutes.')
    }
  }

  if (typeof config.longBreakMinutes === 'number') {
    if (config.longBreakMinutes <= 0 || !Number.isFinite(config.longBreakMinutes)) {
      errors.push('Long break duration must be greater than 0 minutes.')
    } else if (config.longBreakMinutes > 360) {
      errors.push('Long break cannot exceed 360 minutes.')
    }
  }

  if (typeof config.totalCycles === 'number') {
    if (!Number.isInteger(config.totalCycles) || config.totalCycles < 1) {
      errors.push('Number of focus cycles must be at least 1.')
    } else if (config.totalCycles > 24) {
      errors.push('Number of focus cycles cannot exceed 24.')
    }
  }

  if (typeof config.longBreakEvery === 'number') {
    if (!Number.isInteger(config.longBreakEvery) || config.longBreakEvery < 1) {
      errors.push('Long break frequency must be at least 1.')
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Calculates estimated total focus, break, and session duration based on configuration.
 */
export function calculateEstimatedSessionDuration(config: {
  focusDuration: number
  shortBreakDuration: number
  longBreakDuration: number
  totalCycles: number
  longBreakEvery: number
}): {
  totalFocusSeconds: number
  totalBreakSeconds: number
  totalSessionSeconds: number
  shortBreakCount: number
  longBreakCount: number
} {
  const { focusDuration, shortBreakDuration, longBreakDuration, totalCycles, longBreakEvery } = config
  const totalFocusSeconds = Math.max(0, focusDuration * totalCycles)

  let shortBreakCount = 0
  let longBreakCount = 0

  for (let cycle = 1; cycle <= totalCycles; cycle++) {
    const isLastCycle = cycle === totalCycles
    const isLongBreak = (cycle % longBreakEvery === 0)

    if (isLastCycle) {
      // Per specification: do not create a break after the final focus cycle
      // UNLESS the configuration explicitly triggers a scheduled long break.
      if (isLongBreak) {
        longBreakCount++
      }
    } else {
      if (isLongBreak) {
        longBreakCount++
      } else {
        shortBreakCount++
      }
    }
  }

  const totalBreakSeconds = (shortBreakCount * shortBreakDuration) + (longBreakCount * longBreakDuration)
  const totalSessionSeconds = totalFocusSeconds + totalBreakSeconds

  return {
    totalFocusSeconds,
    totalBreakSeconds,
    totalSessionSeconds,
    shortBreakCount,
    longBreakCount,
  }
}

// ── State Machine Transitions ────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).substring(2, 10)
}

/**
 * Creates a brand new focus session in the IDLE state.
 */
export function createFocusSession(
  config: FocusSessionConfig,
  category: string = '',
  subcategory: string = ''
): FocusSessionState {
  return {
    id: `fs_${Date.now()}_${uid()}`,
    config: { ...config },
    status: 'idle',
    currentPhase: 'focus',
    currentCycle: 1,
    phaseStartedAt: null,
    phaseElapsed: 0,
    phaseDuration: config.focusDuration,
    category,
    subcategory,
    intervals: [],
    createdAt: Date.now(),
  }
}

/**
 * Starts or transitions an idle session to RUNNING.
 */
export function startFocusSession(session: FocusSessionState, now: number = Date.now()): FocusSessionState {
  return {
    ...session,
    status: 'running',
    phaseStartedAt: now,
  }
}

/**
 * Pauses a currently running focus session, recording accumulated phase time without counting paused time.
 */
export function pauseFocusSession(session: FocusSessionState, now: number = Date.now()): FocusSessionState {
  if (session.status !== 'running' || session.phaseStartedAt === null) {
    return session
  }
  const delta = Math.max(0, (now - session.phaseStartedAt) / 1000)
  return {
    ...session,
    status: 'paused',
    phaseStartedAt: null,
    phaseElapsed: session.phaseElapsed + delta,
  }
}

/**
 * Resumes a paused focus session with an exact new timestamp.
 */
export function resumeFocusSession(session: FocusSessionState, now: number = Date.now()): FocusSessionState {
  if (session.status !== 'paused') {
    return session
  }
  return {
    ...session,
    status: 'running',
    phaseStartedAt: now,
  }
}

/**
 * Computes remaining seconds in the current phase from timestamps.
 */
export function getPhaseRemainingTime(session: FocusSessionState, now: number = Date.now()): number {
  if (session.status === 'completed' || session.status === 'cancelled') {
    return 0
  }
  let currentElapsed = session.phaseElapsed
  if (session.status === 'running' && session.phaseStartedAt !== null) {
    currentElapsed += Math.max(0, (now - session.phaseStartedAt) / 1000)
  }
  return Math.max(0, session.phaseDuration - currentElapsed)
}

/**
 * Determines the next phase and cycle following a completed phase.
 */
export function getNextPhaseInfo(
  currentPhase: FocusPhase,
  currentCycle: number,
  config: FocusSessionConfig
): { nextPhase: FocusPhase; nextCycle: number; isCompleted: boolean } {
  if (currentPhase === 'focus') {
    const isLastCycle = currentCycle >= config.totalCycles
    const isLongBreak = (currentCycle % config.longBreakEvery === 0)

    if (isLastCycle) {
      if (isLongBreak) {
        return { nextPhase: 'long_break', nextCycle: currentCycle, isCompleted: false }
      }
      return { nextPhase: 'focus', nextCycle: currentCycle, isCompleted: true }
    }

    if (isLongBreak) {
      return { nextPhase: 'long_break', nextCycle: currentCycle, isCompleted: false }
    }
    return { nextPhase: 'short_break', nextCycle: currentCycle, isCompleted: false }
  }

  // After short_break or long_break: advance to next focus cycle
  const nextCycle = currentCycle + 1
  if (nextCycle > config.totalCycles) {
    return { nextPhase: 'focus', nextCycle: config.totalCycles, isCompleted: true }
  }
  return { nextPhase: 'focus', nextCycle, isCompleted: false }
}

/**
 * Gets the planned duration in seconds for a specific phase.
 */
export function getPlannedDurationForPhase(phase: FocusPhase, config: FocusSessionConfig): number {
  switch (phase) {
    case 'focus':
      return config.focusDuration
    case 'short_break':
      return config.shortBreakDuration
    case 'long_break':
      return config.longBreakDuration
  }
}

export interface AdvanceResult {
  session: FocusSessionState
  phaseTransitioned?: {
    fromPhase: FocusPhase
    toPhase: FocusPhase
    cycle: number
    completedInterval: FocusIntervalRecord
  }
  sessionFinished?: boolean
  completedIntervals: FocusIntervalRecord[]
}

/**
 * Pure, deterministic engine transition.
 * Handles background tab throttling, device sleep, and multiple elapsed intervals without time drift.
 */
export function advanceFocusSession(session: FocusSessionState, now: number = Date.now()): AdvanceResult {
  if (session.status !== 'running' || session.phaseStartedAt === null) {
    return { session, completedIntervals: [] }
  }

  const initialElapsed = session.phaseElapsed + Math.max(0, (now - session.phaseStartedAt) / 1000)
  if (initialElapsed < session.phaseDuration) {
    return { session, completedIntervals: [] }
  }

  let current = { ...session, intervals: [...session.intervals] }
  const completedIntervals: FocusIntervalRecord[] = []
  let lastTransition: AdvanceResult['phaseTransitioned'] | undefined

  // While current phase has elapsed, transition sequentially
  while (current.status === 'running' && current.phaseStartedAt !== null) {
    const elapsedSoFar = current.phaseElapsed + Math.max(0, (now - current.phaseStartedAt) / 1000)

    if (elapsedSoFar < current.phaseDuration) {
      // Still in current phase
      break
    }

    // Current phase finished! Calculate exact timestamps
    const phaseStartMs = current.phaseStartedAt - (current.phaseElapsed * 1000)
    const phaseEndMs = phaseStartMs + (current.phaseDuration * 1000)

    const completedInterval: FocusIntervalRecord = {
      id: `int_${phaseStartMs}_${uid()}`,
      phase: current.currentPhase,
      cycle: current.currentCycle,
      startTime: phaseStartMs,
      endTime: phaseEndMs,
      duration: current.phaseDuration,
      completed: true,
    }

    current.intervals.push(completedInterval)
    completedIntervals.push(completedInterval)

    const nextInfo = getNextPhaseInfo(current.currentPhase, current.currentCycle, current.config)

    lastTransition = {
      fromPhase: current.currentPhase,
      toPhase: nextInfo.nextPhase,
      cycle: current.currentCycle,
      completedInterval,
    }

    if (nextInfo.isCompleted) {
      current.status = 'completed'
      current.phaseStartedAt = null
      current.phaseElapsed = current.phaseDuration
      current.completedAt = phaseEndMs
      return {
        session: current,
        phaseTransitioned: lastTransition,
        sessionFinished: true,
        completedIntervals,
      }
    }

    // Set up next phase
    const nextPhaseDuration = getPlannedDurationForPhase(nextInfo.nextPhase, current.config)
    current.currentPhase = nextInfo.nextPhase
    current.currentCycle = nextInfo.nextCycle
    current.phaseDuration = nextPhaseDuration
    current.phaseElapsed = 0

    if (current.config.autoStartNextPhase) {
      // Automatically advance start time to previous end time
      current.phaseStartedAt = phaseEndMs
      // Continue loop if `now` exceeds this new phase as well
    } else {
      // Pause and wait for user to explicitly start the next phase
      current.status = 'paused'
      current.phaseStartedAt = null
      current.phaseElapsed = 0
      break
    }
  }

  return {
    session: current,
    phaseTransitioned: lastTransition,
    sessionFinished: current.status === 'completed',
    completedIntervals,
  }
}

/**
 * Skips the active break phase early and immediately transitions to the next focus cycle.
 * The actual elapsed break duration is recorded.
 */
export function skipBreak(session: FocusSessionState, now: number = Date.now()): FocusSessionState {
  if (session.currentPhase === 'focus' || session.status === 'completed' || session.status === 'cancelled') {
    return session
  }

  // Calculate actual elapsed break duration
  let actualElapsed = session.phaseElapsed
  if (session.status === 'running' && session.phaseStartedAt !== null) {
    actualElapsed += Math.max(0, (now - session.phaseStartedAt) / 1000)
  }
  const roundedDuration = Math.max(1, Math.round(actualElapsed))

  const startTime = session.phaseStartedAt
    ? session.phaseStartedAt - (session.phaseElapsed * 1000)
    : now - (actualElapsed * 1000)

  const breakInterval: FocusIntervalRecord = {
    id: `int_${startTime}_${uid()}`,
    phase: session.currentPhase,
    cycle: session.currentCycle,
    startTime,
    endTime: now,
    duration: roundedDuration,
    completed: false, // skipped early
  }

  const updatedIntervals = [...session.intervals, breakInterval]
  const nextInfo = getNextPhaseInfo(session.currentPhase, session.currentCycle, session.config)

  if (nextInfo.isCompleted) {
    return {
      ...session,
      status: 'completed',
      intervals: updatedIntervals,
      phaseStartedAt: null,
      phaseElapsed: 0,
      completedAt: now,
    }
  }

  const nextPhaseDuration = getPlannedDurationForPhase(nextInfo.nextPhase, session.config)
  return {
    ...session,
    status: session.status === 'running' ? 'running' : 'paused',
    currentPhase: nextInfo.nextPhase,
    currentCycle: nextInfo.nextCycle,
    phaseStartedAt: session.status === 'running' ? now : null,
    phaseElapsed: 0,
    phaseDuration: nextPhaseDuration,
    intervals: updatedIntervals,
  }
}

/**
 * Ends a focus session immediately (user ends early).
 * Any active interval in progress is recorded with its actual elapsed duration.
 */
export function endFocusSession(
  session: FocusSessionState,
  now: number = Date.now(),
  markCompleted: boolean = true
): { session: FocusSessionState; finalInterval?: FocusIntervalRecord } {
  if (session.status === 'completed' || session.status === 'cancelled') {
    return { session }
  }

  let actualElapsed = session.phaseElapsed
  if (session.status === 'running' && session.phaseStartedAt !== null) {
    actualElapsed += Math.max(0, (now - session.phaseStartedAt) / 1000)
  }

  let finalInterval: FocusIntervalRecord | undefined
  const updatedIntervals = [...session.intervals]

  if (actualElapsed >= 5) {
    // Record interval if at least 5 seconds of tracking took place
    const roundedDuration = Math.round(actualElapsed)
    const startTime = session.phaseStartedAt
      ? session.phaseStartedAt - (session.phaseElapsed * 1000)
      : now - (actualElapsed * 1000)

    finalInterval = {
      id: `int_${startTime}_${uid()}`,
      phase: session.currentPhase,
      cycle: session.currentCycle,
      startTime,
      endTime: now,
      duration: roundedDuration,
      completed: actualElapsed >= session.phaseDuration,
    }
    updatedIntervals.push(finalInterval)
  }

  const completedSession: FocusSessionState = {
    ...session,
    status: markCompleted ? 'completed' : 'cancelled',
    phaseStartedAt: null,
    phaseElapsed: actualElapsed,
    intervals: updatedIntervals,
    completedAt: now,
  }

  return { session: completedSession, finalInterval }
}

/**
 * Returns focus and break totals for a session.
 */
export function getFocusSessionTotals(session: FocusSessionState): {
  totalFocusSeconds: number
  totalBreakSeconds: number
  completedCycles: number
} {
  let totalFocusSeconds = 0
  let totalBreakSeconds = 0
  const completedFocusCycles = new Set<number>()

  for (const int of session.intervals) {
    if (int.phase === 'focus') {
      totalFocusSeconds += int.duration
      if (int.completed) {
        completedFocusCycles.add(int.cycle)
      }
    } else {
      totalBreakSeconds += int.duration
    }
  }

  return {
    totalFocusSeconds,
    totalBreakSeconds,
    completedCycles: completedFocusCycles.size,
  }
}
