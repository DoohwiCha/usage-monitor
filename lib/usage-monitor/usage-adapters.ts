import type { AccountUsageReport, ProviderUsageInfo, UtilizationWindow, MonitorAccount, ResolvedRange, UsagePoint } from "@/lib/usage-monitor/types";
import { toUtcDayKey } from "@/lib/usage-monitor/range";

import { getCached, setCached, getStale, isRateLimited, markRateLimited } from "@/lib/usage-monitor/usage-cache";
import { logger } from "@/lib/usage-monitor/logger";

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

  const [costRaw, usageRaw] = await Promise.all([
    fetchJson(costsUrl.toString(), headers),
    fetchJson(usageUrl.toString(), headers),
  ]);

  const points = [
    ...parseOpenAICostPoints(costRaw),
    ...parseOpenAIUsagePoints(usageRaw),
  ];

  return sumReport(account, "ok", points);
}

// ─── OpenAI (oh-my-codex metrics file read) ──────────────────────

async function fetchOpenAIMetricsUsage(account: MonitorAccount): Promise<AccountUsageReport> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const metricsPath = path.join(process.env.HOME || "/root", ".omx", "metrics.json");

  try {
    const raw = await fs.readFile(metricsPath, "utf-8");
    const metrics = JSON.parse(raw) as {
      five_hour_limit_pct?: number;
      weekly_limit_pct?: number;
      last_activity?: string;
    };

    const windows: UtilizationWindow[] = [];

    if (typeof metrics.five_hour_limit_pct === "number") {
      windows.push({
        label: "5h",
        utilization: Math.min(Math.round(metrics.five_hour_limit_pct), 100),
        resetsAt: null,
      });
    }
    if (typeof metrics.weekly_limit_pct === "number") {
      windows.push({
        label: "wk",
        utilization: Math.min(Math.round(metrics.weekly_limit_pct), 100),
        resetsAt: null,
      });
    }

    // Subscription info saved during login
    let billing: ProviderUsageInfo["billing"] | undefined;
    if (account.subscriptionInfo?.plan) {
      billing = {
        status: account.subscriptionInfo.plan,
        nextChargeDate: account.subscriptionInfo.renewsAt || null,
        interval: account.subscriptionInfo.billingPeriod || null,
      };
    }

    const report = emptyReport(account, "ok");
    if (windows.length > 0 || billing) {
      report.usageInfo = { windows, billing };
    }
    return report;
  } catch {
    return emptyReport(account, "not_configured", "oh-my-codex metrics not found (~/.omx/metrics.json)");
  }
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

function readLocalOAuthCredentials(): OAuthCredentials | null {
  try {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
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
      const fs = require("fs");
      const os = require("os");
      const path = require("path");
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
    const { getDb } = require("@/lib/usage-monitor/db");
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
    const { getDb } = require("@/lib/usage-monitor/db");
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

/** Fetch usage for all Claude accounts: rotating queue (1 per cycle), with persistent snapshots. */
export async function fetchClaudeUsageBatch(accounts: MonitorAccount[], _range: ResolvedRange): Promise<AccountUsageReport[]> {
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
    results.set(account.id, emptyReport(account, "ok"));
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
        const profileEmail = profile.email.toLowerCase();
        const matchedAccount = eligible.find(a => {
          const name = a.name.toLowerCase();
          return name === profileEmail || name.includes(profileEmail) || profileEmail.includes(name.split("@")[0]);
        });
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
      if (report.status === "ok") {
        const jitter = Math.floor(Math.random() * 5 * 60 * 1000);
        setCached(`usage:${account.id}`, report, 10 * 60 * 1000 + jitter);
        saveSnapshot(account.id, report);
      }
      results.set(account.id, report);
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
        return { ok: true, message: "API key connection successful" };
      }
      if (account.sessionCookie) {
        return { ok: true, message: "Browser session cookie is stored." };
      }
      return { ok: false, message: "API key or browser login required." };
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
