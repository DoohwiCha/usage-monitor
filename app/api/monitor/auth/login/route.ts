import { cookies } from "next/headers";
import { login, getSessionCookieName } from "@/lib/usage-monitor/auth";
import { checkRateLimit } from "@/lib/usage-monitor/rate-limiter";
import { secureJson } from "@/lib/usage-monitor/response";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  const rl = checkRateLimit(`login:${ip}`, "login");
  if (!rl.allowed) {
    const retryAfter = Math.ceil(rl.retryAfterMs / 1000);
    return secureJson(
      { ok: false, error: "Too many login attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = body.username?.trim() || "";
  const password = body.password || "";

  if (!username || !password) {
    return secureJson({ ok: false, error: "Username and password are required." }, { status: 400 });
  }

  const userAgent = request.headers.get("user-agent") || undefined;
  const result = await login(username, password, ip, userAgent);

  if (!result) {
    return secureJson({ ok: false, error: "Invalid username or password." }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: getSessionCookieName(),
    value: result.token,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return secureJson({ ok: true, username: result.user.username, role: result.user.role });
}
