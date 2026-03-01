import { NextResponse } from "next/server";
import { ensureApiAuth } from "@/lib/usage-monitor/api-auth";
import { resolveRange } from "@/lib/usage-monitor/range";
import { readMonitorConfig } from "@/lib/usage-monitor/store";
import { fetchUsageForAccount } from "@/lib/usage-monitor/usage-adapters";
import type { UsageOverviewResponse } from "@/lib/usage-monitor/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const range = resolveRange(searchParams.get("range"));

  const config = await readMonitorConfig();
  const targetAccounts = accountId
    ? config.accounts.filter((account) => account.id === accountId)
    : config.accounts;

  if (accountId && targetAccounts.length === 0) {
    return NextResponse.json({ ok: false, error: "Account not found." }, { status: 404 });
  }

  const reports = await Promise.all(targetAccounts.map((account) => fetchUsageForAccount(account, range)));

  const response: UsageOverviewResponse = {
    range: {
      preset: range.preset,
      startIso: range.startIso,
      endIso: range.endIso,
    },
    summary: {
      accountCount: reports.length,
      activeCount: reports.filter((r) => r.status !== "disabled").length,
      okCount: reports.filter((r) => r.status === "ok").length,
      errorCount: reports.filter((r) => r.status === "error").length,
      totalCostUsd: Math.round(reports.reduce((sum, r) => sum + r.costUsd, 0) * 100) / 100,
      totalRequests: Math.round(reports.reduce((sum, r) => sum + r.requests, 0)),
      totalTokens: Math.round(reports.reduce((sum, r) => sum + r.tokens, 0)),
      fetchedAt: new Date().toISOString(),
    },
    accounts: reports,
  };

  return NextResponse.json({ ok: true, ...response });
}
