import { ensureApiAdmin, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { ENCRYPTION_KEY_MISMATCH_ERROR, isEncryptionKeyMismatchError, reorderMonitorAccounts, toPublicAccount } from "@/lib/usage-monitor/store";
import { secureJson } from "@/lib/usage-monitor/response";

export const runtime = "nodejs";

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
    return secureJson({ ok: false, error: message }, { status: 400 });
  }
}
