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
      response: NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 }),
    };
  }

  return { ok: true, user: username };
}
