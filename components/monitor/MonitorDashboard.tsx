"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { AccountUsageReport, UsageOverviewResponse } from "@/lib/usage-monitor/types";
import ThemeToggle from "./ThemeToggle";
import { useTranslation } from "@/lib/i18n/context";
import { type TranslationKey } from "@/lib/i18n/translations";
import LanguageSelector from "./LanguageSelector";

function countDisplay(count: number, t: (key: TranslationKey) => string): string {
  const unit = t("countUnit");
  return unit ? `${count}${unit}` : `${count}`;
}

function statusDot(status: AccountUsageReport["status"]): string {
  if (status === "ok") return "#10b981";
  if (status === "disabled") return "#71717a";
  if (status === "not_configured") return "#f59e0b";
  return "#ef4444";
}

function utilizationBarGradient(pct: number): string {
  if (pct >= 80) return "from-amber-500 to-rose-500";
  if (pct >= 50) return "from-emerald-500 to-amber-500";
  return "from-emerald-400 to-emerald-500";
}

function UtilizationBar({ pct, label }: { pct: number; label: string }) {
  return (
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UsageOverviewResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const loadUsage = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/monitor/usage?range=month", { cache: "no-store" });
      const json = (await response.json()) as { ok: boolean; error?: string } & Partial<UsageOverviewResponse>;
      if (!response.ok || !json.ok) {
        setError(json.error || tRef.current("dashboard.loadError"));
        if (!background) setLoading(false);
        return;
      }
      setData(json as UsageOverviewResponse);
      setLastRefreshed(new Date());
    } catch (err) {
      console.error("Failed to load usage:", err);
      setError(tRef.current("dashboard.apiError"));
    } finally {
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadUsage(false); }, [loadUsage]);
  useEffect(() => {
    const timer = window.setInterval(() => { void loadUsage(true); }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadUsage]);

  const { claudeAccounts, openaiAccounts } = useMemo(() => {
    if (!data) return { claudeAccounts: [], openaiAccounts: [] };
    const sorted = [...data.accounts].sort((a, b) => {
      if (a.status === "ok" && b.status !== "ok") return -1;
      if (a.status !== "ok" && b.status === "ok") return 1;
      return b.costUsd - a.costUsd;
    });
    return {
      claudeAccounts: sorted.filter((a) => a.provider === "claude"),
      openaiAccounts: sorted.filter((a) => a.provider === "openai"),
    };
  }, [data]);

  async function handleLogout() {
    try {
      await fetch("/api/monitor/auth/logout", { method: "POST" });
    } catch {
      // Proceed to login page even if logout API fails
    }
    router.replace("/monitor/login");
    router.refresh();
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadUsage(true);
    setRefreshing(false);
  }

  return (
    <main className="min-h-screen surface-page">
      <div className="max-w-6xl mx-auto px-4 py-5 space-y-4">

        {/* Header */}
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
                  width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
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
              <Link href="/monitor/accounts" className="px-3 py-2 rounded-xl text-base font-semibold text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--surface-raised)] transition-all">
                {t("accountManage")}
              </Link>
            )}
            <button onClick={handleLogout} className="px-3 py-2 rounded-xl text-base font-semibold text-[var(--text-muted)] hover:text-[var(--text-heading)] hover:bg-[var(--surface-raised)] transition-all">
              {t("logout")}
            </button>
          </div>
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="glass-card rounded-xl p-4 flex items-center gap-2" style={{ borderColor: "var(--error-border)", background: "var(--error-bg)" }}>
              <p className="text-base font-semibold text-rose-400">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading skeleton — only on initial load */}
        {loading && !data && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="glass-card rounded-xl p-4 space-y-2">
                <div className="h-4 w-3/4 rounded bg-[var(--surface-raised)] animate-pulse" />
                <div className="h-2 w-full rounded-full bg-[var(--surface-raised)] animate-pulse" />
                <div className="h-2 w-4/5 rounded-full bg-[var(--surface-raised)] animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {/* Main content — keep visible during background refresh */}
        {data && (
          <>
            {/* Provider summary - compact */}
            <ProviderSummary
              claudeAccounts={claudeAccounts.filter(a => a.status === "ok")}
              openaiAccounts={openaiAccounts.filter(a => a.status === "ok")}
            />

            {/* Claude accounts group */}
            {claudeAccounts.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 px-1">
                  <div className="w-3 h-3 rounded-full bg-[var(--brand-claude)]" />
                  <h2 className="text-xl font-black" style={{ color: "var(--brand-claude)" }}>Claude</h2>
                  <span className="text-base text-[var(--text-muted)] font-semibold">{countDisplay(claudeAccounts.length, t)}</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: "color-mix(in srgb, var(--brand-claude) 20%, transparent)" }} />
                </div>
                <motion.div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2" variants={cardListVariants} initial="hidden" animate="visible">
                  {claudeAccounts.map((a) => <AccountCard key={a.accountId} account={a} />)}
                </motion.div>
              </div>
            )}

            {/* OpenAI accounts group */}
            {openaiAccounts.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 px-1">
                  <div className="w-3 h-3 rounded-full bg-[var(--brand-openai)]" />
                  <h2 className="text-xl font-black" style={{ color: "var(--brand-openai)" }}>OpenAI</h2>
                  <span className="text-base text-[var(--text-muted)] font-semibold">{countDisplay(openaiAccounts.length, t)}</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: "color-mix(in srgb, var(--brand-openai) 20%, transparent)" }} />
                </div>
                <motion.div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2" variants={cardListVariants} initial="hidden" animate="visible">
                  {openaiAccounts.map((a) => <AccountCard key={a.accountId} account={a} />)}
                </motion.div>
              </div>
            )}

            {claudeAccounts.length === 0 && openaiAccounts.length === 0 && (
              <div className="glass-card rounded-xl p-8 text-center">
                <p className="text-[var(--text-muted)] font-semibold text-lg">{t("noAccounts")}</p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function AccountCard({ account }: { account: AccountUsageReport }) {
  const { t } = useTranslation();
  const isClaude = account.provider === "claude";
  const brand = isClaude ? "var(--brand-claude)" : "var(--brand-openai)";

  function statusLabel(status: AccountUsageReport["status"]): string {
    if (status === "ok") return t("statusOk");
    if (status === "disabled") return t("statusDisabled");
    if (status === "not_configured") return t("statusNotConfigured");
    return t("statusError");
  }

  return (
    <motion.div variants={cardVariants}
      className="relative glass-card rounded-xl p-4 overflow-hidden"
      style={{ borderLeftWidth: 2, borderLeftColor: brand }}
    >
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
          account.usageInfo.windows.map((win) => {
            const pct = Math.min(Math.round(win.utilization), 100);
            return <UtilizationBar key={win.label} pct={pct} label={win.label} />;
          })
        ) : account.provider === "openai" && (account.costUsd > 0 || account.requests > 0 || account.tokens > 0) ? (
          <div className="flex gap-3 text-sm">
            <span className="text-[var(--text-muted)]">{t("cost")} <strong className="text-[var(--text-body)]">${account.costUsd.toFixed(2)}</strong></span>
            <span className="text-[var(--text-muted)]">{t("requests")} <strong className="text-[var(--text-body)]">{account.requests.toLocaleString()}</strong></span>
            <span className="text-[var(--text-muted)]">{t("tokens")} <strong className="text-[var(--text-body)]">{account.tokens.toLocaleString()}</strong></span>
          </div>
        ) : (
          <p className="text-sm text-[var(--text-dim)]">{t("noUsage")}</p>
        )}
      </div>

      {account.error && <p className="mt-1.5 text-sm font-semibold text-rose-400 truncate">{account.error}</p>}

      <Link href={`/monitor/accounts/${account.accountId}`}
        className="mt-2.5 inline-flex items-center gap-1 text-base font-semibold transition-colors"
        style={{ color: brand }}>
        {t("dashboard.detailLink")}
      </Link>
    </motion.div>
  );
}

