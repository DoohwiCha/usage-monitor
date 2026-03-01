import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionCookieName, readSessionUsername } from "@/lib/usage-monitor/auth";

export async function ensureApiAuth(): Promise<{ ok: true; user: string } | { ok: false; response: NextResponse }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  const username = readSessionUsername(token);
  if (!username) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 }),
    };
  }

  return { ok: true, user: username };
}

export function verifyCsrfOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin) {
    const referer = request.headers.get("referer");
    if (!referer || !host) return true; // No origin or referer = likely same-origin
    try { return new URL(referer).host === host; } catch { return false; }
  }
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
