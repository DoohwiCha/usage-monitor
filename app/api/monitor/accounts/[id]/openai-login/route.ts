import { NextResponse } from "next/server";
import { ensureApiAuth, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { readMonitorConfig, toPublicAccount, updateMonitorAccount } from "@/lib/usage-monitor/store";
import type { SubscriptionInfo } from "@/lib/usage-monitor/types";

const AUTH_COOKIE_NAMES = new Set([
  "__Secure-next-auth.session-token",
  "__Host-next-auth.csrf-token",
  "__Secure-next-auth.callback-url",
  "cf_clearance",
  "__cf_bm",
]);

export const runtime = "nodejs";
export const maxDuration = 180;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!verifyCsrfOrigin(request)) {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다." }, { status: 403 });
  }
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const config = await readMonitorConfig();
  const account = config.accounts.find((a) => a.id === id);
  if (!account) {
    return NextResponse.json({ ok: false, error: "계정을 찾을 수 없습니다." }, { status: 404 });
  }
  // provider가 다르면 자동으로 openai로 변경
  if (account.provider !== "openai") {
    await updateMonitorAccount(id, { provider: "openai" });
  }

  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    return NextResponse.json(
      { ok: false, error: "Playwright가 설치되지 않았습니다. `npx playwright install chromium`을 실행해 주세요." },
      { status: 500 },
    );
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: false });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    // 로그인 페이지로 직접 이동
    await page.goto("https://chatgpt.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30_000 });

    // 로그인 완료 후 chatgpt.com 메인으로 이동될 때까지 대기 (최대 3분)
    await page.waitForURL(
      (url) => {
        const u = new URL(url);
        const isChat = u.hostname === "chatgpt.com" || u.hostname === "chat.openai.com";
        // 로그인/인증 관련 경로가 아닌 페이지로 이동하면 완료
        return isChat &&
          !u.pathname.startsWith("/auth") &&
          !u.pathname.startsWith("/login");
      },
      { timeout: 180_000 },
    );

    // 페이지가 완전히 로드될 때까지 대기
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // 로그인된 브라우저에서 사용자 정보 + 구독 정보 추출
    const extractResult = await page.evaluate(async () => {
      const out: { email: string; name: string; plan: string; renewsAt: string | null; billingPeriod: string | null } = {
        email: "", name: "", plan: "", renewsAt: null, billingPeriod: null,
      };

      // 사용자 정보
      try {
        const meRes = await fetch("/backend-api/me", { headers: { "Content-Type": "application/json" } });
        if (meRes.ok) {
          const me = await meRes.json() as { email?: string; name?: string };
          out.email = me.email || "";
          out.name = me.name || "";
        }
      } catch { /* skip */ }

      // 구독 정보
      try {
        const acctRes = await fetch("/backend-api/accounts/check/v4-2023-04-27", { headers: { "Content-Type": "application/json" } });
        if (acctRes.ok) {
          const acctData = await acctRes.json() as { accounts?: Record<string, { entitlement?: { subscription_plan?: string; renews_at?: string; billing_period?: string; has_active_subscription?: boolean } }> };
          const accounts = acctData.accounts;
          if (accounts) {
            const first = Object.values(accounts)[0];
            if (first?.entitlement) {
              out.plan = first.entitlement.subscription_plan || "";
              out.renewsAt = first.entitlement.renews_at || null;
              out.billingPeriod = first.entitlement.billing_period || null;
            }
          }
        }
      } catch { /* skip */ }

      return out;
    });

    // 인증 쿠키만 필터링하여 저장 (PII 제거)
    const allCookies = await browserContext.cookies("https://chatgpt.com");
    const filteredCookies = allCookies.filter((c) => AUTH_COOKIE_NAMES.has(c.name));
    const cookieString = JSON.stringify(filteredCookies);

    await browser.close();
    browser = undefined;

    if (!cookieString || cookieString === "[]") {
      return NextResponse.json({ ok: false, error: "쿠키를 추출하지 못했습니다." }, { status: 502 });
    }

    const displayName = extractResult.email || extractResult.name || account.name;

    // 구독 정보를 subscriptionInfo 필드에 저장
    const subscriptionInfo: SubscriptionInfo | undefined = extractResult.plan ? {
      plan: extractResult.plan,
      renewsAt: extractResult.renewsAt || undefined,
      billingPeriod: extractResult.billingPeriod || undefined,
    } : undefined;

    const updated = await updateMonitorAccount(id, {
      sessionCookie: cookieString,
      name: displayName,
      enabled: true,
      ...(subscriptionInfo ? { subscriptionInfo } : {}),
    });
    const refreshed = updated.accounts.find((a) => a.id === id);

    return NextResponse.json({
      ok: true,
      message: `로그인 성공 — ${displayName}`,
      account: refreshed ? toPublicAccount(refreshed) : undefined,
    });
  } catch (error) {
    console.error("[openai-login] Error:", error);
    const raw = error instanceof Error ? error.message : "";

    if (raw.includes("Timeout") || raw.includes("timeout")) {
      return NextResponse.json({ ok: false, error: "로그인 시간 초과 (3분). 다시 시도해 주세요." }, { status: 408 });
    }

    return NextResponse.json({ ok: false, error: "OpenAI 로그인 중 오류가 발생했습니다." }, { status: 500 });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
