import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "usage_monitor_session";

async function verifySession(token: string): Promise<string | null> {
  let raw = "";
  try {
    raw = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }

  const [username, expRaw, signature] = raw.split("|");
  if (!username || !expRaw || !signature) return null;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;

  // HMAC-SHA256 verification using Web Crypto API (Edge compatible)
  if (process.env.NODE_ENV === "production" && !process.env.MONITOR_SESSION_SECRET) throw new Error("MONITOR_SESSION_SECRET required");
  const secret = process.env.MONITOR_SESSION_SECRET || "change-this-monitor-session-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = `${username}|${expRaw}`;
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const expectedBytes = new TextEncoder().encode(expected);
  const signatureBytes = new TextEncoder().encode(signature);
  if (expectedBytes.length !== signatureBytes.length) return null;
  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) diff |= expectedBytes[i] ^ signatureBytes[i];
  if (diff !== 0) return null;
  return username;
}

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const username = token ? await verifySession(token) : null;

  if (!username) {
    if (request.nextUrl.pathname.startsWith("/api/monitor/")) {
      return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/monitor/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/monitor/accounts/:path*",
    "/api/monitor/usage/:path*",
    "/api/monitor/auth/me",
    "/api/monitor/auth/logout",
    "/monitor/((?!login).*)",
  ],
};
