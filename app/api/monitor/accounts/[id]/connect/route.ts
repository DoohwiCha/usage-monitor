import { NextResponse } from "next/server";
import { ensureApiAuth, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { readMonitorConfig, toPublicAccount } from "@/lib/usage-monitor/store";
import { testConnection } from "@/lib/usage-monitor/usage-adapters";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!verifyCsrfOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const config = await readMonitorConfig();
  const account = config.accounts.find((a) => a.id === id);
  if (!account) {
    return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });
  }

  const result = await testConnection(account);

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.message,
        account: toPublicAccount(account),
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: result.message,
    account: toPublicAccount(account),
  });
}
