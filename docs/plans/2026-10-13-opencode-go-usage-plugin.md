# opencode-go-usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the private `context-bar` TUI plugin into a publishable `opencode-go-usage` plugin: no bash/python sidecar, an in-plugin options panel, and a repo a cloner can install.

**Architecture:** The plugin currently renders two slots (sidebar block, prompt footer) plus a detail dialog, and gets its data by spawning `bash ~/.config/opencode/scripts/go-usage.sh --tui`. This plan inverts that: the plugin reads `auth.json`, calls the usage endpoint itself, and computes the window math in TypeScript. Pure logic (window math, response parsing, row assembly, config merge/cycle) lives in dependency-free `src/*.ts` modules tested with `bun test`; `tui.tsx` keeps rendering and wiring only, because it cannot be imported by a test (solid-js and `@opencode/plugin/tui` are host-provided and unresolvable outside the opencode process).

**Tech Stack:** TypeScript on the Bun runtime (Bun ≥ 1.3, `bun test`). `solid-js` and `@opencode/plugin/tui` are peer dependencies supplied by the opencode host — never added to `dependencies`. No runtime dependency is added by this plan; `python3` and `bash` are removed from the plugin's path.

**Spec:** the agreed design lives in this plan's "Global Constraints" and Task 1–7 Interfaces (originally agreed in chat; the config schema below is copied verbatim from that agreement).

## Global Constraints

- Language: TypeScript. All identifiers, comments and docs in English.
- Runtime deps: none added. `solid-js`, `@opencode/plugin/tui` are peer deps imported for side-effect-free typing only.
- Tests: `bun test`, files under `tests/`, importing the pure modules from `src/`. No python, no shell spawned by the plugin.
- `package.json`: `{ "name": "opencode-go-usage", "version": "1.0.0", "type": "module", "exports": { "./tui": "./tui.tsx" } }`. The `./tui` export is what the opencode loader resolves.
- Plugin folder and `Plugin.define({ id })`: folder `opencode-go-usage`, id `go-usage`.
- Config file: `config.json` **beside the plugin entry**, resolved from the module's own URL — never an absolute `~/.config/...` path. Missing key = default. Re-read on every refresh; no restart applies a change.
- Config schema (exact keys; anything absent means the value shown):
  ```jsonc
  {
    "sidebar": true,          // sidebar block
    "footer": true,           // prompt footer block
    "autoOpen": true,         // dialog opens by itself on a new alert
    "autoOpenAt": 100,        // projected % that triggers the alert
    "autoOpenWindows": ["5h", "weekly", "monthly"],
    "thresholds": { "warning": 75, "error": 90 },
    "bar": { "cells": 8, "glyphs": "blocks" },   // "blocks" | "ascii"
    "columns": { "percent": true, "tokens": true, "cost": true, "reset": true, "flag": true },
    "order": "fixed",         // "fixed" | "projection"
    "accentLabels": true,
    "refresh": { "contextMs": 3000, "planMs": 60000 },
    "projectionMinElapsed": 5
  }
  ```
- Window labels are `5h`, `weekly`, `monthly`; API keys are `rolling`, `weekly`, `monthly`. `autoOpenWindows` and `order` speak labels.
- API: `GET https://opencode.ai/zen/go/v1/usage`, headers `Authorization: Bearer <key>`, `Accept: application/json`, `User-Agent: opencode/2.0.26` (unchanged from the script, so behaviour is byte-identical). Key at `~/.local/share/opencode/auth.json` → `["opencode-go"]["key"]`. Response: `{"usage": {"rolling"|"weekly"|"monthly": {"status": string, "percent": number, "resetsAt": ISO8601}}}`.
- Window math stays bit-for-bit equivalent to the script being replaced: `rolling` is `reset - 5h`, `weekly` is `reset - 7d`, `monthly` is `reset - 1 calendar month` (day clamped, year may cross). Projection is `round(percent * total / elapsed)`, suppressed when less than `projectionMinElapsed`% of the window has elapsed.
- The user's own `/go-usage` command and `~/.config/opencode/scripts/go-usage.sh` are NOT part of this repo and are NOT deleted; the plugin simply stops calling the script.
- Never break the sidebar width contract: the sidebar is 42 columns and one row is `label(8) + bar + percent + optional runs`. A row that grows past 42 wraps (visible bug).

