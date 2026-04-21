import { consumeAccountSyncSession } from "@/lib/usage-monitor/account-sync";
import { auditLog } from "@/lib/usage-monitor/audit";
import { logger } from "@/lib/usage-monitor/logger";
import { secureJson } from "@/lib/usage-monitor/response";
import {
  deleteUsageSnapshot,
} from "@/lib/usage-monitor/usage-adapters";
import {
  ENCRYPTION_KEY_MISMATCH_ERROR,
  isEncryptionKeyMismatchError,
  readMonitorConfig,
  toPublicAccount,
  updateMonitorAccount,
} from "@/lib/usage-monitor/store";
import type { MonitorAccount, ProviderType } from "@/lib/usage-monitor/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function isProviderType(value: string): value is ProviderType {
  return value === "claude" || value === "openai";
}

function parseString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return secureJson({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const token = parseString(body.token);
  const providerRaw = parseString(body.provider);
  if (!token) {
    return secureJson({ ok: false, error: "Sync token is required." }, { status: 400 });
  }
  if (!providerRaw || !isProviderType(providerRaw)) {
    return secureJson({ ok: false, error: "Unsupported provider. (claude or openai)" }, { status: 400 });
  }
  const provider: ProviderType = providerRaw;
  if (provider !== "claude") {
    return secureJson(
      { ok: false, error: "OpenAI local sync is no longer supported. Import a CLIProxyAPI Codex auth-store account instead." },
      { status: 400 },
    );
  }

  const authIdentity = parseString(body.authIdentity);
  const organizationId = parseString(body.organizationId);
  const sessionCookie = parseString(body.sessionCookie);
  if (!sessionCookie) {
    return secureJson({ ok: false, error: "Claude sync requires a session cookie." }, { status: 400 });
  }

  let account: MonitorAccount | undefined;
  try {
    const config = await readMonitorConfig();
    account = config.accounts.find((candidate) => candidate.id === id);
  } catch (error) {
    if (isEncryptionKeyMismatchError(error)) {
      return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
    }
    logger.error("[account-sync-upload] failed to read account", { accountId: id, error: String(error) });
    return secureJson({ ok: false, error: "Failed to read account configuration." }, { status: 500 });
  }

  if (!account) {
    return secureJson({ ok: false, error: "Account not found." }, { status: 404 });
  }
  if (account.provider !== provider) {
    return secureJson({ ok: false, error: "Sync provider does not match the account provider." }, { status: 400 });
  }

  const syncSession = consumeAccountSyncSession(id, provider, token);
  if (!syncSession) {
    return secureJson({ ok: false, error: "Invalid or expired sync token." }, { status: 401 });
  }

  const stamp = new Date().toISOString();

  try {
    const accountUpdates: Partial<MonitorAccount> = {
      sessionCookie,
      enabled: true,
      organizationId,
      authMode: "local_sync",
      authIdentity,
      lastSyncedAt: stamp,
      syncSource: "claude_cookie",
    };
    const config = await updateMonitorAccount(id, accountUpdates);
    deleteUsageSnapshot(id);
    const updatedAccount = config.accounts.find((candidate) => candidate.id === id);
    auditLog("account_sync_uploaded", {
      userId: syncSession.issuedByUserId,
      resourceType: "account",
      resourceId: id,
      details: "claude_cookie",
    });
    return secureJson({
      ok: true,
      message: "Claude session uploaded.",
      account: updatedAccount ? toPublicAccount(updatedAccount) : null,
    });
  } catch (error) {
    if (isEncryptionKeyMismatchError(error)) {
      return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
    }
    logger.error("[account-sync-upload] failed", { accountId: id, provider, error: String(error) });
    return secureJson({ ok: false, error: "Failed to upload local sync data." }, { status: 500 });
  }
}
