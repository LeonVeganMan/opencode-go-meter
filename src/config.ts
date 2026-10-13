// The plugin's options. Every value is one a person can reach from the panel, so
// this module also owns the single interaction the panel has: cycle a value.
// A missing key means the default, which is why the file may be absent, empty or
// half-written, and a hand edit is exactly as valid as a click.

export type Glyph = "blocks" | "ascii"

export type Config = {
  sidebar: boolean
  footer: boolean
  autoOpen: boolean
  autoOpenAt: number
  autoOpenWindows: string[]
  thresholds: { warning: number; error: number }
  bar: { cells: number; glyphs: Glyph }
  columns: { percent: boolean; tokens: boolean; cost: boolean; reset: boolean; flag: boolean }
  order: "fixed" | "projection"
  accentLabels: boolean
  refresh: { contextMs: number; planMs: number }
  projectionMinElapsed: number
}

export const WINDOW_LABELS = ["5h", "weekly", "monthly"]

export const DEFAULTS: Config = {
  sidebar: true,
  footer: true,
  autoOpen: true,
  autoOpenAt: 100,
  autoOpenWindows: [...WINDOW_LABELS],
  thresholds: { warning: 75, error: 90 },
  bar: { cells: 8, glyphs: "blocks" },
  columns: { percent: true, tokens: true, cost: true, reset: true, flag: true },
  order: "fixed",
  accentLabels: true,
  refresh: { contextMs: 3_000, planMs: 60_000 },
  projectionMinElapsed: 5,
}

// The schema is walked leaf by leaf rather than deep-merged: a wrong type in the
// file falls back to the default instead of reaching a rendered string as NaN.
function pickBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function pickNum(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function pickOne<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function pickWindows(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULTS.autoOpenWindows]
  const kept = WINDOW_LABELS.filter((label) => value.includes(label))
  return kept.length ? kept : [...DEFAULTS.autoOpenWindows]
}

function pickColumns(raw: any): Config["columns"] {
  return {
    percent: pickBool(raw?.percent, DEFAULTS.columns.percent),
    tokens: pickBool(raw?.tokens, DEFAULTS.columns.tokens),
    cost: pickBool(raw?.cost, DEFAULTS.columns.cost),
    reset: pickBool(raw?.reset, DEFAULTS.columns.reset),
    flag: pickBool(raw?.flag, DEFAULTS.columns.flag),
  }
}

export function mergeConfig(raw: unknown): Config {
  const file = (raw ?? {}) as Record<string, any>
  return {
    sidebar: pickBool(file.sidebar, DEFAULTS.sidebar),
    footer: pickBool(file.footer, DEFAULTS.footer),
    autoOpen: pickBool(file.autoOpen, DEFAULTS.autoOpen),
    autoOpenAt: pickNum(file.autoOpenAt, DEFAULTS.autoOpenAt, 0, 100),
    autoOpenWindows: pickWindows(file.autoOpenWindows),
    thresholds: {
      warning: pickNum(file.thresholds?.warning, DEFAULTS.thresholds.warning, 0, 100),
      error: pickNum(file.thresholds?.error, DEFAULTS.thresholds.error, 0, 100),
    },
    bar: {
      cells: pickNum(file.bar?.cells, DEFAULTS.bar.cells, 1, 16),
      glyphs: pickOne<Glyph>(file.bar?.glyphs, ["blocks", "ascii"], DEFAULTS.bar.glyphs),
    },
    columns: pickColumns(file.columns),
    order: pickOne(file.order, ["fixed", "projection"], DEFAULTS.order),
    accentLabels: pickBool(file.accentLabels, DEFAULTS.accentLabels),
    refresh: {
      contextMs: pickNum(file.refresh?.contextMs, DEFAULTS.refresh.contextMs, 1_000, 60_000),
      planMs: pickNum(file.refresh?.planMs, DEFAULTS.refresh.planMs, 1_000, 3_600_000),
    },
    projectionMinElapsed: pickNum(file.projectionMinElapsed, DEFAULTS.projectionMinElapsed, 0, 50),
  }
}

function toggle(value: boolean): boolean {
  return !value
}

function wrap(value: number, step: number, min: number, max: number): number {
  const next = value + step
  return next > max ? min : next
}

// Numeric options step rather than type in: the panel is clicked, not edited.
const STEPS: Record<string, { step: number; min: number; max: number }> = {
  autoOpenAt: { step: 5, min: 0, max: 100 },
  "refresh.contextMs": { step: 1_000, min: 1_000, max: 60_000 },
  "refresh.planMs": { step: 30_000, min: 1_000, max: 3_600_000 },
  projectionMinElapsed: { step: 5, min: 0, max: 50 },
}