## Review Focus

Five input classes the design implies but no happy-path test covers; each is pinned to a test in the task that owns the code.

1. `auth.json` absent, unreadable, missing `opencode-go`, or the endpoint returning non-JSON/non-200 → the plugin shows the `plan   n/a` placeholder and the last known rows, never throws inside the render path, never hammers the endpoint. (Task 2)
2. A hand-edited `config.json` with wrong types — `"cells": "8"`, `"thresholds": {"warning": "x"}`, `"columns": null`, `[1,2]` where an object belongs → the merge coerces or falls back, so no `NaN`/`undefined` reaches a rendered string. (Task 3)
3. `resetsAt` in the past, or a derived window start in the future (clock skew) → `projected` returns `null` and `elapsed` is never negative, so no absurd projection. (Task 1, ported cases)
4. Both views off and `autoOpen` off → the plugin stops polling entirely; re-enabling a view at runtime re-registers its slot (a registered slot that renders nothing still leaves a visible empty row). (Task 5)
5. A `percent` of `100` must not raise the alert (`projected > autoOpenAt`, not `>=`), and a window that resets and later re-alerts is announced again while a continuing alert is not repeated. (Task 5)

---

## File Structure

```
~/.config/opencode/plugins/opencode-go-usage/   (renamed from context-bar/)
├── package.json          # name, version, exports ./tui
├── tui.tsx               # entry: slots, components, wiring. No pure logic left.
├── src/
│   ├── windows.ts        # window math: remaining, humanize, countdown, minusMonth,
│   │                     #   windowStart, elapsedSpan, projected, WINDOW_SECONDS
│   ├── usage.ts          # readAuthKey, parseUsage (pure), fetchUsage
│   ├── config.ts         # Config type, DEFAULTS, mergeConfig, cycleOption,
│   │                     #   configPath, loadConfig, saveConfig
│   └── rows.ts           # buildRows(usage, cfg, now) -> Row[]
├── settings.tsx          # the options panel component
├── tests/                # bun test
│   ├── windows.test.ts   # the 10 ported projection cases + humanize cases
│   ├── usage.test.ts     # parseUsage on real/near-miss payloads
│   ├── config.test.ts    # merge, clamps, cycle
│   └── rows.test.ts      # row assembly, order, column suppression
├── README.md
├── LICENSE               # MIT
└── docs/plans/2026-10-13-opencode-go-usage-plugin.md   # this file
```

---

### Task 1: Rename the plugin and port the window math to `src/windows.ts`

**Files:**
- Move: `~/.config/opencode/plugins/context-bar/` → `~/.config/opencode/plugins/opencode-go-usage/`
- Create: `src/windows.ts`, `tests/windows.test.ts`
- Modify: `tui.tsx` (id, and the plan-row helpers below)

**Interfaces:**
- Produces:
  ```ts
  export type Win = "rolling" | "weekly" | "monthly"
  export const SHORT: Record<string, string>              // { "5h": "5h", weekly: "w", monthly: "m" }
  export function remaining(iso: string, now?: Date): number          // ceil seconds, floor 0
  export function humanize(secs: number): string                      // "3d" | "3d 4h" | "1h 5m" | "5m" | "0m"
  export function countdown(iso: string, now?: Date): string          // humanize(remaining(iso, now))
  export function minusMonth(dt: Date): Date
  export function windowStart(win: Win, resetsAt: string): Date
  export function elapsedSpan(win: Win, resetsAt: string, now?: Date): [number, number]  // [elapsed, total]
  export function projected(win: Win, resetsAt: string, percent: number, minElapsedPct: number, now?: Date): number | null
  ```
  `now` defaults to `new Date()`; it exists so tests pin the clock instead of stubbing the global.

- [ ] **Step 1: Rename the folder and the plugin id**

