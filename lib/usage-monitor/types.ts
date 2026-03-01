export type ProviderType = "claude" | "openai";

export interface MonitorAccount {
  id: string;
  name: string;
  provider: ProviderType;
  enabled: boolean;
  /** Claude: 브라우저 세션 쿠키 (key1=value1; key2=value2) */
  sessionCookie?: string;
  /** OpenAI: Admin API Key */
  apiKey?: string;
  /** OpenAI: Organization ID */
  organizationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorConfig {
  maxAccounts: number;
  accounts: MonitorAccount[];
  createdAt: string;
  updatedAt: string;
}

export interface PublicMonitorAccount {
  id: string;
  name: string;
  provider: ProviderType;
  enabled: boolean;
  hasSessionCookie: boolean;
  sessionCookieMasked: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  organizationId?: string;
  createdAt: string;
  updatedAt: string;
}

export type RangePreset = "day" | "week" | "month";

export interface ResolvedRange {
  preset: RangePreset;
  start: Date;
  end: Date;
  startUnix: number;
  endUnix: number;
  startIso: string;
  endIso: string;
}

export interface UsagePoint {
  date: string;
  costUsd: number;
  requests: number;
  tokens: number;
}

export type UsageStatus = "ok" | "disabled" | "not_configured" | "error";

export interface ClaudeUtilizationWindow {
  label: string;
  utilization: number; // 0–1
  resetsAt: string | null;
}

export interface ClaudeUsageInfo {
  windows: ClaudeUtilizationWindow[];
  billing?: {
    status: string;
    nextChargeDate: string | null;
    interval: string | null;
  };
  extraUsage?: {
    enabled: boolean;
    usedCredits: number;
    monthlyLimit: number | null;
  };
}

export interface AccountUsageReport {
  accountId: string;
  name: string;
  provider: ProviderType;
  status: UsageStatus;
  costUsd: number;
  requests: number;
  tokens: number;
  points: UsagePoint[];
  claudeUsage?: ClaudeUsageInfo;
  error?: string;
}

export interface UsageOverviewResponse {
  range: {
    preset: RangePreset;
    startIso: string;
    endIso: string;
  };
  summary: {
    accountCount: number;
    activeCount: number;
    okCount: number;
    errorCount: number;
    totalCostUsd: number;
    totalRequests: number;
    totalTokens: number;
    fetchedAt: string;
  };
  accounts: AccountUsageReport[];
}
