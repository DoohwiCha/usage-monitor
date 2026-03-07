import { afterEach, describe, expect, it } from "vitest";

import { resolveCookieSecure } from "@/lib/usage-monitor/cookies";

describe("resolveCookieSecure", () => {
  const originalOverride = process.env.MONITOR_COOKIE_SECURE;

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.MONITOR_COOKIE_SECURE;
      return;
    }
    process.env.MONITOR_COOKIE_SECURE = originalOverride;
  });

  it("returns true when env override is true", () => {
    process.env.MONITOR_COOKIE_SECURE = "true";
    const req = new Request("http://localhost:3000");
    expect(resolveCookieSecure(req)).toBe(true);
  });

  it("returns false when env override is false", () => {
    process.env.MONITOR_COOKIE_SECURE = "false";
    const req = new Request("https://app.example.com");
    expect(resolveCookieSecure(req)).toBe(false);
  });

  it("uses x-forwarded-proto when override is not set", () => {
    delete process.env.MONITOR_COOKIE_SECURE;
    const req = new Request("http://internal.local", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(resolveCookieSecure(req)).toBe(true);
  });

  it("falls back to request url protocol when forwarded proto is absent", () => {
    delete process.env.MONITOR_COOKIE_SECURE;
    expect(resolveCookieSecure(new Request("https://app.example.com"))).toBe(true);
    expect(resolveCookieSecure(new Request("http://app.example.com"))).toBe(false);
  });
});
