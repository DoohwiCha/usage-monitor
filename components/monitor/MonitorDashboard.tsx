"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

import type {
  AccountUsageReport,
  HistoryRangePreset,
  UsageHistoryResponse,
  UsageOverviewResponse,
  WindowKey,
} from "@/lib/usage-monitor/types";
import { useTranslation } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/translations";
import LanguageSelector from "./LanguageSelector";
import ThemeToggle from "./ThemeToggle";
import UsageHistoryChart from "./UsageHistoryChart";

const HISTORY_RANGES: HistoryRangePreset[] = ["12h", "24h", "7d", "30d", "all"];

function historyRangeLabel(range: HistoryRangePreset): string {
  if (range === "12h") return "12h";
  if (range === "24h") return "24h";
  if (range === "7d") return "7d";
  if (range === "30d") return "30d";
  return "All";
}

function countDisplay(count: number, t: (key: TranslationKey) => string): string {
  const unit = t("countUnit");
  return unit ? `${count}${unit}` : `${count}`;
}

function statusDot(status: AccountUsageReport["status"]): string {
  if (status === "ok") return "#10b981";
  if (status === "disabled") return "#71717a";
  if (status === "pending") return "#3b82f6";
  if (status === "not_configured") return "#f59e0b";
  return "#ef4444";
}

function utilizationBarGradient(pct: number): string {
  if (pct >= 80) return "from-amber-500 to-rose-500";
  if (pct >= 50) return "from-emerald-500 to-amber-500";
  return "from-emerald-400 to-emerald-500";
}

