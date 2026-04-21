import { ensureApiAdmin, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { createAccountSyncSession } from "@/lib/usage-monitor/account-sync";
import { ENCRYPTION_KEY_MISMATCH_ERROR, isEncryptionKeyMismatchError, readMonitorConfig } from "@/lib/usage-monitor/store";
import { auditLog } from "@/lib/usage-monitor/audit";
import { secureJson } from "@/lib/usage-monitor/response";
import { logger } from "@/lib/usage-monitor/logger";

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
    const account = config.accounts.find((candidate) => candidate.id === id);
    if (!account) {
      return secureJson({ ok: false, error: "Account not found." }, { status: 404 });
    }
    if (account.provider !== "claude") {
      return secureJson(
        { ok: false, error: "OpenAI local sync is no longer supported. Import a CLIProxyAPI Codex auth-store account instead." },
        { status: 400 },
      );
    }

    const { token, session } = createAccountSyncSession(id, account.provider, auth.auth.user.id);
    auditLog("account_sync_session_created", {
      userId: auth.auth.user.id,
      resourceType: "account",
      resourceId: id,
      details: `${account.provider}:${session.expiresAt}`,
    });

    return secureJson({
      ok: true,
      syncToken: token,
      expiresAt: session.expiresAt,
      accountId: id,
      provider: account.provider,
      sync: {
        token,
        accountId: id,
        provider: account.provider,
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    if (isEncryptionKeyMismatchError(error)) {
      return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
    }
    logger.error("[account-sync-session] failed", { accountId: id, error: String(error) });
    return secureJson({ ok: false, error: "Failed to create local sync session." }, { status: 500 });
  }
}
