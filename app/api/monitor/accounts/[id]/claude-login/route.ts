import { NextResponse } from "next/server";
import { ensureApiAuth, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { readMonitorConfig, toPublicAccount, updateMonitorAccount } from "@/lib/usage-monitor/store";

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
  // provider가 다르면 자동으로 claude로 변경
  if (account.provider !== "claude") {
    await updateMonitorAccount(id, { provider: "claude" });
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

    await page.goto("https://claude.ai/login", { waitUntil: "domcontentloaded", timeout: 30_000 });

    // 사용자가 로그인할 때까지 대기 (최대 3분)
    // 로그인 완료 시 /login, /magic-link, /oauth 이외 페이지로 이동됨
    await page.waitForURL(
      (url) => {
        const path = new URL(url).pathname;
        return (
          !path.startsWith("/login") &&
          !path.startsWith("/magic-link") &&
          !path.startsWith("/oauth") &&
          !path.startsWith("/sso")
        );
      },
      { timeout: 180_000 },
    );

    // 쿠키가 완전히 세팅될 때까지 잠시 대기
    await page.waitForTimeout(2_000);

    // 브라우저 내부에서 사용자 정보 + organizations API 호출 (Cloudflare 우회)
    const verifyResult = await page.evaluate(async () => {
      let email = "";

      // 1) 사용자 이메일 직접 조회
      try {
        const authRes = await fetch("/api/auth/current_account", {
          headers: { "Content-Type": "application/json" },
        });
        if (authRes.ok) {
          const authData = await authRes.json() as { account?: { email_address?: string }; email_address?: string };
          email = authData.account?.email_address || authData.email_address || "";
        }
      } catch { /* skip */ }

      // 2) organizations 조회
      try {
        const res = await fetch("/api/organizations", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) return { ok: false, status: res.status, orgs: [], email };
        const data = await res.json();
        return { ok: true, status: res.status, orgs: data as Array<{ uuid: string; name?: string }>, email };
      } catch (e) {
        return { ok: false, status: 0, orgs: [], email, error: String(e) };
      }
    });

    // 모든 쿠키 추출 (httpOnly 포함)
    const cookies = await browserContext.cookies("https://claude.ai");
    const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    await browser.close();
    browser = undefined;

    if (!cookieString) {
      return NextResponse.json({ ok: false, error: "쿠키를 추출하지 못했습니다." }, { status: 502 });
    }

    // 이메일 결정: 직접 조회 > org 이름에서 추출 > org UUID > 기존 이름
    let displayName = verifyResult.email || "";
    if (!displayName && verifyResult.ok && Array.isArray(verifyResult.orgs) && verifyResult.orgs.length > 0) {
      const orgName = verifyResult.orgs[0].name || verifyResult.orgs[0].uuid;
      const emailMatch = orgName.match(/^([^@]+@[^']+)/);
      displayName = emailMatch ? emailMatch[1] : orgName;
    }

    if (!verifyResult.ok || !Array.isArray(verifyResult.orgs) || verifyResult.orgs.length === 0) {
      // 검증 실패해도 쿠키는 저장 (로그인은 성공했으므로)
      const updates: Record<string, unknown> = { sessionCookie: cookieString, enabled: true };
      if (displayName) updates.name = displayName;
      const updated = await updateMonitorAccount(id, updates);
      const refreshed = updated.accounts.find((a) => a.id === id);
      return NextResponse.json({
        ok: true,
        message: `로그인 성공 — ${displayName || "쿠키 저장 완료"}`,
        account: refreshed ? toPublicAccount(refreshed) : undefined,
      });
    }

    // 계정에 쿠키 + 이름 저장
    const updated = await updateMonitorAccount(id, { sessionCookie: cookieString, name: displayName || account.name, enabled: true });
    const refreshed = updated.accounts.find((a) => a.id === id);

    return NextResponse.json({
      ok: true,
      message: `로그인 성공 — ${displayName || account.name}`,
      account: refreshed ? toPublicAccount(refreshed) : undefined,
    });
  } catch (error) {
    console.error("[claude-login] Error:", error);
    const raw = error instanceof Error ? error.message : "";

    if (raw.includes("Timeout") || raw.includes("timeout")) {
      return NextResponse.json({ ok: false, error: "로그인 시간 초과 (3분). 다시 시도해 주세요." }, { status: 408 });
    }

    return NextResponse.json({ ok: false, error: "Claude 로그인 중 오류가 발생했습니다." }, { status: 500 });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