function ProviderSummary({ claudeAccounts, openaiAccounts }: { claudeAccounts: AccountUsageReport[]; openaiAccounts: AccountUsageReport[] }) {
  const { t } = useTranslation();

  function buildWindowMap(accs: AccountUsageReport[]) {
    const map = new Map<string, number[]>();
    for (const acc of accs) {
      for (const win of acc.usageInfo?.windows || []) {
        const pct = Math.min(Math.round(win.utilization), 100);
        const list = map.get(win.label) || [];
        list.push(pct);
        map.set(win.label, list);
      }
    }
    return map;
  }

  const claudeWindowMap = buildWindowMap(claudeAccounts);
  const openaiWindowMap = buildWindowMap(openaiAccounts);
  const openaiTotalCost = openaiAccounts.reduce((s, a) => s + a.costUsd, 0);
  const openaiTotalRequests = openaiAccounts.reduce((s, a) => s + a.requests, 0);
  const openaiTotalTokens = openaiAccounts.reduce((s, a) => s + a.tokens, 0);

  if (claudeAccounts.length === 0 && openaiAccounts.length === 0) return null;

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
              {Array.from(claudeWindowMap.entries()).map(([label, pcts]) => {
                const avg = Math.round(pcts.reduce((s, v) => s + v, 0) / pcts.length);
                return <UtilizationBar key={label} pct={avg} label={label} />;
              })}
            </div>
          ) : <p className="text-sm text-[var(--text-dim)]">{t("noData")}</p>}
        </div>
      )}
      {openaiAccounts.length > 0 && (
        <div className="glass-card rounded-xl p-4 overflow-hidden" style={{ borderColor: "color-mix(in srgb, var(--brand-openai) 20%, transparent)" }}>
          <div className="flex items-center gap-2 mb-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--brand-openai)]" />
            <p className="text-base font-black" style={{ color: "var(--brand-openai)" }}>{t("dashboard.openaiTotal")}</p>
            <span className="text-sm text-[var(--text-muted)]">{countDisplay(openaiAccounts.length, t)}</span>
          </div>
          {openaiWindowMap.size > 0 ? (
            <div className="space-y-1.5">
              {Array.from(openaiWindowMap.entries()).map(([label, pcts]) => {
                const avg = Math.round(pcts.reduce((s, v) => s + v, 0) / pcts.length);
                return <UtilizationBar key={label} pct={avg} label={label} />;
              })}
            </div>
          ) : (openaiTotalCost > 0 || openaiTotalRequests > 0 || openaiTotalTokens > 0) ? (
            <div className="flex gap-4 text-sm">
              <span className="text-[var(--text-muted)]">{t("cost")} <strong className="text-[var(--text-body)]">${openaiTotalCost.toFixed(2)}</strong></span>
              <span className="text-[var(--text-muted)]">{t("requests")} <strong className="text-[var(--text-body)]">{openaiTotalRequests.toLocaleString()}</strong></span>
              <span className="text-[var(--text-muted)]">{t("tokens")} <strong className="text-[var(--text-body)]">{openaiTotalTokens.toLocaleString()}</strong></span>
            </div>
          ) : <p className="text-sm text-[var(--text-dim)]">{t("noData")}</p>}
        </div>
      )}
    </div>
  );
}
