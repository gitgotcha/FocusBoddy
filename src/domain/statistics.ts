import type { StatisticsDayBoundary } from './models'

function startOfDay(date: Date): number {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function isoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Local-midnight boundary for the given day. */
export function dayBoundary(date: Date): StatisticsDayBoundary {
  const from = startOfDay(date)
  return { date: isoDate(date), from, to: from + 86_400_000 }
}

/**
 * Boundaries for the current ISO week (Monday..Sunday), computed in the
 * system's local timezone. Passed verbatim to Rust per design spec §6 —
 * Rust never guesses DST day buckets.
 */
export function weekBoundaries(now: Date = new Date()): StatisticsDayBoundary[] {
  // getDay(): 0=Sunday..6=Saturday → shift so Monday is index 0.
  const weekday = (now.getDay() + 6) % 7
  const monday = addDays(now, -weekday)
  return Array.from({ length: 7 }, (_, i) => dayBoundary(addDays(monday, i)))
}

/** Boundary for today (local midnight .. next local midnight). */
export function todayBoundary(now: Date = new Date()): StatisticsDayBoundary {
  return dayBoundary(now)
}

/** Boundary range covering the whole week (from Monday 00:00 to Sunday 24:00). */
export function weekRange(now: Date = new Date()): { from: number; to: number } {
  const days = weekBoundaries(now)
  return { from: days[0].from, to: days[days.length - 1].to }
}