function UtilizationBar({ pct, label, resetStr }: { pct: number; label: string; resetStr?: string | null }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="font-mono shrink-0 text-[var(--text-muted)] text-sm w-20 whitespace-nowrap truncate">{label}</span>
        <div className="flex-1 h-2 bg-[var(--surface-raised)] rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full bg-gradient-to-r ${utilizationBarGradient(pct)}`}
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(pct, 1)}%` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </div>
        <span className={`font-black tabular-nums shrink-0 text-sm w-10 text-right ${pct >= 80 ? "text-rose-400" : pct >= 50 ? "text-amber-400" : "text-[var(--text-body)]"}`}>
          {pct}%
        </span>
      </div>
      {resetStr && (
        <p className="text-xs text-[var(--text-dim)] mt-0.5 ml-[5.5rem]">
          reset in <span className="font-semibold text-[var(--text-muted)]">{resetStr}</span>
        </p>
      )}
    </div>
  );
}

const cardListVariants = { hidden: {}, visible: { transition: { staggerChildren: 0.04 } } };
const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] as const } },
};

export default function MonitorDashboard({ username, role }: { username: string; role: "admin" | "viewer" }) {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;

  const relativeNowMs = useRelativeNowMs();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UsageOverviewResponse | null>(null);
  const [history, setHistory] = useState<UsageHistoryResponse | null>(null);
  const [historyRange, setHistoryRange] = useState<HistoryRangePreset>("12h");
  const [historyEmphasis, setHistoryEmphasis] = useState<WindowKey>("five_hour");
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const loadDashboard = useCallback(async (background = false) => {
    if (!background) {
      setLoading(true);
    }
    setError(null);
    try {
      const [usageResponse, historyResponse] = await Promise.all([
        fetch("/api/monitor/usage?range=month", { cache: "no-store" }),
        fetch(`/api/monitor/history?range=${historyRange}`, { cache: "no-store" }),
      ]);
      if (usageResponse.status === 401 || historyResponse.status === 401) {
        router.replace("/monitor/login");
        router.refresh();
        return;
      }

      const usageJson = (await usageResponse.json()) as { ok: boolean; error?: string } & Partial<UsageOverviewResponse>;
      const historyJson = (await historyResponse.json()) as ({ ok?: boolean; error?: string } & Partial<UsageHistoryResponse>);

      if (!usageResponse.ok || !usageJson.ok) {
        setError(usageJson.error || tRef.current("dashboard.loadError"));
        return;
      }
      if (!historyResponse.ok || !historyJson.ok) {
        setError(historyJson.error || tRef.current("dashboard.loadError"));
        return;
      }

      setData(usageJson as UsageOverviewResponse);
      setHistory(historyJson as UsageHistoryResponse);
      setLastRefreshed(new Date());
    } catch (loadError) {
      console.error("Failed to load dashboard:", loadError);
      setError(tRef.current("dashboard.apiError"));
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, [historyRange, router]);

  useEffect(() => {
    void loadDashboard(false);
  }, [loadDashboard]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadDashboard(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadDashboard]);

  const { claudeAccounts, openaiAccounts } = useMemo(() => {
    if (!data) {
      return { claudeAccounts: [], openaiAccounts: [] };
    }
    const sorted = [...data.accounts].sort((left, right) => {
      if (left.status === "ok" && right.status !== "ok") return -1;
      if (left.status !== "ok" && right.status === "ok") return 1;
      return left.name.localeCompare(right.name);
    });
    return {
      claudeAccounts: sorted.filter((account) => account.provider === "claude"),
      openaiAccounts: sorted.filter((account) => account.provider === "openai"),
    };
  }, [data]);

  async function handleLogout() {
    try {
      await fetch("/api/monitor/auth/logout", { method: "POST" });
    } catch {
      // Continue to login page even if the logout API fails.
    }
    router.replace("/monitor/login");
    router.refresh();
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadDashboard(true);
    setRefreshing(false);
  }

  return (
    <main className="min-h-screen surface-page">
      <div className="max-w-6xl mx-auto px-4 py-5 space-y-4">
        <div className="glass-card rounded-2xl px-5 py-4 flex items-center justify-between gap-3">
          <h1 className="text-3xl font-black gradient-text-brand">{t("usageMonitor")}</h1>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-raised)]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {username}
            </span>
            <div className="flex items-center gap-1">
              {lastRefreshed && (
                <span className="text-xs text-[var(--text-dim)] tabular-nums">
                  {lastRefreshed.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              )}
              <button
                onClick={() => void handleRefresh()}
                className="p-2 rounded-xl hover:bg-[var(--surface-raised)] transition-all"
                title={t("dashboard.refresh")}
              >
                <motion.svg
                  animate={{ rotate: refreshing ? 360 : 0 }}
                  transition={{ duration: 0.6, ease: "linear", repeat: refreshing ? Infinity : 0 }}
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-[var(--text-secondary)]"
                >
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                  <path d="M8 16H3v5" />
                </motion.svg>
              </button>
            </div>
            <LanguageSelector />
            <ThemeToggle />
            {role === "admin" && (
              <Link
                href="/monitor/accounts"
                className="px-3 py-2 rounded-xl text-base font-semibold text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--surface-raised)] transition-all"
              >
                {t("accountManage")}
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="px-3 py-2 rounded-xl text-base font-semibold text-[var(--text-muted)] hover:text-[var(--text-heading)] hover:bg-[var(--surface-raised)] transition-all"
            >
              {t("logout")}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="glass-card rounded-xl p-4 flex items-center gap-2"
              style={{ borderColor: "var(--error-border)", background: "var(--error-bg)" }}
            >
              <p className="text-base font-semibold text-rose-400">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {loading && !data && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((index) => (
              <div key={index} className="glass-card rounded-xl p-4 space-y-2">
                <div className="h-4 w-3/4 rounded bg-[var(--surface-raised)] animate-pulse" />
                <div className="h-2 w-full rounded-full bg-[var(--surface-raised)] animate-pulse" />
                <div className="h-2 w-4/5 rounded-full bg-[var(--surface-raised)] animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {data && (
          <>
            <ProviderSummary claudeAccounts={claudeAccounts.filter((account) => account.status === "ok")} openaiAccounts={openaiAccounts.filter((account) => account.status === "ok")} />

            {claudeAccounts.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 px-1">
                  <div className="w-3 h-3 rounded-full bg-[var(--brand-claude)]" />
                  <h2 className="text-xl font-black" style={{ color: "var(--brand-claude)" }}>Claude</h2>
                  <span className="text-base text-[var(--text-muted)] font-semibold">{countDisplay(claudeAccounts.length, t)}</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: "color-mix(in srgb, var(--brand-claude) 20%, transparent)" }} />
                </div>
                <motion.div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2" variants={cardListVariants} initial="hidden" animate="visible">
                  {claudeAccounts.map((account) => <AccountCard key={account.accountId} account={account} nowMs={relativeNowMs} />)}
                </motion.div>
              </div>
            )}

            {openaiAccounts.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 px-1">
                  <div className="w-3 h-3 rounded-full bg-[var(--brand-openai)]" />
                  <h2 className="text-xl font-black" style={{ color: "var(--brand-openai)" }}>OpenAI</h2>
                  <span className="text-base text-[var(--text-muted)] font-semibold">{countDisplay(openaiAccounts.length, t)}</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: "color-mix(in srgb, var(--brand-openai) 20%, transparent)" }} />
                </div>
                <motion.div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2" variants={cardListVariants} initial="hidden" animate="visible">
                  {openaiAccounts.map((account) => <AccountCard key={account.accountId} account={account} nowMs={relativeNowMs} />)}
                </motion.div>
              </div>
            )}

            {claudeAccounts.length === 0 && openaiAccounts.length === 0 && (
              <div className="glass-card rounded-xl p-8 text-center">
                <p className="text-[var(--text-muted)] font-semibold text-lg">{t("noAccounts")}</p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap px-1">
                <h2 className="text-xl font-black text-[var(--text-heading)]">History</h2>
                <div className="flex items-center gap-1 rounded-full border border-[var(--border-card)] bg-[var(--surface-raised)] p-1">
                  {HISTORY_RANGES.map((range) => {
                    const active = historyRange === range;
                    return (
                      <button
                        key={range}
                        type="button"
                        onClick={() => setHistoryRange(range)}
                        className={`rounded-full px-3.5 py-1.5 text-base font-bold transition-all ${active ? "text-white" : "text-[var(--text-secondary)]"}`}
                        style={{ backgroundColor: active ? "var(--brand-openai)" : "transparent" }}
                      >
                        {historyRangeLabel(range)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <UsageHistoryChart
                history={history}
                emphasis={historyEmphasis}
                onEmphasisChange={setHistoryEmphasis}
                title="All Accounts History"
                emptyLabel="No history sampled yet."
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function useRelativeNowMs(intervalMs = 60_000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return nowMs;
}

function formatResetTime(resetsAt: string | null, nowMs: number): string | null {
  if (!resetsAt) return null;
  const reset = new Date(resetsAt);
  if (Number.isNaN(reset.getTime())) return null;
  const diffMs = reset.getTime() - nowMs;
  if (diffMs <= 0) return null;

  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffMinutes = Math.floor((diffMs % 3_600_000) / 60_000);
  if (diffHours >= 24) {
    const diffDays = Math.floor(diffHours / 24);
    const remainingHours = diffHours % 24;
    return remainingHours > 0 ? `${diffDays}d ${remainingHours}h` : `${diffDays}d`;
  }
  if (diffHours > 0) {
    return `${diffHours}h ${diffMinutes}m`;
  }
  return `${diffMinutes}m`;
}

function AccountCard({ account, nowMs }: { account: AccountUsageReport; nowMs: number }) {
  const { t } = useTranslation();
  const isClaude = account.provider === "claude";
  const brand = isClaude ? "var(--brand-claude)" : "var(--brand-openai)";

  function statusLabel(status: AccountUsageReport["status"]): string {
    if (status === "ok") return t("statusOk");
    if (status === "disabled") return t("statusDisabled");
    if (status === "pending") return t("statusPending");
    if (status === "not_configured") return t("statusNotConfigured");
    return t("statusError");
  }

  return (
    <motion.div variants={cardVariants} className="relative glass-card rounded-xl p-4 overflow-hidden" style={{ borderLeftWidth: 2, borderLeftColor: brand }}>
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="min-w-0 flex items-center gap-2">
          <p className="font-bold text-lg text-[var(--text-heading)] truncate">{account.name}</p>
          <span className="shrink-0 text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${brand} 12%, transparent)`, color: brand }}>
            {isClaude ? "Claude" : "OpenAI"}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusDot(account.status) }} />
          <span className="text-sm font-semibold text-[var(--text-muted)]">{statusLabel(account.status)}</span>
        </div>
      </div>

      <div className="space-y-1.5">
        {account.usageInfo && account.usageInfo.windows.length > 0 ? (
          <>
            {account.usageInfo.windows.map((window) => {
              const pct = Math.min(Math.round(window.utilization), 100);
              const resetStr = formatResetTime(window.resetsAt, nowMs);
              return <UtilizationBar key={`${window.key}:${window.label}`} pct={pct} label={window.label} resetStr={resetStr} />;
            })}
          </>
        ) : (
          <p className="text-sm text-[var(--text-dim)]">{t("noUsage")}</p>
        )}

        {account.provider === "openai" && account.usageInfo?.accountIdentity?.email && (
          <p className="text-xs text-[var(--text-dim)] truncate">{account.usageInfo.accountIdentity.email}</p>
        )}
      </div>

      {account.error && (
        <p className={`mt-1.5 text-sm font-semibold truncate ${account.status === "pending" ? "text-sky-400" : "text-rose-400"}`}>
          {account.error}
        </p>
      )}

      <Link
        href={`/monitor/accounts/${account.accountId}`}
        className="mt-2.5 inline-flex items-center gap-1 text-base font-semibold transition-colors"
        style={{ color: brand }}
      >
        {t("dashboard.detailLink")}
      </Link>
    </motion.div>
  );
}

