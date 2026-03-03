import { ensureApiAdmin, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { ENCRYPTION_KEY_MISMATCH_ERROR, isEncryptionKeyMismatchError, readMonitorConfig, toPublicAccount, updateMonitorAccount } from "@/lib/usage-monitor/store";
import { acquireBrowserSlot, releaseBrowserSlot, BrowserPoolExhaustedError } from "@/lib/usage-monitor/browser-pool";
import { logger } from "@/lib/usage-monitor/logger";
import { auditLog } from "@/lib/usage-monitor/audit";
import { secureJson } from "@/lib/usage-monitor/response";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!verifyCsrfOrigin(request)) {
    return secureJson({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  let account: Awaited<ReturnType<typeof readMonitorConfig>>["accounts"][number] | undefined;
  try {
    const config = await readMonitorConfig();
    account = config.accounts.find((a) => a.id === id);
  } catch (error) {
    if (isEncryptionKeyMismatchError(error)) {
      return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "Failed to read account configuration.";
    return secureJson({ ok: false, error: message }, { status: 500 });
  }
  if (!account) {
    return secureJson({ ok: false, error: "Account not found." }, { status: 404 });
  }
  // Auto-switch provider to claude if different
  if (account.provider !== "claude") {
    try {
      await updateMonitorAccount(id, { provider: "claude" });
    } catch (error) {
      if (isEncryptionKeyMismatchError(error)) {
        return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
      }
      const message = error instanceof Error ? error.message : "Failed to update account provider.";
      return secureJson({ ok: false, error: message }, { status: 500 });
    }
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
    browser = await playwright.chromium.launch({
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-gpu",
        "--disable-gpu-compositing",
        "--use-gl=swiftshader",
        "--no-sandbox",
        "--ozone-platform=x11",
      ],
    });
    const browserContext = await browser.newContext({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/New_York",
      viewport: { width: 1365, height: 900 },
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    });
    await browserContext.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });
    const page = await browserContext.newPage();

    await page.goto("https://claude.ai/login", { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Poll for completed login/human verification.
    // We only proceed when organizations API is actually accessible.
    const verifyDeadline = Date.now() + 170_000;
    let timedOut = false;
    let verifyResult: {
      ok: boolean;
      status: number;
      orgs: Array<{ uuid: string; name?: string }>;
      email: string;
      path: string;
      challenge: boolean;
      error?: string;
    } | null = null;

    while (true) {
      verifyResult = await page.evaluate(async () => {
        const path = window.location.pathname || "/";
        const pageText = (document.body?.innerText || "").toLowerCase();
        const challenge =
          pageText.includes("performing security verification") ||
          pageText.includes("verifies you are not a bot") ||
          pageText.includes("checking your browser");

        if (challenge) {
          return { ok: false, status: 0, orgs: [], email: "", path, challenge };
        }

        let email = "";

        try {
          const authRes = await fetch("/api/auth/current_account", {
            headers: { "Content-Type": "application/json" },
          });
          if (authRes.ok) {
            const authData = await authRes.json() as { account?: { email_address?: string }; email_address?: string };
            email = authData.account?.email_address || authData.email_address || "";
          }
        } catch { /* skip */ }

        try {
          const res = await fetch("/api/organizations", {
            method: "GET",
            headers: { "Content-Type": "application/json" },
          });
          if (!res.ok) return { ok: false, status: res.status, orgs: [], email, path, challenge };
          const data = await res.json();
          return { ok: true, status: res.status, orgs: data as Array<{ uuid: string; name?: string }>, email, path, challenge };
        } catch (e) {
          return { ok: false, status: 0, orgs: [], email, path, challenge, error: String(e) };
        }
      });

      if (verifyResult.ok && verifyResult.orgs.length > 0) {
        break;
      }
      if (Date.now() >= verifyDeadline) {
        timedOut = true;
        break;
      }
      await page.waitForTimeout(2_500);
    }

    if (!verifyResult || !verifyResult.ok || verifyResult.orgs.length === 0) {
      logger.warn("[claude-login] Verification incomplete before close", {
        accountId: id,
        status: verifyResult?.status ?? 0,
        path: verifyResult?.path ?? "unknown",
        challenge: verifyResult?.challenge ?? false,
        timedOut,
      });

      if (timedOut) {
        if (verifyResult?.challenge) {
          return secureJson(
            {
              ok: false,
              error:
                "Cloudflare human verification appears stuck in the automated browser. Please login once in your normal browser and paste session cookie manually.",
            },
            { status: 504 },
          );
        }
        return secureJson(
          { ok: false, error: "Human verification/login was not completed in time (3 min). Please finish verification, then retry." },
          { status: 504 },
        );
      }
      if (verifyResult?.status === 403) {
        return secureJson(
          { ok: false, error: "Claude rejected organization access (403). Complete human verification and ensure account access, then retry." },
          { status: 403 },
        );
      }
      if (verifyResult?.status === 401) {
        return secureJson({ ok: false, error: "Claude session is not authenticated. Please login again." }, { status: 401 });
      }
      return secureJson({ ok: false, error: "Claude login verification did not complete. Please retry." }, { status: 502 });
    }

    // Extract all cookies (including httpOnly)
    const cookies = await browserContext.cookies("https://claude.ai");
    const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    if (!cookieString) {
      return secureJson({ ok: false, error: "Failed to extract cookies." }, { status: 502 });
    }

    // Determine display name: direct email > org name > org UUID > existing name
    let displayName = verifyResult.email || "";
    if (!displayName && verifyResult.ok && Array.isArray(verifyResult.orgs) && verifyResult.orgs.length > 0) {
      const orgName = verifyResult.orgs[0].name || verifyResult.orgs[0].uuid;
      const emailMatch = orgName.match(/^([^@]+@[^']+)/);
      displayName = emailMatch ? emailMatch[1] : orgName;
    }

    // Save cookies + name to account
    const updated = await updateMonitorAccount(id, { sessionCookie: cookieString, name: displayName || account.name, enabled: true });
    const refreshed = updated.accounts.find((a) => a.id === id);
    auditLog("claude_session_extracted", { resourceType: "account", resourceId: id, details: displayName || account.name });

    return secureJson({
      ok: true,
      message: `Login successful — ${displayName || account.name}`,
      account: refreshed ? toPublicAccount(refreshed) : undefined,
    });
  } catch (error) {
    logger.error("[claude-login] Error during login", { accountId: id, error: String(error) });
    const raw = error instanceof Error ? error.message : "";

    if (raw.includes("Timeout") || raw.includes("timeout")) {
      return secureJson({ ok: false, error: "Login timeout (3 min). Please try again." }, { status: 504 });
    }
    if (isEncryptionKeyMismatchError(error)) {
      return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
    }

    return secureJson({ ok: false, error: "Error during Claude login." }, { status: 500 });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    releaseBrowserSlot();
  }
}
