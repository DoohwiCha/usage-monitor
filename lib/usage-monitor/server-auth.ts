import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionCookieName, validateSessionToken } from "@/lib/usage-monitor/auth";
import type { AuthResult } from "@/lib/usage-monitor/auth";

export async function getSessionUser(): Promise<AuthResult | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  return validateSessionToken(token);
}

export async function requirePageAuth(): Promise<AuthResult> {
  const auth = await getSessionUser();
  if (!auth) {
    redirect("/monitor/login");
  }
  return auth;
}

export async function requireAdminPageAuth(): Promise<AuthResult> {
  const auth = await requirePageAuth();
  if (auth.user.role !== "admin") {
    redirect("/monitor");
  }
  return auth;
}
