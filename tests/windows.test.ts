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
  expect(projected("weekly", "2026-01-08T00:00:00Z", 20, 5, at("2026-01-01T08:00:00Z"))).toBe(null)
  expect(projected("weekly", "2026-01-08T00:00:00Z", 20, 5, at("2026-01-01T09:00:00Z"))).toBe(373)
})

test("elapsedSpan returns how much of the window is behind us", () => {
  expect(elapsedSpan("monthly", "2026-11-10T00:00:00Z", at("2026-10-12T20:00:00Z"))).toEqual([2 * 86400 + 20 * 3600, 31 * 86400])
})

test("humanize drops a trailing zero unit", () => {
  expect([humanize(0), humanize(300), humanize(3600 + 5 * 60), humanize(3 * 86400), humanize(3 * 86400 + 4 * 3600)]).toEqual([
    "0m",
    "5m",
    "1h 5m",
    "3d",
    "3d 4h",
  ])
})

test("a reset in the past counts zero, not negative", () => {
  expect(remaining("2026-01-01T00:00:00Z", at("2026-01-02T00:00:00Z"))).toBe(0)
  expect(countdown("2026-01-01T00:00:00Z", at("2026-01-02T00:00:00Z"))).toBe("0m")
})