function ProviderSummary({
  claudeAccounts,
  openaiAccounts,
}: {
  claudeAccounts: AccountUsageReport[];
  openaiAccounts: AccountUsageReport[];
}) {
  const { t } = useTranslation();

  function buildWindowMap(accounts: AccountUsageReport[]) {
    const map = new Map<string, number[]>();
    for (const account of accounts) {
      for (const window of account.usageInfo?.windows || []) {
        const pct = Math.min(Math.round(window.utilization), 100);
        const list = map.get(window.label) || [];
        list.push(pct);
        map.set(window.label, list);
      }
    }
    return map;
  }

  const claudeWindowMap = buildWindowMap(claudeAccounts);
  const openaiWindowMap = buildWindowMap(openaiAccounts);

  if (claudeAccounts.length === 0 && openaiAccounts.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {claudeAccounts.length > 0 && (
        <div className="glass-card rounded-xl p-4 overflow-hidden" style={{ borderColor: "color-mix(in srgb, var(--brand-claude) 20%, transparent)" }}>
          <div className="flex items-center gap-2 mb-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--brand-claude)]" />
            <p className="text-base font-black" style={{ color: "var(--brand-claude)" }}>{t("dashboard.claudeAvg")}</p>
            <span className="text-sm text-[var(--text-muted)]">{countDisplay(claudeAccounts.length, t)}</span>
          </div>
          {claudeWindowMap.size > 0 ? (
            <div className="space-y-1.5">
              {Array.from(claudeWindowMap.entries()).map(([label, values]) => {
                const avg = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
                return <UtilizationBar key={label} pct={avg} label={label} />;
              })}
            </div>
          ) : (
            <p className="text-sm text-[var(--text-dim)]">{t("noData")}</p>
          )}
        </div>
      )}

      {openaiAccounts.length > 0 && (
        <div className="glass-card rounded-xl p-4 overflow-hidden" style={{ borderColor: "color-mix(in srgb, var(--brand-openai) 20%, transparent)" }}>
          <div className="flex items-center gap-2 mb-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--brand-openai)]" />
            <p className="text-base font-black" style={{ color: "var(--brand-openai)" }}>OpenAI</p>
            <span className="text-sm text-[var(--text-muted)]">{countDisplay(openaiAccounts.length, t)}</span>
          </div>
          {openaiWindowMap.size > 0 ? (
            <div className="space-y-1.5">
              {Array.from(openaiWindowMap.entries()).map(([label, values]) => {
                const avg = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
                return <UtilizationBar key={label} pct={avg} label={label} />;
              })}
            </div>
          ) : (
            <p className="text-sm text-[var(--text-dim)]">{t("noData")}</p>
          )}
        </div>
      )}
    </div>
  );
}
