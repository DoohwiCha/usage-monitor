import type { AccountUsageReport, ProviderUsageInfo, UtilizationWindow, MonitorAccount, ResolvedRange, UsagePoint, CodexMetrics } from "@/lib/usage-monitor/types";
import { toUtcDayKey } from "@/lib/usage-monitor/range";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getCached, setCached, getStale, isRateLimited, markRateLimited } from "@/lib/usage-monitor/usage-cache";
import { logger } from "@/lib/usage-monitor/logger";
import { getDb } from "@/lib/usage-monitor/db";
import { acquireBrowserSlot, releaseBrowserSlot } from "@/lib/usage-monitor/browser-pool";
import { resolveBrowserProfileCandidates } from "@/lib/usage-monitor/browser-profile-path";

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function with2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyReport(account: MonitorAccount, status: AccountUsageReport["status"], error?: string): AccountUsageReport {
  return {
    accountId: account.id,
    name: account.name,
    provider: account.provider,
    status,
    costUsd: 0,
    requests: 0,
    tokens: 0,
    points: [],
    error,
  };
}

function mergePoints(points: UsagePoint[]): UsagePoint[] {
  const map = new Map<string, UsagePoint>();
  for (const point of points) {
    const prev = map.get(point.date);
    if (!prev) {
      map.set(point.date, { ...point });
      continue;
    }
    prev.costUsd += point.costUsd;
    prev.requests += point.requests;
    prev.tokens += point.tokens;
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function sumReport(account: MonitorAccount, status: AccountUsageReport["status"], points: UsagePoint[]): AccountUsageReport {
  const merged = mergePoints(points);
  return {
    accountId: account.id,
    name: account.name,
    provider: account.provider,
    status,
    costUsd: with2(merged.reduce((sum, p) => sum + p.costUsd, 0)),
    requests: Math.round(merged.reduce((sum, p) => sum + p.requests, 0)),
    tokens: Math.round(merged.reduce((sum, p) => sum + p.tokens, 0)),
    points: merged.map((p) => ({
      ...p,
      costUsd: with2(p.costUsd),
      requests: Math.round(p.requests),
      tokens: Math.round(p.tokens),
    })),
  };
}

async function fetchJson(url: string, headers: HeadersInit): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error("[fetchJson] HTTP error from external API", { status: response.status, url, body: body.slice(0, 500) });
    throw new Error(`External API request failed (HTTP ${response.status})`);
  }

  return response.json();
}

// ─── OpenAI (Admin API Key) ───────────────────────────────────────

