import { ensureApiAuth } from "@/lib/usage-monitor/api-auth";
import { secureJson } from "@/lib/usage-monitor/response";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const check = await ensureApiAuth(request);
  if (!check.ok) return check.response;

  return secureJson({
    ok: true,
    username: check.auth.user.username,
    role: check.auth.user.role,
  });
}
