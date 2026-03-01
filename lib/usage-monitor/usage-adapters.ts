import type { AccountUsageReport, ClaudeUsageInfo, ClaudeUtilizationWindow, MonitorAccount, ResolvedRange, UsagePoint } from "@/lib/usage-monitor/types";
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
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
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

// ─── Claude (Session Cookie + Playwright) ────────────────────────

function parseCookieString(cookieStr: string): Array<{ name: string; value: string; domain: string; path: string }> {
  return cookieStr
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eqIdx = part.indexOf("=");
      if (eqIdx <= 0) return null;
      return {
        name: part.slice(0, eqIdx).trim(),
        value: part.slice(eqIdx + 1).trim(),
        domain: ".claude.ai",
        path: "/",
      };
    })
    .filter((c): c is { name: string; value: string; domain: string; path: string } => c !== null && c.name.length > 0);
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
      await browser.close();
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

    await browser.close();

    if (!evalResult || "error" in evalResult) {
      const errMsg = evalResult && "error" in evalResult ? String(evalResult.error) : "데이터 조회 실패";
      return emptyReport(account, "error", errMsg);
    }

    const claudeUsage = parseClaudeUsageInfo(evalResult.results || []);

    return {
      accountId: account.id,
      name: account.name,
      provider: account.provider,
      status: "ok",
      costUsd: 0,
      requests: 0,
      tokens: 0,
      points: [],
      claudeUsage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return emptyReport(account, "error", `사용량 조회 실패: ${message}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

interface ClaudeUtilizationRaw {
  utilization?: number;
  resets_at?: string | null;
}

const CLAUDE_WINDOW_LABELS: Record<string, string> = {
  five_hour: "5시간",
  seven_day: "7일",
  seven_day_opus: "7일 (Opus)",
  seven_day_sonnet: "7일 (Sonnet)",
  seven_day_cowork: "7일 (Cowork)",
  seven_day_oauth_apps: "7일 (OAuth)",
  iguana_necktie: "기타",
};

function parseClaudeUsageInfo(dataList: unknown[]): ClaudeUsageInfo {
  const windows: ClaudeUtilizationWindow[] = [];
  let billing: ClaudeUsageInfo["billing"] | undefined;
  let extraUsage: ClaudeUsageInfo["extraUsage"] | undefined;

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
      if (!account.apiKey) {
        return { ok: false, message: "API 키가 입력되지 않았습니다." };
      }

      const headers = buildOpenAIHeaders(account);
      // 간단한 조직 정보 조회로 키 유효성 확인
      await fetchJson("https://api.openai.com/v1/organization/costs?start_time=0&end_time=1&bucket_width=1d", headers);
      return { ok: true, message: "API 키 연결 성공" };
    }

    return { ok: false, message: "지원하지 않는 provider입니다." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, message };
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

  if (account.provider === "openai" && !account.apiKey) {
    return emptyReport(account, "not_configured", "API 키가 비어 있습니다.");
  }

  try {
    if (account.provider === "openai") {
      return await fetchOpenAIUsage(account, range);
    }
    return await fetchClaudeUsage(account, range);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return emptyReport(account, "error", message);
  }
}
