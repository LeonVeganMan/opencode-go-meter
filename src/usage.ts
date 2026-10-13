import { homedir } from "node:os"
import type { Win } from "./windows"

export type UsageWindow = { percent: number; resetsAt: string; status: string }
// A window the endpoint did not send is simply absent, which is what the caller
// skips over; the keys are optional for that reason.
export type Usage = Partial<Record<Win, UsageWindow>>

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
const TIMEOUT_MS = 20_000
const WINDOW_KEYS: Win[] = ["rolling", "weekly", "monthly"]

function isUsageWindow(value: unknown): value is UsageWindow {
  const window = value as UsageWindow | null | undefined
  // A string that is not a date would render as "NaNm": drop the window instead.
  return (
    !!window &&
    typeof window.percent === "number" &&
    typeof window.resetsAt === "string" &&
    !Number.isNaN(Date.parse(window.resetsAt))
  )
}

// Total for `unknown`: anything that is not the payload we know becomes null, so a
// shape change degrades to the placeholder instead of crashing the render path.
export function parseUsage(raw: unknown): Usage | null {
  const sent = (raw as { usage?: Record<string, unknown> } | null | undefined)?.usage
  if (!sent || typeof sent !== "object") return null
  const usage: Usage = {}
  for (const key of WINDOW_KEYS) {
    const window = sent[key]
    if (isUsageWindow(window)) {
      usage[key] = {
        percent: window.percent,
        resetsAt: window.resetsAt,
        status: typeof window.status === "string" ? window.status : "",
      }
    }
  }
  return Object.keys(usage).length > 0 ? usage : null
}

export function authPath(): string {
  return `${homedir()}/.local/share/opencode/auth.json`
}

export async function readAuthKey(path: string = authPath()): Promise<string | null> {
  try {
    const data = (await Bun.file(path).json()) as Record<string, { key?: unknown }> | null
    const key = data?.["opencode-go"]?.key
    return typeof key === "string" && key.length > 0 ? key : null
  } catch {
    return null
  }
}

export async function fetchUsage(key: string, url: string = USAGE_URL): Promise<Usage | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "User-Agent": "opencode/2.0.26",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return null
    return parseUsage(await response.json())
  } catch {
    return null
  }
}
