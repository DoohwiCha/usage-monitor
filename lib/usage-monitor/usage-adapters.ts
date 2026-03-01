import type { AccountUsageReport, ProviderUsageInfo, UtilizationWindow, MonitorAccount, ResolvedRange, UsagePoint } from "@/lib/usage-monitor/types";
import { toUtcDayKey } from "@/lib/usage-monitor/range";

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
    console.error(`[fetchJson] HTTP ${response.status} from ${url}:`, body.slice(0, 500));
    throw new Error(`외부 API 요청 실패 (HTTP ${response.status})`);
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

// ─── OpenAI (oh-my-codex 메트릭 파일 읽기) ───────────────────────

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

    // 로그인 시 저장된 구독 정보
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
    return emptyReport(account, "ok", "oh-my-codex 메트릭을 찾을 수 없습니다 (~/.omx/metrics.json)");
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

      // __Host- 쿠키는 domain 없이, secure + path=/ 필수
      if (name.startsWith("__Host-")) {
        return { name, value, domain: domain.replace(/^\./, ""), path: "/", secure: true };
      }
      // __Secure- 쿠키는 secure 필수
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
    return emptyReport(account, "not_configured", "세션 쿠키가 비어 있습니다.");
  }

  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    return emptyReport(account, "error", "Playwright가 설치되지 않았습니다. `npx playwright install chromium`을 실행해 주세요.");
  }

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });

    const cookies = parseCookieString(cookieStr);
    if (cookies.length === 0) {
      return emptyReport(account, "error", "쿠키를 파싱할 수 없습니다.");
    }
    await context.addCookies(cookies);

    const page = await context.newPage();

    // 최소한의 페이지 로드 (도메인 확립만 — 전체 렌더링 불필요)
    await page.goto("https://claude.ai/settings", {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });

    // 로그인 리다이렉트 확인
    const currentUrl = page.url();
    if (currentUrl.includes("/login") || currentUrl.includes("/oauth") || currentUrl.includes("/sso")) {
      return emptyReport(account, "error", "세션 쿠키가 만료되었습니다. 다시 로그인해 주세요.");
    }

    // 브라우저 컨텍스트에서 API 병렬 호출 (Cloudflare 우회)
    const evalResult = await page.evaluate(async () => {
      try {
        const orgsRes = await fetch("/api/organizations");
        if (!orgsRes.ok) return { error: `orgs ${orgsRes.status}` };
        const orgs = await orgsRes.json() as Array<{ uuid: string; name?: string }>;
        if (!Array.isArray(orgs) || orgs.length === 0) return { error: "no orgs" };

        const orgUuid = orgs[0].uuid;

        // usage + billing 병렬 호출
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
      const errMsg = evalResult && "error" in evalResult ? String(evalResult.error) : "데이터 조회 실패";
      return emptyReport(account, "error", errMsg);
    }

    const usageInfo = parseClaudeUsageInfo(evalResult.results || []);

    return {
      accountId: account.id,
      name: account.name,
      provider: account.provider,
      status: "ok",
      costUsd: 0,
      requests: 0,
      tokens: 0,
      points: [],
      usageInfo,
    };
  } catch (error) {
    console.error("[fetchClaudeUsage] Error:", error);
    return emptyReport(account, "error", "Claude 사용량 조회에 실패했습니다.");
  } finally {
    await browser.close().catch(() => {});
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

    // 사용량 utilization 데이터 (five_hour, seven_day 등)
    if ("five_hour" in obj || "seven_day" in obj) {
      for (const [key, label] of Object.entries(CLAUDE_WINDOW_LABELS)) {
        const win = obj[key] as ClaudeUtilizationRaw | null | undefined;
        if (win && typeof win === "object" && typeof win.utilization === "number") {
          // 중복 방지
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

    // 빌링 데이터
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
        return { ok: false, message: "세션 쿠키가 입력되지 않았습니다." };
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
        return { ok: false, message: "세션 쿠키가 유효하지 않습니다. 만료되었을 수 있습니다." };
      }

      const orgName = orgs[0].name || orgs[0].uuid;
      return { ok: true, message: `연결 성공 — 조직: ${orgName}` };
    }

    if (account.provider === "openai") {
      if (account.apiKey) {
        const headers = buildOpenAIHeaders(account);
        await fetchJson("https://api.openai.com/v1/organization/costs?start_time=0&end_time=1&bucket_width=1d", headers);
        return { ok: true, message: "API 키 연결 성공" };
      }
      if (account.sessionCookie) {
        return { ok: true, message: "브라우저 세션 쿠키가 저장되어 있습니다." };
      }
      return { ok: false, message: "API 키 또는 브라우저 로그인이 필요합니다." };
    }

    return { ok: false, message: "지원하지 않는 provider입니다." };
  } catch (error) {
    console.error("[testConnection] Error:", error);
    return { ok: false, message: "연결 테스트 중 오류가 발생했습니다." };
  }
}

// ─── Main Entry ───────────────────────────────────────────────────

export async function fetchUsageForAccount(account: MonitorAccount, range: ResolvedRange): Promise<AccountUsageReport> {
  if (!account.enabled) {
    return emptyReport(account, "disabled");
  }

  if (account.provider === "claude" && !account.sessionCookie) {
    return emptyReport(account, "not_configured", "세션 쿠키가 비어 있습니다.");
  }

  try {
    if (account.provider === "openai") {
      // Admin API Key가 있으면 API 방식, 없으면 oh-my-codex 메트릭 읽기
      if (account.apiKey) {
        return await fetchOpenAIUsage(account, range);
      }
      return await fetchOpenAIMetricsUsage(account);
    }
    return await fetchClaudeUsage(account, range);
  } catch (error) {
    console.error("[fetchUsageForAccount] Error:", error);
    return emptyReport(account, "error", "사용량 조회 중 오류가 발생했습니다.");
  }
}
