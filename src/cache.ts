// Cache-hit figures for the sidebar. The percentage is per assistant message,
// not cumulative: it is the share of the prompt that came from the cache on the
// last turn, with the previous turn as the trend reference.

export type CacheTokens = {
  input?: number
  cache?: { read?: number; write?: number }
}

export type CacheHit = {
  hit: number
  trend?: number
  total?: number
}

function rate(tokens: CacheTokens | undefined): number | undefined {
  if (!tokens) return undefined
  const input = tokens.input ?? 0
  const read = tokens.cache?.read ?? 0
  const write = tokens.cache?.write ?? 0
  const total = input + read + write
  return total > 0 ? (read / total) * 100 : undefined
}

// Same revert boundary as read() in tui.tsx: messages at or after the reverted
// one are not part of the current context. The two most recent rates give the
// value and the trend; one rate alone has no trend.
export function cacheHit(
  messages: Array<{ id?: string; type?: string; role?: string; tokens?: CacheTokens }>,
  sessionTokens?: CacheTokens,
  revertID?: string,
): CacheHit | undefined {
  const stop = revertID ? messages.findIndex((message) => message.id === revertID) : -1
  const rates: number[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    if (stop >= 0 && i >= stop) continue
    const message = messages[i]
    if ((message.type ?? message.role) !== "assistant") continue
    const value = rate(message.tokens)
    if (value !== undefined) rates.push(value)
    if (rates.length === 2) break
  }
  if (rates.length === 0) return undefined
  return {
    hit: rates[0],
    trend: rates.length > 1 ? rates[0] - rates[1] : undefined,
    total: rate(sessionTokens),
  }
}

// One decimal, floored like the token-cache row: 98.59% reads 98.5%, not 98.6%.
export function cachePercent(value: number): string {
  return (Math.floor(value * 10) / 10).toFixed(1) + "%"
}

// A delta smaller than 0.05 is noise: the row shows "-" rather than an arrow.
export function cacheTrend(value: number | undefined): string {
  if (value === undefined || Math.abs(value) < 0.05) return "-"
  return (value > 0 ? "\u2191" : "\u2193") + Math.abs(value).toFixed(1) + "%"
}

// The sidebar slot reports only the session id, not its width. The host gives it
// roughly a third of the terminal, so that is the budget used to decide whether
// the session total fits after the trend. Row: label, bar, " 98.5%", " ↓0.9%",
// " · 84.7%".
export function totalFits(terminalWidth: number, cells: number, hasTrend: boolean): boolean {
  const sidebar = Math.floor(terminalWidth * 0.3)
  const row = 8 + cells + 6 + (hasTrend ? 6 : 0) + 8
  return sidebar >= row
}
