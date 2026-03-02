import { deleteMonitorAccount, ENCRYPTION_KEY_MISMATCH_ERROR, isEncryptionKeyMismatchError, readMonitorConfig, toPublicAccount, updateMonitorAccount } from "@/lib/usage-monitor/store";
import { ensureApiAdmin, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import type { ProviderType } from "@/lib/usage-monitor/types";
import { secureJson } from "@/lib/usage-monitor/response";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const PROVIDERS: ProviderType[] = ["claude", "openai"];

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
    const message = error instanceof Error ? error.message : "Failed to read account configuration.";
    return secureJson({ ok: false, error: message }, { status: 500 });
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
    return secureJson({ ok: false, error: message }, { status: 400 });
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
    return secureJson({ ok: false, error: message }, { status: 400 });
  }
}
