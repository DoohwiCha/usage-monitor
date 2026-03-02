import { ensureApiAuth } from "@/lib/usage-monitor/api-auth";
import { resolveRange } from "@/lib/usage-monitor/range";
import { ENCRYPTION_KEY_MISMATCH_ERROR, isEncryptionKeyMismatchError, readMonitorConfig } from "@/lib/usage-monitor/store";
import { fetchUsageForAccount } from "@/lib/usage-monitor/usage-adapters";
import type { UsageOverviewResponse } from "@/lib/usage-monitor/types";
import { secureJson } from "@/lib/usage-monitor/response";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await ensureApiAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const range = resolveRange(searchParams.get("range"));

  try {
    const config = await readMonitorConfig();
    const targetAccounts = accountId
      ? config.accounts.filter((account) => account.id === accountId)
      : config.accounts;

    if (accountId && targetAccounts.length === 0) {
      return secureJson({ ok: false, error: "Account not found." }, { status: 404 });
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

    return secureJson({ ok: true, ...response });
  } catch (error) {
    if (isEncryptionKeyMismatchError(error)) {
      return secureJson({ ok: false, error: ENCRYPTION_KEY_MISMATCH_ERROR }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "Failed to fetch usage data.";
    return secureJson({ ok: false, error: message }, { status: 500 });
  }
}
