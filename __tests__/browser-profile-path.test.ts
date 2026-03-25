import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  resolveBrowserProfileCandidates,
  resolveBrowserProfilePath,
  resolveBrowserProfileRoot,
  resolveExistingBrowserProfilePath,
} from "@/lib/usage-monitor/browser-profile-path";

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

  it("includes legacy in-project browser profile path as a fallback candidate", () => {
    process.env.MONITOR_BROWSER_PROFILE_ROOT = path.join(os.tmpdir(), "usage-monitor-profiles");
    expect(resolveBrowserProfileCandidates("openai", "acct-3")).toEqual([
      path.join(os.tmpdir(), "usage-monitor-profiles", "openai-acct-3"),
      path.join(process.cwd(), "data", "browser-profiles", "openai-acct-3"),
    ]);
  });

  it("returns the first existing browser profile path across configured and legacy roots", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "usage-monitor-profiles-"));
    process.env.MONITOR_BROWSER_PROFILE_ROOT = tmpRoot;
    const legacyPath = path.join(process.cwd(), "data", "browser-profiles", "openai-acct-4");
    fs.mkdirSync(legacyPath, { recursive: true });
    try {
      expect(resolveExistingBrowserProfilePath("openai", "acct-4")).toBe(legacyPath);
    } finally {
      fs.rmSync(legacyPath, { recursive: true, force: true });
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
