import { ensureApiAdmin, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { findCliProxyCandidateByPath } from "@/lib/usage-monitor/cliproxy-auth-store";
import { logger } from "@/lib/usage-monitor/logger";
import { secureJson } from "@/lib/usage-monitor/response";
import {
  addMonitorAccount,
  ENCRYPTION_KEY_MISMATCH_ERROR,
  isEncryptionKeyMismatchError,
  readMonitorConfig,
  toPublicAccount,
} from "@/lib/usage-monitor/store";

export const runtime = "nodejs";

const CLIENT_ERRORS = new Set([
  "Maximum 12 accounts allowed.",
  "Account name must be 200 characters or less.",
  "Auth identity must be 500 characters or less.",
  "Source path must be 2,000 characters or less.",
  "Source account ID must be 500 characters or less.",
]);

function isExpired(sourceExpiresAt?: string): boolean {
  if (!sourceExpiresAt) return false;
  const expiresAtMs = Date.parse(sourceExpiresAt);
  if (!Number.isFinite(expiresAtMs)) return false;
  return expiresAtMs <= Date.now();
}

export async function POST(request: Request) {
  if (!verifyCsrfOrigin(request)) {
    return secureJson({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAdmin(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return secureJson({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath.trim() : "";
  if (!sourcePath) {
    return secureJson({ ok: false, error: "sourcePath is required." }, { status: 400 });
    }

    try {
      const candidate = findCliProxyCandidateByPath(sourcePath);
    if (!candidate) {
      return secureJson({ ok: false, error: "CLIProxyAPI auth source not found." }, { status: 404 });
    }

    const current = await readMonitorConfig();
    const existing = current.accounts.find((account) => account.sourcePath === candidate.sourcePath);
      if (existing) {
        return secureJson({ ok: true, account: toPublicAccount(existing), imported: false });
      }

      const shouldEnable = !candidate.disabled && !isExpired(candidate.sourceExpiresAt);

      const config = await addMonitorAccount({
        name: candidate.displayName,
        provider: candidate.provider,
        enabled: shouldEnable,
        authMode: "auth_store",
        authIdentity: candidate.email,
        lastSyncedAt: new Date().toISOString(),
      syncSource: candidate.syncSource,
      sourcePath: candidate.sourcePath,
      sourceAccountId: candidate.sourceAccountId,
      sourceExpiresAt: candidate.sourceExpiresAt,
      ...(candidate.planType ? { subscriptionInfo: { plan: candidate.planType } } : {}),
    });

    const account = config.accounts.find((item) => item.sourcePath === candidate.sourcePath);
    return secureJson({
      ok: true,
      account: account ? toPublicAccount(account) : null,
      accounts: config.accounts.map(toPublicAccount),
      imported: true,
    });
  } catch (error) {
    if (isEncryptionKeyMismatchError(error)) {
      return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "Failed to import CLIProxyAPI auth source.";
    if (CLIENT_ERRORS.has(message)) {
      return secureJson({ ok: false, error: message }, { status: 400 });
    }
    logger.error("[accounts:import-cliproxy] failed", { error: String(error), sourcePath });
    return secureJson({ ok: false, error: "Failed to import CLIProxyAPI auth source." }, { status: 500 });
  }
}
