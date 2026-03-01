import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "usage_monitor_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

function getAuthSecret(): string {
  const secret = process.env.MONITOR_SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!secret || secret === "change-this-monitor-session-secret") {
      throw new Error("MONITOR_SESSION_SECRET must be set to a secure value in production.");
    }
    return secret;
  }
  return secret || "change-this-monitor-session-secret";
}

function getAdminUser(): string {
  return process.env.MONITOR_ADMIN_USER || "admin";
}

function getAdminPass(): string {
  const pass = process.env.MONITOR_ADMIN_PASS;
  if (process.env.NODE_ENV === "production") {
    if (!pass || pass === "admin1234") {
      throw new Error("MONITOR_ADMIN_PASS must be set to a secure value in production.");
    }
    return pass;
  }
  return pass || "admin1234";
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
  const expectedUser = getAdminUser();
  const expectedPass = getAdminPass();
  const maxUserLen = Math.max(username.length, expectedUser.length);
  const maxPassLen = Math.max(password.length, expectedPass.length);
  const userMatch = timingSafeEqual(
    Buffer.from(username.padEnd(maxUserLen, "\0")),
    Buffer.from(expectedUser.padEnd(maxUserLen, "\0")),
  );
  const passMatch = timingSafeEqual(
    Buffer.from(password.padEnd(maxPassLen, "\0")),
    Buffer.from(expectedPass.padEnd(maxPassLen, "\0")),
  );
  return userMatch && passMatch;
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE;
}
