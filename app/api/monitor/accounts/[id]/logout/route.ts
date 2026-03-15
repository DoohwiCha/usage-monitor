import { ensureApiAdmin, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { ENCRYPTION_KEY_MISMATCH_ERROR, isEncryptionKeyMismatchError, updateMonitorAccount, readMonitorConfig, toPublicAccount } from "@/lib/usage-monitor/store";
import { resolveBrowserProfilePath } from "@/lib/usage-monitor/browser-profile-path";
import { secureJson } from "@/lib/usage-monitor/response";
import { logger } from "@/lib/usage-monitor/logger";
import { rm } from "node:fs/promises";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!verifyCsrfOrigin(request)) {
    return secureJson({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAdmin(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  try {
    const config = await readMonitorConfig();
    const account = config.accounts.find((a) => a.id === id);
    if (!account) {
      return secureJson({ ok: false, error: "Account not found." }, { status: 404 });
    }

    // Clear credentials
    await updateMonitorAccount(id, {
      sessionCookie: "",
      ...(account.provider === "openai" ? { apiKey: "", organizationId: "" } : {}),
    });

    // Remove browser profile directory
    const providers: Array<"claude" | "openai"> = [account.provider];
    for (const p of providers) {
      const profileDir = resolveBrowserProfilePath(p, id);
      try {
        await rm(profileDir, { recursive: true, force: true });
        logger.info("[account-logout] Removed browser profile", { accountId: id, profileDir });
      } catch {
        // Profile may not exist — that's fine
      }
    }

    logger.info("[account-logout] Account credentials cleared", { accountId: id, provider: account.provider });

    const updated = await readMonitorConfig();
    const updatedAccount = updated.accounts.find((a) => a.id === id);
    return secureJson({ ok: true, account: updatedAccount ? toPublicAccount(updatedAccount) : null });
  } catch (error) {
    if (isEncryptionKeyMismatchError(error)) {
      return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
    }
    logger.error("[account-logout] failed", { accountId: id, error: String(error) });
    return secureJson({ ok: false, error: "Failed to logout account." }, { status: 500 });
  }
}
