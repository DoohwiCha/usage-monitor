import { deleteMonitorAccount, readMonitorConfig, toPublicAccount, updateMonitorAccount } from "@/lib/usage-monitor/store";
import { ensureApiAuth, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import type { ProviderType } from "@/lib/usage-monitor/types";
import { secureJson } from "@/lib/usage-monitor/response";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const PROVIDERS: ProviderType[] = ["claude", "openai"];

export async function GET(_: Request, context: RouteContext) {
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const config = await readMonitorConfig();
  const account = config.accounts.find((a) => a.id === id);

  if (!account) {
    return secureJson({ ok: false, error: "Account not found." }, { status: 404 });
  }

  return secureJson({ ok: true, account: toPublicAccount(account) });
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!verifyCsrfOrigin(request)) {
    return secureJson({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const providerRaw = body.provider ? String(body.provider) : undefined;
  const provider = providerRaw as ProviderType | undefined;

  if (provider && !PROVIDERS.includes(provider)) {
    return secureJson({ ok: false, error: "Unsupported provider. (claude or openai)" }, { status: 400 });
  }

  try {
    const config = await updateMonitorAccount(id, {
      name: body.name !== undefined ? String(body.name || "") : undefined,
      provider,
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
      sessionCookie: body.sessionCookie !== undefined ? String(body.sessionCookie || "") : undefined,
      apiKey: body.apiKey !== undefined ? String(body.apiKey || "") : undefined,
      organizationId: body.organizationId !== undefined ? String(body.organizationId || "") : undefined,
    });

    return secureJson({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error updating account.";
    return secureJson({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!verifyCsrfOrigin(request)) {
    return secureJson({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  try {
    const config = await deleteMonitorAccount(id);
    return secureJson({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error deleting account.";
    return secureJson({ ok: false, error: message }, { status: 400 });
  }
}
