import { test, expect } from "bun:test"
import { DEFAULTS, mergeConfig, cycleOption, optionLabel, pollingNeeded } from "../src/config"

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
test("nothing visible and no alert means no API calls", () => {
  expect(pollingNeeded(mergeConfig({ sidebar: false, footer: false, autoOpen: false }))).toBe(false)
  expect(pollingNeeded(mergeConfig({ sidebar: false, footer: false }))).toBe(true)
  expect(pollingNeeded(DEFAULTS)).toBe(true)
})
test("a row states its value so a click is predictable", () => {
  expect(optionLabel(DEFAULTS, "sidebar")).toBe("sidebar                on")
  expect(optionLabel(DEFAULTS, "thresholds.warning")).toBe("thresholds.warning     75")
  expect(optionLabel(DEFAULTS, "bar.cells")).toBe("bar.cells              8")
  expect(optionLabel(DEFAULTS, "columns.cost")).toBe("columns.cost           on")
})
