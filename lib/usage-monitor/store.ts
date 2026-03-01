import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { MonitorAccount, MonitorConfig, ProviderType, PublicMonitorAccount } from "@/lib/usage-monitor/types";

const MAX_ACCOUNTS = 12;
const STORE_PATH = path.join(process.cwd(), "data", "usage-monitor.json");

function nowIso(): string {
  return new Date().toISOString();
}

function maskSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length < 4) return "****";
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
  if (!key) return plain;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

function decryptSecret(blob: string): string {
  // Detect encrypted format: three colon-separated hex segments
  const parts = blob.split(":");
  if (parts.length !== 3 || !parts.every((p) => /^[0-9a-f]+$/i.test(p))) {
    return blob; // Not encrypted, return as-is (backward compat)
  }

  const key = getEncryptionKey();
  if (!key) return blob; // No key available, return raw

  try {
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const ciphertext = Buffer.from(parts[2], "hex");

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext).toString("utf-8") + decipher.final("utf-8");
  } catch {
    // Decryption failed (wrong key, corrupted data), return raw blob
    return blob;
  }
}

// --- Validation helpers ---

function validateAccountInput(input: Partial<MonitorAccount>): void {
  if (input.name !== undefined && input.name.length > 200) {
    throw new Error("계정 이름은 최대 200자까지 입력할 수 있습니다.");
  }
  if (input.sessionCookie !== undefined && input.sessionCookie.length > 20000) {
    throw new Error("세션 쿠키는 최대 20,000자(20KB)까지 입력할 수 있습니다.");
  }
  if (input.apiKey !== undefined && input.apiKey.length > 500) {
    throw new Error("API 키는 최대 500자까지 입력할 수 있습니다.");
  }
  if (input.organizationId !== undefined && input.organizationId.length > 500) {
    throw new Error("조직 ID는 최대 500자까지 입력할 수 있습니다.");
  }
}

// ---

function buildDefaultConfig(): MonitorConfig {
  const stamp = nowIso();
  return {
    maxAccounts: MAX_ACCOUNTS,
    accounts: [],
    createdAt: stamp,
    updatedAt: stamp,
  };
}

async function ensureStoreExists(): Promise<void> {
  const dir = path.dirname(STORE_PATH);
  await fs.mkdir(dir, { recursive: true });

  try {
    await fs.access(STORE_PATH);
  } catch {
    const defaultConfig = buildDefaultConfig();
    await fs.writeFile(STORE_PATH, JSON.stringify(defaultConfig, null, 2), "utf-8");
    await fs.chmod(STORE_PATH, 0o600);
  }
}

