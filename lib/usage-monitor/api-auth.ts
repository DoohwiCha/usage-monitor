import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionCookieName, validateSessionToken } from "@/lib/usage-monitor/auth";
import type { AuthResult } from "@/lib/usage-monitor/auth";
import { secureJson } from "@/lib/usage-monitor/response";
import { resolveCookieSecure } from "@/lib/usage-monitor/cookies";

export async function ensureApiAuth(request?: Request): Promise<{ ok: true; auth: AuthResult } | { ok: false; response: NextResponse }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  const auth = validateSessionToken(token);
  if (!auth) {
    return {
      ok: false,
      response: secureJson({ ok: false, error: "Authentication required." }, { status: 401 }),
    };
  }

  // Refresh the cookie maxAge to keep it in sync with the renewed DB session
  try {
    cookieStore.set({
      name: getSessionCookieName(),
      value: token!,
      httpOnly: true,
      sameSite: "strict",
      secure: request ? resolveCookieSecure(request) : true,
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  } catch {
    // Cookie refresh is best-effort; some read-only contexts may not allow set
  }

  return { ok: true, auth };
}

export async function ensureApiAdmin(request?: Request): Promise<{ ok: true; auth: AuthResult } | { ok: false; response: NextResponse }> {
  const auth = await ensureApiAuth(request);
  if (!auth.ok) return auth;
  if (auth.auth.user.role !== "admin") {
    return {
      ok: false,
      response: secureJson({ ok: false, error: "Forbidden." }, { status: 403 }),
    };
  }
  return auth;
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
