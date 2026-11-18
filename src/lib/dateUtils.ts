/**
 * Date and Tracking Day Utilities for Chrono
 *
 * Implements:
 * 1. Configurable day start boundaries (00:00 to 06:00 local time)
 * 2. Logical session duration splitting across tracking boundaries
 * 3. Configurable week start (Monday vs Sunday)
 * 4. Calendar date details calculation and breakdown
 */

export type WeekStartPreference = 'monday' | 'sunday'

export type SubcategoryBreakdown = {
  name: string
  duration: number
}

export type CategoryBreakdown = {
  id: string
  name: string
  color: string
  duration: number
  subcategories: SubcategoryBreakdown[]
}

export type CalendarDayDetails = {
  fullDate: string
  dateKey: string
  totalTracked: number // seconds
  studyTime: number    // seconds (focus time excluding breaks)
  sessionCount: number
  categoryBreakdown: CategoryBreakdown[]
  isEmpty: boolean
}

/**
 * Returns a Date object set to local midnight of the tracking day that the given
 * timestamp belongs to, given the configured dayStartHour (0..6).
 *
 * For example, if dayStartHour = 4:
 * - Tuesday at 02:00 AM belongs to Monday's tracking day.
 * - Tuesday at 05:00 AM belongs to Tuesday's tracking day.
 */
export function getTrackingDate(timestamp: number, dayStartHour: number = 0): Date {
  const d = new Date(timestamp)
  const hour = d.getHours()
  if (hour < dayStartHour) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 0, 0, 0, 0)
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

/**
 * Returns 'YYYY-MM-DD' representing the tracking day for the given timestamp.
 */
export function getTrackingDateKey(timestamp: number, dayStartHour: number = 0): string {
  const d = getTrackingDate(timestamp, dayStartHour)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Returns the exact millisecond boundaries [start, end) of a tracking day.
 * @param date A Date or 'YYYY-MM-DD' string representing the tracking day
 * @param dayStartHour The configured reset hour (0..6)
 */
export function getDayBoundaryRange(date: Date | string, dayStartHour: number = 0): { start: number; end: number } {
  let y: number, m: number, d: number
  if (typeof date === 'string') {
    const parts = date.split('-').map(Number)
    y = parts[0]
    m = parts[1] - 1
    d = parts[2]
  } else {
    y = date.getFullYear()
    m = date.getMonth()
    d = date.getDate()
  }

  const start = new Date(y, m, d, dayStartHour, 0, 0, 0).getTime()
  const end = new Date(y, m, d + 1, dayStartHour, 0, 0, 0).getTime()
  return { start, end }
}

/**
 * Calculates how many seconds of a session fall within a specific time window [windowStart, windowEnd).
 * If a session crossed the day boundary, this returns only the portion in this window.
 * If the session recorded pause exclusions (duration < end - start), duration is split proportionally.
 */
export function getSessionDayOverlap(
  session: { start: number; end: number; duration?: number },
  windowStart: number,
  windowEnd: number
): number {
  if (session.start >= windowEnd || session.end <= windowStart) {
    return 0
  }

  const overlapStart = Math.max(session.start, windowStart)
  const overlapEnd = Math.min(session.end, windowEnd)
  if (overlapEnd <= overlapStart) {
    return 0
  }

  const overlapMs = overlapEnd - overlapStart
  const totalMs = session.end - session.start

  // If no duration provided or totalMs is invalid, return raw seconds
  if (typeof session.duration !== 'number' || totalMs <= 0) {
    return Math.round(overlapMs / 1000)
  }

  // If session duration matches or exceeds totalMs (no pauses)
  if (session.duration >= totalMs / 1000) {
    return Math.round(overlapMs / 1000)
  }

  // Proportionally scale active duration
  const ratio = overlapMs / totalMs
  return Math.round(session.duration * ratio)
}

/**
 * Splits a session logically across all tracking days it intersects.
 * Does NOT alter or duplicate the original session record.
 */
export function splitSessionByTrackingDays(
  session: { start: number; end: number; duration: number },
  dayStartHour: number = 0
): Array<{ dateKey: string; duration: number }> {
  if (session.duration <= 0 || session.end <= session.start) {
    return []
  }

  const startDate = getTrackingDate(session.start, dayStartHour)
  // Check the end of the session (subtract 1ms to handle boundary edges)
  const endDate = getTrackingDate(Math.max(session.start, session.end - 1), dayStartHour)

  const results: Array<{ dateKey: string; duration: number }> = []
  const current = new Date(startDate.getTime())

  while (current.getTime() <= endDate.getTime()) {
    const range = getDayBoundaryRange(current, dayStartHour)
    const overlap = getSessionDayOverlap(session, range.start, range.end)
    if (overlap > 0) {
      const y = current.getFullYear()
      const m = String(current.getMonth() + 1).padStart(2, '0')
      const d = String(current.getDate()).padStart(2, '0')
      results.push({ dateKey: `${y}-${m}-${d}`, duration: overlap })
    }
    // Next day
    current.setDate(current.getDate() + 1)
  }

  return results
}

/**
 * Returns the timestamp boundaries [start, end) of the current tracking week.
 * Respects both dayStartHour and weekStartsOn ('monday' or 'sunday').
 */
export function getWeekRange(
  timestamp: number,
  dayStartHour: number = 0,
  weekStartsOn: WeekStartPreference = 'monday'
): { start: number; end: number } {
  const tDate = getTrackingDate(timestamp, dayStartHour)
  const dayOfWeek = tDate.getDay() // 0 = Sunday, 1 = Monday, ... 6 = Saturday

  const diff = weekStartsOn === 'sunday' ? dayOfWeek : (dayOfWeek + 6) % 7
  const weekStartDate = new Date(tDate.getFullYear(), tDate.getMonth(), tDate.getDate() - diff)

  const start = new Date(
    weekStartDate.getFullYear(),
    weekStartDate.getMonth(),
    weekStartDate.getDate(),
    dayStartHour,
    0,
    0,
    0
  ).getTime()

  const end = new Date(
    weekStartDate.getFullYear(),
    weekStartDate.getMonth(),
    weekStartDate.getDate() + 7,
    dayStartHour,
    0,
    0,
    0
  ).getTime()

  return { start, end }
}

/**
 * Formats a duration in seconds into a friendly string: e.g. "5h 25m", "40m", or "0m".
 */
export function formatDurationHuman(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) {
    return `${h}h ${m}m`
  }
  return `${m}m`
}

