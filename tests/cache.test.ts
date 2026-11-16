import { test, expect } from "bun:test"
import { cacheHit, cachePercent, cacheTrend, totalFits } from "../src/cache"

const assistant = (id: string, input: number, read: number, write = 0) => ({
  id,
  type: "assistant",
  tokens: { input, cache: { read, write } },
})

test("the last assistant message is the hit, the previous one is the trend", () => {
  const info = cacheHit([assistant("old", 50, 50), assistant("new", 20, 80)])
  expect(info?.hit).toBeCloseTo(80)
  expect(info?.trend).toBeCloseTo(30)
  expect(info?.total).toBeUndefined()
})

test("one message has no trend", () => {
  const info = cacheHit([assistant("only", 100, 0)])
  expect(info?.hit).toBe(0)
  expect(info?.trend).toBeUndefined()
})

test("the session total uses the cumulative tokens", () => {
  const info = cacheHit([assistant("new", 20, 80)], { input: 100, cache: { read: 300, write: 0 } })
  expect(info?.hit).toBeCloseTo(80)
  expect(info?.total).toBeCloseTo(75)
})

test("messages at or after the revert are excluded", () => {
  const info = cacheHit([assistant("old", 50, 50), assistant("new", 20, 80)], undefined, "new")
  expect(info?.hit).toBeCloseTo(50)
  expect(info?.trend).toBeUndefined()
})

test("no assistant tokens means no row", () => {
  expect(cacheHit([{ id: "u", type: "user" }])).toBeUndefined()
  expect(cacheHit([])).toBeUndefined()
  expect(cacheHit([{ id: "a", type: "assistant", tokens: { input: 0, cache: { read: 0, write: 0 } } }])).toBeUndefined()
})

test("the total only shows when the sidebar has room", () => {
  expect(totalFits(160, 8, true)).toBe(true)
  expect(totalFits(120, 8, true)).toBe(true)
  expect(totalFits(100, 8, true)).toBe(false)
  expect(totalFits(100, 8, false)).toBe(true)
})

test("percent and trend keep the token-cache formatting", () => {
  expect(cachePercent(98.59)).toBe("98.5%")
  expect(cachePercent(100)).toBe("100.0%")
  expect(cacheTrend(-0.9)).toBe("\u21930.9%")
  expect(cacheTrend(1.2)).toBe("\u21911.2%")
  expect(cacheTrend(0.01)).toBe("-")
  expect(cacheTrend(undefined)).toBe("-")
})