```bash
mv ~/.config/opencode/plugins/context-bar ~/.config/opencode/plugins/opencode-go-usage
cd ~/.config/opencode/plugins/opencode-go-usage && git init
```
The folder is not a git repository yet, so `git init` belongs to the first task that commits (every later task commits into it). Change `Plugin.define({ id: "context-bar"` to `id: "go-usage"`. Leave every `~/.config/opencode/plugins/context-bar/...` string alone for now except the `CONFIG` constant, which task 3 rewrites.

- [ ] **Step 2: Write the failing test**

`tests/windows.test.ts` — the ten cases ported from the deleted python harness `/tmp/opencode/gousage-proj.test.py`, plus `humanize`:

```ts
import { test, expect } from "bun:test"
import { remaining, humanize, countdown, minusMonth, elapsedSpan, projected } from "../src/windows"

const at = (s: string) => new Date(s)
test("monthly mid-window", () => {
  expect(projected("monthly", "2026-11-10T00:00:00Z", 33, 5, at("2026-10-21T00:00:00Z"))).toBe(93)
})
test("monthly extrapolates past the limit", () => {
  expect(projected("monthly", "2026-11-10T00:00:00Z", 40, 5, at("2026-10-21T00:00:00Z"))).toBe(113)
})
test("monthly too young to mean anything", () => {
  expect(projected("monthly", "2026-11-10T00:00:00Z", 33, 5, at("2026-10-11T00:00:00Z"))).toBe(null)
})
test("window start in the future", () => {
  expect(projected("monthly", "2026-11-10T00:00:00Z", 33, 5, at("2026-10-01T00:00:00Z"))).toBe(null)
})
test("minusMonth clamps the day", () => {
  expect(minusMonth(new Date("2026-05-31T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-04-30")
})
test("minusMonth crosses the year", () => {
  expect(minusMonth(new Date("2026-01-15T00:00:00Z")).toISOString().slice(0, 10)).toBe("2025-12-15")
})
test("half the rolling window is exactly at the limit", () => {
  expect(projected("rolling", "2026-01-01T05:00:00Z", 50, 5, at("2026-01-01T02:30:00Z"))).toBe(100)
})
test("just over half flags", () => {
  expect(projected("rolling", "2026-01-01T05:00:00Z", 51, 5, at("2026-01-01T02:30:00Z"))).toBe(102)
})
test("weekly guard boundary", () => {
  expect(projected("weekly", "2026-01-08T00:00:00Z", 10, 5, at("2026-01-01T08:00:00Z"))).toBe(null)
  expect(projected("weekly", "2026-01-08T00:00:00Z", 10, 5, at("2026-01-01T09:00:00Z"))).toBe(373)
})
test("elapsedSpan returns how much of the window is behind us", () => {
  expect(elapsedSpan("monthly", "2026-11-10T00:00:00Z", at("2026-10-12T20:00:00Z")))
    .toEqual([2 * 86400 + 20 * 3600, 31 * 86400])
})
test("humanize drops a trailing zero unit", () => {
  expect([humanize(0), humanize(300), humanize(3600 + 5 * 60), humanize(3 * 86400), humanize(3 * 86400 + 4 * 3600)])
    .toEqual(["0m", "5m", "1h 5m", "3d", "3d 4h"])
})
test("a reset in the past counts zero, not negative", () => {
  expect(remaining("2026-01-01T00:00:00Z", at("2026-01-02T00:00:00Z"))).toBe(0)
  expect(countdown("2026-01-01T00:00:00Z", at("2026-01-02T00:00:00Z"))).toBe("0m")
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/.config/opencode/plugins/opencode-go-usage && bun test`
Expected: FAIL — `Cannot find module '../src/windows'`.

- [ ] **Step 4: Implement `src/windows.ts`**

