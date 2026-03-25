import { addMonitorAccount, ENCRYPTION_KEY_MISMATCH_ERROR, isEncryptionKeyMismatchError, readMonitorConfig, toPublicAccount, updateMonitorAccount } from "@/lib/usage-monitor/store";
import { fetchOpenAIIdentity } from "@/lib/usage-monitor/usage-adapters";
import { ensureApiAdmin, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import type { ProviderType } from "@/lib/usage-monitor/types";
import { secureJson } from "@/lib/usage-monitor/response";
import { logger } from "@/lib/usage-monitor/logger";

export const runtime = "nodejs";

const PROVIDERS: ProviderType[] = ["claude", "openai"];
const CLIENT_ADD_ACCOUNT_ERRORS = new Set([
  "Maximum 12 accounts allowed.",
  "Account name must be 200 characters or less.",
  "Session cookie must be 20,000 characters or less.",
  "API key must be 500 characters or less.",
  "Organization ID must be 500 characters or less.",
  "MONITOR_ENCRYPTION_KEY must be set.",
]);

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

export async function GET(request: Request) {
  const auth = await ensureApiAdmin(request);
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
    logger.error("[accounts:get] failed to read account configuration", { error: String(error) });
    return secureJson({ ok: false, error: "Failed to read account configuration." }, { status: 500 });
  }
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

    // Auto-fetch identity for OpenAI accounts with API key (like Claude browser login)
    if (provider === "openai" && body.apiKey && (!body.name || !String(body.name).trim())) {
      try {
        const newAccount = config.accounts[config.accounts.length - 1];
        if (newAccount) {
          const identity = await fetchOpenAIIdentity(newAccount);
          if (identity?.email) {
            const updated = await updateMonitorAccount(newAccount.id, { name: identity.email });
            return secureJson({ ok: true, accounts: updated.accounts.map(toPublicAccount) });
          }
        }
      } catch { /* identity fetch is best-effort */ }
    }

    return secureJson({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    if (isEncryptionKeyMismatchError(error)) {
      return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "";
    if (CLIENT_ADD_ACCOUNT_ERRORS.has(message)) {
      return secureJson({ ok: false, error: message }, { status: 400 });
    }
    logger.error("[accounts:post] failed to add account", { error: String(error) });
    return secureJson({ ok: false, error: "Error adding account." }, { status: 500 });
  }
}
