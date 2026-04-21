import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { MonitorAccount } from "@/lib/usage-monitor/types";
import { resolveRange } from "@/lib/usage-monitor/range";
import {
  fetchClaudeUsageBatch,
  fetchUsageForAccount,
  parseOpenAIWhamUsageInfo,
  testConnection,
} from "@/lib/usage-monitor/usage-adapters";

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

describe("fetchUsageForAccount (OpenAI CLIProxyAPI auth store)", () => {
  it("uses CLIProxyAPI codex auth files as an account-scoped OpenAI source", async () => {
    const authDir = fs.mkdtempSync(path.join(os.tmpdir(), "cliproxy-openai-"));
    const authPath = path.join(authDir, "codex-openai@example.com-pro.json");
    fs.writeFileSync(authPath, JSON.stringify({
      access_token: "jwt-token",
      account_id: "acct-123",
      email: "openai@example.com",
      expired: "2026-04-01T00:00:00Z",
    }));

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      email: "openai@example.com",
      account_id: "acct-123",
      plan_type: "pro",
      rate_limit: {
        primary_window: {
          used_percent: 12.4,
          reset_at: "2026-04-01T00:00:00Z",
        },
        secondary_window: {
          used_percent: 44.8,
          reset_at: 1_775_520_000,
        },
      },
    }), { status: 200 }));

    try {
      const report = await fetchUsageForAccount(makeOpenAIAccount({
        authMode: "auth_store",
        syncSource: "cliproxy_codex",
        sourcePath: authPath,
        sourceAccountId: "acct-123",
        authIdentity: "openai@example.com",
      }), resolveRange("month"));

      expect(report.status).toBe("ok");
      expect(report.usageInfo?.accountIdentity).toMatchObject({
        email: "openai@example.com",
        accountId: "acct-123",
        planType: "pro",
      });
      expect(report.usageInfo?.billing).toEqual({
        status: "pro",
        nextChargeDate: null,
        interval: null,
      });
      expect(report.usageInfo?.windows).toEqual([
        {
          key: "five_hour",
          label: "5h",
          utilization: 12.4,
          resetsAt: "2026-04-01T00:00:00Z",
        },
        {
          key: "seven_day",
          label: "7d",
          utilization: 44.8,
          resetsAt: "2026-04-07T00:00:00.000Z",
        },
      ]);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://chatgpt.com/backend-api/wham/usage",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer jwt-token",
            "ChatGPT-Account-Id": "acct-123",
          }),
        }),
      );
    } finally {
      global.fetch = originalFetch;
      fs.rmSync(authDir, { recursive: true, force: true });
    }
  });

  it("returns not_configured for unsupported legacy-style OpenAI rows", async () => {
    const report = await fetchUsageForAccount(makeOpenAIAccount(), resolveRange("month"));

    expect(report.status).toBe("not_configured");
    expect(report.error).toContain("CLIProxyAPI Codex auth-store import");
  });
});

describe("parseOpenAIWhamUsageInfo", () => {
  it("normalizes window keys, preserves raw utilization, and clamps oversized values", () => {
    const info = parseOpenAIWhamUsageInfo({
      email: "dominic.d.cha@gmail.com",
      account_id: "user-K9u1gl39y4MP9ytfE49ynhiT",
      rate_limit: {
        primary_window: { used_percent: 118, reset_at: "2026-04-01T00:00:00Z" },
        secondary_window: { used_percent: 52.25, reset_at: 1_775_520_000 },
      },
    }, makeOpenAIAccount({
      subscriptionInfo: {
        plan: "chatgptplus",
        renewsAt: "2026-04-20",
        billingPeriod: "month",
      },
    }));

    expect(info).toEqual({
      windows: [
        { key: "five_hour", label: "5h", utilization: 100, resetsAt: "2026-04-01T00:00:00Z" },
        { key: "seven_day", label: "7d", utilization: 52.25, resetsAt: "2026-04-07T00:00:00.000Z" },
      ],
      accountIdentity: {
        email: "dominic.d.cha@gmail.com",
        accountId: "user-K9u1gl39y4MP9ytfE49ynhiT",
        planType: null,
      },
      billing: {
        status: "chatgptplus",
        nextChargeDate: "2026-04-20",
        interval: "month",
      },
    });
  });
});

