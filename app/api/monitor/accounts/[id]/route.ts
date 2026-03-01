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
    return NextResponse.json({ ok: false, error: "계정을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, account: toPublicAccount(account) });
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!verifyCsrfOrigin(request)) {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다." }, { status: 403 });
  }
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const providerRaw = body.provider ? String(body.provider) : undefined;
  const provider = providerRaw as ProviderType | undefined;

  if (provider && !PROVIDERS.includes(provider)) {
    return NextResponse.json({ ok: false, error: "지원하지 않는 provider 입니다. (claude 또는 openai)" }, { status: 400 });
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
    const message = error instanceof Error ? error.message : "계정 수정 중 오류가 발생했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!verifyCsrfOrigin(request)) {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다." }, { status: 403 });
  }
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  try {
    const config = await deleteMonitorAccount(id);
    return NextResponse.json({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "계정 삭제 중 오류가 발생했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
