import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionCookieName, readSessionUsername } from "@/lib/usage-monitor/auth";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  const username = readSessionUsername(token);

  if (!username) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return NextResponse.json({ ok: true, username });
}
