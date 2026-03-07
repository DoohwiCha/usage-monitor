import { ensureApiAdmin, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { ENCRYPTION_KEY_MISMATCH_ERROR, isEncryptionKeyMismatchError, reorderMonitorAccounts, toPublicAccount } from "@/lib/usage-monitor/store";
import { secureJson } from "@/lib/usage-monitor/response";
import { logger } from "@/lib/usage-monitor/logger";

export const runtime = "nodejs";
const CLIENT_REORDER_ERRORS = new Set([
  "orderedIds must include every account exactly once.",
  "orderedIds must not contain duplicates.",
  "orderedIds contains unknown account id.",
]);

export async function PATCH(request: Request) {
  if (!verifyCsrfOrigin(request)) {
    return secureJson({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAdmin();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return secureJson({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const orderedIds = body.orderedIds;

  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
    return secureJson({ ok: false, error: "orderedIds must be an array of strings." }, { status: 400 });
  }

  try {
    const config = await reorderMonitorAccounts(orderedIds as string[]);
    return secureJson({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error reordering accounts.";
    if (isEncryptionKeyMismatchError(error)) {
      return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
    }
    if (CLIENT_REORDER_ERRORS.has(message)) {
      return secureJson({ ok: false, error: message }, { status: 400 });
    }
    logger.error("[accounts:reorder] failed to reorder accounts", { error: String(error) });
    return secureJson({ ok: false, error: "Error reordering accounts." }, { status: 500 });
  }
}
