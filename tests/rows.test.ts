import { test, expect } from "bun:test"
import { buildRows } from "../src/rows"
import type { Usage } from "../src/usage"

const at = (s: string) => new Date(s)
const usage: Usage = {
  rolling: { status: "ok", percent: 20, resetsAt: "2026-10-13T12:15:58Z" },
  weekly: { status: "ok", percent: 17, resetsAt: "2026-10-19T00:00:00Z" },
  monthly: { status: "ok", percent: 14, resetsAt: "2026-11-10T13:58:06Z" },
}

test("a row carries every figure the render path needs", () => {
  expect(buildRows(usage, at("2026-10-13T09:20:00Z"))[2]).toEqual({
    label: "monthly",
    percent: 14,
    reset: "28d 4h",
    remaining: 2435886,
    projected: 155,
    span: "2d 19h of 31d",
  })
})

test("the rolling window is the short one", () => {
  expect(buildRows(usage, at("2026-10-13T09:20:00Z"))[0]).toEqual({
    label: "5h",
    percent: 20,
    reset: "2h 55m",
    remaining: 10558,
    projected: 48,
    span: "2h 4m of 5h",
  })
})

test("the rows keep the fixed order and a window the payload left out is skipped", () => {
  const { weekly, ...withoutWeekly } = usage
  expect(buildRows(usage, at("2026-10-13T09:20:00Z")).map((row) => row.label)).toEqual(["5h", "weekly", "monthly"])
  expect(buildRows(withoutWeekly, at("2026-10-13T09:20:00Z")).map((row) => row.label)).toEqual(["5h", "monthly"])
})
