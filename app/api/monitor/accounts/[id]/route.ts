import { NextResponse } from "next/server";
import { deleteMonitorAccount, readMonitorConfig, toPublicAccount, updateMonitorAccount } from "@/lib/usage-monitor/store";
import { ensureApiAuth, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import type { ProviderType } from "@/lib/usage-monitor/types";

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
    return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, account: toPublicAccount(account) });
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!verifyCsrfOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const providerRaw = body.provider ? String(body.provider) : undefined;
  const provider = providerRaw as ProviderType | undefined;

  if (provider && !PROVIDERS.includes(provider)) {
    return NextResponse.json({ ok: false, error: "Unsupported provider. (claude or openai)" }, { status: 400 });
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

    return NextResponse.json({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error updating account.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!verifyCsrfOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  try {
    const config = await deleteMonitorAccount(id);
    return NextResponse.json({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error deleting account.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
