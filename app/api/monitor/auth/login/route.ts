import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { login, getSessionCookieName } from "@/lib/usage-monitor/auth";
import { verifyCsrfOrigin } from "@/lib/usage-monitor/api-auth";
import { checkRateLimit } from "@/lib/usage-monitor/rate-limiter";
import { secureJson } from "@/lib/usage-monitor/response";
import { resolveCookieSecure } from "@/lib/usage-monitor/cookies";
import { INITIAL_ADMIN_ENV_ERROR } from "@/lib/usage-monitor/users";
import { logger } from "@/lib/usage-monitor/logger";

export const runtime = "nodejs";
let trustProxyWarningLogged = false;

function normalizeIp(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  return isIP(candidate) ? candidate : null;
}

function resolveClientIp(request: Request): string | null {
  const trustProxy = process.env.TRUST_PROXY === "true";
  if (!trustProxy) {
    return null;
  }

  const cfIp = normalizeIp(request.headers.get("cf-connecting-ip"));
  if (cfIp && request.headers.get("cf-ray")) {
    return cfIp;
  }

  const trustedProxySecret = process.env.TRUST_PROXY_SHARED_SECRET?.trim() || "";
  if (!trustedProxySecret) {
    if (!trustProxyWarningLogged) {
      logger.warn("[auth-login] TRUST_PROXY is enabled but TRUST_PROXY_SHARED_SECRET is not set; forwarded headers are ignored.");
      trustProxyWarningLogged = true;
    }
    return null;
  }

  const providedSecret = request.headers.get("x-monitor-proxy-secret")?.trim();
  if (!providedSecret || providedSecret !== trustedProxySecret) {
    return null;
  }

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    for (const part of forwarded.split(",")) {
      const ip = normalizeIp(part);
      if (ip) return ip;
    }
  }

  const realIp = normalizeIp(request.headers.get("x-real-ip"));
  if (realIp) return realIp;

  return null;
}

function buildLoginRateLimitKey(request: Request, username: string): string {
  const normalizedUser = username.trim().toLowerCase();
  const ip = resolveClientIp(request);
  if (ip) return `login:${normalizedUser}:${ip}`;

  const ua = request.headers.get("user-agent") || "unknown";
  const uaHash = createHash("sha256").update(ua).digest("hex").slice(0, 16);
  return `login:${normalizedUser}:ua:${uaHash}`;
}

export async function POST(request: Request) {
  if (!verifyCsrfOrigin(request)) {
    return secureJson({ ok: false, error: "Invalid request." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = body.username?.trim() || "";
  const password = body.password || "";

  if (!username || !password) {
    return secureJson({ ok: false, error: "Username and password are required." }, { status: 400 });
  }

  const rl = checkRateLimit(buildLoginRateLimitKey(request, username), "login");
  if (!rl.allowed) {
    const retryAfter = Math.ceil(rl.retryAfterMs / 1000);
    return secureJson(
      { ok: false, error: "Too many login attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const ip = resolveClientIp(request) || undefined;
  const userAgent = request.headers.get("user-agent") || undefined;
  let result: Awaited<ReturnType<typeof login>>;
  try {
    result = await login(username, password, ip, userAgent);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process login.";
    if (message === INITIAL_ADMIN_ENV_ERROR) {
      return secureJson(
        {
          ok: false,
          error: "Initial admin is not configured. Set MONITOR_ADMIN_USER and MONITOR_ADMIN_PASS, then restart the server.",
        },
        { status: 500 },
      );
    }
    logger.error("[auth-login] login failed due to internal error", { error: String(error) });
    return secureJson({ ok: false, error: "Failed to process login." }, { status: 500 });
  }

  if (!result) {
    return secureJson({ ok: false, error: "Invalid username or password." }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: getSessionCookieName(),
    value: result.token,
    httpOnly: true,
    sameSite: "strict",
    secure: resolveCookieSecure(request),
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return secureJson({ ok: true, username: result.user.username, role: result.user.role });
}
