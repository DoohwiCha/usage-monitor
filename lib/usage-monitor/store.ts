import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MonitorAccount, MonitorConfig, ProviderType, PublicMonitorAccount } from "@/lib/usage-monitor/types";

const MAX_ACCOUNTS = 12;
const STORE_PATH = path.join(process.cwd(), "data", "usage-monitor.json");

function nowIso(): string {
  return new Date().toISOString();
}

function maskSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 8) return `${secret.slice(0, 2)}****`;
  return `${secret.slice(0, 4)}...${secret.slice(-2)}`;
}

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
  }
}

function normalizeConfig(config: MonitorConfig): MonitorConfig {
  const safeAccounts: MonitorAccount[] = config.accounts.slice(0, MAX_ACCOUNTS).map((acct) => ({
    id: acct.id,
    name: acct.name || "계정",
    provider: acct.provider,
    enabled: Boolean(acct.enabled),
    sessionCookie: acct.sessionCookie?.trim() || undefined,
    apiKey: acct.apiKey?.trim() || undefined,
    organizationId: acct.organizationId?.trim() || undefined,
    createdAt: acct.createdAt || nowIso(),
    updatedAt: acct.updatedAt || nowIso(),
  }));

  return {
    ...config,
    maxAccounts: MAX_ACCOUNTS,
    accounts: safeAccounts,
    createdAt: config.createdAt || nowIso(),
    updatedAt: config.updatedAt || nowIso(),
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
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export async function readMonitorConfig(): Promise<MonitorConfig> {
  await ensureStoreExists();
  const raw = await fs.readFile(STORE_PATH, "utf-8");
  const parsed = JSON.parse(raw) as MonitorConfig;
  const normalized = normalizeConfig(parsed);

  if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
    await writeMonitorConfig(normalized);
  }

  return normalized;
}

export async function writeMonitorConfig(config: MonitorConfig): Promise<void> {
  const normalized = normalizeConfig({
    ...config,
    updatedAt: nowIso(),
  });
  await fs.writeFile(STORE_PATH, JSON.stringify(normalized, null, 2), "utf-8");
}

export async function addMonitorAccount(input: Partial<MonitorAccount>): Promise<MonitorConfig> {
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
    createdAt: stamp,
    updatedAt: stamp,
  };

  config.accounts.push(account);
  await writeMonitorConfig(config);
  return readMonitorConfig();
}

export async function updateMonitorAccount(id: string, updates: Partial<MonitorAccount>): Promise<MonitorConfig> {
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
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  };

  config.accounts[idx] = merged;
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
