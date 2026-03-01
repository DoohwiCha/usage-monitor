import { NextResponse } from "next/server";
import { ensureApiAuth, verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { reorderMonitorAccounts, toPublicAccount } from "@/lib/usage-monitor/store";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  if (!verifyCsrfOrigin(request)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 403 });
  }
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const orderedIds = body.orderedIds;

  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ ok: false, error: "orderedIds must be an array of strings." }, { status: 400 });
  }

  try {
    const config = await reorderMonitorAccounts(orderedIds as string[]);
    return NextResponse.json({ ok: true, accounts: config.accounts.map(toPublicAccount) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error reordering accounts.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
