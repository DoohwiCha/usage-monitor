import { NextResponse } from "next/server";
import { ensureApiAuth, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { reorderMonitorAccounts, toPublicAccount } from "@/lib/usage-monitor/store";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  if (!verifyCsrfOrigin(request)) {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다." }, { status: 403 });
  }
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const orderedIds = body.orderedIds;

  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ ok: false, error: "orderedIds는 문자열 배열이어야 합니다." }, { status: 400 });
  }

  try {
    const config = await reorderMonitorAccounts(orderedIds as string[]);
    return NextResponse.json({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "순서 변경 중 오류가 발생했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
