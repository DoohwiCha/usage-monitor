import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { MonitorAccount, MonitorConfig, ProviderType, PublicMonitorAccount, SubscriptionInfo } from "@/lib/usage-monitor/types";
import { getDb } from "@/lib/usage-monitor/db";

const MAX_ACCOUNTS = 12;
export const ENCRYPTION_KEY_MISMATCH_ERROR =
  "Failed to decrypt stored secret. MONITOR_ENCRYPTION_KEY is missing or does not match the key used to encrypt existing account data.";
const ENCRYPTION_KEY_REQUIRED_ERROR = "MONITOR_ENCRYPTION_KEY must be set.";

function nowIso(): string {
  return new Date().toISOString();
}

function maskSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 12) return "****";
  return `****${secret.slice(-4)}`;
}

// --- Encryption helpers ---

function getEncryptionKey(): Buffer | null {
  const hex = process.env.MONITOR_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, "hex");
}

function encryptSecret(plain: string): string {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error(ENCRYPTION_KEY_REQUIRED_ERROR);
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function isEncryptionKeyMismatchError(error: unknown): boolean {
  return error instanceof Error && error.message === ENCRYPTION_KEY_MISMATCH_ERROR;
}

function decryptSecret(blob: string): string {
  const parts = blob.split(":");
  if (parts.length !== 3 || !parts.every((p) => /^[0-9a-f]+$/i.test(p))) {
    return blob;
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error(ENCRYPTION_KEY_MISMATCH_ERROR);
  }

  try {
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const ciphertext = Buffer.from(parts[2], "hex");

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext).toString("utf-8") + decipher.final("utf-8");
  } catch {
    throw new Error(ENCRYPTION_KEY_MISMATCH_ERROR);
  }
}

// --- Validation helpers ---

function validateAccountInput(input: Partial<MonitorAccount>): void {
  if (input.name !== undefined && input.name.length > 200) {
    throw new Error("Account name must be 200 characters or less.");
  }
  if (input.sessionCookie !== undefined && input.sessionCookie.length > 20000) {
    throw new Error("Session cookie must be 20,000 characters or less.");
  }
  if (input.apiKey !== undefined && input.apiKey.length > 500) {
    throw new Error("API key must be 500 characters or less.");
  }
  if (input.organizationId !== undefined && input.organizationId.length > 500) {
    throw new Error("Organization ID must be 500 characters or less.");
  }
}

// --- DB row <-> domain model ---

