import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionCookieName, validateSessionToken } from "@/lib/usage-monitor/auth";
import type { AuthResult } from "@/lib/usage-monitor/auth";
import { secureJson } from "@/lib/usage-monitor/response";

export async function ensureApiAuth(): Promise<{ ok: true; auth: AuthResult } | { ok: false; response: NextResponse }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  const auth = validateSessionToken(token);
  if (!auth) {
    return {
      ok: false,
      response: secureJson({ ok: false, error: "Authentication required." }, { status: 401 }),
    };
  }

  return { ok: true, auth };
}

export function verifyCsrfOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!host) return false;

  if (origin) {
    try { return new URL(origin).host === host; } catch { return false; }
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try { return new URL(referer).host === host; } catch { return false; }
  }

  return false;
}
