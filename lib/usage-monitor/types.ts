export type ProviderType = "claude" | "openai";
export type AccountAuthMode = "manual_cookie" | "local_sync" | "auth_store";
export type AccountSyncSource =
  | "manual_cookie"
  | "claude_cookie"
  | "cliproxy_codex"
  | "cliproxy_claude";

export type WindowKey =
  | "five_hour"
  | "seven_day"
  | "seven_day_opus"
  | "seven_day_sonnet"
  | "seven_day_cowork"
  | "seven_day_oauth"
  | "other";
export type UsageSampleKind = "observed" | "carried_forward";
export type HistoryRangePreset = "12h" | "24h" | "7d" | "30d" | "all";

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
  organizationId?: string;
  authMode?: AccountAuthMode;
  authIdentity?: string;
  lastSyncedAt?: string;
  syncSource?: AccountSyncSource;
  sourcePath?: string;
  sourceAccountId?: string;
  sourceExpiresAt?: string;
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
  organizationId?: string;
  authMode?: AccountAuthMode;
  authIdentity?: string;
  lastSyncedAt?: string;
  syncSource?: AccountSyncSource;
  sourcePath?: string;
  sourceAccountId?: string;
  sourceExpiresAt?: string;
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
  key: WindowKey;
  label: string;
  utilization: number; // raw percent, 0–100
  resetsAt: string | null;
}

export interface ProviderUsageInfo {
  windows: UtilizationWindow[];
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

export interface UsageHistoryPoint {
  bucketStart: string;
  utilization: number;
  resetsAt: string | null;
  sampleKind: UsageSampleKind;
}

export interface AccountHistorySeries {
  accountId: string;
  accountName: string;
  provider: ProviderType;
  windowKey: WindowKey;
  points: UsageHistoryPoint[];
}

export interface ResetMarker {
  accountId: string;
  accountName: string;
  provider: ProviderType;
  at: string;
}

export interface UsageHistoryResponse {
  range: {
    preset: HistoryRangePreset;
    startIso: string;
    endIso: string;
  };
  series: AccountHistorySeries[];
  // X-axis reset annotations are intentionally the 5-hour window resets only.
  resetMarkers: ResetMarker[];
}
