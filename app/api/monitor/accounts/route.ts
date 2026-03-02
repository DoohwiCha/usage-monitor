import { addMonitorAccount, readMonitorConfig, toPublicAccount } from "@/lib/usage-monitor/store";
import { ensureApiAuth, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import type { ProviderType } from "@/lib/usage-monitor/types";
import { secureJson } from "@/lib/usage-monitor/response";

export const runtime = "nodejs";

const PROVIDERS: ProviderType[] = ["claude", "openai"];

export async function GET() {
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const config = await readMonitorConfig();
  return secureJson({
    ok: true,
    maxAccounts: config.maxAccounts,
    accounts: config.accounts.map(toPublicAccount),
  });
}

export async function POST(request: Request) {
  if (!verifyCsrfOrigin(request)) {
    return secureJson({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const provider = String(body.provider || "claude") as ProviderType;
  if (!PROVIDERS.includes(provider)) {
    return secureJson({ ok: false, error: "Unsupported provider. (claude or openai)" }, { status: 400 });
  }

  try {
    const config = await addMonitorAccount({
      name: String(body.name || ""),
      provider,
      enabled: Boolean(body.enabled),
      sessionCookie: provider === "claude" ? String(body.sessionCookie || "") : undefined,
      apiKey: provider === "openai" ? String(body.apiKey || "") : undefined,
      organizationId: provider === "openai" ? String(body.organizationId || "") : undefined,
    });

    return secureJson({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error adding account.";
    return secureJson({ ok: false, error: message }, { status: 400 });
  }
}
