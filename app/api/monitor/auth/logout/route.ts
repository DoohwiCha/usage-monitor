import { cookies } from "next/headers";
import { logout, getSessionCookieName } from "@/lib/usage-monitor/auth";
import { secureJson } from "@/lib/usage-monitor/response";
import { resolveCookieSecure } from "@/lib/usage-monitor/cookies";
import { verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!verifyCsrfOrigin(request)) {
    return secureJson({ ok: false, error: "Invalid request." }, { status: 403 });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;

  if (token) {
    logout(token);
  }

  cookieStore.set({
    name: getSessionCookieName(),
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: resolveCookieSecure(request),
    path: "/",
    maxAge: 0,
  });

  return secureJson({ ok: true });
}
