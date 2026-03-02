import type { AccountUsageReport, ProviderUsageInfo, UtilizationWindow, MonitorAccount, ResolvedRange, UsagePoint } from "@/lib/usage-monitor/types";
import { toUtcDayKey } from "@/lib/usage-monitor/range";
import { withBrowser } from "@/lib/usage-monitor/browser-pool";
import { getCached, setCached } from "@/lib/usage-monitor/usage-cache";
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

async function fetchClaudeUsage(account: MonitorAccount, _range: ResolvedRange): Promise<AccountUsageReport> {
  const cookieStr = account.sessionCookie || "";
  if (!cookieStr) {
    return emptyReport(account, "not_configured", "Session cookie is empty.");
  }

  const cacheKey = `usage:${account.id}`;
  const cached = getCached<AccountUsageReport>(cacheKey);
  if (cached) return cached;

  try {
    const result = await withBrowser(async (browser) => {
      const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      });

      const cookies = parseCookieString(cookieStr);
      if (cookies.length === 0) {
        return emptyReport(account, "error", "Failed to parse cookies.");
      }
      await context.addCookies(cookies);

      const page = await context.newPage();

      // Minimal page load (domain establishment only — full rendering not needed)
      await page.goto("https://claude.ai/settings", {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });

      // Check for login redirect
      const currentUrl = page.url();
      if (currentUrl.includes("/login") || currentUrl.includes("/oauth") || currentUrl.includes("/sso")) {
        return emptyReport(account, "error", "Session cookie expired. Please login again.");
      }

      // Parallel API calls from browser context (Cloudflare bypass)
      const evalResult = await page.evaluate(async () => {
        try {
          const orgsRes = await fetch("/api/organizations");
          if (!orgsRes.ok) return { error: `orgs ${orgsRes.status}` };
          const orgs = await orgsRes.json() as Array<{ uuid: string; name?: string }>;
          if (!Array.isArray(orgs) || orgs.length === 0) return { error: "no orgs" };

          const orgUuid = orgs[0].uuid;

          // Parallel calls for usage + billing
          const [usageRes, billingRes] = await Promise.all([
            fetch(`/api/organizations/${orgUuid}/usage`).then(async (r) => r.ok ? r.json() : null).catch(() => null),
            fetch(`/api/organizations/${orgUuid}/settings/billing`).then(async (r) => r.ok ? r.json() : null).catch(() => null),
          ]);

          return { results: [usageRes, billingRes].filter(Boolean) };
        } catch (e) {
          return { error: String(e) };
        }
      });

      if (!evalResult || "error" in evalResult) {
        const errMsg = evalResult && "error" in evalResult ? String(evalResult.error) : "Data fetch failed";
        return emptyReport(account, "error", errMsg);
      }

      const usageInfo = parseClaudeUsageInfo(evalResult.results || []);

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
    });

    if (result.status === "ok") {
      setCached(cacheKey, result);
    }
    return result;
  } catch (error) {
    logger.error("[fetchClaudeUsage] Error fetching Claude usage", { error: String(error) });
    return emptyReport(account, "error", "Failed to fetch Claude usage.");
  }
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
    return await fetchClaudeUsage(account, range);
  } catch (error) {
    logger.error("[fetchUsageForAccount] Error fetching usage", { accountId: account.id, error: String(error) });
    return emptyReport(account, "error", "Error fetching usage data.");
  }
}
