import { describe, it, expect } from "vitest";
import { resolveRange, toUtcDayKey } from "@/lib/usage-monitor/range";

describe("resolveRange", () => {
  it("returns week preset by default for null input", () => {
    const range = resolveRange(null);
    expect(range.preset).toBe("week");
  });

  it("returns week preset for unknown string", () => {
    const range = resolveRange("unknown");
    expect(range.preset).toBe("week");
  });

  it("returns day preset for 'day'", () => {
    const range = resolveRange("day");
    expect(range.preset).toBe("day");
  });

  it("returns month preset for 'month'", () => {
    const range = resolveRange("month");
    expect(range.preset).toBe("month");
  });

  it("day range spans ~1 day", () => {
    const before = Date.now();
    const range = resolveRange("day");
    const after = Date.now();

    const diffMs = range.end.getTime() - range.start.getTime();
    // Should be approximately 24 hours (within a small tolerance)
    expect(diffMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 100);
    expect(diffMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 100);
  });

  it("week range spans ~7 days", () => {
    const range = resolveRange("week");
    const diffMs = range.end.getTime() - range.start.getTime();
    expect(diffMs).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 100);
    expect(diffMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000 + 100);
  });

  it("month range spans ~30 days", () => {
    const range = resolveRange("month");
    const diffMs = range.end.getTime() - range.start.getTime();
    expect(diffMs).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000 - 100);
    expect(diffMs).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000 + 100);
  });

  it("start is before end", () => {
    for (const preset of ["day", "week", "month"] as const) {
      const range = resolveRange(preset);
      expect(range.start.getTime()).toBeLessThan(range.end.getTime());
    }
  });

  it("unix timestamps match the Date objects", () => {
    const range = resolveRange("week");
    expect(range.startUnix).toBe(Math.floor(range.start.getTime() / 1000));
    expect(range.endUnix).toBe(Math.floor(range.end.getTime() / 1000));
  });

  it("ISO strings match the Date objects", () => {
    const range = resolveRange("day");
    expect(range.startIso).toBe(range.start.toISOString());
    expect(range.endIso).toBe(range.end.toISOString());
  });

  it("end is close to now", () => {
    const before = Date.now();
    const range = resolveRange("week");
    const after = Date.now();
    expect(range.end.getTime()).toBeGreaterThanOrEqual(before);
    expect(range.end.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("toUtcDayKey", () => {
  it("returns YYYY-MM-DD format", () => {
    const d = new Date("2024-06-15T12:34:56.789Z");
    expect(toUtcDayKey(d)).toBe("2024-06-15");
  });

  it("returns 10 characters", () => {
    const d = new Date("2023-01-01T00:00:00Z");
    expect(toUtcDayKey(d)).toHaveLength(10);
  });

  it("uses UTC date (not local)", () => {
    // 2024-03-01T00:30:00Z is March 1st UTC
    const d = new Date("2024-03-01T00:30:00Z");
    expect(toUtcDayKey(d)).toBe("2024-03-01");
  });

  it("handles start of day", () => {
    const d = new Date("2024-12-31T00:00:00.000Z");
    expect(toUtcDayKey(d)).toBe("2024-12-31");
  });

  it("handles end of day", () => {
    const d = new Date("2024-12-31T23:59:59.999Z");
    expect(toUtcDayKey(d)).toBe("2024-12-31");
  });
});
