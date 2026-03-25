export type ProviderType = "claude" | "openai";

export interface SubscriptionInfo {
  plan?: string;
  renewsAt?: string;
  billingPeriod?: string;
}

export interface MonitorAccount {
  id: string;
  name: string;
  provider: ProviderType;
  enabled: boolean;
  /** Claude: browser session cookie (key1=value1; key2=value2) */
  sessionCookie?: string;
  /** OpenAI: Admin API Key */
  apiKey?: string;
  /** OpenAI: Organization ID */
  organizationId?: string;
  /** Subscription/plan info (extracted during browser login) */
  subscriptionInfo?: SubscriptionInfo | null;
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
  subscriptionInfo?: SubscriptionInfo | null;
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

export type UsageStatus = "ok" | "disabled" | "not_configured" | "pending" | "error";

export interface UtilizationWindow {
  label: string;       // "5h", "7d", "wk" etc.
  utilization: number; // 0–100
  resetsAt: string | null;
}

export interface CodexMetrics {
  totalTurns: number;
  sessionTurns: number;
  sessionInputTokens: number;
  sessionOutputTokens: number;
  sessionTotalTokens: number;
  lastActivity: string | null;
}

export interface ProviderUsageInfo {
  windows: UtilizationWindow[];
  sourceScope?: "account" | "shared_local";
  accountIdentity?: {
    email: string | null;
    accountId: string | null;
    planType: string | null;
  };
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
  codexMetrics?: CodexMetrics;
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
  usageInfo?: ProviderUsageInfo;
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
