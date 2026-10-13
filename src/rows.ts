import { countdown, elapsedSpan, humanize, projected, remaining } from "./windows"
import type { Win } from "./windows"
import type { Usage } from "./usage"

export type Row = {
  label: string
  percent: number
  reset: string
  remaining: number
  projected: number
  span: string
}

// The order the sidebar lists the windows in, which is the order the API names them.
export const WINDOWS: { label: string; key: Win }[] = [
  { label: "5h", key: "rolling" },
  { label: "weekly", key: "weekly" },
  { label: "monthly", key: "monthly" },
]

// Below this much of the window elapsed a projection is noise, not signal.
const MIN_ELAPSED_PCT = 5

export function buildRows(usage: Usage, now: Date = new Date()): Row[] {
  const rows: Row[] = []
  for (const { label, key } of WINDOWS) {
    const usageWindow = usage[key]
    if (!usageWindow) continue
    const [elapsed, total] = elapsedSpan(key, usageWindow.resetsAt, now)
    rows.push({
      label,
      percent: usageWindow.percent,
      reset: countdown(usageWindow.resetsAt, now),
      remaining: remaining(usageWindow.resetsAt, now),
      projected: projected(key, usageWindow.resetsAt, usageWindow.percent, MIN_ELAPSED_PCT, now) ?? 0,
      span: `${humanize(elapsed)} of ${humanize(total)}`,
    })
  }
  return rows
}
