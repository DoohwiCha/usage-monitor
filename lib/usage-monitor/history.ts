import { randomUUID } from "node:crypto";

import { getDb } from "@/lib/usage-monitor/db";
import { logger } from "@/lib/usage-monitor/logger";
import { readMonitorConfig } from "@/lib/usage-monitor/store";
import {
  fetchClaudeUsageDirect,
  fetchClaudeUsageViaCliProxyAuth,
  fetchOpenAIUsageViaCliProxyAuth,
} from "@/lib/usage-monitor/usage-adapters";
import type {
  AccountHistorySeries,
  HistoryRangePreset,
  MonitorAccount,
  ProviderType,
  ResetMarker,
  UsageHistoryPoint,
  UsageHistoryResponse,
  UsageSampleKind,
  WindowKey,
} from "@/lib/usage-monitor/types";

const SAMPLE_BUCKET_MS = 5 * 60 * 1000;
const CHART_WINDOW_KEYS: WindowKey[] = ["five_hour", "seven_day"];
const MAX_POINTS_PER_SERIES = 960;
const MAX_RESET_MARKERS = 240;

interface HistorySampleRow {
  account_id: string;
  provider: ProviderType;
  window_key: WindowKey;
  bucket_start: string;
  sampled_at: string;
  utilization_pct: number;
  resets_at: string | null;
  sample_kind: UsageSampleKind;
}

function floorBucketStart(ts: number): number {
  return ts - (ts % SAMPLE_BUCKET_MS);
}

export function bucketStartIso(date = new Date()): string {
  return new Date(floorBucketStart(date.getTime())).toISOString();
}

function rangeStartMs(preset: HistoryRangePreset, endMs: number): number | null {
  switch (preset) {
    case "12h":
      return endMs - 12 * 60 * 60 * 1000;
    case "24h":
      return endMs - 24 * 60 * 60 * 1000;
    case "7d":
      return endMs - 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return endMs - 30 * 24 * 60 * 60 * 1000;
    case "all":
      return null;
  }
}

function earliestHistoryBucketMs(): number | null {
  const db = getDb();
  const row = db.prepare("SELECT bucket_start FROM usage_window_samples ORDER BY bucket_start ASC LIMIT 1").get() as { bucket_start: string } | undefined;
  if (!row?.bucket_start) return null;
  const parsed = Date.parse(row.bucket_start);
  return Number.isFinite(parsed) ? parsed : null;
}

function carryForwardAllowed(sample: HistorySampleRow, bucketIso: string): boolean {
  if (!sample.resets_at) return true;
  const resetTs = Date.parse(sample.resets_at);
  const bucketTs = Date.parse(bucketIso);
  if (!Number.isFinite(resetTs) || !Number.isFinite(bucketTs)) return true;
  return bucketTs < resetTs;
}

function upsertHistorySample(
  accountId: string,
  provider: ProviderType,
  windowKey: WindowKey,
  bucketIso: string,
  sampledAt: string,
  utilization: number,
  resetsAt: string | null,
  sampleKind: UsageSampleKind,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO usage_window_samples (
      account_id,
      provider,
      window_key,
      bucket_start,
      sampled_at,
      utilization_pct,
      resets_at,
      sample_kind
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, window_key, bucket_start) DO UPDATE SET
      provider = excluded.provider,
      sampled_at = excluded.sampled_at,
      utilization_pct = excluded.utilization_pct,
      resets_at = excluded.resets_at,
      sample_kind = excluded.sample_kind
  `).run(accountId, provider, windowKey, bucketIso, sampledAt, utilization, resetsAt, sampleKind);
}

function loadLatestSample(accountId: string, windowKey: WindowKey): HistorySampleRow | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT account_id, provider, window_key, bucket_start, sampled_at, utilization_pct, resets_at, sample_kind
    FROM usage_window_samples
    WHERE account_id = ? AND window_key = ?
    ORDER BY bucket_start DESC
    LIMIT 1
  `).get(accountId, windowKey) as HistorySampleRow | undefined;
  return row || null;
}

function extractChartWindows(account: MonitorAccount, windows: Array<{ key: WindowKey; utilization: number; resetsAt: string | null }>): Array<{ key: WindowKey; utilization: number; resetsAt: string | null }> {
  const seen = new Set<WindowKey>();
  const filtered: Array<{ key: WindowKey; utilization: number; resetsAt: string | null }> = [];
  for (const window of windows) {
    if (!CHART_WINDOW_KEYS.includes(window.key)) continue;
    if (seen.has(window.key)) continue;
    seen.add(window.key);
    filtered.push({
      key: window.key,
      utilization: Math.max(0, Math.min(window.utilization, 100)),
      resetsAt: window.resetsAt,
    });
  }
  if (!seen.has("five_hour")) {
    logger.debug?.("[history] missing five_hour window", { accountId: account.id, provider: account.provider });
  }
  return filtered;
}

