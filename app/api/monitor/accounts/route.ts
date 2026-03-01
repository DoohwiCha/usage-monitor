import { NextResponse } from "next/server";
import { addMonitorAccount, readMonitorConfig, toPublicAccount } from "@/lib/usage-monitor/store";
import { ensureApiAuth, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import type { ProviderType } from "@/lib/usage-monitor/types";

export const runtime = "nodejs";

const PROVIDERS: ProviderType[] = ["claude", "openai"];

export async function GET() {
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const config = await readMonitorConfig();
  return NextResponse.json({
    ok: true,
    maxAccounts: config.maxAccounts,
    accounts: config.accounts.map(toPublicAccount),
  });
}

export async function POST(request: Request) {
  if (!verifyCsrfOrigin(request)) {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다." }, { status: 403 });
  }
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const provider = String(body.provider || "claude") as ProviderType;
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ ok: false, error: "지원하지 않는 provider 입니다. (claude 또는 openai)" }, { status: 400 });
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

    return NextResponse.json({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "계정 추가 중 오류가 발생했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