/**
 * Determines whether a session record represents a break (not study time).
 */
export function isSessionBreak(
  session: { source?: string; category?: string; subcategory?: string; notes?: string },
  categories: Array<{ id: string; name: string }> = []
): boolean {
  if (session.source === 'break') return true
  const catObj = categories.find(c => c.id === session.category)
  const catNameLower = (catObj?.name || session.category || '').toLowerCase()
  const subLower = (session.subcategory || '').toLowerCase()
  const notesLower = (session.notes || '').toLowerCase()
  return (
    catNameLower.includes('break') ||
    subLower.includes('break') ||
    notesLower.includes('break')
  )
}

/**
 * Computes full details for a calendar date cell.
 * Respects custom day boundary, breaks exclusion, and aggregates categories & subcategories.
 */
export function getCalendarDayDetails(params: {
  year: number
  month: number // 0-indexed (0 = Jan, 11 = Dec)
  day: number   // 1-based day of month
  dayStartHour: number
  sessions: Array<{
    id: string
    start: number
    end: number
    duration: number
    category?: string
    subcategory?: string
    notes?: string
    source?: string
  }>
  categories: Array<{
    id: string
    name: string
    color: string
    subs?: string[]
  }>
}): CalendarDayDetails {
  const { year, month, day, dayStartHour, sessions, categories } = params

  const dateObj = new Date(year, month, day)
  const weekdayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()
  const monthName = dateObj.toLocaleDateString('en-US', { month: 'long' }).toUpperCase()
  const fullDate = `${weekdayName}, ${day} ${monthName}`

  const yStr = String(year)
  const mStr = String(month + 1).padStart(2, '0')
  const dStr = String(day).padStart(2, '0')
  const dateKey = `${yStr}-${mStr}-${dStr}`

  const range = getDayBoundaryRange(new Date(year, month, day), dayStartHour)

  let totalTracked = 0
  let studyTime = 0
  let sessionCount = 0

  // Category map: categoryId -> { duration, subs: Map<subName, duration> }
  const catMap = new Map<string, { duration: number; subs: Map<string, number> }>()

  for (const s of sessions) {
    const overlap = getSessionDayOverlap(s, range.start, range.end)
    if (overlap <= 0) continue

    totalTracked += overlap
    sessionCount += 1

    // Determine if session is considered a "break"
    const isBreak = isSessionBreak(s, categories)

    if (!isBreak) {
      studyTime += overlap
    }

    const catId = s.category || '__uncategorized__'
    let entry = catMap.get(catId)
    if (!entry) {
      entry = { duration: 0, subs: new Map<string, number>() }
      catMap.set(catId, entry)
    }
    entry.duration += overlap

    if (s.subcategory && s.subcategory.trim()) {
      const subName = s.subcategory.trim()
      entry.subs.set(subName, (entry.subs.get(subName) || 0) + overlap)
    }
  }

  const categoryBreakdown: CategoryBreakdown[] = []
  for (const [catId, data] of catMap.entries()) {
    let catName = 'Uncategorized'
    let catColor = '#8892A4'

    if (catId !== '__uncategorized__') {
      const found = categories.find(c => c.id === catId)
      if (found) {
        catName = found.name
        catColor = found.color
      }
    }

    const subList: SubcategoryBreakdown[] = []
    for (const [subName, subDur] of data.subs.entries()) {
      subList.push({ name: subName, duration: subDur })
    }
    subList.sort((a, b) => b.duration - a.duration)

    categoryBreakdown.push({
      id: catId,
      name: catName,
      color: catColor,
      duration: data.duration,
      subcategories: subList,
    })
  }

  categoryBreakdown.sort((a, b) => b.duration - a.duration)

  return {
    fullDate,
    dateKey,
    totalTracked,
    studyTime,
    sessionCount,
    categoryBreakdown,
    isEmpty: totalTracked === 0,
  }
}
