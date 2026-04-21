import { ensureApiAdmin } from "@/lib/usage-monitor/api-auth";
import { scanCliProxyAuthStore } from "@/lib/usage-monitor/cliproxy-auth-store";
import { logger } from "@/lib/usage-monitor/logger";
import { secureJson } from "@/lib/usage-monitor/response";
import { readMonitorConfig } from "@/lib/usage-monitor/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await ensureApiAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const [config, candidates] = await Promise.all([
      readMonitorConfig(),
      Promise.resolve(scanCliProxyAuthStore()),
    ]);

    return secureJson({
      ok: true,
      candidates: candidates.map((candidate) => {
        const existing = config.accounts.find((account) => account.sourcePath === candidate.sourcePath);
        return {
          ...candidate,
          imported: Boolean(existing),
          existingAccountId: existing?.id || null,
        };
      }),
    });
  } catch (error) {
    logger.error("[cliproxy-auth-sources:get] failed", { error: String(error) });
    return secureJson({ ok: false, error: "Failed to load CLIProxyAPI auth sources." }, { status: 500 });
  }
}
