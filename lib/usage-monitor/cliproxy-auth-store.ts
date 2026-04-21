import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AccountSyncSource, ProviderType } from "@/lib/usage-monitor/types";

const DEFAULT_CLIPROXY_AUTH_DIR = path.join(os.homedir(), ".cli-proxy-api");

export interface CliProxyAuthSourceCandidate {
  provider: ProviderType;
  syncSource: AccountSyncSource;
  sourcePath: string;
  fileName: string;
  displayName: string;
  email: string;
  sourceAccountId?: string;
  sourceExpiresAt?: string;
  disabled: boolean;
  planType?: string | null;
}

interface CodexAuthFile {
  access_token: string;
  account_id?: string;
  email?: string;
  expired?: string;
  type?: string;
  disabled?: boolean;
  id_token?: string;
}

interface ClaudeAuthFile {
  access_token: string;
  refresh_token?: string;
  email?: string;
  expired?: string;
  type?: string;
  disabled?: boolean;
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const normalized = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveCliProxyAuthDir(): string {
  const configured = process.env.CLIPROXY_AUTH_DIR?.trim();
  if (!configured) return DEFAULT_CLIPROXY_AUTH_DIR;
  if (configured.startsWith("~")) {
    return path.join(os.homedir(), configured.slice(1));
  }
  return path.isAbsolute(configured) ? configured : path.resolve(configured);
}

function readAuthFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function readCliProxyCodexAuthFile(filePath: string): CodexAuthFile | null {
  const raw = readAuthFile(filePath);
  const parsed = raw ? safeJsonParse<CodexAuthFile>(raw) : null;
  if (!parsed?.access_token) return null;
  return parsed;
}

export function readCliProxyClaudeAuthFile(filePath: string): ClaudeAuthFile | null {
  const raw = readAuthFile(filePath);
  const parsed = raw ? safeJsonParse<ClaudeAuthFile>(raw) : null;
  if (!parsed?.access_token) return null;
  return parsed;
}

function buildCodexCandidate(filePath: string, fileName: string, parsed: CodexAuthFile): CliProxyAuthSourceCandidate | null {
  const payload = decodeJwtPayload(parsed.id_token || parsed.access_token || "");
  const planType = typeof payload?.["https://api.openai.com/auth"] === "object"
    ? String((payload["https://api.openai.com/auth"] as Record<string, unknown>).chatgpt_plan_type || "")
    : null;

  const email = String(parsed.email || payload?.["email"] || "").trim();
  if (!email) return null;

  return {
    provider: "openai",
    syncSource: "cliproxy_codex",
    sourcePath: filePath,
    fileName,
    displayName: email,
    email,
    sourceAccountId: parsed.account_id?.trim() || undefined,
    sourceExpiresAt: parsed.expired || undefined,
    disabled: Boolean(parsed.disabled),
    planType: planType || null,
  };
}

function buildClaudeCandidate(filePath: string, fileName: string, parsed: ClaudeAuthFile): CliProxyAuthSourceCandidate | null {
  const email = String(parsed.email || "").trim();
  if (!email) return null;

  return {
    provider: "claude",
    syncSource: "cliproxy_claude",
    sourcePath: filePath,
    fileName,
    displayName: email,
    email,
    sourceExpiresAt: parsed.expired || undefined,
    disabled: Boolean(parsed.disabled),
    planType: null,
  };
}

export function scanCliProxyAuthStore(): CliProxyAuthSourceCandidate[] {
  const authDir = resolveCliProxyAuthDir();
  if (!fs.existsSync(authDir)) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(authDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates: CliProxyAuthSourceCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

    const filePath = path.join(authDir, entry.name);
    if (entry.name.startsWith("codex-")) {
      const parsed = readCliProxyCodexAuthFile(filePath);
      const candidate = parsed ? buildCodexCandidate(filePath, entry.name, parsed) : null;
      if (candidate) candidates.push(candidate);
      continue;
    }
    if (entry.name.startsWith("claude-")) {
      const parsed = readCliProxyClaudeAuthFile(filePath);
      const candidate = parsed ? buildClaudeCandidate(filePath, entry.name, parsed) : null;
      if (candidate) candidates.push(candidate);
    }
  }

  return candidates.sort((left, right) => {
    if (left.provider !== right.provider) return left.provider.localeCompare(right.provider);
    return left.email.localeCompare(right.email);
  });
}

export function findCliProxyCandidateByPath(sourcePath: string): CliProxyAuthSourceCandidate | undefined {
  return scanCliProxyAuthStore().find((candidate) => candidate.sourcePath === sourcePath);
}
