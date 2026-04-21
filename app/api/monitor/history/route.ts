import { ensureApiAuth } from "@/lib/usage-monitor/api-auth";
import { readUsageHistory } from "@/lib/usage-monitor/history";
import { readMonitorConfig } from "@/lib/usage-monitor/store";
import { secureJson } from "@/lib/usage-monitor/response";
import type { HistoryRangePreset } from "@/lib/usage-monitor/types";

const PRESETS: HistoryRangePreset[] = ["12h", "24h", "7d", "30d", "all"];

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await ensureApiAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const range = (searchParams.get("range") || "12h") as HistoryRangePreset;

  if (!PRESETS.includes(range)) {
    return secureJson({ ok: false, error: "Invalid range. Use 12h, 24h, 7d, 30d, or all." }, { status: 400 });
  }

  if (accountId) {
    const config = await readMonitorConfig();
    const account = config.accounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      return secureJson({ ok: false, error: "Account not found." }, { status: 404 });
    }
  }

  const history = readUsageHistory(accountId ? [accountId] : null, range);
  return secureJson({ ok: true, ...history });
}
