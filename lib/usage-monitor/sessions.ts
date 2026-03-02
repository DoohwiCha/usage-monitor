import { randomUUID, createHash } from "node:crypto";
import { getDb } from "@/lib/usage-monitor/db";

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  ip_address: string | null;
  user_agent: string | null;
}

export function createSession(userId: string, ip?: string, userAgent?: string): { token: string; session: Session } {
  const db = getDb();
  const id = randomUUID();
  const token = randomUUID() + "-" + randomUUID();
  const tokenHash = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, tokenHash, expiresAt.toISOString(), now.toISOString(), ip || null, userAgent || null);

  return {
    token,
    session: {
      id,
      userId,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
      ipAddress: ip || null,
      userAgent: userAgent || null,
    },
  };
}

export function validateSession(token: string): Session | null {
  const db = getDb();
  const tokenHash = hashToken(token);
  const nowIso = new Date().toISOString();
  const row = db.prepare("SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?").get(tokenHash, nowIso) as SessionRow | undefined;

  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  };
}

export function revokeSession(token: string): boolean {
  const db = getDb();
  const tokenHash = hashToken(token);
  const result = db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  return result.changes > 0;
}

export function revokeSessionById(sessionId: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  return result.changes > 0;
}

export function revokeAllUserSessions(userId: string): number {
  const db = getDb();
  const result = db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  return result.changes;
}

export function getUserSessions(userId: string): Session[] {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const rows = db.prepare("SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC").all(userId, nowIso) as SessionRow[];
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  }));
}

export function cleanExpiredSessions(): number {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const result = db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowIso);
  return result.changes;
}

export function getSessionCookieName(): string {
  return "usage_monitor_session";
}
