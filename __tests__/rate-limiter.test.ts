import { describe, it, expect } from "vitest";
import { checkRateLimit, resetRateLimit } from "@/lib/usage-monitor/rate-limiter";

describe("checkRateLimit (login category: 5 attempts per window)", () => {
  it("allows requests within the limit", () => {
    const key = "test-login-ip-1";
    const result = checkRateLimit(key, "login");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.retryAfterMs).toBe(0);
  });

  it("blocks requests exceeding the limit", () => {
    const key = "test-login-ip-2";
    // Use up all 5 allowed attempts
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, "login");
    }
    const blocked = checkRateLimit(key, "login");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThanOrEqual(0);
  });

  it("tracks remaining count correctly across multiple calls", () => {
    const key = "test-login-ip-3";
    const r1 = checkRateLimit(key, "login");
    expect(r1.remaining).toBe(4);

    const r2 = checkRateLimit(key, "login");
    expect(r2.remaining).toBe(3);

    const r3 = checkRateLimit(key, "login");
    expect(r3.remaining).toBe(2);
  });
});

describe("resetRateLimit", () => {
  it("clears the counter so requests are allowed again", () => {
    const key = "test-reset-ip";
    // Exhaust the limit
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, "login");
    }
    expect(checkRateLimit(key, "login").allowed).toBe(false);

    // Reset and verify it's allowed again
    resetRateLimit(key);
    const after = checkRateLimit(key, "login");
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(4);
  });

  it("is a no-op for keys that have no entries", () => {
    expect(() => resetRateLimit("nonexistent-key")).not.toThrow();
  });
});

describe("checkRateLimit (api category: 100 attempts per window)", () => {
  it("allows requests within the api limit", () => {
    const key = "test-api-ip";
    const result = checkRateLimit(key, "api");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  it("uses api defaults for unknown category", () => {
    const key = "test-unknown-ip";
    const result = checkRateLimit(key, "unknown_category");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });
});
