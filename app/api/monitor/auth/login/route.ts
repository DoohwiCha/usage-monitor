import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSessionToken, getSessionCookieName, isValidCredential } from "@/lib/usage-monitor/auth";

export const runtime = "nodejs";

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count++;
  return true;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { ok: false, error: "로그인 시도가 너무 많습니다. 1분 후 다시 시도하세요." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = body.username?.trim() || "";
  const password = body.password || "";

  if (!isValidCredential(username, password)) {
    return NextResponse.json({ ok: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const token = createSessionToken(username);
  const cookieStore = await cookies();
  cookieStore.set({
    name: getSessionCookieName(),
    value: token,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  return NextResponse.json({ ok: true, username });
}
