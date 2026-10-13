/**
 * The window math, ported from the shell script this plugin used to spawn so the
 * plugin has no `bash`/`python3` dependency. Every function takes an optional
 * `now` so a test can pin the clock instead of stubbing the global.
 */

export type Win = "rolling" | "weekly" | "monthly"

export const SHORT: Record<string, string> = { "5h": "5h", weekly: "w", monthly: "m" }

// A window opens at its reset minus its own length. The API sends only the reset
// timestamp, and the start derived this way lands in the past for all three
// windows, which is what makes the derivation checkable instead of a guess.
const WINDOW_SECONDS: Record<string, number> = { rolling: 5 * 3600, weekly: 7 * 86400 }

const DAY = 86400
const HOUR = 3600
const MINUTE = 60

function parseReset(resetsAt: string): Date {
  return new Date(resetsAt)
}

export function remaining(resetsAt: string, now: Date = new Date()): number {
  const seconds = (parseReset(resetsAt).getTime() - now.getTime()) / 1000
  return Math.max(0, Math.ceil(seconds))
}

export function humanize(secs: number): string {
  // A trailing zero unit is dropped: "5h", not "5h 0m".
  const total = Math.trunc(secs)
  const days = Math.trunc(total / DAY)
  const hours = Math.trunc((total % DAY) / HOUR)
  const mins = Math.trunc((total % HOUR) / MINUTE)
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`
  if (hours) return mins ? `${hours}h ${mins}m` : `${hours}h`
  return `${mins}m`
}

export function countdown(resetsAt: string, now: Date = new Date()): string {
  return humanize(remaining(resetsAt, now))
}

export function minusMonth(dt: Date): Date {
  const month = (dt.getUTCMonth() + 11) % 12
  const year = dt.getUTCMonth() === 0 ? dt.getUTCFullYear() - 1 : dt.getUTCFullYear()
  // Day 0 of the next month is the last day of this one: the clamp a 31st needs
  // when the month before it is shorter.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const shifted = new Date(dt.getTime())
  shifted.setUTCFullYear(year, month, Math.min(dt.getUTCDate(), lastDay))
  return shifted
}

export function windowStart(win: Win, resetsAt: string): Date {
  const reset = parseReset(resetsAt)
  if (win === "monthly") return minusMonth(reset)
  return new Date(reset.getTime() - WINDOW_SECONDS[win] * 1000)
}

export function elapsedSpan(win: Win, resetsAt: string, now: Date = new Date()): [number, number] {
  // Seconds behind us and the window's own length, for the detail view.
  const start = windowStart(win, resetsAt)
  return [(now.getTime() - start.getTime()) / 1000, (parseReset(resetsAt).getTime() - start.getTime()) / 1000]
}

export function projected(
  win: Win,
  resetsAt: string,
  percent: number,
  minElapsedPct: number,
  now: Date = new Date(),
): number | null {
  // Where this window lands at its reset if usage keeps the average pace seen
  // since it opened. Null when too little of the window is behind us: a burst
  // right after a reset would otherwise project to thousands.
  const [elapsed, total] = elapsedSpan(win, resetsAt, now)
  if (elapsed < (total * minElapsedPct) / 100) return null
  return Math.round((percent * total) / elapsed)
}
