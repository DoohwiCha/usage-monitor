import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "usage_monitor_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

function getAuthSecret(): string {
  return process.env.MONITOR_SESSION_SECRET || "change-this-monitor-session-secret";
}

function getAdminUser(): string {
  return process.env.MONITOR_ADMIN_USER || "admin";
}

function getAdminPass(): string {
  return process.env.MONITOR_ADMIN_PASS || "admin1234";
}

function sign(value: string): string {
  return createHmac("sha256", getAuthSecret()).update(value).digest("hex");
}

export function createSessionToken(username: string): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${username}|${exp}`;
  const signature = sign(payload);
  return Buffer.from(`${payload}|${signature}`).toString("base64url");
}

export function readSessionUsername(token: string | undefined | null): string | null {
  if (!token) return null;

  let raw = "";
  try {
    raw = Buffer.from(token, "base64url").toString("utf-8");
  } catch {
    return null;
  }

  const [username, expRaw, signature] = raw.split("|");
  if (!username || !expRaw || !signature) return null;

  const payload = `${username}|${expRaw}`;
  const expected = sign(payload);
  if (expected.length !== signature.length) return null;

  const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  if (!ok) return null;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;

  return username;
}

export function isValidCredential(username: string, password: string): boolean {
  return username === getAdminUser() && password === getAdminPass();
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE;
}

export function getDefaultLoginHint(): { username: string; password: string } {
  return {
    username: getAdminUser(),
    password: getAdminPass(),
  };
}
