import { addMonitorAccount, ENCRYPTION_KEY_MISMATCH_ERROR, isEncryptionKeyMismatchError, readMonitorConfig, toPublicAccount } from "@/lib/usage-monitor/store";
import { ensureApiAdmin, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import type { ProviderType } from "@/lib/usage-monitor/types";
import { secureJson } from "@/lib/usage-monitor/response";

export const runtime = "nodejs";

const PROVIDERS: ProviderType[] = ["claude", "openai"];

function parseBooleanInput(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0" || normalized === "") return false;
  }
  return Boolean(value);
}

export async function GET() {
  const auth = await ensureApiAdmin();
  if (!auth.ok) return auth.response;

  try {
    const config = await readMonitorConfig();
    return secureJson({
      ok: true,
      maxAccounts: config.maxAccounts,
      accounts: config.accounts.map(toPublicAccount),
    });
  } catch (error) {
    if (isEncryptionKeyMismatchError(error)) {
      return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "Failed to read account configuration.";
    return secureJson({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
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

  const provider = String(body.provider || "claude") as ProviderType;
  if (!PROVIDERS.includes(provider)) {
    return secureJson({ ok: false, error: "Unsupported provider. (claude or openai)" }, { status: 400 });
  }

  try {
    const config = await addMonitorAccount({
      name: String(body.name || ""),
      provider,
      enabled: parseBooleanInput(body.enabled, false),
      sessionCookie: provider === "claude" ? String(body.sessionCookie || "") : undefined,
      apiKey: provider === "openai" ? String(body.apiKey || "") : undefined,
      organizationId: provider === "openai" ? String(body.organizationId || "") : undefined,
    });

    return secureJson({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    if (isEncryptionKeyMismatchError(error)) {
      return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "Error adding account.";
    return secureJson({ ok: false, error: message }, { status: 400 });
  }
}