function buildOpenAIHeaders(account: MonitorAccount): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${account.apiKey}`,
  };
  if (account.organizationId) {
    headers["OpenAI-Organization"] = account.organizationId;
  }
  return headers;
}

export async function fetchOpenAIIdentity(account: MonitorAccount): Promise<{ email: string; name: string } | null> {
  if (!account.apiKey) return null;
  try {
    const headers = buildOpenAIHeaders(account);
    const raw = await fetchJson("https://api.openai.com/v1/organization/users?limit=50", headers) as {
      data?: Array<{ email?: string; name?: string; role?: string }>;
    };
    if (!raw.data || !Array.isArray(raw.data)) return null;
    const owner = raw.data.find(u => u.role === "owner") || raw.data[0];
    if (!owner?.email) return null;
    return { email: owner.email, name: owner.name || "" };
  } catch {
    return null;
  }
}

function parseOpenAICostPoints(raw: unknown): UsagePoint[] {
  const points: UsagePoint[] = [];
  const buckets = (raw as { data?: Array<{ start_time?: number; results?: Array<{ amount?: { value?: number } }> }> })?.data || [];

  for (const bucket of buckets) {
    const date = toUtcDayKey(new Date(toNumber(bucket.start_time) * 1000));
    const cost = (bucket.results || []).reduce((sum, result) => sum + toNumber(result.amount?.value), 0);
    points.push({ date, costUsd: cost, requests: 0, tokens: 0 });
  }
  return points;
}

function parseOpenAIUsagePoints(raw: unknown): UsagePoint[] {
  const points: UsagePoint[] = [];
  const buckets = (raw as { data?: Array<{ start_time?: number; results?: Array<Record<string, unknown>> }> })?.data || [];

  for (const bucket of buckets) {
    const date = toUtcDayKey(new Date(toNumber(bucket.start_time) * 1000));
    let requests = 0;
    let tokens = 0;

    for (const result of bucket.results || []) {
      requests += toNumber(result.num_model_requests) || toNumber(result.requests) || toNumber(result.request_count);
      tokens += toNumber(result.input_tokens);
      tokens += toNumber(result.output_tokens);
      tokens += toNumber(result.input_cached_tokens);
      tokens += toNumber(result.input_audio_tokens);
      tokens += toNumber(result.output_audio_tokens);
    }

    points.push({ date, costUsd: 0, requests, tokens });
  }

  return points;
}

type OpenAIStatusMetrics = {
  five_hour_limit_pct?: number;
  weekly_limit_pct?: number;
  last_activity?: string;
  total_turns?: number;
  session_turns?: number;
  session_input_tokens?: number;
  session_output_tokens?: number;
  session_total_tokens?: number;
};

type CodexQuotaSnapshot = {
  five_hour_limit_pct?: number;
  weekly_limit_pct?: number;
  timestamp?: string;
};

function readLatestCodexQuotaSnapshot(): CodexQuotaSnapshot | null {
  const sessionsRoot = path.join(process.env.HOME || os.homedir(), ".codex", "sessions");
  if (!fs.existsSync(sessionsRoot)) return null;

  const sessionFiles: string[] = [];
  const stack = [sessionsRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        sessionFiles.push(fullPath);
      }
    }
  }

  sessionFiles.sort((a, b) => b.localeCompare(a));

  for (const file of sessionFiles.slice(0, 20)) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const lines = content.trim().split("\n").reverse();
    for (const line of lines) {
      try {
        const row = JSON.parse(line) as {
          timestamp?: string;
          type?: string;
          payload?: {
            type?: string;
            rate_limits?: {
              primary?: { used_percent?: number };
              secondary?: { used_percent?: number };
            };
          };
        };

        if (row.type !== "event_msg" || row.payload?.type !== "token_count") continue;

        const primary = row.payload.rate_limits?.primary?.used_percent;
        const secondary = row.payload.rate_limits?.secondary?.used_percent;
        if (typeof primary !== "number" && typeof secondary !== "number") continue;

        return {
          ...(typeof primary === "number" ? { five_hour_limit_pct: primary } : {}),
          ...(typeof secondary === "number" ? { weekly_limit_pct: secondary } : {}),
          ...(row.timestamp ? { timestamp: row.timestamp } : {}),
        };
      } catch {
        continue;
      }
    }
  }

  return null;
}

function buildOpenAIBilling(account: MonitorAccount): ProviderUsageInfo["billing"] | undefined {
  return account.subscriptionInfo?.plan
    ? {
        status: account.subscriptionInfo.plan,
        nextChargeDate: account.subscriptionInfo.renewsAt || null,
        interval: account.subscriptionInfo.billingPeriod || null,
      }
    : undefined;
}

export function parseOpenAIWhamUsageInfo(raw: unknown, account: MonitorAccount): ProviderUsageInfo | undefined {
  return parseOpenAIWhamUsageInfoWithIdentity(raw, account);
}

function parseOpenAIWhamUsageInfoWithIdentity(
  raw: unknown,
  account: MonitorAccount,
  identity?: { email?: string | null; accountId?: string | null; planType?: string | null },
): ProviderUsageInfo | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const data = raw as Record<string, unknown>;
  const rateLimit = data.rate_limit as Record<string, unknown> | undefined;
  const primaryWindow = rateLimit?.primary_window as Record<string, unknown> | undefined;
  const secondaryWindow = rateLimit?.secondary_window as Record<string, unknown> | undefined;

  const windows: UtilizationWindow[] = [];
  if (typeof primaryWindow?.used_percent === "number") {
    windows.push({
      label: "5h",
      utilization: Math.min(Math.round(primaryWindow.used_percent), 100),
      resetsAt: null,
    });
  }
  if (typeof secondaryWindow?.used_percent === "number") {
    windows.push({
      label: "wk",
      utilization: Math.min(Math.round(secondaryWindow.used_percent), 100),
      resetsAt: null,
    });
  }

  const billing = buildOpenAIBilling(account) || (typeof data.plan_type === "string"
    ? {
        status: String(data.plan_type),
        nextChargeDate: null,
        interval: null,
      }
    : undefined);

  if (windows.length === 0 && !billing) return undefined;
  return {
    windows,
    sourceScope: "account",
    accountIdentity: {
      email: identity?.email || (typeof data.email === "string" ? data.email : null),
      accountId: identity?.accountId || (typeof data.account_id === "string" ? data.account_id : null),
      planType: identity?.planType || (typeof data.plan_type === "string" ? data.plan_type : null),
    },
    ...(billing ? { billing } : {}),
  };
}

async function fetchOpenAIUsageViaBrowserProfile(account: MonitorAccount): Promise<AccountUsageReport | null> {
  const profilePaths = resolveBrowserProfileCandidates("openai", account.id).filter((candidate) => fs.existsSync(candidate));
  if (profilePaths.length === 0) return null;

  const playwright = await import("playwright").catch(() => null);
  if (!playwright) return null;

  await acquireBrowserSlot();
  try {
    for (const profilePath of profilePaths) {
      let context: Awaited<ReturnType<typeof playwright.chromium.launchPersistentContext>> | undefined;
      try {
        context = await playwright.chromium.launchPersistentContext(profilePath, {
          headless: true,
          args: [
            "--disable-gpu",
            "--disable-gpu-compositing",
            "--use-gl=swiftshader",
            "--ozone-platform=x11",
          ],
          userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          locale: "en-US",
          timezoneId: "America/New_York",
        });

        const cookies = await context.cookies("https://chatgpt.com");
        const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
        if (!cookieHeader) continue;

        const commonHeaders = {
          Cookie: cookieHeader,
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://chatgpt.com/",
          "Origin": "https://chatgpt.com",
        };

        const sessionRes = await fetch("https://chatgpt.com/api/auth/session", { headers: commonHeaders });
        if (!sessionRes.ok) continue;
        const sessionJson = await sessionRes.json() as {
          accessToken?: string;
          user?: { email?: string };
          account?: { id?: string; planType?: string };
        };
        if (!sessionJson.accessToken || !sessionJson.account?.id) continue;

        const usageRes = await fetch("https://chatgpt.com/backend-api/wham/usage", {
          headers: {
            "Authorization": `Bearer ${sessionJson.accessToken}`,
            "ChatGPT-Account-Id": sessionJson.account.id,
            "User-Agent": commonHeaders["User-Agent"],
            "Accept": commonHeaders["Accept"],
            "Accept-Language": commonHeaders["Accept-Language"],
            "Referer": commonHeaders["Referer"],
            "Origin": commonHeaders["Origin"],
          },
        });
        if (!usageRes.ok) continue;

        const usageJson = await usageRes.json();
        const usageInfo = parseOpenAIWhamUsageInfoWithIdentity(usageJson, {
          ...account,
          subscriptionInfo: account.subscriptionInfo || (sessionJson.account.planType ? { plan: sessionJson.account.planType } : null),
        }, {
          email: sessionJson.user?.email || null,
          accountId: sessionJson.account.id,
          planType: sessionJson.account.planType || null,
        });
        if (!usageInfo) continue;

        const report = emptyReport(account, "ok");
        report.usageInfo = usageInfo;
        return report;
      } catch (error) {
        logger.warn("[fetchOpenAIUsageViaBrowserProfile] candidate failed", { accountId: account.id, profilePath, error: String(error) });
      } finally {
        if (context) await context.close().catch(() => {});
      }
    }
    return null;
  } finally {
    releaseBrowserSlot();
  }
}

function buildOpenAIStatusUsageInfo(
  account: MonitorAccount,
  metrics?: OpenAIStatusMetrics,
): ProviderUsageInfo | undefined {
  const billing = buildOpenAIBilling(account);
  const windows: UtilizationWindow[] = [];

  if (typeof metrics?.five_hour_limit_pct === "number") {
    windows.push({
      label: "5h",
      utilization: Math.min(Math.round(metrics.five_hour_limit_pct), 100),
      resetsAt: null,
    });
  }
  if (typeof metrics?.weekly_limit_pct === "number") {
    windows.push({
      label: "wk",
      utilization: Math.min(Math.round(metrics.weekly_limit_pct), 100),
      resetsAt: null,
    });
  }

  const codexMetrics: CodexMetrics | undefined = metrics
    ? {
        totalTurns: toNumber(metrics.total_turns),
        sessionTurns: toNumber(metrics.session_turns),
        sessionInputTokens: toNumber(metrics.session_input_tokens),
        sessionOutputTokens: toNumber(metrics.session_output_tokens),
        sessionTotalTokens: toNumber(metrics.session_total_tokens),
        lastActivity: metrics.last_activity || null,
      }
    : undefined;

  const hasCodexData = codexMetrics
    ? codexMetrics.totalTurns > 0 ||
      codexMetrics.sessionTurns > 0 ||
      codexMetrics.sessionInputTokens > 0 ||
      codexMetrics.sessionOutputTokens > 0 ||
      codexMetrics.sessionTotalTokens > 0 ||
      codexMetrics.lastActivity !== null
    : false;

  if (windows.length === 0 && !billing && !hasCodexData) {
    return undefined;
  }

  return {
    windows,
    sourceScope: account.apiKey ? "account" : "shared_local",
    ...(billing ? { billing } : {}),
    ...(hasCodexData && codexMetrics ? { codexMetrics } : {}),
  };
}

async function readOpenAIStatusUsageInfo(account: MonitorAccount): Promise<{ usageInfo?: ProviderUsageInfo; metricsFound: boolean }> {
  const fs = await import("fs/promises");
  const metricsPath = path.join(process.env.HOME || "/root", ".omx", "metrics.json");

  try {
    const raw = await fs.readFile(metricsPath, "utf-8");
    const metrics = JSON.parse(raw) as OpenAIStatusMetrics;
    const shouldUseQuotaFallback =
      (metrics.five_hour_limit_pct == null || metrics.five_hour_limit_pct === 0) &&
      (metrics.weekly_limit_pct == null || metrics.weekly_limit_pct === 0);
    const quotaSnapshot = shouldUseQuotaFallback ? readLatestCodexQuotaSnapshot() : null;
    const mergedMetrics: OpenAIStatusMetrics = {
      ...metrics,
      ...(quotaSnapshot?.five_hour_limit_pct != null ? { five_hour_limit_pct: quotaSnapshot.five_hour_limit_pct } : {}),
      ...(quotaSnapshot?.weekly_limit_pct != null ? { weekly_limit_pct: quotaSnapshot.weekly_limit_pct } : {}),
      ...(!metrics.last_activity && quotaSnapshot?.timestamp ? { last_activity: quotaSnapshot.timestamp } : {}),
    };
    return {
      usageInfo: buildOpenAIStatusUsageInfo(account, mergedMetrics),
      metricsFound: true,
    };
  } catch {
    return {
      usageInfo: buildOpenAIStatusUsageInfo(account),
      metricsFound: false,
    };
  }
}

async function fetchOpenAIUsage(account: MonitorAccount, range: ResolvedRange): Promise<AccountUsageReport> {
  const headers = buildOpenAIHeaders(account);

  const costsUrl = new URL("/v1/organization/costs", "https://api.openai.com");
  costsUrl.searchParams.set("start_time", String(range.startUnix));
  costsUrl.searchParams.set("end_time", String(range.endUnix));
  costsUrl.searchParams.set("bucket_width", "1d");

  const usageUrl = new URL("/v1/organization/usage/completions", "https://api.openai.com");
  usageUrl.searchParams.set("start_time", String(range.startUnix));
  usageUrl.searchParams.set("end_time", String(range.endUnix));
  usageUrl.searchParams.set("bucket_width", "1d");

  const [costRaw, usageRaw, statusUsage] = await Promise.all([
    fetchJson(costsUrl.toString(), headers),
    fetchJson(usageUrl.toString(), headers),
    readOpenAIStatusUsageInfo(account),
  ]);

  const points = [
    ...parseOpenAICostPoints(costRaw),
    ...parseOpenAIUsagePoints(usageRaw),
  ];

  const report = sumReport(account, "ok", points);
  if (statusUsage.usageInfo) {
    report.usageInfo = statusUsage.usageInfo;
  }
  return report;
}

// ─── OpenAI (oh-my-codex metrics file read) ──────────────────────

async function fetchOpenAIMetricsUsage(account: MonitorAccount): Promise<AccountUsageReport> {
  const statusUsage = await readOpenAIStatusUsageInfo(account);
  if (!statusUsage.usageInfo) {
    return statusUsage.metricsFound
      ? emptyReport(account, "not_configured", "OpenAI usage metrics are not available.")
      : emptyReport(account, "not_configured", "oh-my-codex metrics not found (~/.omx/metrics.json)");
  }

  const report = emptyReport(account, "ok");
  report.usageInfo = statusUsage.usageInfo;
  return report;
}

// ─── Claude (Session Cookie + Playwright) ────────────────────────

function parseCookieString(cookieStr: string, domain = ".claude.ai"): Array<{ name: string; value: string; domain: string; path: string; secure?: boolean }> {
  return cookieStr
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eqIdx = part.indexOf("=");
      if (eqIdx <= 0) return null;
      const name = part.slice(0, eqIdx).trim();
      const value = part.slice(eqIdx + 1).trim();
      if (!name) return null;

      // __Host- cookies require no domain, secure + path=/ mandatory
      if (name.startsWith("__Host-")) {
        return { name, value, domain: domain.replace(/^\./, ""), path: "/", secure: true };
      }
      // __Secure- cookies require secure flag
      if (name.startsWith("__Secure-")) {
        return { name, value, domain, path: "/", secure: true };
      }

      return { name, value, domain, path: "/" };
    })
    .filter((c): c is { name: string; value: string; domain: string; path: string; secure?: boolean } => c !== null);
}

// ─── Claude OAuth Direct API (no Playwright needed) ──────────────

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export function matchClaudeOAuthAccount(
  eligibleAccounts: MonitorAccount[],
  profileEmailRaw: string,
): MonitorAccount | undefined {
  const profileEmail = profileEmailRaw.trim().toLowerCase();
  if (!profileEmail || !profileEmail.includes("@")) {
    return undefined;
  }
  return eligibleAccounts.find((account) => account.name.trim().toLowerCase() === profileEmail);
}

function readLocalOAuthCredentials(): OAuthCredentials | null {
  try {
    const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
    const raw = fs.readFileSync(credPath, "utf-8");
    const parsed = JSON.parse(raw);
    const creds = parsed.claudeAiOauth || parsed;
    if (!creds.accessToken) return null;
    return {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken || "",
      expiresAt: typeof creds.expiresAt === "number" ? creds.expiresAt : 0,
    };
  } catch {
    return null;
  }
}

async function refreshOAuthToken(refreshToken: string): Promise<OAuthCredentials | null> {
  try {
    const clientId = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
    const res = await fetch("https://platform.claude.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    if (!data.access_token) return null;
    const newCreds: OAuthCredentials = {
      accessToken: String(data.access_token),
      refreshToken: data.refresh_token ? String(data.refresh_token) : refreshToken,
      expiresAt: data.expires_at
        ? Number(data.expires_at) * 1000
        : Date.now() + (Number(data.expires_in) || 3600) * 1000,
    };
    // Write refreshed credentials back
    try {
      const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
      const existing = JSON.parse(fs.readFileSync(credPath, "utf-8"));
      if (existing.claudeAiOauth) {
        existing.claudeAiOauth.accessToken = newCreds.accessToken;
        existing.claudeAiOauth.refreshToken = newCreds.refreshToken;
        existing.claudeAiOauth.expiresAt = newCreds.expiresAt;
      }
      const tmpPath = credPath + ".tmp";
      fs.writeFileSync(tmpPath, JSON.stringify(existing));
      fs.renameSync(tmpPath, credPath);
    } catch { /* skip writeback */ }
    return newCreds;
  } catch {
    return null;
  }
}

async function getValidOAuthCredentials(): Promise<OAuthCredentials | null> {
  let creds = readLocalOAuthCredentials();
  if (!creds) return null;
  // Refresh if less than 5 minutes remaining
  if (creds.expiresAt < Date.now() + 5 * 60 * 1000) {
    if (!creds.refreshToken) return null;
    const refreshed = await refreshOAuthToken(creds.refreshToken);
    if (!refreshed) return null;
    creds = refreshed;
  }
  return creds;
}

async function fetchOAuthProfile(accessToken: string): Promise<{ email: string; name: string } | null> {
  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/profile", {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    const account = data.account as Record<string, unknown> | undefined;
    const email = String(account?.email || "");
    const name = String(account?.full_name || account?.display_name || "");
    return email ? { email, name } : null;
  } catch {
    return null;
  }
}

async function fetchClaudeUsageViaOAuth(accessToken: string): Promise<ProviderUsageInfo> {
  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { windows: [] };
    const data = await res.json();
    return parseClaudeUsageInfo([data]);
  } catch {
    return { windows: [] };
  }
}

// ─── Claude cf_clearance refresh via Playwright ──────────────────

async function refreshCfClearance(account: MonitorAccount): Promise<string | null> {
  const cookieStr = account.sessionCookie || "";
  if (!cookieStr) return null;

  logger.info("[refreshCfClearance] Refreshing cf_clearance via browser", { accountId: account.id });

  try {
    const { withBrowser } = await import("@/lib/usage-monitor/browser-pool");

    return await withBrowser(async (browser) => {
      const cookies = parseCookieString(cookieStr);

      const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        locale: "en-US",
        timezoneId: "America/New_York",
        extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
      });

      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      });

      await context.addCookies(cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain || ".claude.ai",
        path: c.path || "/",
        ...(c.secure ? { secure: true } : {}),
      })));

      const page = await context.newPage();
      await page.goto("https://claude.ai/", { waitUntil: "domcontentloaded", timeout: 30_000 });

      // Wait for Cloudflare challenge to resolve (poll every 5s, up to 3 times)
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.waitForTimeout(5_000);
        const pageCookies = await context.cookies("https://claude.ai");
        if (pageCookies.some(c => c.name === "cf_clearance")) {
          const claudeCookies = pageCookies.filter(c =>
            c.domain === ".claude.ai" || c.domain === "claude.ai"
          );
          const newCookieStr = claudeCookies.map(c => `${c.name}=${c.value}`).join("; ");
          await context.close();

          // Persist refreshed cookies to DB
          const { updateMonitorAccount } = await import("@/lib/usage-monitor/store");
          await updateMonitorAccount(account.id, { sessionCookie: newCookieStr });

          logger.info("[refreshCfClearance] Success", { accountId: account.id });
          return newCookieStr;
        }
      }

      await context.close();
      logger.warn("[refreshCfClearance] cf_clearance not obtained after 15s", { accountId: account.id });
      return null;
    });
  } catch (error) {
    logger.error("[refreshCfClearance] Failed", { accountId: account.id, error: String(error) });
    return null;
  }
}

// ─── Claude Direct Fetch (session cookies + cf_clearance) ────────

const CLAUDE_API_HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://claude.ai/",
  "Origin": "https://claude.ai",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

async function fetchClaudeUsageDirect(account: MonitorAccount, allowCfRefresh = true): Promise<AccountUsageReport> {
  const cookieStr = account.sessionCookie || "";
  if (!cookieStr) return emptyReport(account, "not_configured", "Session cookie is empty.");

  const headers = { ...CLAUDE_API_HEADERS, Cookie: cookieStr };

  try {
    // Step 1: Get organizations
    const orgsRes = await fetch("https://claude.ai/api/organizations", {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (orgsRes.status === 403) {
      if (allowCfRefresh) {
        // cf_clearance may have expired — try to refresh via Playwright
        const newCookieStr = await refreshCfClearance(account);
        if (newCookieStr) {
          return fetchClaudeUsageDirect({ ...account, sessionCookie: newCookieStr }, false);
        }
      }
      return emptyReport(account, "error", "Session blocked by Cloudflare (403). Re-login needed.");
    }
    if (orgsRes.status === 401) {
      return emptyReport(account, "error", "Session cookie expired. Please login again.");
    }
    if (!orgsRes.ok) {
      return emptyReport(account, "error", `Organizations API failed (HTTP ${orgsRes.status})`);
    }

    const orgs = (await orgsRes.json()) as Array<{ uuid: string }>;
    if (!Array.isArray(orgs) || orgs.length === 0) {
      return emptyReport(account, "error", "No organizations found.");
    }

    const orgId = orgs[0].uuid;

    // Persist orgId if not yet stored, and detect duplicate orgs across accounts
    if (!account.organizationId || account.organizationId !== orgId) {
      try {
        const db = getDb();
        db.prepare("UPDATE accounts SET organization_id = ?, updated_at = datetime('now') WHERE id = ?").run(orgId, account.id);
        const dup = db.prepare("SELECT id, name FROM accounts WHERE organization_id = ? AND id != ?").get(orgId, account.id) as { id: string; name: string } | undefined;
        if (dup) {
          logger.warn("[fetchClaudeUsageDirect] Duplicate org detected — usage will be identical", {
            accountId: account.id, accountName: account.name,
            duplicateId: dup.id, duplicateName: dup.name, orgId,
          });
        }
      } catch { /* best-effort */ }
    }

    const dataList: unknown[] = [];

    // Step 2: Fetch usage + subscription in parallel (different rate limit pools)
    const [usageRes, subRes] = await Promise.all([
      fetch(`https://claude.ai/api/organizations/${orgId}/usage`, {
        headers, cache: "no-store", signal: AbortSignal.timeout(15_000),
      }),
      fetch(`https://claude.ai/api/organizations/${orgId}/subscription_details`, {
        headers, cache: "no-store", signal: AbortSignal.timeout(15_000),
      }).catch(() => null),
    ]);

    if (usageRes.ok) {
      try { dataList.push(await usageRes.json()); } catch { /* skip */ }
    } else if (usageRes.status === 429) {
      markRateLimited(`usage:${account.id}`);
      logger.warn("[fetchClaudeUsageDirect] Usage API rate-limited, backing off 5min", { accountId: account.id });
    } else {
      logger.warn("[fetchClaudeUsageDirect] Usage API returned non-OK", {
        accountId: account.id,
        status: usageRes.status,
      });
    }

    // Subscription details for billing info (plan type, next charge, etc.)
    if (subRes?.ok) {
      try { dataList.push(await subRes.json()); } catch { /* skip */ }
    }

    const usageInfo = parseClaudeUsageInfo(dataList);
    return {
      accountId: account.id,
      name: account.name,
      provider: account.provider,
      status: "ok" as const,
      costUsd: 0,
      requests: 0,
      tokens: 0,
      points: [],
      usageInfo,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error("[fetchClaudeUsageDirect] Error", { accountId: account.id, error: msg });
    return emptyReport(account, "error", `Failed to fetch Claude usage: ${msg}`);
  }
}

