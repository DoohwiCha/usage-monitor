import { cookies } from "next/headers";
import { logout, getSessionCookieName } from "@/lib/usage-monitor/auth";
import { secureJson } from "@/lib/usage-monitor/response";

export const runtime = "nodejs";

export async function POST() {
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
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return secureJson({ ok: true });
}
