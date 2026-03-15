import { listDeletedAccounts, restoreMonitorAccount, toPublicAccount } from "@/lib/usage-monitor/store";
import { ensureApiAdmin, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { secureJson } from "@/lib/usage-monitor/response";
import { logger } from "@/lib/usage-monitor/logger";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await ensureApiAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const accounts = await listDeletedAccounts();
    return secureJson({ ok: true, accounts });
  } catch (error) {
    logger.error("[accounts:deleted:get] failed to list deleted accounts", { error: String(error) });
    return secureJson({ ok: false, error: "Failed to list deleted accounts." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!verifyCsrfOrigin(request)) {
    return secureJson({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAdmin(request);
  if (!auth.ok) return auth.response;

  let body: { id?: string };
  try {
    body = await request.json() as { id?: string };
  } catch {
    return secureJson({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.id) {
    return secureJson({ ok: false, error: "Account ID is required." }, { status: 400 });
  }

  try {
    const config = await restoreMonitorAccount(body.id);
    return secureJson({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error restoring account.";
    if (message === "No deleted account found with this ID.") {
      return secureJson({ ok: false, error: message }, { status: 404 });
    }
    logger.error("[accounts:deleted:restore] failed to restore account", { accountId: body.id, error: String(error) });
    return secureJson({ ok: false, error: "Error restoring account." }, { status: 500 });
  }
}