function normalizeConfig(config: MonitorConfig): MonitorConfig {
  const safeAccounts: MonitorAccount[] = config.accounts.slice(0, MAX_ACCOUNTS).map((acct) => ({
    id: acct.id,
    name: acct.name || "계정",
    provider: acct.provider,
    enabled: Boolean(acct.enabled),
    sessionCookie: acct.sessionCookie ? decryptSecret(acct.sessionCookie).trim() || undefined : undefined,
    apiKey: acct.apiKey ? decryptSecret(acct.apiKey).trim() || undefined : undefined,
    organizationId: acct.organizationId?.trim() || undefined,
    subscriptionInfo: acct.subscriptionInfo,
    createdAt: acct.createdAt,
    updatedAt: acct.updatedAt,
  }));

  return {
    ...config,
    maxAccounts: MAX_ACCOUNTS,
    accounts: safeAccounts,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

function encryptConfigSecrets(config: MonitorConfig): MonitorConfig {
  return {
    ...config,
    accounts: config.accounts.map((acct) => ({
      ...acct,
      sessionCookie: acct.sessionCookie ? encryptSecret(acct.sessionCookie) : undefined,
      apiKey: acct.apiKey ? encryptSecret(acct.apiKey) : undefined,
    })),
  };
}

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
  await ensureStoreExists();
  const raw = await fs.readFile(STORE_PATH, "utf-8");
  const parsed = JSON.parse(raw) as MonitorConfig;
  const normalized = normalizeConfig(parsed);
  return normalized;
}

export async function writeMonitorConfig(config: MonitorConfig): Promise<void> {
  const normalized = normalizeConfig({
    ...config,
    updatedAt: nowIso(),
  });
  const encrypted = encryptConfigSecrets(normalized);
  await fs.writeFile(STORE_PATH, JSON.stringify(encrypted, null, 2), "utf-8");
  await fs.chmod(STORE_PATH, 0o600);
}

export async function addMonitorAccount(input: Partial<MonitorAccount>): Promise<MonitorConfig> {
  validateAccountInput(input);

  const config = await readMonitorConfig();
  if (config.accounts.length >= MAX_ACCOUNTS) {
    throw new Error(`최대 ${MAX_ACCOUNTS}개 계정까지 추가할 수 있습니다.`);
  }

  const stamp = nowIso();
  const account: MonitorAccount = {
    id: randomUUID(),
    name: input.name?.trim() || `${config.accounts.length + 1}번 계정`,
    provider: (input.provider as ProviderType) || "claude",
    enabled: Boolean(input.enabled),
    sessionCookie: input.sessionCookie?.trim() || undefined,
    apiKey: input.apiKey?.trim() || undefined,
    organizationId: input.organizationId?.trim() || undefined,
    subscriptionInfo: input.subscriptionInfo,
    createdAt: stamp,
    updatedAt: stamp,
  };

  config.accounts.push(account);
  await writeMonitorConfig(config);
  return readMonitorConfig();
}

export async function updateMonitorAccount(id: string, updates: Partial<MonitorAccount>): Promise<MonitorConfig> {
  validateAccountInput(updates);

  const config = await readMonitorConfig();
  const idx = config.accounts.findIndex((acct) => acct.id === id);
  if (idx < 0) {
    throw new Error("계정을 찾을 수 없습니다.");
  }

  const current = config.accounts[idx];
  const merged: MonitorAccount = {
    id: current.id,
    name: updates.name !== undefined ? (updates.name.trim() || current.name) : current.name,
    provider: updates.provider !== undefined ? updates.provider : current.provider,
    enabled: updates.enabled !== undefined ? Boolean(updates.enabled) : current.enabled,
    sessionCookie: updates.sessionCookie !== undefined ? (updates.sessionCookie.trim() || undefined) : current.sessionCookie,
    apiKey: updates.apiKey !== undefined ? (updates.apiKey.trim() || undefined) : current.apiKey,
    organizationId: updates.organizationId !== undefined ? (updates.organizationId.trim() || undefined) : current.organizationId,
    subscriptionInfo: updates.subscriptionInfo !== undefined ? updates.subscriptionInfo : current.subscriptionInfo,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };

  config.accounts[idx] = merged;
  await writeMonitorConfig(config);
  return readMonitorConfig();
}

export async function reorderMonitorAccounts(orderedIds: string[]): Promise<MonitorConfig> {
  const config = await readMonitorConfig();
  const accountMap = new Map(config.accounts.map((a) => [a.id, a]));
  const reordered: MonitorAccount[] = [];

  for (const id of orderedIds) {
    const acct = accountMap.get(id);
    if (acct) {
      reordered.push(acct);
      accountMap.delete(id);
    }
  }
  // 누락된 계정은 뒤에 추가
  for (const acct of accountMap.values()) {
    reordered.push(acct);
  }

  config.accounts = reordered;
  await writeMonitorConfig(config);
  return readMonitorConfig();
}

export async function deleteMonitorAccount(id: string): Promise<MonitorConfig> {
  const config = await readMonitorConfig();
  const filtered = config.accounts.filter((acct) => acct.id !== id);
  if (filtered.length === config.accounts.length) {
    throw new Error("계정을 찾을 수 없습니다.");
  }

  config.accounts = filtered;
  await writeMonitorConfig(config);
  return readMonitorConfig();
}
