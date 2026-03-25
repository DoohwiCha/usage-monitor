import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

import type { MonitorAccount } from "@/lib/usage-monitor/types";
import { resolveRange } from "@/lib/usage-monitor/range";
import { fetchClaudeUsageBatch, fetchUsageForAccount, testConnection } from "@/lib/usage-monitor/usage-adapters";
import { parseOpenAIWhamUsageInfo } from "@/lib/usage-monitor/usage-adapters";

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
    expect(report.usageInfo?.sourceScope).toBe("shared_local");
  });

  it("falls back to the latest Codex session quota snapshot when metrics quota is stale", async () => {
    const readdirSpy = vi.spyOn(fs, "readdirSync").mockImplementation(((target: fs.PathLike) => {
      const path = String(target);
      if (path.endsWith("/.codex/sessions")) {
        return [
          { name: "2026", isDirectory: () => true, isFile: () => false },
        ] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      if (path.endsWith("/.codex/sessions/2026")) {
        return [
          { name: "03", isDirectory: () => true, isFile: () => false },
        ] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      if (path.endsWith("/.codex/sessions/2026/03")) {
        return [
          { name: "24", isDirectory: () => true, isFile: () => false },
        ] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      if (path.endsWith("/.codex/sessions/2026/03/24")) {
        return [
          { name: "rollout-test.jsonl", isDirectory: () => false, isFile: () => true },
        ] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      return [] as unknown as ReturnType<typeof fs.readdirSync>;
    }) as typeof fs.readdirSync);

    const readFileSyncSpy = vi.spyOn(fs, "readFileSync").mockImplementation(((target: fs.PathLike) => {
      const path = String(target);
      if (path.endsWith("rollout-test.jsonl")) {
        return JSON.stringify({
          timestamp: "2026-03-24T00:00:20.733Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            rate_limits: {
              primary: { used_percent: 13 },
              secondary: { used_percent: 50 },
            },
          },
        }) as unknown as ReturnType<typeof fs.readFileSync>;
      }
      return "" as unknown as ReturnType<typeof fs.readFileSync>;
    }) as typeof fs.readFileSync);

    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        five_hour_limit_pct: 0,
        weekly_limit_pct: 0,
        total_turns: 21,
        last_activity: "2026-03-24T00:00:10.000Z",
      }),
    );

    const report = await fetchUsageForAccount(makeOpenAIAccount(), resolveRange("month"));

    expect(report.status).toBe("ok");
    expect(report.usageInfo?.windows).toEqual([
      { label: "5h", utilization: 13, resetsAt: null },
      { label: "wk", utilization: 50, resetsAt: null },
    ]);

    readdirSpy.mockRestore();
    readFileSyncSpy.mockRestore();
  });

  it("merges local /status metrics into Admin API OpenAI reports", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ start_time: 1_700_000_000, results: [{ amount: { value: 1.25 } }] }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ start_time: 1_700_000_000, results: [{ num_model_requests: 3, input_tokens: 4, output_tokens: 5 }] }],
      }), { status: 200 }));

    readFileMock.mockResolvedValueOnce(JSON.stringify({
      five_hour_limit_pct: 11.2,
      weekly_limit_pct: 22.8,
      session_turns: 2,
      session_input_tokens: 4,
      session_output_tokens: 5,
    }));

    const report = await fetchUsageForAccount(
      makeOpenAIAccount({ apiKey: "sk-admin-test" }),
      resolveRange("month"),
    );

    expect(report.status).toBe("ok");
    expect(report.costUsd).toBe(1.25);
    expect(report.requests).toBe(3);
    expect(report.tokens).toBe(9);
    expect(report.usageInfo?.windows).toEqual([
      { label: "5h", utilization: 11, resetsAt: null },
      { label: "wk", utilization: 23, resetsAt: null },
    ]);
    expect(report.usageInfo?.codexMetrics).toMatchObject({
      totalTurns: 0,
      sessionTurns: 2,
      sessionInputTokens: 4,
      sessionOutputTokens: 5,
      sessionTotalTokens: 0,
      lastActivity: null,
    });
    expect(report.usageInfo?.sourceScope).toBe("account");

    global.fetch = originalFetch;
  });

  it("parses wham usage payloads into account-scoped OpenAI windows", () => {
    const info = parseOpenAIWhamUsageInfo({
      email: "dominic.d.cha@gmail.com",
      account_id: "user-K9u1gl39y4MP9ytfE49ynhiT",
      plan_type: "pro",
      rate_limit: {
        primary_window: { used_percent: 18 },
        secondary_window: { used_percent: 52 },
      },
    }, makeOpenAIAccount());

    expect(info).toEqual({
      windows: [
        { label: "5h", utilization: 18, resetsAt: null },
        { label: "wk", utilization: 52, resetsAt: null },
      ],
      sourceScope: "account",
      accountIdentity: {
        email: "dominic.d.cha@gmail.com",
        accountId: "user-K9u1gl39y4MP9ytfE49ynhiT",
        planType: "pro",
      },
      billing: {
        status: "pro",
        nextChargeDate: null,
        interval: null,
      },
    });
  });
});

describe("fetchClaudeUsageBatch (initial fetch state)", () => {
  beforeEach(() => {
    readFileMock.mockReset();
  });

  it("returns pending state when no cache exists and upstream returns no windows", async () => {
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

    expect(report.status).toBe("pending");
    expect(report.error).toContain("being fetched");

    fsSpy.mockRestore();
    global.fetch = originalFetch;
  });
});

describe("testConnection (OpenAI setup sources)", () => {
  beforeEach(() => {
    readFileMock.mockReset();
  });

  it("reports local metrics as a valid usage source", async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify({ five_hour_limit_pct: 15 }));

    const result = await testConnection(makeOpenAIAccount());

    expect(result.ok).toBe(true);
    expect(result.message).toContain("metrics.json");
  });

  it("does not treat stored browser login data as an actual usage source", async () => {
    readFileMock.mockRejectedValueOnce(new Error("ENOENT"));

    const result = await testConnection(makeOpenAIAccount({ sessionCookie: "[{\"name\":\"session\"}]" }));

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Admin API key");
    expect(result.message).toContain("metrics.json");
  });
});
