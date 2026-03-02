import { ensureApiAuth, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { readMonitorConfig, toPublicAccount, updateMonitorAccount } from "@/lib/usage-monitor/store";
import type { SubscriptionInfo } from "@/lib/usage-monitor/types";
import { acquireBrowserSlot, releaseBrowserSlot, BrowserPoolExhaustedError } from "@/lib/usage-monitor/browser-pool";
import { logger } from "@/lib/usage-monitor/logger";
import { auditLog } from "@/lib/usage-monitor/audit";
import { secureJson } from "@/lib/usage-monitor/response";

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
    return secureJson({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const config = await readMonitorConfig();
  const account = config.accounts.find((a) => a.id === id);
  if (!account) {
    return secureJson({ ok: false, error: "Account not found." }, { status: 404 });
  }
  // Auto-switch provider to openai if different
  if (account.provider !== "openai") {
    await updateMonitorAccount(id, { provider: "openai" });
  }

  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    return secureJson(
      { ok: false, error: "Playwright is not installed. Run `npx playwright install chromium`." },
      { status: 500 },
    );
  }

  try {
    await acquireBrowserSlot();
  } catch (err) {
    if (err instanceof BrowserPoolExhaustedError) {
      return secureJson({ ok: false, error: err.message }, { status: 429 });
    }
    throw err;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: false });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();

    // Navigate directly to login page
    await page.goto("https://chatgpt.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Wait until redirected to chatgpt.com main page after login (max 3 minutes)
    await page.waitForURL(
      (url) => {
        const u = new URL(url);
        const isChat = u.hostname === "chatgpt.com" || u.hostname === "chat.openai.com";
        // Complete when navigated away from login/auth-related paths
        return isChat &&
          !u.pathname.startsWith("/auth") &&
          !u.pathname.startsWith("/login");
      },
      { timeout: 180_000 },
    );

    // Wait for page to fully load
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Extract user info + subscription info from the logged-in browser
    const extractResult = await page.evaluate(async () => {
      const out: { email: string; name: string; plan: string; renewsAt: string | null; billingPeriod: string | null } = {
        email: "", name: "", plan: "", renewsAt: null, billingPeriod: null,
      };

      // User info
      try {
        const meRes = await fetch("/backend-api/me", { headers: { "Content-Type": "application/json" } });
        if (meRes.ok) {
          const me = await meRes.json() as { email?: string; name?: string };
          out.email = me.email || "";
          out.name = me.name || "";
        }
      } catch { /* skip */ }

      // Subscription info
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

    // Filter and store only auth cookies (remove PII)
    const allCookies = await browserContext.cookies("https://chatgpt.com");
    const filteredCookies = allCookies.filter((c) => AUTH_COOKIE_NAMES.has(c.name));
    const cookieString = JSON.stringify(filteredCookies);

    await browser.close();
    browser = undefined;

    if (!cookieString || cookieString === "[]") {
      return secureJson({ ok: false, error: "Failed to extract cookies." }, { status: 502 });
    }

    const displayName = extractResult.email || extractResult.name || account.name;

    // Save subscription info to subscriptionInfo field
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
    auditLog("openai_session_extracted", { resourceType: "account", resourceId: id, details: displayName });

    return secureJson({
      ok: true,
      message: `Login successful — ${displayName}`,
      account: refreshed ? toPublicAccount(refreshed) : undefined,
    });
  } catch (error) {
    logger.error("[openai-login] Error during login", { accountId: id, error: String(error) });
    const raw = error instanceof Error ? error.message : "";

    if (raw.includes("Timeout") || raw.includes("timeout")) {
      return secureJson({ ok: false, error: "Login timeout (3 min). Please try again." }, { status: 408 });
    }

    return secureJson({ ok: false, error: "Error during OpenAI login." }, { status: 500 });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    releaseBrowserSlot();
  }
}
