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
