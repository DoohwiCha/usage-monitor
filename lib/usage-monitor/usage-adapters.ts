import type { AccountUsageReport, ProviderUsageInfo, UtilizationWindow, MonitorAccount, ResolvedRange, WindowKey } from "@/lib/usage-monitor/types";

import { getCached, setCached, getStale, isRateLimited, markRateLimited } from "@/lib/usage-monitor/usage-cache";
import { logger } from "@/lib/usage-monitor/logger";
import { getDb } from "@/lib/usage-monitor/db";
import {
  readCliProxyClaudeAuthFile,
  readCliProxyCodexAuthFile,
} from "@/lib/usage-monitor/cliproxy-auth-store";

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
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

async function fetchJsonAllowingStatus(url: string, headers: HeadersInit): Promise<Response> {
  return fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
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

function windowLabelForKey(key: WindowKey): string {
  switch (key) {
    case "five_hour":
      return "5h";
    case "seven_day":
      return "7d";
    case "seven_day_opus":
      return "7d Opus";
    case "seven_day_sonnet":
      return "7d Sonnet";
    case "seven_day_cowork":
      return "7d Cowork";
    case "seven_day_oauth":
      return "7d OAuth";
    default:
      return "etc";
  }
}

function createWindow(key: WindowKey, utilization: number, resetsAt: string | null): UtilizationWindow {
  return {
    key,
    label: windowLabelForKey(key),
    utilization,
    resetsAt,
  };
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
  const primaryResetAt = typeof primaryWindow?.reset_at === "number"
    ? new Date(primaryWindow.reset_at * 1000).toISOString()
    : typeof primaryWindow?.reset_at === "string"
      ? primaryWindow.reset_at
      : null;
  const secondaryResetAt = typeof secondaryWindow?.reset_at === "number"
    ? new Date(secondaryWindow.reset_at * 1000).toISOString()
    : typeof secondaryWindow?.reset_at === "string"
      ? secondaryWindow.reset_at
      : null;
  if (typeof primaryWindow?.used_percent === "number") {
    windows.push(createWindow("five_hour", Math.min(primaryWindow.used_percent, 100), primaryResetAt));
  }
  if (typeof secondaryWindow?.used_percent === "number") {
    windows.push(createWindow("seven_day", Math.min(secondaryWindow.used_percent, 100), secondaryResetAt));
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
    accountIdentity: {
      email: identity?.email || (typeof data.email === "string" ? data.email : null),
      accountId: identity?.accountId || (typeof data.account_id === "string" ? data.account_id : null),
      planType: identity?.planType || (typeof data.plan_type === "string" ? data.plan_type : null),
    },
    ...(billing ? { billing } : {}),
  };
}

export async function fetchOpenAIUsageViaCliProxyAuth(account: MonitorAccount): Promise<AccountUsageReport> {
  const sourcePath = account.sourcePath;
  if (!sourcePath) {
    return emptyReport(account, "not_configured", "CLIProxyAPI auth source path is not configured.");
  }

  const authFile = readCliProxyCodexAuthFile(sourcePath);
  if (!authFile?.access_token || !authFile.account_id) {
    return emptyReport(account, "error", "CLIProxyAPI Codex auth file is missing access_token or account_id.");
  }

  const response = await fetchJsonAllowingStatus("https://chatgpt.com/backend-api/wham/usage", {
    Authorization: `Bearer ${authFile.access_token}`,
    "ChatGPT-Account-Id": authFile.account_id,
    "User-Agent": "Mozilla/5.0",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://chatgpt.com/",
    Origin: "https://chatgpt.com",
  });

  if (!response.ok) {
    return emptyReport(account, "error", `CLIProxyAPI Codex usage request failed (HTTP ${response.status}).`);
  }

  const usageRaw = await response.json();
  const usageInfo = parseOpenAIWhamUsageInfo(usageRaw, {
    ...account,
    subscriptionInfo: account.subscriptionInfo
      || ((usageRaw && typeof usageRaw === "object" && !Array.isArray(usageRaw) && typeof (usageRaw as Record<string, unknown>).plan_type === "string")
        ? { plan: String((usageRaw as Record<string, unknown>).plan_type) }
        : null),
  });

  if (!usageInfo) {
    return emptyReport(account, "error", "CLIProxyAPI Codex auth file did not yield usable OpenAI usage data.");
  }

  const report = emptyReport(account, "ok");
  report.usageInfo = usageInfo;
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

// ─── Claude OAuth account matching helper (legacy test coverage) ────────

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

export async function fetchClaudeUsageDirect(account: MonitorAccount, allowCfRefresh = true): Promise<AccountUsageReport> {
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

export async function fetchClaudeUsageViaCliProxyAuth(account: MonitorAccount): Promise<AccountUsageReport> {
  const sourcePath = account.sourcePath;
  if (!sourcePath) {
    return emptyReport(account, "not_configured", "CLIProxyAPI auth source path is not configured.");
  }

  const authFile = readCliProxyClaudeAuthFile(sourcePath);
  if (!authFile?.access_token) {
    return emptyReport(account, "error", "CLIProxyAPI Claude auth file is missing access_token.");
  }

  const headers = {
    Authorization: `Bearer ${authFile.access_token}`,
    "anthropic-beta": "oauth-2025-04-20",
    "Content-Type": "application/json",
  };

  const [profileRes, usageRes] = await Promise.all([
    fetchJsonAllowingStatus("https://api.anthropic.com/api/oauth/profile", headers),
    fetchJsonAllowingStatus("https://api.anthropic.com/api/oauth/usage", headers),
  ]);

  if (!profileRes.ok && !usageRes.ok) {
    return emptyReport(account, "error", `CLIProxyAPI Claude auth file usage/profile requests failed (HTTP ${profileRes.status}/${usageRes.status}).`);
  }

  let billing: ProviderUsageInfo["billing"] | undefined;
  if (profileRes.ok) {
    const profileRaw = await profileRes.json() as Record<string, unknown>;
    const rawOrg = profileRaw.organization as Record<string, unknown> | undefined;
    if (rawOrg) {
      billing = {
        status: String(rawOrg.subscription_status || ""),
        nextChargeDate: null,
        interval: rawOrg.organization_type ? String(rawOrg.organization_type) : null,
      };
    }
  }

  const windows: UtilizationWindow[] = [];
  let extraUsage: ProviderUsageInfo["extraUsage"] | undefined;
  const snapshot = loadSnapshot(account);
  if (usageRes.status === 429) {
    if (snapshot?.provider === "claude" && snapshot.usageInfo?.windows?.length) {
      return {
        ...snapshot,
        accountId: account.id,
        name: account.name,
        provider: account.provider,
      };
    }

    const pending = emptyReport(account, "pending", "Claude auth-store usage is temporarily rate-limited. Please retry shortly.");
    pending.usageInfo = {
      windows: [],
      ...(billing ? { billing } : {}),
    };
    return pending;
  }
  if (usageRes.ok) {
    const usageRaw = await usageRes.json() as Record<string, unknown>;
    for (const [key, windowKey] of Object.entries(CLAUDE_WINDOW_KEYS)) {
      const win = usageRaw[key] as { utilization?: number; resets_at?: string | null } | null | undefined;
      if (win && typeof win === "object" && typeof win.utilization === "number") {
        windows.push(createWindow(windowKey, Math.min(win.utilization, 100), win.resets_at || null));
      }
    }
    const extra = usageRaw.extra_usage as Record<string, unknown> | null | undefined;
    if (extra && typeof extra === "object") {
      extraUsage = {
        enabled: !!extra.is_enabled,
        usedCredits: toNumber(extra.used_credits),
        monthlyLimit: extra.monthly_limit != null ? toNumber(extra.monthly_limit) : null,
      };
    }
  }

  const usageInfo: ProviderUsageInfo = {
    windows,
    ...(billing ? { billing } : {}),
    ...(extraUsage ? { extraUsage } : {}),
  };

  const report = emptyReport(account, windows.length > 0 ? "ok" : "error");
  report.usageInfo = usageInfo;
  if (report.status !== "ok") {
    report.error = "CLIProxyAPI Claude auth file did not yield usable usage windows.";
  }
  return report;
}

// ─── SQLite usage snapshot persistence ───────────────────────────

export function saveUsageSnapshot(accountId: string, report: AccountUsageReport): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO usage_snapshots (account_id, fetched_at, usage_json)
      VALUES (?, datetime('now'), ?)
      ON CONFLICT(account_id) DO UPDATE SET fetched_at = datetime('now'), usage_json = excluded.usage_json
    `).run(accountId, JSON.stringify(report));
  } catch { /* table may not exist yet on first run */ }
}

export function deleteUsageSnapshot(accountId: string): void {
  try {
    const db = getDb();
    db.prepare("DELETE FROM usage_snapshots WHERE account_id = ?").run(accountId);
  } catch { /* ignore */ }
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

  // Step 3: Pick ONE account from the rotating queue.
  const fetchable = eligible;
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
        saveUsageSnapshot(account.id, report);
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

const CLAUDE_WINDOW_KEYS: Record<string, WindowKey> = {
  five_hour: "five_hour",
  seven_day: "seven_day",
  seven_day_opus: "seven_day_opus",
  seven_day_sonnet: "seven_day_sonnet",
  seven_day_cowork: "seven_day_cowork",
  seven_day_oauth_apps: "seven_day_oauth",
  iguana_necktie: "other",
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
      for (const [key, windowKey] of Object.entries(CLAUDE_WINDOW_KEYS)) {
        const win = obj[key] as ClaudeUtilizationRaw | null | undefined;
        if (win && typeof win === "object" && typeof win.utilization === "number") {
          // Prevent duplicates
          if (!windows.some((w) => w.key === windowKey)) {
            windows.push(createWindow(windowKey, Math.min(win.utilization, 100), win.resets_at || null));
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
      if (account.authMode === "auth_store" && account.syncSource === "cliproxy_claude" && account.sourcePath) {
        const report = await fetchClaudeUsageViaCliProxyAuth(account);
        const hasWindows = Boolean(report.usageInfo?.windows?.length);
        if (hasWindows) {
          return { ok: true, message: `CLIProxyAPI Claude auth source is available${account.authIdentity ? ` — ${account.authIdentity}` : ""}` };
        }
        return { ok: false, message: report.error || "CLIProxyAPI Claude auth source is not usable." };
      }
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
      if (account.authMode === "auth_store" && account.syncSource === "cliproxy_codex" && account.sourcePath) {
        const report = await fetchOpenAIUsageViaCliProxyAuth(account);
        if (report.status === "ok") {
          return { ok: true, message: `CLIProxyAPI Codex auth source is available${account.authIdentity ? ` — ${account.authIdentity}` : ""}` };
        }
        return { ok: false, message: report.error || "CLIProxyAPI Codex auth source is not usable." };
      }
      return { ok: false, message: "OpenAI usage collection requires a CLIProxyAPI Codex auth-store import." };
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

  if (
    account.provider === "claude" &&
    !(account.authMode === "auth_store" && account.syncSource === "cliproxy_claude" && account.sourcePath) &&
    !account.sessionCookie
  ) {
    return emptyReport(account, "not_configured", "Session cookie is empty.");
  }

  try {
    if (account.provider === "openai") {
      if (account.authMode === "auth_store" && account.syncSource === "cliproxy_codex" && account.sourcePath) {
        return await fetchOpenAIUsageViaCliProxyAuth(account);
      }
      return emptyReport(account, "not_configured", "OpenAI usage collection requires a CLIProxyAPI Codex auth-store import.");
    }
    if (account.authMode === "auth_store" && account.syncSource === "cliproxy_claude" && account.sourcePath) {
      const cacheKey = `usage:${account.id}`;
      const cached = getCached<AccountUsageReport>(cacheKey);
      if (cached) return cached;
      const stale = getStale<AccountUsageReport>(cacheKey);
      const snapshot = loadSnapshot(account);

      const report = await fetchClaudeUsageViaCliProxyAuth(account);
      if (report.status === "ok" && (report.usageInfo?.windows?.length ?? 0) > 0) {
        const jitter = Math.floor(Math.random() * 5 * 60 * 1000);
        setCached(cacheKey, report, 10 * 60 * 1000 + jitter);
        saveUsageSnapshot(account.id, report);
        return report;
      }
      if (stale) return stale;
      if (snapshot) return snapshot;
      return report;
    }
    // Claude accounts with session cookies should go through batch path
    const [report] = await fetchClaudeUsageBatch([account], range);
    return report;
  } catch (error) {
    logger.error("[fetchUsageForAccount] Error fetching usage", { accountId: account.id, error: String(error) });
    return emptyReport(account, "error", "Error fetching usage data.");
  }
}
