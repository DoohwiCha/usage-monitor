import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCached,
  getStale,
  invalidateCache,
  isRateLimited,
  markRateLimited,
  setCached,
} from "@/lib/usage-monitor/usage-cache";

describe("usage-cache", () => {
  beforeEach(() => {
    vi.useRealTimers();
    invalidateCache();
  });

  it("returns cached value before ttl expires", () => {
    setCached("acct:1", { total: 5 }, 1_000);
    expect(getCached<{ total: number }>("acct:1")).toEqual({ total: 5 });
  });

  it("returns null from primary cache after ttl expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T00:00:00.000Z"));
    setCached("acct:1", { total: 5 }, 1_000);

    vi.advanceTimersByTime(1_001);
    expect(getCached("acct:1")).toBeNull();
  });

  it("keeps stale copy after primary cache expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T00:00:00.000Z"));
    setCached("acct:2", { total: 9 }, 1_000);

    vi.advanceTimersByTime(1_001);
    expect(getStale<{ total: number }>("acct:2")).toEqual({ total: 9 });
  });

  it("marks account as rate limited until backoff expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T00:00:00.000Z"));

    markRateLimited("acct:3", 1_000);
    expect(isRateLimited("acct:3")).toBe(true);

    vi.advanceTimersByTime(1_001);
    expect(isRateLimited("acct:3")).toBe(false);
  });

  it("invalidates only keys under provided prefix", () => {
    setCached("acct:1:week", { ok: true }, 5_000);
    setCached("acct:2:week", { ok: true }, 5_000);
    markRateLimited("acct:1:week", 5_000);
    markRateLimited("acct:2:week", 5_000);

    invalidateCache("acct:1");

    expect(getCached("acct:1:week")).toBeNull();
    expect(getCached("acct:2:week")).toEqual({ ok: true });
    expect(isRateLimited("acct:1:week")).toBe(false);
    expect(isRateLimited("acct:2:week")).toBe(true);
  });
});
