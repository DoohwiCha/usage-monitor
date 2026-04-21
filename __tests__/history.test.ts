import { describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/usage-monitor/db";
import { addMonitorAccount } from "@/lib/usage-monitor/store";
import type { AccountUsageReport, MonitorAccount } from "@/lib/usage-monitor/types";
import { sampleUsageHistory, readUsageHistory } from "@/lib/usage-monitor/history";
import {
  fetchClaudeUsageDirect,
  fetchClaudeUsageViaCliProxyAuth,
  fetchOpenAIUsageViaCliProxyAuth,
} from "@/lib/usage-monitor/usage-adapters";

vi.mock("@/lib/usage-monitor/usage-adapters", () => ({
  fetchClaudeUsageDirect: vi.fn(),
  fetchClaudeUsageViaCliProxyAuth: vi.fn(),
  fetchOpenAIUsageViaCliProxyAuth: vi.fn(),
}));

function okReport(account: MonitorAccount): AccountUsageReport {
  return {
    accountId: account.id,
    name: account.name,
    provider: account.provider,
    status: "ok",
    costUsd: 0,
    requests: 0,
    tokens: 0,
    points: [],
    usageInfo: {
      windows: [
        { key: "five_hour", label: "5h", utilization: 12.5, resetsAt: "2026-04-21T05:00:00.000Z" },
        { key: "seven_day", label: "7d", utilization: 37.25, resetsAt: "2026-04-27T00:00:00.000Z" },
      ],
    },
  };
}

describe("sampleUsageHistory", () => {
  it("observes every enabled Claude manual-cookie account in each sampler run", async () => {
    const claudeFetchMock = vi.mocked(fetchClaudeUsageDirect);
    const claudeAuthFetchMock = vi.mocked(fetchClaudeUsageViaCliProxyAuth);
    const openaiFetchMock = vi.mocked(fetchOpenAIUsageViaCliProxyAuth);

    claudeFetchMock.mockImplementation(async (account) => okReport(account));
    claudeAuthFetchMock.mockResolvedValue({
      accountId: "unused",
      name: "unused",
      provider: "claude",
      status: "not_configured",
      costUsd: 0,
      requests: 0,
      tokens: 0,
      points: [],
    });
    openaiFetchMock.mockResolvedValue({
      accountId: "unused",
      name: "unused",
      provider: "openai",
      status: "not_configured",
      costUsd: 0,
      requests: 0,
      tokens: 0,
      points: [],
    });

    await addMonitorAccount({
      name: "Claude One",
      provider: "claude",
      enabled: true,
      sessionCookie: "session=one",
    });
    await addMonitorAccount({
      name: "Claude Two",
      provider: "claude",
      enabled: true,
      sessionCookie: "session=two",
    });

    const result = await sampleUsageHistory(new Date("2026-04-21T01:30:00.000Z"));

    expect(claudeFetchMock).toHaveBeenCalledTimes(2);
    expect(result.observedCount).toBe(4);
    expect(result.carriedForwardCount).toBe(0);
    expect(result.sampledAccountIds).toHaveLength(2);

    const db = getDb();
    const rows = db.prepare(`
      SELECT account_id, window_key, sample_kind
      FROM usage_window_samples
      ORDER BY account_id ASC, window_key ASC
    `).all() as Array<{ account_id: string; window_key: string; sample_kind: string }>;

    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.account_id)).size).toBe(2);
    expect(new Set(rows.map((row) => row.window_key))).toEqual(new Set(["five_hour", "seven_day"]));
    expect(new Set(rows.map((row) => row.sample_kind))).toEqual(new Set(["observed"]));
  });
});

describe("readUsageHistory", () => {
  it("supports a 12h preset and excludes older samples", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T12:00:00.000Z"));
    try {
      const config = await addMonitorAccount({
        name: "Recent Claude",
        provider: "claude",
        enabled: true,
        sessionCookie: "session=recent",
      });
      const account = config.accounts[0];
      const db = getDb();

      const insert = db.prepare(`
        INSERT INTO usage_window_samples (
          account_id, provider, window_key, bucket_start, sampled_at, utilization_pct, resets_at, sample_kind
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insert.run(
        account.id,
        "claude",
        "five_hour",
        "2026-04-20T23:55:00.000Z",
        "2026-04-20T23:55:00.000Z",
        10,
        "2026-04-21T04:55:00.000Z",
        "observed",
      );
      insert.run(
        account.id,
        "claude",
        "five_hour",
        "2026-04-21T00:05:00.000Z",
        "2026-04-21T00:05:00.000Z",
        42,
        "2026-04-21T05:05:00.000Z",
        "observed",
      );

      const history = readUsageHistory([account.id], "12h");
      const series = history.series.find((item) => item.accountId === account.id && item.windowKey === "five_hour");

      expect(history.range.preset).toBe("12h");
      expect(Date.parse(history.range.endIso) - Date.parse(history.range.startIso)).toBe(12 * 60 * 60 * 1000);
      expect(series?.points.map((point) => point.bucketStart)).toEqual(["2026-04-21T00:05:00.000Z"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("downsamples dense history ranges and bounds reset markers", async () => {
    const config = await addMonitorAccount({
      name: "Dense Claude",
      provider: "claude",
      enabled: true,
      sessionCookie: "session=dense",
    });
    const account = config.accounts[0];
    const db = getDb();

    const insert = db.prepare(`
      INSERT INTO usage_window_samples (
        account_id, provider, window_key, bucket_start, sampled_at, utilization_pct, resets_at, sample_kind
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const endTs = Date.parse("2026-04-20T23:55:00.000Z");
    for (let index = 0; index < 2_000; index += 1) {
      const ts = new Date(endTs - ((1_999 - index) * 5 * 60 * 1000)).toISOString();
      insert.run(
        account.id,
        "claude",
        "five_hour",
        ts,
        ts,
        (index % 100) + 0.5,
        new Date(Date.parse(ts) + 5 * 60 * 60 * 1000).toISOString(),
        "observed",
      );
    }

    const history = readUsageHistory([account.id], "all");
    const series = history.series.find((item) => item.accountId === account.id && item.windowKey === "five_hour");

    expect(series).toBeTruthy();
    expect(series?.points.length).toBeLessThanOrEqual(960);
    expect(history.resetMarkers.length).toBeLessThanOrEqual(240);
    expect(series?.points.at(-1)?.bucketStart).toBe("2026-04-20T23:55:00.000Z");
  });
});