interface AccountRow {
  id: string;
  name: string;
  provider: string;
  enabled: number;
  session_cookie: string | null;
  api_key: string | null;
  organization_id: string | null;
  subscription_info: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function rowToAccount(row: AccountRow): MonitorAccount {
  const provider = row.provider as ProviderType;
  const sessionCookie = row.session_cookie ? decryptSecret(row.session_cookie).trim() || undefined : undefined;
  const apiKey = row.api_key ? decryptSecret(row.api_key).trim() || undefined : undefined;

  return {
    id: row.id,
    name: row.name,
    provider,
    enabled: row.enabled === 1,
    sessionCookie: provider === "claude" ? sessionCookie : undefined,
    apiKey: provider === "openai" ? apiKey : undefined,
    organizationId: row.organization_id?.trim() || undefined,
    subscriptionInfo: row.subscription_info ? JSON.parse(row.subscription_info) as SubscriptionInfo : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Public API (same signatures as before) ---

export function toPublicAccount(account: MonitorAccount): PublicMonitorAccount {
  return {
    id: account.id,
    name: account.name,
    provider: account.provider,
    enabled: account.enabled,
    hasSessionCookie: Boolean(account.sessionCookie),
    sessionCookieMasked: maskSecret(account.sessionCookie || ""),
    hasApiKey: Boolean(account.apiKey),
    apiKeyMasked: maskSecret(account.apiKey || ""),
    organizationId: account.organizationId,
    subscriptionInfo: account.subscriptionInfo,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export async function readMonitorConfig(): Promise<MonitorConfig> {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC").all() as AccountRow[];
  const accounts = rows.slice(0, MAX_ACCOUNTS).map(rowToAccount);

  return {
    maxAccounts: MAX_ACCOUNTS,
    accounts,
    createdAt: accounts[0]?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

export async function writeMonitorConfig(config: MonitorConfig): Promise<void> {
  void config;
  // No-op: individual mutations handle their own writes via SQLite transactions.
  // This function is kept for backward compatibility with any callers.
}

export async function addMonitorAccount(input: Partial<MonitorAccount>): Promise<MonitorConfig> {
  validateAccountInput(input);

  const db = getDb();
  const count = (db.prepare("SELECT COUNT(*) as cnt FROM accounts WHERE deleted_at IS NULL").get() as { cnt: number }).cnt;
  if (count >= MAX_ACCOUNTS) {
    throw new Error(`Maximum ${MAX_ACCOUNTS} accounts allowed.`);
  }

  const stamp = nowIso();
  const id = randomUUID();
  const maxOrder = (db.prepare("SELECT COALESCE(MAX(sort_order), -1) as mx FROM accounts").get() as { mx: number }).mx;

  const insertAccount = db.transaction(() => {
    db.prepare(`
      INSERT INTO accounts (id, name, provider, enabled, session_cookie, api_key, organization_id, subscription_info, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name?.trim() || `Account ${count + 1}`,
      (input.provider as ProviderType) || "claude",
      input.enabled ? 1 : 0,
      input.sessionCookie?.trim() ? encryptSecret(input.sessionCookie.trim()) : null,
      input.apiKey?.trim() ? encryptSecret(input.apiKey.trim()) : null,
      input.organizationId?.trim() || null,
      input.subscriptionInfo ? JSON.stringify(input.subscriptionInfo) : null,
      maxOrder + 1,
      stamp,
      stamp,
    );
  });
  insertAccount();

  db.prepare(
    "INSERT INTO audit_log (timestamp, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)"
  ).run(stamp, "account_created", "account", id, `${input.name?.trim() || `Account ${count + 1}`} (${input.provider || "claude"})`);

  return readMonitorConfig();
}

export async function updateMonitorAccount(id: string, updates: Partial<MonitorAccount>): Promise<MonitorConfig> {
  validateAccountInput(updates);

  const db = getDb();
  const existing = db.prepare("SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL").get(id) as AccountRow | undefined;
  if (!existing) {
    throw new Error("Account not found.");
  }

  const current = rowToAccount(existing);
  const stamp = nowIso();

  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    setClauses.push("name = ?");
    values.push(updates.name.trim() || current.name);
  }
  if (updates.provider !== undefined) {
    setClauses.push("provider = ?");
    values.push(updates.provider);
  }
  const targetProvider = updates.provider ?? current.provider;
  if (updates.provider === "openai" && updates.sessionCookie === undefined) {
    setClauses.push("session_cookie = ?");
    values.push(null);
  }
  if (updates.provider === "claude" && updates.apiKey === undefined) {
    setClauses.push("api_key = ?");
    values.push(null);
  }
  if (updates.enabled !== undefined) {
    setClauses.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }
  if (updates.sessionCookie !== undefined) {
    setClauses.push("session_cookie = ?");
    const trimmed = updates.sessionCookie.trim();
    values.push(targetProvider === "claude" && trimmed ? encryptSecret(trimmed) : null);
  }
  if (updates.apiKey !== undefined) {
    setClauses.push("api_key = ?");
    const trimmed = updates.apiKey.trim();
    values.push(targetProvider === "openai" && trimmed ? encryptSecret(trimmed) : null);
  }
  if (updates.organizationId !== undefined) {
    setClauses.push("organization_id = ?");
    values.push(updates.organizationId.trim() || null);
  }
  if (updates.subscriptionInfo !== undefined) {
    setClauses.push("subscription_info = ?");
    values.push(updates.subscriptionInfo ? JSON.stringify(updates.subscriptionInfo) : null);
  }

  if (setClauses.length > 0) {
    setClauses.push("updated_at = ?");
    values.push(stamp);
    values.push(id);
    db.prepare(`UPDATE accounts SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
  }

  return readMonitorConfig();
}

export async function reorderMonitorAccounts(orderedIds: string[]): Promise<MonitorConfig> {
  const db = getDb();
  const currentIds = (db.prepare("SELECT id FROM accounts WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC").all() as Array<{ id: string }>).map((r) => r.id);
  if (orderedIds.length !== currentIds.length) {
    throw new Error("orderedIds must include every account exactly once.");
  }
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new Error("orderedIds must not contain duplicates.");
  }
  const currentIdSet = new Set(currentIds);
  if (orderedIds.some((id) => !currentIdSet.has(id))) {
    throw new Error("orderedIds contains unknown account id.");
  }

  const reorder = db.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      db.prepare("UPDATE accounts SET sort_order = ?, updated_at = ? WHERE id = ?").run(i, nowIso(), orderedIds[i]);
    }
  });
  reorder();

  return readMonitorConfig();
}

export async function deleteMonitorAccount(id: string): Promise<MonitorConfig> {
  const db = getDb();
  const existing = db.prepare("SELECT id, name, provider FROM accounts WHERE id = ? AND deleted_at IS NULL").get(id) as { id: string; name: string; provider: string } | undefined;
  if (!existing) {
    throw new Error("Account not found.");
  }

  const stamp = nowIso();
  const softDelete = db.transaction(() => {
    db.prepare("UPDATE accounts SET deleted_at = ?, updated_at = ? WHERE id = ?").run(stamp, stamp, id);
    db.prepare(
      "INSERT INTO audit_log (timestamp, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)"
    ).run(stamp, "account_deleted", "account", id, `${existing.name} (${existing.provider})`);
  });
  softDelete();

  return readMonitorConfig();
}

export async function restoreMonitorAccount(id: string): Promise<MonitorConfig> {
  const db = getDb();
  const existing = db.prepare("SELECT id, name, provider FROM accounts WHERE id = ? AND deleted_at IS NOT NULL").get(id) as { id: string; name: string; provider: string } | undefined;
  if (!existing) {
    throw new Error("No deleted account found with this ID.");
  }

  const stamp = nowIso();
  const restore = db.transaction(() => {
    db.prepare("UPDATE accounts SET deleted_at = NULL, updated_at = ? WHERE id = ?").run(stamp, id);
    db.prepare(
      "INSERT INTO audit_log (timestamp, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?)"
    ).run(stamp, "account_restored", "account", id, `${existing.name} (${existing.provider})`);
  });
  restore();

  return readMonitorConfig();
}

export async function listDeletedAccounts(): Promise<PublicMonitorAccount[]> {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM accounts WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all() as AccountRow[];
  return rows.map((r) => toPublicAccount(rowToAccount(r)));
}
