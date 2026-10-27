import {afterEach, describe, expect, it} from "bun:test";
import {DateTime} from "luxon";
import {freezeTime} from "./freezeTime";

const REAL_YEAR_FLOOR = 2025;

describe("freezeTime", () => {
  afterEach(() => {
    // Every freeze in this file auto-restores; the clock must be real again here.
    expect(DateTime.now().year).toBeGreaterThanOrEqual(REAL_YEAR_FLOOR);
  });

  it("freezes Date.now, new Date, and Luxon to the same instant", async () => {
    freezeTime("2024-06-01T10:30:00Z");
    await new Promise((resolve) => setTimeout(resolve, 15));
    const expected = Date.parse("2024-06-01T10:30:00Z");
    expect(Date.now()).toBe(expected);
    // biome-ignore lint/complexity/useDateNow: the Date constructor is the path under test
    expect(new Date().getTime()).toBe(expected);
    expect(DateTime.now().toMillis()).toBe(expected);
  });

  it("accepts a Luxon DateTime", () => {
    const instant = DateTime.fromISO("2030-01-02T03:04:05Z");
    freezeTime(instant);
    expect(DateTime.now().toMillis()).toBe(instant.toMillis());
  });

  it("restores nested freezes to the outer instant", () => {
    freezeTime("2024-01-01T00:00:00Z");
    const restoreInner = freezeTime("2024-12-31T00:00:00Z");
    expect(DateTime.now().toUTC().month).toBe(12);
    restoreInner();
    restoreInner();
    expect(DateTime.now().toUTC().month).toBe(1);
  });

  it("wins over a preload that replaced Date.now", () => {
    const original = Date.now;
    Date.now = (): number => 0;
    const restore = freezeTime("2024-06-01T00:00:00Z", {restoreAfterEach: false});
    expect(Date.now()).toBe(Date.parse("2024-06-01T00:00:00Z"));
    restore();
    expect(Date.now()).toBe(0);
    Date.now = original;
  });

  it("rejects invalid input", () => {
    expect(() => freezeTime("not a date")).toThrow(/freezeTime: invalid date\/time "not a date"/);
    expect(() => freezeTime(DateTime.invalid("bad"))).toThrow(/freezeTime: invalid date\/time/);
  });
});
