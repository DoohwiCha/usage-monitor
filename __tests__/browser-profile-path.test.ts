import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveBrowserProfilePath, resolveBrowserProfileRoot } from "@/lib/usage-monitor/browser-profile-path";

describe("browser profile path helpers", () => {
  const originalRoot = process.env.MONITOR_BROWSER_PROFILE_ROOT;

  afterEach(() => {
    if (originalRoot === undefined) {
      delete process.env.MONITOR_BROWSER_PROFILE_ROOT;
      return;
    }
    process.env.MONITOR_BROWSER_PROFILE_ROOT = originalRoot;
  });

  it("uses an external home-directory root by default", () => {
    delete process.env.MONITOR_BROWSER_PROFILE_ROOT;
    const root = resolveBrowserProfileRoot();
    expect(root).toContain(path.join(".usage-monitor", "browser-profiles"));
    expect(resolveBrowserProfilePath("claude", "acct-1")).toBe(path.join(root, "claude-acct-1"));
  });

  it("resolves a relative custom root from the project root", () => {
    process.env.MONITOR_BROWSER_PROFILE_ROOT = "tmp/browser-profiles";
    expect(resolveBrowserProfileRoot()).toBe(path.join(process.cwd(), "tmp", "browser-profiles"));
  });

  it("preserves an absolute custom root", () => {
    process.env.MONITOR_BROWSER_PROFILE_ROOT = "/tmp/usage-monitor-profiles";
    expect(resolveBrowserProfilePath("openai", "acct-2")).toBe("/tmp/usage-monitor-profiles/openai-acct-2");
  });
});
