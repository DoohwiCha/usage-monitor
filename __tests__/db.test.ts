import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveDbPath } from "@/lib/usage-monitor/db";

describe("resolveDbPath", () => {
  const originalDbPath = process.env.MONITOR_DB_PATH;

  afterEach(() => {
    if (originalDbPath === undefined) {
      delete process.env.MONITOR_DB_PATH;
      return;
    }
    process.env.MONITOR_DB_PATH = originalDbPath;
  });

  it("uses the default project data path when no override is set", () => {
    delete process.env.MONITOR_DB_PATH;
    expect(resolveDbPath()).toBe(path.join(process.cwd(), "data", "usage-monitor.db"));
  });

  it("resolves a relative override from the project root", () => {
    process.env.MONITOR_DB_PATH = "tmp/test-monitor.db";
    expect(resolveDbPath()).toBe(path.join(process.cwd(), "tmp", "test-monitor.db"));
  });

  it("preserves an absolute override path", () => {
    process.env.MONITOR_DB_PATH = "/tmp/usage-monitor-absolute.db";
    expect(resolveDbPath()).toBe("/tmp/usage-monitor-absolute.db");
  });
});