async function fetchObservedWindowsForAccount(
  account: MonitorAccount,
): Promise<Array<{ key: WindowKey; utilization: number; resetsAt: string | null }> | null> {
  if (!account.enabled) return null;

  if (account.provider === "openai") {
    if (!(account.authMode === "auth_store" && account.syncSource === "cliproxy_codex" && account.sourcePath)) {
      return null;
    }
    const report = await fetchOpenAIUsageViaCliProxyAuth(account);
    if (report.status !== "ok" || !report.usageInfo?.windows?.length) return null;
    return extractChartWindows(account, report.usageInfo.windows);
  }

  if (account.authMode === "auth_store" && account.syncSource === "cliproxy_claude" && account.sourcePath) {
    const report = await fetchClaudeUsageViaCliProxyAuth(account);
    if (report.status !== "ok" || !report.usageInfo?.windows?.length) return null;
    return extractChartWindows(account, report.usageInfo.windows);
  }

  if (!account.sessionCookie) return null;

  const report = await fetchClaudeUsageDirect(account);
  if (report.status !== "ok" || !report.usageInfo?.windows?.length) return null;
  return extractChartWindows(account, report.usageInfo.windows);
}

export async function sampleUsageHistory(now = new Date()): Promise<{
  bucketStart: string;
  observedCount: number;
  carriedForwardCount: number;
  sampledAccountIds: string[];
}> {
  const bucketIso = bucketStartIso(now);
  const db = getDb();
  const startedAt = new Date().toISOString();
  const runId = randomUUID();

  db.prepare(`
    INSERT INTO usage_sampler_runs (id, bucket_start, started_at, status, observed_count, carried_forward_count, details_json)
    VALUES (?, ?, ?, 'error', 0, 0, NULL)
    ON CONFLICT(bucket_start) DO UPDATE SET
      id = excluded.id,
      started_at = excluded.started_at,
      finished_at = NULL,
      status = 'error',
      observed_count = 0,
      carried_forward_count = 0,
      details_json = NULL
  `).run(runId, bucketIso, startedAt);

  const config = await readMonitorConfig();
  const activeAccounts = config.accounts.filter((account) => account.enabled);
  let observedCount = 0;
  let carriedForwardCount = 0;
  const sampledAccountIds = new Set<string>();
  const errors: Array<{ accountId: string; error: string }> = [];

  for (const account of activeAccounts) {
    try {
      const observedWindows = await fetchObservedWindowsForAccount(account);
      const observedKeys = new Set<WindowKey>();

      if (observedWindows && observedWindows.length > 0) {
        sampledAccountIds.add(account.id);
        for (const window of observedWindows) {
          observedKeys.add(window.key);
          upsertHistorySample(
            account.id,
            account.provider,
            window.key,
            bucketIso,
            startedAt,
            window.utilization,
            window.resetsAt,
            "observed",
          );
          observedCount += 1;
        }
      }

      for (const windowKey of CHART_WINDOW_KEYS) {
        if (observedKeys.has(windowKey)) continue;
        const latest = loadLatestSample(account.id, windowKey);
        if (!latest || !carryForwardAllowed(latest, bucketIso)) continue;
        upsertHistorySample(
          account.id,
          account.provider,
          windowKey,
          bucketIso,
          startedAt,
          latest.utilization_pct,
          latest.resets_at,
          "carried_forward",
        );
        carriedForwardCount += 1;
      }
    } catch (error) {
      errors.push({ accountId: account.id, error: String(error) });
      logger.error("[history] sampler account failure", { accountId: account.id, error: String(error) });
      for (const windowKey of CHART_WINDOW_KEYS) {
        const latest = loadLatestSample(account.id, windowKey);
        if (!latest || !carryForwardAllowed(latest, bucketIso)) continue;
        upsertHistorySample(
          account.id,
          account.provider,
          windowKey,
          bucketIso,
          startedAt,
          latest.utilization_pct,
          latest.resets_at,
          "carried_forward",
        );
        carriedForwardCount += 1;
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const status = errors.length === 0 ? "ok" : observedCount > 0 || carriedForwardCount > 0 ? "partial" : "error";
  db.prepare(`
    UPDATE usage_sampler_runs
    SET finished_at = ?, status = ?, observed_count = ?, carried_forward_count = ?, details_json = ?
    WHERE bucket_start = ?
  `).run(
    finishedAt,
    status,
    observedCount,
    carriedForwardCount,
    JSON.stringify({
      sampledAccountIds: Array.from(sampledAccountIds),
      errors,
    }),
    bucketIso,
  );

  return {
    bucketStart: bucketIso,
    observedCount,
    carriedForwardCount,
    sampledAccountIds: Array.from(sampledAccountIds),
  };
}

function historyBucketMs(startMs: number, endMs: number): number {
  const rangeMs = Math.max(endMs - startMs, SAMPLE_BUCKET_MS);
  const targetBucketMs = Math.ceil(rangeMs / MAX_POINTS_PER_SERIES);
  const bucketCount = Math.max(1, Math.ceil(targetBucketMs / SAMPLE_BUCKET_MS));
  return bucketCount * SAMPLE_BUCKET_MS;
}

function thinResetMarkers(markers: ResetMarker[]): ResetMarker[] {
  if (markers.length <= MAX_RESET_MARKERS) return markers;
  const stride = Math.ceil(markers.length / MAX_RESET_MARKERS);
  return markers.filter((_, index) => index % stride === 0 || index === markers.length - 1);
}

export function readUsageHistory(accountIds: string[] | null, preset: HistoryRangePreset): UsageHistoryResponse {
  const db = getDb();
  const now = new Date();
  const endMs = now.getTime();
  const startMs = rangeStartMs(preset, endMs) ?? earliestHistoryBucketMs() ?? endMs;
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  const bucketMs = historyBucketMs(startMs, endMs);
  const bucketSeconds = Math.max(1, Math.floor(bucketMs / 1000));
  const startEpoch = Math.floor(startMs / 1000);

  const params: unknown[] = [startEpoch, bucketSeconds, startIso, endIso];
  const whereAccountClause = accountIds && accountIds.length > 0
    ? `AND filtered.account_id IN (${accountIds.map(() => "?").join(", ")})`
    : "";
  if (accountIds && accountIds.length > 0) {
    params.push(...accountIds);
  }

  const rows = db.prepare(`
    WITH filtered AS (
      SELECT
        samples.account_id,
        accounts.name AS account_name,
        samples.provider,
        samples.window_key,
        samples.bucket_start,
        samples.utilization_pct,
        samples.resets_at,
        samples.sample_kind,
        CAST((unixepoch(samples.bucket_start) - ?) / ? AS INTEGER) AS history_bucket
      FROM usage_window_samples samples
      INNER JOIN accounts ON accounts.id = samples.account_id
      WHERE samples.bucket_start >= ?
        AND samples.bucket_start <= ?
        AND accounts.deleted_at IS NULL
    ),
    ranked AS (
      SELECT
        filtered.account_id,
        filtered.account_name,
        filtered.provider,
        filtered.window_key,
        filtered.bucket_start,
        filtered.utilization_pct,
        filtered.resets_at,
        filtered.sample_kind,
        ROW_NUMBER() OVER (
          PARTITION BY filtered.account_id, filtered.window_key, filtered.history_bucket
          ORDER BY filtered.bucket_start DESC
        ) AS row_rank
      FROM filtered
      WHERE 1 = 1
        ${whereAccountClause}
    )
    SELECT
      account_id,
      account_name,
      provider,
      window_key,
      bucket_start,
      utilization_pct,
      resets_at,
      sample_kind
    FROM ranked
    WHERE row_rank = 1
    ORDER BY account_id ASC, window_key ASC, bucket_start ASC
  `).all(...params) as Array<{
    account_id: string;
    account_name: string;
    provider: ProviderType;
    window_key: WindowKey;
    bucket_start: string;
    utilization_pct: number;
    resets_at: string | null;
    sample_kind: UsageSampleKind;
  }>;

  const seriesMap = new Map<string, AccountHistorySeries>();
  const resetMarkers: ResetMarker[] = [];
  const seenResetMarkers = new Set<string>();

  for (const row of rows) {
    const key = `${row.account_id}:${row.window_key}`;
    const series = seriesMap.get(key) || {
      accountId: row.account_id,
      accountName: row.account_name,
      provider: row.provider,
      windowKey: row.window_key,
      points: [],
    };
    const point: UsageHistoryPoint = {
      bucketStart: row.bucket_start,
      utilization: row.utilization_pct,
      resetsAt: row.resets_at,
      sampleKind: row.sample_kind,
    };
    series.points.push(point);
    seriesMap.set(key, series);

    if (row.window_key === "five_hour" && row.resets_at) {
      const resetKey = `${row.account_id}:${row.resets_at}`;
      if (!seenResetMarkers.has(resetKey)) {
        seenResetMarkers.add(resetKey);
        resetMarkers.push({
          accountId: row.account_id,
          accountName: row.account_name,
          provider: row.provider,
          at: row.resets_at,
        });
      }
    }
  }

  return {
    range: {
      preset,
      startIso,
      endIso,
    },
    series: Array.from(seriesMap.values()),
    resetMarkers: thinResetMarkers(
      resetMarkers.sort((left, right) => left.at.localeCompare(right.at)),
    ),
  };
}