Port from `~/.config/opencode/scripts/go-usage.sh`, replacing `datetime.now(timezone.utc)` with `now ?? new Date()`. Two choices the signatures do not determine: `minusMonth` clamps with `new Date(Date.UTC(y, m, 1))` then `setUTCDate(min(day, daysInMonth))`, and `remaining` uses `Math.ceil` (the script's `ceil`, so a 59.2s reset reads `1m`, never `0m` while time is left).

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/windows.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Delete the superseded helpers from `tui.tsx` and re-export**

`tui.tsx` keeps `col`, `bar`, `tokens`, `thresholdColor`, `resetImminent`, `planMessage`, `brief`; the ones that moved (`remaining`, `humanize`-based formatting) are imported from `./src/windows`. `col` and `bar` stay until Task 5 makes them config-driven.

- [ ] **Step 7: Verify the loader still resolves a relative import**

Run: `bun build ./tui.tsx --outfile /tmp/opencode/opencode-go-usage-tui.js --external '*' --target=bun`
Expected: exit 0 and the local module bundled (`Bundled 2 modules`). A failure here is a hard stop: report it, because the whole file structure rests on relative imports working. Fallback if it fails: keep everything in `tui.tsx` and only the tests in `src/` (which is still importable by `bun test`).

- [ ] **Step 8: Restart opencode and confirm the sidebar still renders**

Manual gate: `go-usage` appears in the opencode log with the renamed path, and the sidebar shows the title, the context row, the three plan rows and the `(!)` on the saturating window.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "refactor: rename to opencode-go-usage and port the window math to TypeScript"
```

---

### Task 2: Read the usage endpoint from the plugin

**Files:**
- Create: `src/usage.ts`, `tests/usage.test.ts`
- Modify: `tui.tsx` (`readRows`, delete `SCRIPT`)

**Interfaces:**
- Consumes: `Win` from `src/windows.ts`.
- Produces:
  ```ts
  export type UsageWindow = { percent: number; resetsAt: string; status: string }
  export type Usage = Record<Win, UsageWindow>
  export function parseUsage(raw: unknown): Usage | null
  export function authPath(): string                       // ~/.local/share/opencode/auth.json
  export async function readAuthKey(path?: string): Promise<string | null>
  export async function fetchUsage(key: string, url?: string): Promise<Usage | null>
  ```
  `parseUsage` is pure and total for `unknown`; the two IO helpers return `null` instead of throwing.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "bun:test"
import { parseUsage } from "../src/usage"

const ok = { usage: {
  rolling: { status: "ok", percent: 20, resetsAt: "2026-10-13T12:15:58Z" },
  weekly:  { status: "ok", percent: 17, resetsAt: "2026-10-19T00:00:00Z" },
  monthly: { status: "ok", percent: 14, resetsAt: "2026-11-10T13:58:06Z" },
} }
test("parses the real payload", () => {
  expect(parseUsage(ok)?.monthly.percent).toBe(14)
})
test("rejects what is not the payload", () => {
  for (const bad of [null, undefined, {}, { usage: null }, { usage: { rolling: {} } },
                     { usage: { rolling: { percent: "20", resetsAt: 1 } } }, "nope", 42])
    expect(parseUsage(bad)).toBe(null)
})
test("keeps the window it can read and drops the rest", () => {
  const partial = { usage: { ...ok.usage, weekly: { percent: 17 } } }
  expect(parseUsage(partial)?.weekly).toBeUndefined()
  expect(parseUsage(partial)?.monthly.percent).toBe(14)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/usage.test.ts` — FAIL, module not found.

- [ ] **Step 3: Implement `src/usage.ts`**

`parseUsage` validates `typeof percent === "number"` and `typeof resetsAt === "string"` per window and returns `null` when zero windows survive, so a shape change degrades to the placeholder instead of a crash. `readAuthKey` reads the JSON and returns `data?.["opencode-go"]?.key ?? null` inside a `try`. `fetchUsage` uses `fetch` with the three headers from Global Constraints, `AbortSignal.timeout(20_000)`, and returns `await res.json()` through `parseUsage` inside a `try`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/usage.test.ts` — PASS.

- [ ] **Step 5: Rewire `readRows` and delete the sidecar**

```ts
const readRows = async () => {
  const key = await readAuthKey()
  const usage = key ? await fetchUsage(key) : null
  return usage ? buildRows(usage, await loadConfig()) : []
}
```
Delete `SCRIPT` and the `Bun.spawn` call. Keep the seven-field `Row` shape until Task 4 replaces `buildRows`; in this task, inline the translation with a temporary adapter and its own test (`tests/rows.test.ts` gets the field mapping here, and grows in Task 4).

- [ ] **Step 6: Verify against the live endpoint**

Run: `bun test` (all suites) and then, in a session, confirm the sidebar still shows the same numbers the script prints (`bash ~/.config/opencode/scripts/go-usage.sh --brief`).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: read the usage endpoint from the plugin, drop the bash sidecar"
```

---

### Task 3: Config module

**Files:**
- Create: `src/config.ts`, `tests/config.test.ts`
- Modify: `tui.tsx` (replace `CONFIG`, `wantsAutoOpen`, `autoOpen`)

**Interfaces:**
- Produces:
  ```ts
  export type Glyph = "blocks" | "ascii"
  export type Config = { sidebar: boolean; footer: boolean; autoOpen: boolean; autoOpenAt: number
    autoOpenWindows: string[]; thresholds: { warning: number; error: number }
    bar: { cells: number; glyphs: Glyph }
    columns: { percent: boolean; tokens: boolean; cost: boolean; reset: boolean; flag: boolean }
    order: "fixed" | "projection"; accentLabels: boolean
    refresh: { contextMs: number; planMs: number }; projectionMinElapsed: number }
  export const DEFAULTS: Config
  export function mergeConfig(raw: unknown): Config
  export function cycleOption(cfg: Config, key: string): Config   // pure; the panel's whole interaction
  export function configPath(): string                            // beside the plugin entry
  export async function loadConfig(path?: string): Promise<Config>
  export async function saveConfig(cfg: Config, path?: string): Promise<void>
  export function optionKeys(cfg: Config): string[]               // the panel's row order
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "bun:test"
import { DEFAULTS, mergeConfig, cycleOption } from "../src/config"

test("missing keys fall back to the defaults", () => {
  expect(mergeConfig({})).toEqual(DEFAULTS)
  expect(mergeConfig(null).bar.cells).toBe(8)
})
test("a hand-edited file cannot poison a rendered value", () => {
  const cfg = mergeConfig({ bar: { cells: "8", glyphs: "wat" }, thresholds: { warning: "x" }, columns: null })
  expect(cfg.bar).toEqual({ cells: 8, glyphs: "blocks" })
  expect(cfg.thresholds.warning).toBe(75)
  expect(cfg.columns.percent).toBe(true)
})
test("numbers are clamped to what can be drawn", () => {
  expect(mergeConfig({ bar: { cells: 0 } }).bar.cells).toBe(1)
  expect(mergeConfig({ bar: { cells: 999 } }).bar.cells).toBe(16)
  expect(mergeConfig({ thresholds: { warning: -5, error: 900 } }).thresholds).toEqual({ warning: 0, error: 100 })
  expect(mergeConfig({ refresh: { planMs: 10 } }).refresh.planMs).toBe(1000)
})
test("cycling a boolean inverts it and cycling a value walks the list", () => {
  expect(cycleOption(DEFAULTS, "sidebar").sidebar).toBe(false)
  expect(cycleOption(DEFAULTS, "bar.glyphs").bar.glyphs).toBe("ascii")
  expect(cycleOption(DEFAULTS, "order").order).toBe("projection")
  expect(cycleOption(cycleOption(DEFAULTS, "order"), "order").order).toBe("fixed")
})
test("cycling a counter steps and wraps", () => {
  expect(cycleOption(DEFAULTS, "bar.cells").bar.cells).toBe(9)
  expect(cycleOption(mergeConfig({ bar: { cells: 16 } }), "bar.cells").bar.cells).toBe(1)
  expect(cycleOption(DEFAULTS, "thresholds.warning").thresholds.warning).toBe(80)
})
test("cycling a column list toggles one entry", () => {
  expect(cycleOption(DEFAULTS, "columns.cost").columns.cost).toBe(false)
  expect(cycleOption(DEFAULTS, "autoOpenWindows.monthly").autoOpenWindows).toEqual(["5h", "weekly"])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/config.test.ts` — FAIL, module not found.

- [ ] **Step 3: Implement `src/config.ts`**

`mergeConfig` walks the schema explicitly (no deep-merge helper): each leaf takes the raw value only when `typeof` matches the default's type, then clamps. `cycleOption` switches on the key string: booleans invert, `glyphs` `blocks→ascii→blocks`, `order` `fixed→projection`, `bar.cells` `1..16` stepping by 1 with wrap, `thresholds.*` stepping by 5 within `0..100`, `columns.*` toggling, `autoOpenWindows.<label>` adding/removing the label (never removing the last one — a config that alerts on nothing is a trap). `configPath` is `new URL("./config.json", import.meta.url).pathname`, so the file sits beside `tui.tsx` wherever the repo is cloned. `saveConfig` writes `JSON.stringify(cfg, null, 2)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/config.test.ts` — PASS.

- [ ] **Step 5: Replace the two `autoOpen` helpers in `tui.tsx`**

`const cfg = await loadConfig()` per refresh; `if (started.length && cfg.autoOpen) openDetail(sessionID)`. The alert is still tracked while `autoOpen` is false, and `started` is filtered by `cfg.autoOpenWindows` and `row.projected > cfg.autoOpenAt`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: config module with defaults, clamps and the panel's cycle operation"
```

---

### Task 4: Row assembly in `src/rows.ts`

**Files:**
- Create: `src/rows.ts`, extend `tests/rows.test.ts`
- Modify: `tui.tsx` (`readRows`)

**Interfaces:**
- Consumes: `Usage` (`src/usage.ts`), `Config` (`src/config.ts`), `Win`/`elapsedSpan`/`humanize`/`projected` (`src/windows.ts`).
- Produces:
  ```ts
  export type Row = { label: string; percent: number; reset: string; remaining: number
                      projected: number; span: string }
  export const WINDOWS: { label: string; key: Win }[]   // [5h/rolling, weekly/weekly, monthly/monthly]
  export function buildRows(usage: Usage, cfg: Config, now?: Date): Row[]
  export function orderRows(rows: Row[], order: Config["order"]): Row[]
  ```
  `projected` is `0` when there is no projection (the render path treats `≤ 0` as "no alert"); `span` is `"2d 20h of 31d"`, empty only if `elapsedSpan` cannot be computed.

- [ ] **Step 1: Write the failing test**

```ts
test("a row carries every figure the render path needs", () => {
  const rows = buildRows(usage, DEFAULTS, at("2026-10-13T09:20:00Z"))
  expect(rows.map((r) => r.label)).toEqual(["5h", "weekly", "monthly"])
  expect(rows[2]).toMatchObject({ percent: 14, reset: "28d 4h", projected: 152, span: "2d 20h of 31d" })
})
test("no projection becomes zero, never a flag", () => {
  const young = buildRows(usage, mergeConfig({ projectionMinElapsed: 99 }), at("2026-10-13T09:20:00Z"))
  expect(young.map((r) => r.projected)).toEqual([0, 0, 0])
})
test("projection order puts the worst first and keeps the rest stable", () => {
  const rows = buildRows(usage, DEFAULTS, at("2026-10-13T09:20:00Z"))
  expect(orderRows(rows, "projection").map((r) => r.label)).toEqual(["monthly", "weekly", "5h"])
  expect(orderRows(rows, "fixed").map((r) => r.label)).toEqual(["5h", "weekly", "monthly"])
})
test("a window missing from the payload is left out", () => {
  const rows = buildRows({ ...usage, weekly: undefined as any }, DEFAULTS, at("2026-10-13T09:20:00Z"))
  expect(rows.map((r) => r.label)).toEqual(["5h", "monthly"])
})
```

- [ ] **Step 2: Run test to verify it fails** — `bun test tests/rows.test.ts`, module not found.

- [ ] **Step 3: Implement `src/rows.ts`**

One loop over `WINDOWS`, skipping a key absent from `usage`; `projected(key, resetsAt, percent, cfg.projectionMinElapsed, now) ?? 0`; `span` from `elapsedSpan` via `humanize`. `orderRows` copies and sorts by `projected` descending with a stable comparison (return `0` for equal values so the fixed order survives).

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: `readRows` becomes three lines**

`const usage = await fetchUsage(await readAuthKey())` → `usage ? buildRows(usage, await loadConfig()) : []`. Delete the temporary adapter from Task 2. The seven-field tab contract is gone; nothing parses text anymore.

- [ ] **Step 6: Run the whole suite and the build** — `bun test` and `bun build ./tui.tsx --external '*' --target=bun`, both clean.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: assemble the plan rows in TypeScript, no tab-separated contract"
```

---

### Task 5: Make every option actually take effect

**Files:**
- Modify: `tui.tsx`

**Interfaces:**
- Consumes: `Config` and `loadConfig` (Task 3), `orderRows` (Task 4).
- Produces: no new module; `tui.tsx` reads `cfg` once per render path.

- [ ] **Step 1: Write the failing test**

The parts of this task that are logic are already covered (`mergeConfig`, `orderRows`, `cycleOption`). What is left is wiring, so the test is a pure one for the one piece of new logic — deciding whether to poll:

```ts
// src/config.ts, exported for this test
export function pollingNeeded(cfg: Config): boolean {
  return cfg.sidebar || cfg.footer || cfg.autoOpen
}
test("nothing visible and no alert means no API calls", () => {
  expect(pollingNeeded(mergeConfig({ sidebar: false, footer: false, autoOpen: false }))).toBe(false)
  expect(pollingNeeded(mergeConfig({ sidebar: false, footer: false }))).toBe(true)
  expect(pollingNeeded(DEFAULTS)).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails** — `bun test tests/config.test.ts`, `pollingNeeded` not exported.

- [ ] **Step 3: Implement `pollingNeeded` and gate the timers**

In `setup`, the plan timer calls `refresh()` only when `pollingNeeded(cfg)`; the context timer keeps its own cadence because it reads local session data. The intervals use `cfg.refresh.contextMs` / `cfg.refresh.planMs`, re-armed whenever `loadConfig()` returns different values (compare with a shallow equality on the two numbers and `clearInterval`/`setInterval` on change).

- [ ] **Step 4: Apply the visual options**

- Views: `cfg.sidebar` / `cfg.footer` decide whether the slot is registered. Registering or disposing on change means `context.ui.slot(...)` is called when the flag turns true and the disposer called when it turns false — re-evaluated on each config load, not only at setup.
- `cfg.thresholds` replaces the literals `75`/`90` in `thresholdColor`.
- `cfg.bar.cells` and `cfg.bar.glyphs` replace `CELLS` and the `█`/`░` constants (`ascii` uses `#` and `-`, which also sidesteps the wide-glyph complaint).
- `cfg.columns.*` gate the percent run, the tokens run, the cost run, the reset countdown, and the `(!)`.
- `cfg.order` goes through `orderRows`.
- `cfg.accentLabels` picks accent or muted for the section headers.
- `cfg.autoOpenAt` / `cfg.autoOpenWindows` feed the `started` filter.

- [ ] **Step 5: Run the suite and the build** — `bun test`, `bun build` clean.

- [ ] **Step 6: Restart opencode and walk the options by hand**

Manual gate, one option at a time: `sidebar: false` removes the block from the sidebar and leaves the footer; `footer: false` the reverse; both false plus `autoOpen: false` stops the API calls; `bar.glyphs: "ascii"` swaps the bar; `columns.cost: false` drops the cost.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: every config option takes effect, and polling follows what is visible"
```

---

### Task 6: The options panel

**Files:**
- Create: `settings.tsx`
- Modify: `tui.tsx` (a row in the detail dialog opens the panel)

**Interfaces:**
- Consumes: `Config`, `cycleOption`, `optionKeys`, `loadConfig`, `saveConfig`.
- Produces: `export function Settings(props: { config: () => Config; onChange: (cfg: Config) => void })` — a `box` listing `optionKeys()` one per row, each row `onMouseUp` → `onChange(cycleOption(cfg, key))`.

- [ ] **Step 1: Write the failing test**

The panel's only logic is "which row is next in the cycle", already tested in Task 3. The one new pure piece is the row label:

```ts
// src/config.ts
export function optionLabel(cfg: Config, key: string): string   // "sidebar  on" | "thresholds  75 / 90" | "bar  8 cells blocks"
test("a row states its value so a click is predictable", () => {
  expect(optionLabel(DEFAULTS, "sidebar")).toBe("sidebar               on")
  expect(optionLabel(DEFAULTS, "thresholds.warning")).toBe("thresholds.warning    75")
  expect(optionLabel(DEFAULTS, "bar.cells")).toBe("bar.cells              8")
  expect(optionLabel(DEFAULTS, "columns.cost")).toBe("columns.cost           on")
})
```
(Label column padded to 20, value right after; the exact padding is the implementer's call as long as one column of values lines up.)

- [ ] **Step 2: Run test to verify it fails** — not exported.

- [ ] **Step 3: Implement `optionLabel` and `settings.tsx`**

`settings.tsx` renders a framed box (`border`, `borderStyle="rounded"`, `title="Settings"`, `paddingLeft/Right=2`) with the title, then one `<text onMouseUp>` row per key, then a hint line. `tui.tsx` adds a `settings` row inside the detail dialog that calls `context.ui.dialog.show(() => <Settings ... />)` (the dialog can be re-shown from inside a dialog; if the host refuses to stack, the fallback is to render the panel as a section of the detail dialog and toggle it) and persists every change with `saveConfig`, so the panel writes the file the way a hand edit would.

- [ ] **Step 4: Run test to verify it passes** — `bun test` green.

- [ ] **Step 5: Manual gate: click through every row**

Open the panel from the dialog, click each row once, and confirm after each click that `config.json` on disk holds the new value and the sidebar redraws.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: an options panel that writes config.json on click"
```

---

### Task 7: Publish

**Files:**
- Create: `package.json`, `README.md`, `LICENSE`, `.gitignore`
- Move: the five `/tmp/opencode/*` harnesses are already superseded by `tests/` — delete them.

- [ ] **Step 1: `package.json` and `.gitignore`**

Exactly the shape in Global Constraints, plus `"private": false` and a `"scripts": { "test": "bun test" }`. `.gitignore`: `config.json`, `node_modules`, `*.log`.

- [ ] **Step 2: README states the constraint first**

First three lines: this plugin only works for **opencode-go subscribers**, it reads the key from `~/.local/share/opencode/auth.json` (`opencode-go`), and it calls `opencode.ai/zen/go/v1/usage`. Then: install (clone into `~/.config/opencode/plugins/`), what it shows (sidebar block, footer, detail dialog on click), the options table (every key of the schema with its default), the config file location (beside the plugin), and a note that opencode must be restarted to pick up the plugin itself.

- [ ] **Step 3: LICENSE** — MIT, the user's name and 2026.

- [ ] **Step 4: Run the full suite from a clean checkout**

```bash
git status --porcelain   # nothing untracked left behind
bun test                 # OK
```

- [ ] **Step 5: Tag and confirm the repo state**

The repository already exists from Task 1. Confirm the tree is clean, then `git tag v1.0.0`. Repository name, owner and the actual `git remote add` + push are the user's call — ask before pushing anywhere public.

---

## Self-Review

- **Spec coverage:** window math port → Task 1; endpoint/auth → Task 2; the whole config schema → Task 3; rows → Task 4; every option in the schema taking effect plus the "no views, no polling" call → Task 5; the panel → Task 6; publication deliverables (package.json, README constraint, LICENSE, tests in the repo) → Task 7. The three calls I made on the user's behalf (dispose/re-register a view's slot, stop polling when nothing is visible, ship the tests) are Tasks 5 and 7.
- **Step scan:** no step says "handle edge cases" or leaves a signature open; every code step names the function, its module and the values the spec pins.
- **Type consistency:** `Row` is defined in `src/rows.ts` (Task 4) and consumed by `tui.tsx`; `Win` in `src/windows.ts` (Task 1) and consumed by `src/usage.ts` and `src/rows.ts`; `Config` in `src/config.ts` (Task 3) and consumed by Tasks 4–6. `cycleOption`, `optionKeys`, `optionLabel`, `pollingNeeded` are all produced and consumed inside the same task (3 or 5) that tests them.
- **Review Focus:** the five classes map to Task 2 (auth/endpoint failures, `parseUsage` cases), Task 3 (poisoned config, clamps), Task 1 (past reset, future window start, the `100` boundary), Task 5 (`pollingNeeded`, slot re-registration), Task 5 (`autoOpenAt` strict `>`, announced-once semantics).
- **Proportion:** seven tasks, each with a test cycle and a manual gate only where rendering cannot be observed from a test.
