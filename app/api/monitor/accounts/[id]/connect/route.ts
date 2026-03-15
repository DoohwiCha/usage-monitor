import { ensureApiAdmin, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { ENCRYPTION_KEY_MISMATCH_ERROR, isEncryptionKeyMismatchError, readMonitorConfig, toPublicAccount } from "@/lib/usage-monitor/store";
import { testConnection } from "@/lib/usage-monitor/usage-adapters";
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
  let account: Awaited<ReturnType<typeof readMonitorConfig>>["accounts"][number] | undefined;
  try {
    const config = await readMonitorConfig();
    account = config.accounts.find((a) => a.id === id);
  } catch (error) {
    if (isEncryptionKeyMismatchError(error)) {
      return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
    }
    logger.error("[accounts:connect] failed to read account configuration", { accountId: id, error: String(error) });
    return secureJson({ ok: false, error: "Failed to read account configuration." }, { status: 500 });
  }
  if (!account) {
    return secureJson({ ok: false, error: "Account not found." }, { status: 404 });
  }

  const result = await testConnection(account);

  if (!result.ok) {
    return secureJson(
      {
        ok: false,
        error: result.message,
        account: toPublicAccount(account),
      },
      { status: 400 },
    );
  }

  return secureJson({
    ok: true,
    message: result.message,
    account: toPublicAccount(account),
  });
}