// ─── SQLite usage snapshot persistence ───────────────────────────

function saveSnapshot(accountId: string, report: AccountUsageReport): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO usage_snapshots (account_id, fetched_at, usage_json)
      VALUES (?, datetime('now'), ?)
      ON CONFLICT(account_id) DO UPDATE SET fetched_at = datetime('now'), usage_json = excluded.usage_json
    `).run(accountId, JSON.stringify(report));
  } catch { /* table may not exist yet on first run */ }
}

function loadSnapshot(account: MonitorAccount): AccountUsageReport | null {
  try {
    const db = getDb();
    const row = db.prepare("SELECT usage_json FROM usage_snapshots WHERE account_id = ?").get(account.id) as { usage_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.usage_json) as AccountUsageReport;
  } catch {
    return null;
  }
}

// ─── Rotating queue: fetch 1 account per cycle ───────────────────

let claudeQueueIndex = 0;
const CLAUDE_INITIAL_FETCH_PENDING_ERROR = "Usage data is being fetched. Please refresh shortly.";

/** Fetch usage for all Claude accounts: rotating queue (1 per cycle), with persistent snapshots. */
export async function fetchClaudeUsageBatch(accounts: MonitorAccount[], range: ResolvedRange): Promise<AccountUsageReport[]> {
  void range;
  // Step 1: Build results from cache → stale → DB snapshot → empty
  const results: Map<string, AccountUsageReport> = new Map();
  for (const account of accounts) {
    if (!account.sessionCookie) {
      results.set(account.id, emptyReport(account, "not_configured", "Session cookie is empty."));
      continue;
    }
    const cached = getCached<AccountUsageReport>(`usage:${account.id}`);
    if (cached) { results.set(account.id, cached); continue; }
    const stale = getStale<AccountUsageReport>(`usage:${account.id}`);
    if (stale) { results.set(account.id, stale); continue; }
    const snapshot = loadSnapshot(account);
    if (snapshot) { results.set(account.id, snapshot); continue; }
    // No cached/stale/snapshot data yet: report a truthful pending state instead of synthetic "ok".
    results.set(account.id, emptyReport(account, "pending", CLAUDE_INITIAL_FETCH_PENDING_ERROR));
  }

  // Step 2: Find accounts eligible for a fresh fetch (not cached, not rate-limited)
  const eligible = accounts.filter(a =>
    a.sessionCookie &&
    !getCached<AccountUsageReport>(`usage:${a.id}`) &&
    !isRateLimited(`usage:${a.id}`)
  );

  if (eligible.length === 0) {
    return accounts.map(a => results.get(a.id) || emptyReport(a, "error", "Unknown error"));
  }

  // Step 3: Try OAuth for one matching account (if credentials exist)
  let oauthHandledId: string | null = null;
  try {
    const creds = await getValidOAuthCredentials();
    if (creds) {
      const profile = await fetchOAuthProfile(creds.accessToken);
      if (profile) {
        const matchedAccount = matchClaudeOAuthAccount(eligible, profile.email);
        if (matchedAccount) {
          const usageInfo = await fetchClaudeUsageViaOAuth(creds.accessToken);
          if (usageInfo.windows.length > 0) {
            const report: AccountUsageReport = {
              accountId: matchedAccount.id, name: matchedAccount.name,
              provider: matchedAccount.provider, status: "ok",
              costUsd: 0, requests: 0, tokens: 0, points: [], usageInfo,
            };
            setCached(`usage:${matchedAccount.id}`, report);
            saveSnapshot(matchedAccount.id, report);
            results.set(matchedAccount.id, report);
            oauthHandledId = matchedAccount.id;
          }
        }
      }
    }
  } catch { /* skip OAuth */ }

  // Step 4: Pick ONE account from the rotating queue (not the OAuth one)
  const fetchable = eligible.filter(a => a.id !== oauthHandledId);
  if (fetchable.length > 0) {
    const account = fetchable[claudeQueueIndex % fetchable.length];
    claudeQueueIndex++;

    logger.info("[fetchClaudeUsageBatch] Rotating fetch", {
      accountId: account.id, name: account.name, queuePos: claudeQueueIndex,
    });

    try {
      const report = await fetchClaudeUsageDirect(account);
      const hasWindows = (report.usageInfo?.windows?.length ?? 0) > 0;
      if (report.status === "ok" && hasWindows) {
        // Only cache/persist when we actually got usage data
        const jitter = Math.floor(Math.random() * 5 * 60 * 1000);
        setCached(`usage:${account.id}`, report, 10 * 60 * 1000 + jitter);
        saveSnapshot(account.id, report);
        results.set(account.id, report);
      } else if (report.status === "ok" && !hasWindows) {
        // Got OK but no windows (likely 429 on /usage) — keep existing data
        logger.info("[fetchClaudeUsageBatch] No windows returned, keeping existing data", { accountId: account.id });
      } else {
        results.set(account.id, report);
      }
    } catch (error) {
      logger.error("[fetchClaudeUsageBatch] Fetch error", { accountId: account.id, error: String(error) });
    }
  }

  return accounts.map(a => results.get(a.id) || emptyReport(a, "error", "Unknown error"));
}

interface ClaudeUtilizationRaw {
  utilization?: number;
  resets_at?: string | null;
}

const CLAUDE_WINDOW_LABELS: Record<string, string> = {
  five_hour: "5h",
  seven_day: "7d",
  seven_day_opus: "7d Opus",
  seven_day_sonnet: "7d Sonnet",
  seven_day_cowork: "7d Cowork",
  seven_day_oauth_apps: "7d OAuth",
  iguana_necktie: "etc",
};

function parseClaudeUsageInfo(dataList: unknown[]): ProviderUsageInfo {
  const windows: UtilizationWindow[] = [];
  let billing: ProviderUsageInfo["billing"] | undefined;
  let extraUsage: ProviderUsageInfo["extraUsage"] | undefined;

  for (const raw of dataList) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const obj = raw as Record<string, unknown>;

    // Usage utilization data (five_hour, seven_day, etc.)
    if ("five_hour" in obj || "seven_day" in obj) {
      for (const [key, label] of Object.entries(CLAUDE_WINDOW_LABELS)) {
        const win = obj[key] as ClaudeUtilizationRaw | null | undefined;
        if (win && typeof win === "object" && typeof win.utilization === "number") {
          // Prevent duplicates
          if (!windows.some((w) => w.label === label)) {
            windows.push({
              label,
              utilization: win.utilization,
              resetsAt: win.resets_at || null,
            });
          }
        }
      }

      // extra_usage
      const extra = obj.extra_usage as Record<string, unknown> | null | undefined;
      if (extra && typeof extra === "object" && !extraUsage) {
        extraUsage = {
          enabled: !!extra.is_enabled,
          usedCredits: toNumber(extra.used_credits),
          monthlyLimit: extra.monthly_limit != null ? toNumber(extra.monthly_limit) : null,
        };
      }
    }

    // Billing data
    if ("next_charge_date" in obj && "status" in obj && !billing) {
      billing = {
        status: String(obj.status || ""),
        nextChargeDate: obj.next_charge_date ? String(obj.next_charge_date) : null,
        interval: obj.billing_interval ? String(obj.billing_interval) : null,
      };
    }
  }

  return { windows, billing, extraUsage };
}

// ─── Connection Test ──────────────────────────────────────────────

interface ConnectionTestResult {
  ok: boolean;
  message: string;
  identity?: { email: string; name: string };
}

export async function testConnection(account: MonitorAccount): Promise<ConnectionTestResult> {
  try {
    if (account.provider === "claude") {
      if (!account.sessionCookie) {
        return { ok: false, message: "Session cookie is not set." };
      }

      const headers: Record<string, string> = {
        Cookie: account.sessionCookie,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": "https://claude.ai/",
      };

      const orgsRaw = await fetchJson("https://claude.ai/api/organizations", headers);
      const orgs = (Array.isArray(orgsRaw) ? orgsRaw : []) as Array<{ uuid: string; name?: string }>;

      if (orgs.length === 0) {
        return { ok: false, message: "Session cookie is invalid. It may have expired." };
      }

      const orgName = orgs[0].name || orgs[0].uuid;
      return { ok: true, message: `Connected — Organization: ${orgName}` };
    }

    if (account.provider === "openai") {
      if (account.apiKey) {
        const headers = buildOpenAIHeaders(account);
        await fetchJson("https://api.openai.com/v1/organization/costs?start_time=0&end_time=1&bucket_width=1d", headers);
        const identity = await fetchOpenAIIdentity(account);
        return { ok: true, message: `API key connection successful${identity ? ` — ${identity.email}` : ""}`, ...(identity ? { identity } : {}) };
      }
      const metricsReport = await fetchOpenAIMetricsUsage(account);
      const hasLocalMetrics = Boolean(
        metricsReport.usageInfo?.windows?.length ||
        metricsReport.usageInfo?.codexMetrics,
      );
      if (hasLocalMetrics) {
        return { ok: true, message: "Local ~/.omx/metrics.json usage source is available." };
      }
      if (account.subscriptionInfo?.plan) {
        return { ok: true, message: "Subscription info is stored. Usage collection still requires an Admin API key or local ~/.omx/metrics.json." };
      }
      if (account.sessionCookie) {
        return { ok: false, message: "Stored browser login data is not used for OpenAI usage collection. Use an Admin API key or local ~/.omx/metrics.json." };
      }
      return { ok: false, message: "OpenAI usage collection requires an Admin API key or local ~/.omx/metrics.json." };
    }

    return { ok: false, message: "Unsupported provider." };
  } catch (error) {
    logger.error("[testConnection] Error during connection test", { error: String(error) });
    return { ok: false, message: "Error during connection test." };
  }
}

// ─── Main Entry ───────────────────────────────────────────────────

export async function fetchUsageForAccount(account: MonitorAccount, range: ResolvedRange): Promise<AccountUsageReport> {
  if (!account.enabled) {
    return emptyReport(account, "disabled");
  }

  if (account.provider === "claude" && !account.sessionCookie) {
    return emptyReport(account, "not_configured", "Session cookie is empty.");
  }

  try {
    if (account.provider === "openai") {
      // Use API method if Admin API Key is present, otherwise read oh-my-codex metrics
      if (account.apiKey) {
        return await fetchOpenAIUsage(account, range);
      }
      const browserProfileReport = await fetchOpenAIUsageViaBrowserProfile(account);
      if (browserProfileReport) return browserProfileReport;
      return await fetchOpenAIMetricsUsage(account);
    }
    // Claude accounts with session cookies should go through batch path
    const [report] = await fetchClaudeUsageBatch([account], range);
    return report;
  } catch (error) {
    logger.error("[fetchUsageForAccount] Error fetching usage", { accountId: account.id, error: String(error) });
    return emptyReport(account, "error", "Error fetching usage data.");
  }
}
