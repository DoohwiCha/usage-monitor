import { createHash, randomUUID } from "node:crypto";

import { getDb } from "@/lib/usage-monitor/db";
import type { ProviderType } from "@/lib/usage-monitor/types";

const ACCOUNT_SYNC_TTL_MS = 1000 * 60 * 10;

interface AccountSyncSessionRow {
  id: string;
  account_id: string;
  provider: string;
  issued_by_user_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface AccountSyncSession {
  id: string;
  accountId: string;
  provider: ProviderType;
  issuedByUserId: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface IssuedAccountSyncSession {
  token: string;
  session: AccountSyncSession;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function rowToSession(row: AccountSyncSessionRow): AccountSyncSession {
  return {
    id: row.id,
    accountId: row.account_id,
    provider: row.provider as ProviderType,
    issuedByUserId: row.issued_by_user_id,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    createdAt: row.created_at,
  };
}

export function createAccountSyncSession(accountId: string, provider: ProviderType, issuedByUserId: string): IssuedAccountSyncSession {
  const db = getDb();
  const now = new Date();
  const sessionId = randomUUID();
  const token = `${randomUUID()}-${randomUUID()}`;
  const expiresAt = new Date(now.getTime() + ACCOUNT_SYNC_TTL_MS).toISOString();

  db.prepare("DELETE FROM account_sync_sessions WHERE account_id = ?").run(accountId);

  db.prepare(`
    INSERT INTO account_sync_sessions (id, account_id, provider, issued_by_user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    accountId,
    provider,
    issuedByUserId,
    hashToken(token),
    expiresAt,
    now.toISOString(),
  );

  return {
    token,
    session: {
      id: sessionId,
      accountId,
      provider,
      issuedByUserId,
      expiresAt,
      usedAt: null,
      createdAt: now.toISOString(),
    },
  };
}

export function consumeAccountSyncSession(accountId: string, provider: ProviderType, token: string): AccountSyncSession | null {
  const db = getDb();
  const stamp = new Date().toISOString();
  const tokenHash = hashToken(token);

  const consume = db.transaction(() => {
    const row = db.prepare(`
      SELECT * FROM account_sync_sessions
      WHERE account_id = ? AND provider = ? AND token_hash = ? AND used_at IS NULL AND expires_at > ?
    `).get(accountId, provider, tokenHash, stamp) as AccountSyncSessionRow | undefined;
    if (!row) return null;

    db.prepare("UPDATE account_sync_sessions SET used_at = ? WHERE id = ?").run(stamp, row.id);
    return rowToSession({ ...row, used_at: stamp });
  });

  return consume();
}

export function revokeAccountSyncSessions(accountId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM account_sync_sessions WHERE account_id = ?").run(accountId);
}

export const clearAccountSyncSessionsForAccount = revokeAccountSyncSessions;
export const revokeAccountSyncSessionsForAccount = revokeAccountSyncSessions;

export function cleanExpiredAccountSyncSessions(): number {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM account_sync_sessions
    WHERE used_at IS NOT NULL OR expires_at <= ?
  `).run(new Date().toISOString());
  return result.changes;
}
