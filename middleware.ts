import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "usage_monitor_session";

export function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (!token || token.length < 10) {
    if (request.nextUrl.pathname.startsWith("/api/monitor/")) {
      return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/monitor/login", request.url));
  }

  // Cookie exists — actual session validation happens in route handlers via SQLite.
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
