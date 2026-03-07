import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

import type { MonitorAccount } from "@/lib/usage-monitor/types";
import { resolveRange } from "@/lib/usage-monitor/range";
import { fetchClaudeUsageBatch, fetchUsageForAccount } from "@/lib/usage-monitor/usage-adapters";

const readFileMock = vi.fn();

vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

function makeOpenAIAccount(overrides: Partial<MonitorAccount> = {}): MonitorAccount {
  return {
    id: "openai-1",
    name: "OpenAI Test",
    provider: "openai",
    enabled: true,
    createdAt: "2026-03-05T00:00:00.000Z",
    updatedAt: "2026-03-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("fetchUsageForAccount (OpenAI ChatGPT fallback)", () => {
  beforeEach(() => {
    readFileMock.mockReset();
  });

  it("returns billing info when metrics file is missing but subscription exists", async () => {
    readFileMock.mockRejectedValueOnce(new Error("ENOENT"));

    const account = makeOpenAIAccount({
      subscriptionInfo: {
        plan: "chatgptplus",
        renewsAt: "2026-03-20",
        billingPeriod: "month",
      },
    });

    const report = await fetchUsageForAccount(account, resolveRange("month"));

    expect(report.status).toBe("ok");
    expect(report.error).toBeUndefined();
    expect(report.usageInfo?.windows).toEqual([]);
    expect(report.usageInfo?.billing).toEqual({
      status: "chatgptplus",
      nextChargeDate: "2026-03-20",
      interval: "month",
    });
  });

  it("returns not_configured when metrics file is missing and no subscription exists", async () => {
    readFileMock.mockRejectedValueOnce(new Error("ENOENT"));

    const report = await fetchUsageForAccount(makeOpenAIAccount(), resolveRange("month"));

    expect(report.status).toBe("not_configured");
    expect(report.error).toContain("metrics not found");
  });

  it("returns utilization windows when metrics file exists", async () => {
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        five_hour_limit_pct: 47.7,
        weekly_limit_pct: 82.1,
      }),
    );

    const report = await fetchUsageForAccount(makeOpenAIAccount(), resolveRange("month"));

    expect(report.status).toBe("ok");
    expect(report.usageInfo?.windows).toEqual([
      { label: "5h", utilization: 48, resetsAt: null },
      { label: "wk", utilization: 82, resetsAt: null },
    ]);
  });
});

describe("fetchClaudeUsageBatch (initial fetch state)", () => {
  beforeEach(() => {
    readFileMock.mockReset();
  });

  it("returns error/pending state when no cache exists and upstream returns no windows", async () => {
    const originalFetch = global.fetch;
    const originalReadFileSync = fs.readFileSync.bind(fs);
    const fsSpy = vi.spyOn(fs, "readFileSync").mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
      const target = String(args[0] ?? "");
      if (target.includes(".claude/.credentials.json")) {
        throw new Error("ENOENT");
      }
      return originalReadFileSync(...args as [Parameters<typeof fs.readFileSync>[0], Parameters<typeof fs.readFileSync>[1]?]);
    }) as typeof fs.readFileSync);

    global.fetch = vi.fn()
      // organizations
      .mockResolvedValueOnce(new Response(JSON.stringify([{ uuid: "org-1" }]), { status: 200 }))
      // usage endpoint
      .mockResolvedValueOnce(new Response("rate-limited", { status: 429 }))
      // subscription endpoint
      .mockRejectedValueOnce(new Error("network"));

    const account: MonitorAccount = {
      id: "claude-batch-1",
      name: "Claude Batch Test",
      provider: "claude",
      enabled: true,
      sessionCookie: "session=test",
      createdAt: "2026-03-05T00:00:00.000Z",
      updatedAt: "2026-03-05T00:00:00.000Z",
    };

    const [report] = await fetchClaudeUsageBatch([account], resolveRange("month"));

    expect(report.status).toBe("error");
    expect(report.error).toContain("being fetched");

    fsSpy.mockRestore();
    global.fetch = originalFetch;
  });
});
