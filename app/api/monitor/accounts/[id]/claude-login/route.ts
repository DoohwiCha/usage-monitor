import { NextResponse } from "next/server";
import { ensureApiAuth, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { readMonitorConfig, toPublicAccount, updateMonitorAccount } from "@/lib/usage-monitor/store";

export const runtime = "nodejs";
export const maxDuration = 180;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!verifyCsrfOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const config = await readMonitorConfig();
  const account = config.accounts.find((a) => a.id === id);
  if (!account) {
    return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });
  }
  // Auto-switch provider to claude if different
  if (account.provider !== "claude") {
    await updateMonitorAccount(id, { provider: "claude" });
  }

  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    return NextResponse.json(
      { ok: false, error: "Playwright is not installed. Run `npx playwright install chromium`." },
      { status: 500 },
    );
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: false });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    await page.goto("https://claude.ai/login", { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Wait for user to complete login (max 3 minutes)
    // Login is complete when navigated away from /login, /magic-link, /oauth pages
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

    // Wait briefly for cookies to fully settle
    await page.waitForTimeout(2_000);

    // Call user info + organizations API from within the browser (Cloudflare bypass)
    const verifyResult = await page.evaluate(async () => {
      let email = "";

      // 1) Fetch user email directly
      try {
        const authRes = await fetch("/api/auth/current_account", {
          headers: { "Content-Type": "application/json" },
        });
        if (authRes.ok) {
          const authData = await authRes.json() as { account?: { email_address?: string }; email_address?: string };
          email = authData.account?.email_address || authData.email_address || "";
        }
      } catch { /* skip */ }

      // 2) Fetch organizations
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

    // Extract all cookies (including httpOnly)
    const cookies = await browserContext.cookies("https://claude.ai");
    const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    await browser.close();
    browser = undefined;

    if (!cookieString) {
      return NextResponse.json({ ok: false, error: "Failed to extract cookies." }, { status: 502 });
    }

    // Determine display name: direct email > org name > org UUID > existing name
    let displayName = verifyResult.email || "";
    if (!displayName && verifyResult.ok && Array.isArray(verifyResult.orgs) && verifyResult.orgs.length > 0) {
      const orgName = verifyResult.orgs[0].name || verifyResult.orgs[0].uuid;
      const emailMatch = orgName.match(/^([^@]+@[^']+)/);
      displayName = emailMatch ? emailMatch[1] : orgName;
    }

    if (!verifyResult.ok || !Array.isArray(verifyResult.orgs) || verifyResult.orgs.length === 0) {
      // Save cookies even if verification fails (login succeeded)
      const updates: Record<string, unknown> = { sessionCookie: cookieString, enabled: true };
      if (displayName) updates.name = displayName;
      const updated = await updateMonitorAccount(id, updates);
      const refreshed = updated.accounts.find((a) => a.id === id);
      return NextResponse.json({
        ok: true,
        message: `Login successful — ${displayName || "cookies saved"}`,
        account: refreshed ? toPublicAccount(refreshed) : undefined,
      });
    }

    // Save cookies + name to account
    const updated = await updateMonitorAccount(id, { sessionCookie: cookieString, name: displayName || account.name, enabled: true });
    const refreshed = updated.accounts.find((a) => a.id === id);

    return NextResponse.json({
      ok: true,
      message: `Login successful — ${displayName || account.name}`,
      account: refreshed ? toPublicAccount(refreshed) : undefined,
    });
  } catch (error) {
    console.error("[claude-login] Error:", error);
    const raw = error instanceof Error ? error.message : "";

    if (raw.includes("Timeout") || raw.includes("timeout")) {
      return NextResponse.json({ ok: false, error: "Login timeout (3 min). Please try again." }, { status: 408 });
    }

    return NextResponse.json({ ok: false, error: "Error during Claude login." }, { status: 500 });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