export function cycleOption(cfg: Config, key: string): Config {
  const next: Config = {
    ...cfg,
    autoOpenWindows: [...cfg.autoOpenWindows],
    thresholds: { ...cfg.thresholds },
    bar: { ...cfg.bar },
    columns: { ...cfg.columns },
    refresh: { ...cfg.refresh },
  }

  // One row per window label, so the click is always "cycle this value".
  if (key.startsWith("autoOpenWindows.")) {
    const label = key.slice("autoOpenWindows.".length)
    if (!WINDOW_LABELS.includes(label)) return cfg
    const on = next.autoOpenWindows.includes(label)
    // Never empty: a config that alerts on nothing is a trap, not an option.
    if (on && next.autoOpenWindows.length === 1) return cfg
    next.autoOpenWindows = on
      ? next.autoOpenWindows.filter((entry) => entry !== label)
      : WINDOW_LABELS.filter((entry) => next.autoOpenWindows.includes(entry) || entry === label)
    return next
  }

  if (key.startsWith("columns.")) {
    const column = key.slice("columns.".length) as keyof Config["columns"]
    if (!(column in next.columns)) return cfg
    next.columns[column] = toggle(next.columns[column])
    return next
  }

  const step = STEPS[key]
  if (step) {
    const [group, leaf] = key.split(".") as [keyof Config, string]
    if (leaf) {
      const current = (next[group] as Record<string, number>)[leaf]
      ;(next[group] as Record<string, number>)[leaf] = wrap(current, step.step, step.min, step.max)
    } else {
      ;(next as Record<string, any>)[key] = wrap(next[key] as number, step.step, step.min, step.max)
    }
    return next
  }

  switch (key) {
    case "sidebar":
      next.sidebar = toggle(next.sidebar)
      return next
    case "footer":
      next.footer = toggle(next.footer)
      return next
    case "autoOpen":
      next.autoOpen = toggle(next.autoOpen)
      return next
    case "accentLabels":
      next.accentLabels = toggle(next.accentLabels)
      return next
    case "bar.cells":
      next.bar.cells = wrap(next.bar.cells, 1, 1, 16)
      return next
    case "bar.glyphs":
      next.bar.glyphs = next.bar.glyphs === "blocks" ? "ascii" : "blocks"
      return next
    case "order":
      next.order = next.order === "fixed" ? "projection" : "fixed"
      return next
    case "thresholds.warning":
      next.thresholds.warning = wrap(next.thresholds.warning, 5, 0, 100)
      return next
    case "thresholds.error":
      next.thresholds.error = wrap(next.thresholds.error, 5, 0, 100)
      return next
    default:
      return cfg
  }
}

export function optionKeys(cfg: Config): string[] {
  return [
    "sidebar",
    "footer",
    "autoOpen",
    "autoOpenAt",
    "order",
    "accentLabels",
    "bar.cells",
    "bar.glyphs",
    "thresholds.warning",
    "thresholds.error",
    "columns.percent",
    "columns.tokens",
    "columns.cost",
    "columns.reset",
    "columns.flag",
    "refresh.contextMs",
    "refresh.planMs",
    "projectionMinElapsed",
    ...WINDOW_LABELS.filter((label) => cfg.autoOpenWindows.includes(label)).map((label) => `autoOpenWindows.${label}`),
  ]
}

// Beside the plugin entry, wherever the repo is cloned. src/config.ts is one
// directory below it.
export function configPath(): string {
  return new URL("../config.json", import.meta.url).pathname
}

export async function loadConfig(path: string = configPath()): Promise<Config> {
  try {
    return mergeConfig(await Bun.file(path).json())
  } catch {
    return mergeConfig(null)
  }
}

export async function saveConfig(cfg: Config, path: string = configPath()): Promise<void> {
  try {
    await Bun.write(path, JSON.stringify(cfg, null, 2) + "\n")
  } catch {
    // A config that cannot be written still leaves the running session correct.
  }
}

// Whether the plan figures are worth fetching at all: something has to be able to
// show them, or to announce them. Both views off with no dialog means the endpoint
// is never called.
export function pollingNeeded(cfg: Config): boolean {
  return cfg.sidebar || cfg.footer || cfg.autoOpen
}

// The widest key optionKeys() produces is autoOpenWindows.monthly, 23 characters:
// padding to that keeps one column of values for every row, including that one.
const LABEL_COLUMN = 23

// What the panel shows for a key, and what a click on it will therefore change. A
// boolean reads as on/off, everything else as its own value.
export function optionLabel(cfg: Config, key: string): string {
  return key.padEnd(LABEL_COLUMN) + optionValue(cfg, key)
}

function optionValue(cfg: Config, key: string): string {
  if (key.startsWith("autoOpenWindows.")) {
    return cfg.autoOpenWindows.includes(key.slice("autoOpenWindows.".length)) ? "on" : "off"
  }
  if (key.startsWith("columns.")) {
    return cfg.columns[key.slice("columns.".length) as keyof Config["columns"]] ? "on" : "off"
  }
  if (key === "bar.glyphs") return cfg.bar.glyphs
  if (key === "order") return cfg.order
  const [group, leaf] = key.split(".")
  if (group === "bar" || group === "thresholds" || group === "refresh") {
    return String((cfg[group] as Record<string, unknown>)[leaf])
  }
  const value = (cfg as unknown as Record<string, unknown>)[key]
  return typeof value === "boolean" ? (value ? "on" : "off") : String(value)
}
