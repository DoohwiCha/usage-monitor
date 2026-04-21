"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

import type {
  AccountUsageReport,
  HistoryRangePreset,
  ProviderType,
  PublicMonitorAccount,
  UsageHistoryResponse,
  UtilizationWindow,
  WindowKey,
} from "@/lib/usage-monitor/types";
import { useTranslation } from "@/lib/i18n/context";
import LanguageSelector from "./LanguageSelector";
import ThemeToggle from "./ThemeToggle";
import UsageHistoryChart from "./UsageHistoryChart";
import { ToggleSwitch, Spinner, brandLightVar, brandVar } from "./shared";

const HISTORY_RANGES: HistoryRangePreset[] = ["12h", "24h", "7d", "30d", "all"];

function historyRangeLabel(range: HistoryRangePreset): string {
  if (range === "12h") return "12h";
  if (range === "24h") return "24h";
  if (range === "7d") return "7d";
  if (range === "30d") return "30d";
  return "All";
}

export default function AccountDetail({ id }: { id: string }) {
  const router = useRouter();
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<PublicMonitorAccount | null>(null);
  const [report, setReport] = useState<AccountUsageReport | null>(null);
  const [history, setHistory] = useState<UsageHistoryResponse | null>(null);
  const [historyRange, setHistoryRange] = useState<HistoryRangePreset>("12h");
  const [historyEmphasis, setHistoryEmphasis] = useState<WindowKey>("five_hour");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncToken, setSyncToken] = useState<string | null>(null);
  const [syncExpiresAt, setSyncExpiresAt] = useState<string | null>(null);
  const [syncStartedAt, setSyncStartedAt] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", enabled: false, sessionCookie: "" });
  const [formDirty, setFormDirty] = useState(false);
  const formDirtyRef = useRef(false);
  formDirtyRef.current = formDirty;

  const load = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const [accountResult, usageResult, historyResult] = await Promise.allSettled([
        fetch(`/api/monitor/accounts/${id}`, { cache: "no-store" }),
        fetch(`/api/monitor/usage?accountId=${id}&range=month`, { cache: "no-store" }),
        fetch(`/api/monitor/history?accountId=${id}&range=${historyRange}`, { cache: "no-store" }),
      ]);

      if (accountResult.status === "rejected") {
        setError("detail.loadAccountError");
        return;
      }

      const accountResponse = accountResult.value;
      if (accountResponse.status === 401) {
        router.replace("/monitor/login");
        router.refresh();
        return;
      }

      const accountJson = (await accountResponse.json()) as { ok: boolean; account?: PublicMonitorAccount; error?: string };
      if (!accountResponse.ok || !accountJson.ok || !accountJson.account) {
        setError(accountJson.error || "detail.loadAccountError");
        return;
      }

      setAccount(accountJson.account);
      if (!formDirtyRef.current) {
        setForm({
          name: accountJson.account.name,
          enabled: accountJson.account.enabled,
          sessionCookie: "",
        });
      }

      if (usageResult.status === "fulfilled") {
        const usageResponse = usageResult.value;
        if (usageResponse.status === 401) {
          router.replace("/monitor/login");
          router.refresh();
          return;
        }
        const usageJson = (await usageResponse.json()) as {
          ok: boolean;
          accounts?: AccountUsageReport[];
          error?: string;
        };
        if (usageResponse.ok && usageJson.ok) {
          setReport(usageJson.accounts?.[0] || null);
        } else {
          setReport(null);
          setError(usageJson.error || "detail.loadUsageError");
        }
      } else {
        setReport(null);
        setError("detail.loadUsageError");
      }

      if (historyResult.status === "fulfilled") {
        const historyResponse = historyResult.value;
        if (historyResponse.status === 401) {
          router.replace("/monitor/login");
          router.refresh();
          return;
        }
        const historyJson = (await historyResponse.json()) as ({ ok?: boolean; error?: string } & UsageHistoryResponse);
        if (historyResponse.ok && historyJson.ok) {
          setHistory(historyJson as UsageHistoryResponse);
        } else {
          setError((prev) => prev || historyJson.error || "Failed to load usage history.");
        }
      } else {
        setError((prev) => prev || "Failed to load usage history.");
      }
    } catch {
      setError("detail.apiCallError");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [historyRange, id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load({ silent: true });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!syncExpiresAt) return;
    const expiryTs = Date.parse(syncExpiresAt);
    if (!Number.isFinite(expiryTs)) return;

    const timer = window.setInterval(() => {
      if (Date.now() >= expiryTs) {
        setSyncToken(null);
        setSyncExpiresAt(null);
        setSyncStartedAt(null);
        window.clearInterval(timer);
        return;
      }
      void load({ silent: true });
    }, 5_000);

    return () => window.clearInterval(timer);
  }, [syncExpiresAt, load]);

  useEffect(() => {
    if (!account?.lastSyncedAt || !syncStartedAt) return;
    if (Date.parse(account.lastSyncedAt) >= Date.parse(syncStartedAt)) {
      setSyncToken(null);
      setSyncExpiresAt(null);
      setSyncStartedAt(null);
      setSaveMessage(t("detail.localSyncCompleted"));
    }
  }, [account?.lastSyncedAt, syncStartedAt, t]);

  const provider = account?.provider || "claude";
  const isClaude = provider === "claude";
  const brand = brandVar(provider);
  const title = useMemo(() => account?.name || "Account", [account]);
  const helperCommand = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://usage-monitor.hjyeo.com";
    return `npx tsx scripts/local-sync.ts claude --server ${origin} --account-id ${id}`;
  }, [id]);

  const errorMsg = error ? (t(error as Parameters<typeof t>[0]) || error) : null;

  async function saveAccount() {
    setSaving(true);
    setSaveMessage(null);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        enabled: form.enabled,
      };
      if (form.sessionCookie.trim()) {
        payload.sessionCookie = form.sessionCookie.trim();
      }

      const response = await fetch(`/api/monitor/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !json.ok) {
        setError(json.error || "detail.saveError");
        return;
      }
      setFormDirty(false);
      formDirtyRef.current = false;
      setSaveMessage(t("detail.saved"));
      setForm((prev) => ({ ...prev, sessionCookie: "" }));
      await load();
    } catch {
      setError("detail.saveApiError");
    } finally {
      setSaving(false);
    }
  }

  async function handleStartLocalSync() {
    setSyncing(true);
    setError(null);
    setSaveMessage(null);
    try {
      const response = await fetch(`/api/monitor/accounts/${id}/sync-session`, { method: "POST" });
      const json = (await response.json()) as {
        ok: boolean;
        error?: string;
        syncToken?: string;
        expiresAt?: string;
        sync?: { token: string; expiresAt: string; provider: ProviderType };
        syncSession?: { token: string; expiresAt: string; provider: ProviderType };
      };
      const issuedToken = json.syncSession?.token || json.sync?.token || json.syncToken;
      const issuedExpiry = json.syncSession?.expiresAt || json.sync?.expiresAt || json.expiresAt;
      if (!response.ok || !json.ok || !issuedToken || !issuedExpiry) {
        setError(json.error || "detail.localSyncError");
        return;
      }
      setSyncToken(issuedToken);
      setSyncExpiresAt(issuedExpiry);
      setSyncStartedAt(new Date().toISOString());
      setSaveMessage(t("detail.localSyncStarted"));
      void load({ silent: true });
    } catch {
      setError("detail.localSyncError");
    } finally {
      setSyncing(false);
    }
  }

  async function handleTestConnection() {
    setConnecting(true);
    setSaveMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/monitor/accounts/${id}/connect`, { method: "POST" });
      const json = (await response.json()) as {
        ok: boolean;
        account?: PublicMonitorAccount;
        error?: string;
        message?: string;
      };
      if (!response.ok || !json.ok) {
        setError(json.error || "detail.connectError");
        if (json.account) {
          setAccount(json.account);
        }
        return;
      }
      setSaveMessage(json.message || t("detail.connectSuccess"));
      if (json.account) {
        setAccount(json.account);
      }
      await load();
    } catch {
      setError("detail.connectError");
    } finally {
      setConnecting(false);
    }
  }

  async function handleAccountLogout() {
    if (!confirm(t("detail.logoutConfirm"))) return;
    setLoggingOut(true);
    setSaveMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/monitor/accounts/${id}/logout`, { method: "POST" });
      const json = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !json.ok) {
        setError(json.error || "detail.saveError");
        return;
      }
      setFormDirty(false);
      formDirtyRef.current = false;
      setSaveMessage(t("detail.logoutSuccess"));
      setForm((prev) => ({ ...prev, sessionCookie: "" }));
      await load();
    } catch {
      setError("detail.saveApiError");
    } finally {
      setLoggingOut(false);
    }
  }

  function formatTimestamp(value?: string | null): string {
    if (!value) return t("accounts.none");
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return value;
    return new Date(parsed).toLocaleString();
  }

  function formatAuthMode(value?: PublicMonitorAccount["authMode"]): string {
    if (!value) return t("accounts.none");
    if (value === "manual_cookie") return t("detail.authModeManualCookie");
    if (value === "local_sync") return t("detail.authModeLocalSync");
    if (value === "auth_store") return "Auth store";
    return value;
  }

  function formatSyncSource(value?: PublicMonitorAccount["syncSource"]): string {
    if (!value) return t("accounts.none");
    if (value === "manual_cookie") return t("detail.syncSourceManualCookie");
    if (value === "claude_cookie") return t("detail.syncSourceClaudeCookie");
    if (value === "cliproxy_codex") return "CLIProxyAPI Codex";
    if (value === "cliproxy_claude") return "CLIProxyAPI Claude";
    return value;
  }

  return (
    <main className="min-h-screen surface-page">
      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        <div className="glass-card rounded-2xl px-5 py-4 flex items-center justify-between gap-3">
          <div>
            <Link
              href="/monitor/accounts"
              className="group inline-flex items-center gap-1 text-sm font-bold text-[var(--text-muted)] hover:text-[var(--text-heading)] transition-colors mb-1"
            >
              <span className="group-hover:-translate-x-0.5 transition-transform">←</span> {t("detail.accountList")}
            </Link>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-black text-[var(--text-heading)]">{title}</h1>
              <span
                className="text-sm font-bold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: `color-mix(in srgb, ${brand} 12%, transparent)`, color: brand }}
              >
                {isClaude ? "Claude" : "OpenAI"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <LanguageSelector />
            <ThemeToggle />
            <Link
              href="/monitor"
              className="px-3 py-2 rounded-xl text-base font-bold text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--surface-raised)] transition-all"
            >
              {t("dashboard")}
            </Link>
          </div>
        </div>

        <AnimatePresence>
          {errorMsg && (
            <motion.div
              key="err"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="rounded-xl p-4 text-base font-bold text-rose-400"
              style={{ background: "var(--error-bg)", border: "1px solid var(--error-border)" }}
            >
              {errorMsg}
            </motion.div>
          )}
          {saveMessage && (
            <motion.div
              key="ok"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="rounded-xl p-4 text-base font-bold text-emerald-400"
              style={{ background: "var(--success-bg)", border: "1px solid var(--success-border)" }}
            >
              {saveMessage}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-[var(--text-heading)]">{t("detail.accountSettings")}</h2>
            <div className="flex items-center gap-2">
                <span className="text-base font-bold text-[var(--text-muted)]">{t("enabled")}</span>
                <ToggleSwitch
                  checked={form.enabled}
                  onChange={(value) => {
                    setFormDirty(true);
                    setForm((prev) => ({ ...prev, enabled: value }));
                  }}
                  color={brand}
                  label={t("enabled")}
                />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-bold text-[var(--text-muted)] mb-1">{t("detail.name")}</label>
              <input
                value={form.name}
                onChange={(event) => {
                  setFormDirty(true);
                  setForm((prev) => ({ ...prev, name: event.target.value }));
                }}
                className="surface-input rounded-xl px-3 py-2.5 text-base border w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-[var(--text-muted)] mb-1">{t("detail.provider")}</label>
              <div className="surface-input rounded-xl px-3 py-2.5 text-base border font-bold text-[var(--text-secondary)]">
                {isClaude ? "Claude" : "OpenAI"}
              </div>
            </div>

            <div className="md:col-span-2">
              {isClaude ? (
                <>
                  <div
                    className="rounded-xl p-4 space-y-2.5"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${brand} 6%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${brand} 20%, transparent)`,
                    }}
                  >
                    <p className="text-base font-black" style={{ color: brand }}>{t("detail.localSyncClaude")}</p>
                    <p className="text-sm text-[var(--text-muted)]">{t("detail.claudeLocalSyncDesc")}</p>
                    <button
                      onClick={() => void handleStartLocalSync()}
                      disabled={syncing}
                      className="inline-flex items-center gap-2 rounded-xl text-white px-4 py-2.5 font-bold text-base disabled:opacity-50 transition-all"
                      style={{ background: `linear-gradient(to right, ${brand}, ${brandLightVar(provider)})` }}
                    >
                      {syncing && <Spinner className="h-4 w-4" />}
                      {syncing ? t("detail.startingLocalSync") : t("detail.startLocalSync")}
                    </button>

                    {syncToken && (
                      <div className="rounded-xl bg-[var(--surface-raised)] border border-[var(--border-card)] p-3 space-y-2">
                        <div>
                          <p className="text-xs font-black uppercase tracking-wide text-[var(--text-muted)]">
                            {t("detail.localSyncToken")}
                          </p>
                          <code className="block mt-1 text-sm break-all text-[var(--text-secondary)]">{syncToken}</code>
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase tracking-wide text-[var(--text-muted)]">
                            {t("detail.localSyncCommand")}
                          </p>
                          <code className="block mt-1 text-sm break-all text-[var(--text-secondary)]">{helperCommand}</code>
                        </div>
                        <p className="text-xs text-[var(--text-muted)]">{t("detail.localSyncTokenHelp")}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {t("detail.localSyncExpires")}: {formatTimestamp(syncExpiresAt)}
                        </p>
                      </div>
                    )}
                  </div>

                  <details className="mt-2 group">
                    <summary className="text-sm font-bold text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)] transition-colors">
                      {t("detail.manualCookie")}
                    </summary>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input
                        type="password"
                        value={form.sessionCookie}
                        onChange={(event) => {
                          setFormDirty(true);
                          setForm((prev) => ({ ...prev, sessionCookie: event.target.value }));
                        }}
                        className="surface-input rounded-xl px-3 py-2.5 text-base border md:col-span-2"
                        placeholder={account?.sessionCookieMasked
                          ? `${t("detail.current")}: ${account.sessionCookieMasked}`
                          : "sessionKey=sk-ant-sid01-..."}
                      />
                    </div>
                  </details>
                </>
              ) : (
                <div
                  className="rounded-xl p-4 space-y-2.5"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${brand} 6%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${brand} 20%, transparent)`,
                  }}
                >
                  <p className="text-base font-black" style={{ color: brand }}>CLIProxyAPI Codex</p>
                  <p className="text-sm text-[var(--text-muted)]">
                    This OpenAI account is read directly from the server-local auth store. Manual credentials and local sync are disabled.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-[var(--surface-raised)] px-4 py-3 text-sm font-semibold text-[var(--text-muted)] space-y-1">
            <p>{t("detail.authMode")}: <span className="text-[var(--text-secondary)]">{formatAuthMode(account?.authMode)}</span></p>
            <p>{t("detail.syncSource")}: <span className="text-[var(--text-secondary)]">{formatSyncSource(account?.syncSource)}</span></p>
            <p>{t("detail.authIdentity")}: <span className="text-[var(--text-secondary)]">{account?.authIdentity || t("accounts.none")}</span></p>
            <p>{t("detail.lastSyncedAt")}: <span className="text-[var(--text-secondary)]">{formatTimestamp(account?.lastSyncedAt)}</span></p>
            {account?.sourcePath && <p>Source Path: <span className="text-[var(--text-secondary)]">{account.sourcePath}</span></p>}
            {account?.sourceAccountId && <p>Source Account ID: <span className="text-[var(--text-secondary)]">{account.sourceAccountId}</span></p>}
            {account?.sourceExpiresAt && <p>Source Expires: <span className="text-[var(--text-secondary)]">{formatTimestamp(account.sourceExpiresAt)}</span></p>}
            {isClaude && <p>{t("accounts.cookie")}: <span className="text-[var(--text-secondary)]">{account?.sessionCookieMasked || t("accounts.none")}</span></p>}
            {account?.organizationId && <p>{t("detail.orgLabel")}: <span className="text-[var(--text-secondary)]">{account.organizationId}</span></p>}
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => void saveAccount()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl text-white px-4 py-2.5 font-bold text-base disabled:opacity-50"
              style={{ background: `linear-gradient(to right, ${brand}, ${brandLightVar(provider)})` }}
            >
              {saving && <Spinner className="h-4 w-4" />}
              {saving ? t("detail.saving") : t("detail.saveSettings")}
            </button>
            <button
              onClick={() => void handleTestConnection()}
              disabled={connecting}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-card)] px-4 py-2.5 font-bold text-base text-[var(--text-body)] hover:border-[var(--border-hover)] disabled:opacity-50 transition-all"
            >
              {connecting && <Spinner className="h-4 w-4" />}
              {connecting ? t("detail.testing") : t("detail.testConnection")}
            </button>
            {(account?.hasSessionCookie || Boolean(account?.subscriptionInfo) || Boolean(account?.lastSyncedAt) || Boolean(account?.sourcePath)) && (
              <button
                onClick={() => void handleAccountLogout()}
                disabled={loggingOut}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-500/30 px-4 py-2.5 font-bold text-base text-rose-400 hover:bg-rose-500/10 disabled:opacity-50 transition-all ml-auto"
              >
                {loggingOut && <Spinner className="h-4 w-4" />}
                {loggingOut ? t("detail.loggingOut") : t("detail.accountLogout")}
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="space-y-5">
            {[1, 2, 3].map((index) => (
              <div key={index} className="glass-card rounded-2xl p-6 animate-pulse">
                <div className="h-6 w-48 rounded-lg bg-[var(--surface-raised)] mb-4" />
                <div className="h-4 w-full rounded-lg bg-[var(--surface-raised)] mb-2" />
                <div className="h-4 w-2/3 rounded-lg bg-[var(--surface-raised)]" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {report?.usageInfo && report.usageInfo.windows.length > 0 ? (
              <div className="glass-card rounded-xl p-5 space-y-3">
                <h2 className="text-lg font-black text-[var(--text-heading)]">{t("detail.usageRateLimit")}</h2>
                {report.usageInfo.windows.map((window) => <UtilBar key={`${window.key}:${window.label}`} window={window} />)}
              </div>
            ) : (
              <div className="glass-card rounded-xl p-5">
                <h2 className="text-lg font-black text-[var(--text-heading)] mb-1">{t("detail.usage")}</h2>
                <p className="text-base text-[var(--text-muted)]">
                  {report?.status === "disabled"
                    ? t("detail.disabledStatus")
                    : report?.status === "not_configured"
                      ? t("detail.needsSetup")
                      : report?.status === "pending"
                        ? (report.error || t("detail.pendingFetch"))
                        : t("noData")}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 flex-wrap px-1">
              <h2 className="text-lg font-black text-[var(--text-heading)]">Usage History</h2>
              <div className="flex items-center gap-1 rounded-full border border-[var(--border-card)] bg-[var(--surface-raised)] p-1">
                {HISTORY_RANGES.map((range) => {
                  const active = historyRange === range;
                  return (
                    <button
                      key={range}
                      type="button"
                      onClick={() => setHistoryRange(range)}
                      className={`rounded-full px-3.5 py-1.5 text-base font-bold transition-all ${active ? "text-white" : "text-[var(--text-secondary)]"}`}
                      style={{ backgroundColor: active ? brand : "transparent" }}
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
              title="Usage History"
              emptyLabel="No history sampled yet."
            />

            {report?.usageInfo?.extraUsage?.enabled && (
              <div className="glass-card rounded-xl p-5">
                <h2 className="text-lg font-black text-[var(--text-heading)] mb-1">{t("detail.extraUsage")}</h2>
                <p className="text-base text-[var(--text-body)]">
                  ${report.usageInfo.extraUsage.usedCredits.toFixed(2)}
                  {report.usageInfo.extraUsage.monthlyLimit != null && (
                    <span className="text-[var(--text-muted)]"> / ${report.usageInfo.extraUsage.monthlyLimit.toFixed(2)}</span>
                  )}
                </p>
              </div>
            )}

            {report?.usageInfo?.billing && (
              <div className="glass-card rounded-xl p-5">
                <h2 className="text-lg font-black text-[var(--text-heading)] mb-2">{t("detail.subscription")}</h2>
                <div className="grid grid-cols-3 gap-3 text-base">
                  <div>
                    <p className="text-sm text-[var(--text-muted)]">{t("detail.status")}</p>
                    <p className="font-black text-[var(--text-heading)] capitalize">{report.usageInfo.billing.status}</p>
                  </div>
                  {report.usageInfo.billing.nextChargeDate && (
                    <div>
                      <p className="text-sm text-[var(--text-muted)]">{t("detail.chargeDate")}</p>
                      <p className="font-black text-[var(--text-heading)]">{report.usageInfo.billing.nextChargeDate}</p>
                    </div>
                  )}
                  {report.usageInfo.billing.interval && (
                    <div>
                      <p className="text-sm text-[var(--text-muted)]">{t("detail.interval")}</p>
                      <p className="font-black text-[var(--text-heading)] capitalize">{report.usageInfo.billing.interval}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {report?.provider === "openai" && report.usageInfo?.accountIdentity && (
              <div className="glass-card rounded-xl p-5">
                <h2 className="text-lg font-black text-[var(--text-heading)] mb-2">{t("detail.resolvedAccount")}</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-base">
                  <div>
                    <p className="text-sm text-[var(--text-muted)]">{t("detail.resolvedEmail")}</p>
                    <p className="font-black text-[var(--text-heading)] break-all">
                      {report.usageInfo.accountIdentity.email || t("accounts.none")}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-[var(--text-muted)]">{t("detail.resolvedAccountId")}</p>
                    <p className="font-black text-[var(--text-heading)] break-all">
                      {report.usageInfo.accountIdentity.accountId || t("accounts.none")}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-[var(--text-muted)]">{t("detail.resolvedPlanType")}</p>
                    <p className="font-black text-[var(--text-heading)] capitalize">
                      {report.usageInfo.accountIdentity.planType || t("accounts.none")}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-[var(--text-dim)]">{t("detail.sameAccountWarning")}</p>
              </div>
            )}

            {report?.error && report.status !== "pending" && (
              <div className="rounded-xl p-4 text-base font-bold text-rose-400" style={{ background: "var(--error-bg)" }}>
                {t("detail.errorPrefix")}: {report.error}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function UtilBar({ window }: { window: UtilizationWindow }) {
  const { t } = useTranslation();
  const pct = Math.min(Math.round(window.utilization), 100);
  const gradient = pct >= 80 ? "from-rose-500 to-rose-400" : pct >= 50 ? "from-amber-500 to-amber-400" : "from-emerald-500 to-emerald-400";

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-base font-bold text-[var(--text-body)]">{window.label}</span>
        <span className={`text-base font-black ${pct >= 80 ? "text-rose-400" : pct >= 50 ? "text-amber-400" : "text-[var(--text-heading)]"}`}>
          {pct}%
        </span>
      </div>
      <div className="w-full h-2.5 bg-[var(--surface-raised)] rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(pct, 1)}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className={`h-full rounded-full bg-gradient-to-r ${gradient}`}
        />
      </div>
      {window.resetsAt && (
        <p className="text-sm text-[var(--text-dim)] mt-0.5">
          {t("detail.reset")} {new Date(window.resetsAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
