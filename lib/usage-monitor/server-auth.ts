import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionCookieName, readSessionUsername } from "@/lib/usage-monitor/auth";

export async function getSessionUser(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  return readSessionUsername(token);
}

export async function requirePageAuth(): Promise<string> {
  const user = await getSessionUser();
  if (!user) {
    redirect("/monitor/login");
  }
  return user;
}
