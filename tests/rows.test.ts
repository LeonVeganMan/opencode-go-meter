import { test, expect } from "bun:test"
import { alerting, buildRows, orderRows } from "../src/rows"
import { DEFAULTS, mergeConfig } from "../src/config"
import type { Usage } from "../src/usage"

const at = (s: string) => new Date(s)
const usage: Usage = {
  rolling: { status: "ok", percent: 20, resetsAt: "2026-10-13T12:15:58Z" },
  weekly: { status: "ok", percent: 17, resetsAt: "2026-10-19T00:00:00Z" },
  monthly: { status: "ok", percent: 14, resetsAt: "2026-11-10T13:58:06Z" },
}

test("a row carries every figure the render path needs", () => {
  const rows = buildRows(usage, DEFAULTS, at("2026-10-13T09:20:00Z"))
  expect(rows.map((row) => row.label)).toEqual(["5h", "weekly", "monthly"])
  expect(rows[2]).toEqual({
    label: "monthly",
    percent: 14,
    reset: "28d 4h",
    remaining: 2435886,
    projected: 155,
    span: "2d 19h of 31d",
  })
})

test("the rolling window is the short one", () => {
  expect(buildRows(usage, DEFAULTS, at("2026-10-13T09:20:00Z"))[0]).toEqual({
    label: "5h",
    percent: 20,
    reset: "2h 55m",
    remaining: 10558,
    projected: 48,
    span: "2h 4m of 5h",
  })
})

test("no projection becomes zero, never a flag", () => {
  const young = buildRows(usage, mergeConfig({ projectionMinElapsed: 99 }), at("2026-10-13T09:20:00Z"))
  expect(young.map((row) => row.projected)).toEqual([0, 0, 0])
})

test("a forecast breach is an alert, exactly at the limit is not", () => {
  const monthly = buildRows(usage, DEFAULTS, at("2026-10-13T09:20:00Z")).find((r) => r.label === "monthly")!
  expect(alerting(monthly, DEFAULTS)).toBe(true)
  expect(alerting({ ...monthly, projected: 101 }, DEFAULTS)).toBe(true)
  expect(alerting({ ...monthly, projected: 100 }, DEFAULTS)).toBe(false)
  expect(alerting({ ...monthly, projected: 70 }, mergeConfig({ autoOpenAt: 50 }))).toBe(true)
  expect(alerting({ ...monthly, projected: 40 }, mergeConfig({ autoOpenAt: 50 }))).toBe(false)
})
test("projection order puts the worst first and keeps the rest stable", () => {
  const rows = buildRows(usage, DEFAULTS, at("2026-10-13T09:20:00Z"))
  expect(orderRows(rows, "projection").map((row) => row.label)).toEqual(["monthly", "weekly", "5h"])
  expect(orderRows(rows, "fixed").map((row) => row.label)).toEqual(["5h", "weekly", "monthly"])
})

test("the rows keep the fixed order and a window the payload left out is skipped", () => {
  const { weekly, ...withoutWeekly } = usage
  expect(buildRows(usage, DEFAULTS, at("2026-10-13T09:20:00Z")).map((row) => row.label)).toEqual(["5h", "weekly", "monthly"])
  expect(buildRows(withoutWeekly, DEFAULTS, at("2026-10-13T09:20:00Z")).map((row) => row.label)).toEqual(["5h", "monthly"])
})
