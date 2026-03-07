import { deleteMonitorAccount, ENCRYPTION_KEY_MISMATCH_ERROR, isEncryptionKeyMismatchError, readMonitorConfig, toPublicAccount, updateMonitorAccount } from "@/lib/usage-monitor/store";
import { ensureApiAdmin, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import type { ProviderType } from "@/lib/usage-monitor/types";
import { secureJson } from "@/lib/usage-monitor/response";
import { logger } from "@/lib/usage-monitor/logger";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const PROVIDERS: ProviderType[] = ["claude", "openai"];
const CLIENT_UPDATE_ACCOUNT_ERRORS = new Set([
  "Account name must be 200 characters or less.",
  "Session cookie must be 20,000 characters or less.",
  "API key must be 500 characters or less.",
  "Organization ID must be 500 characters or less.",
  "MONITOR_ENCRYPTION_KEY must be set.",
]);

function parseBooleanInput(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0" || normalized === "") return false;
  }
  return Boolean(value);
}

export async function GET(_: Request, context: RouteContext) {
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
    logger.error("[accounts:id:get] failed to read account configuration", { accountId: id, error: String(error) });
    return secureJson({ ok: false, error: "Failed to read account configuration." }, { status: 500 });
  }

  if (!account) {
    return secureJson({ ok: false, error: "Account not found." }, { status: 404 });
  }

  return secureJson({ ok: true, account: toPublicAccount(account) });
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!verifyCsrfOrigin(request)) {
    return secureJson({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return secureJson({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (Object.keys(body).length === 0) {
    return secureJson({ ok: false, error: "No fields to update." }, { status: 400 });
  }

  const providerRaw = body.provider ? String(body.provider) : undefined;
  const provider = providerRaw as ProviderType | undefined;

  if (provider && !PROVIDERS.includes(provider)) {
    return secureJson({ ok: false, error: "Unsupported provider. (claude or openai)" }, { status: 400 });
  }

  try {
    const config = await updateMonitorAccount(id, {
      name: body.name !== undefined ? String(body.name || "") : undefined,
      provider,
      enabled: body.enabled !== undefined ? parseBooleanInput(body.enabled) : undefined,
      sessionCookie: body.sessionCookie !== undefined ? String(body.sessionCookie || "") : undefined,
      apiKey: body.apiKey !== undefined ? String(body.apiKey || "") : undefined,
      organizationId: body.organizationId !== undefined ? String(body.organizationId || "") : undefined,
    });

    return secureJson({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error updating account.";
    if (message === "Account not found.") {
      return secureJson({ ok: false, error: message }, { status: 404 });
    }
    if (isEncryptionKeyMismatchError(error)) {
      return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
    }
    if (CLIENT_UPDATE_ACCOUNT_ERRORS.has(message)) {
      return secureJson({ ok: false, error: message }, { status: 400 });
    }
    logger.error("[accounts:id:patch] failed to update account", { accountId: id, error: String(error) });
    return secureJson({ ok: false, error: "Error updating account." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!verifyCsrfOrigin(request)) {
    return secureJson({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  try {
    const config = await deleteMonitorAccount(id);
    return secureJson({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error deleting account.";
    if (message === "Account not found.") {
      return secureJson({ ok: false, error: message }, { status: 404 });
    }
    if (isEncryptionKeyMismatchError(error)) {
      return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
    }
    logger.error("[accounts:id:delete] failed to delete account", { accountId: id, error: String(error) });
    return secureJson({ ok: false, error: "Error deleting account." }, { status: 500 });
  }
}
