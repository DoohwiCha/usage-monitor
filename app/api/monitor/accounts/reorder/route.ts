import { ensureApiAuth, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { reorderMonitorAccounts, toPublicAccount } from "@/lib/usage-monitor/store";
import { secureJson } from "@/lib/usage-monitor/response";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  if (!verifyCsrfOrigin(request)) {
    return secureJson({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const orderedIds = body.orderedIds;

  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
    return secureJson({ ok: false, error: "orderedIds must be an array of strings." }, { status: 400 });
  }

  try {
    const config = await reorderMonitorAccounts(orderedIds as string[]);
    return secureJson({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error reordering accounts.";
    return secureJson({ ok: false, error: message }, { status: 400 });
  }
}