describe("fetchClaudeUsageBatch (initial fetch state)", () => {
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
      .mockResolvedValueOnce(new Response(JSON.stringify([{ uuid: "org-1" }]), { status: 200 }))
      .mockResolvedValueOnce(new Response("rate-limited", { status: 429 }))
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

    try {
      const [report] = await fetchClaudeUsageBatch([account], resolveRange("month"));

      expect(report.status).toBe("pending");
      expect(report.error).toContain("being fetched");
    } finally {
      fsSpy.mockRestore();
      global.fetch = originalFetch;
    }
  });
});

describe("fetchUsageForAccount (Claude CLIProxyAPI auth store)", () => {
  it("uses CLIProxyAPI claude auth files as a direct usage source", async () => {
    const authDir = fs.mkdtempSync(path.join(os.tmpdir(), "cliproxy-claude-"));
    const authPath = path.join(authDir, "claude-user@example.com.json");
    fs.writeFileSync(authPath, JSON.stringify({
      access_token: "sk-ant-oat01-test",
      email: "user@example.com",
      expired: "2026-04-01T00:00:00Z",
    }));

    const originalFetch = global.fetch;
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        account: { email: "user@example.com" },
        organization: { subscription_status: "active", organization_type: "claude_max" },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        five_hour: { utilization: 5, resets_at: "2026-04-01T00:00:00Z" },
        seven_day: { utilization: 40, resets_at: "2026-04-07T00:00:00Z" },
      }), { status: 200 }));

    try {
      const report = await fetchUsageForAccount({
        id: "claude-store-1",
        name: "Claude Auth Store",
        provider: "claude",
        enabled: true,
        authMode: "auth_store",
        syncSource: "cliproxy_claude",
        sourcePath: authPath,
        authIdentity: "user@example.com",
        createdAt: "2026-03-05T00:00:00.000Z",
        updatedAt: "2026-03-05T00:00:00.000Z",
      }, resolveRange("month"));

      expect(report.status).toBe("ok");
      expect(report.usageInfo?.windows).toEqual([
        { key: "five_hour", label: "5h", utilization: 5, resetsAt: "2026-04-01T00:00:00Z" },
        { key: "seven_day", label: "7d", utilization: 40, resetsAt: "2026-04-07T00:00:00Z" },
      ]);
    } finally {
      global.fetch = originalFetch;
      fs.rmSync(authDir, { recursive: true, force: true });
    }
  });
});

describe("testConnection (OpenAI setup sources)", () => {
  it("validates CLIProxyAPI Codex auth-store imports", async () => {
    const authDir = fs.mkdtempSync(path.join(os.tmpdir(), "cliproxy-openai-test-"));
    const authPath = path.join(authDir, "codex-openai@example.com-pro.json");
    fs.writeFileSync(authPath, JSON.stringify({
      access_token: "jwt-token",
      account_id: "acct-123",
      email: "openai@example.com",
    }));

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      email: "openai@example.com",
      account_id: "acct-123",
      plan_type: "pro",
      rate_limit: {
        primary_window: { used_percent: 15 },
        secondary_window: { used_percent: 45 },
      },
    }), { status: 200 }));

    try {
      const result = await testConnection(makeOpenAIAccount({
        authMode: "auth_store",
        syncSource: "cliproxy_codex",
        sourcePath: authPath,
        authIdentity: "openai@example.com",
      }));

      expect(result.ok).toBe(true);
      expect(result.message).toContain("CLIProxyAPI Codex auth source is available");
    } finally {
      global.fetch = originalFetch;
      fs.rmSync(authDir, { recursive: true, force: true });
    }
  });

  it("does not treat stored browser login data as an actual usage source", async () => {
    const result = await testConnection(makeOpenAIAccount({ sessionCookie: "[{\"name\":\"session\"}]" }));

    expect(result.ok).toBe(false);
    expect(result.message).toContain("CLIProxyAPI Codex auth-store import");
  });
});
