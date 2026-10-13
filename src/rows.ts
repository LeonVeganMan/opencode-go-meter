import { countdown, elapsedSpan, humanize, projected, remaining } from "./windows"
import type { Win } from "./windows"
import type { Usage } from "./usage"
import type { Config } from "./config"

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

export function buildRows(usage: Usage, cfg: Config, now: Date = new Date()): Row[] {
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
      projected: projected(key, usageWindow.resetsAt, usageWindow.percent, cfg.projectionMinElapsed, now) ?? 0,
      span: `${humanize(elapsed)} of ${humanize(total)}`,
    })
  }
  return rows
}

// "projection" puts the window closest to saturating first. The sort is stable,
// so windows that forecast the same land keep the order WINDOWS lists them in.
export function orderRows(rows: Row[], order: Config["order"]): Row[] {
  if (order === "fixed") return [...rows]
  return [...rows].sort((a, b) => b.projected - a.projected)
}
