"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { AccountUsageReport, UtilizationWindow, ProviderType, PublicMonitorAccount, CodexMetrics } from "@/lib/usage-monitor/types";
import ThemeToggle from "./ThemeToggle";
import { useTranslation } from "@/lib/i18n/context";
import LanguageSelector from "./LanguageSelector";
import { ToggleSwitch, Spinner, brandVar, brandLightVar } from "./shared";

export default function AccountDetail({ id }: { id: string }) {
  const router = useRouter();
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<PublicMonitorAccount | null>(null);
  const [report, setReport] = useState<AccountUsageReport | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [claudeLogging, setClaudeLogging] = useState(false);
  const [openaiLogging, setOpenaiLogging] = useState(false);
  const [form, setForm] = useState({ name: "", provider: "claude" as ProviderType, enabled: false, sessionCookie: "", apiKey: "", organizationId: "" });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [accountResult, usageResult] = await Promise.allSettled([
        fetch(`/api/monitor/accounts/${id}`, { cache: "no-store" }),
        fetch(`/api/monitor/usage?accountId=${id}&range=month`, { cache: "no-store" }),
      ]);

      if (accountResult.status === "rejected") {
        setError("detail.loadAccountError");
        return;
      }

      const aRes = accountResult.value;
      if (aRes.status === 401) {
        router.replace("/monitor/login");
        router.refresh();
        return;
      }
      const aJson = (await aRes.json()) as { ok: boolean; account?: PublicMonitorAccount; error?: string };
      if (!aRes.ok || !aJson.ok || !aJson.account) {
        setError(aJson.error || "detail.loadAccountError");
        return;
      }

      setAccount(aJson.account);
      setForm({ name: aJson.account.name, provider: aJson.account.provider, enabled: aJson.account.enabled, sessionCookie: "", apiKey: "", organizationId: aJson.account.organizationId || "" });

      if (usageResult.status === "fulfilled") {
        const uRes = usageResult.value;
        if (uRes.status === 401) {
          router.replace("/monitor/login");
          router.refresh();
          return;
        }
        const uJson = (await uRes.json()) as { ok: boolean; accounts?: AccountUsageReport[]; error?: string };
        if (uRes.ok && uJson.ok && uJson.accounts?.[0]) {
          setReport(uJson.accounts[0]);
        } else {
          setError(uJson.error || "detail.loadUsageError");
        }
      } else {
        setError("detail.loadUsageError");
      }
    } catch { setError("detail.apiCallError"); } finally { setLoading(false); }
  }, [id, router]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => { void load(); }, 60_000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { setNowTs(Date.now()); }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const title = useMemo(() => account?.name || "Account", [account]);
  const isClaude = form.provider === "claude";
  const brand = brandVar(form.provider);

  const errorMsg = error ? (t(error as Parameters<typeof t>[0]) || error) : null;

  async function saveAccount() {
    setSaving(true); setSaveMessage(null); setError(null);
    try {
      const payload: Record<string, unknown> = { name: form.name, provider: form.provider, enabled: form.enabled, organizationId: form.organizationId };
      if (form.sessionCookie.trim()) payload.sessionCookie = form.sessionCookie.trim();
      if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();
      const res = await fetch(`/api/monitor/accounts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) { setError(json.error || "detail.saveError"); setSaving(false); return; }
      setSaveMessage(t("detail.saved")); setForm((p) => ({ ...p, sessionCookie: "", apiKey: "" })); await load();
    } catch { setError("detail.saveApiError"); } finally { setSaving(false); }
  }

  async function handleProviderLogin(provider: "claude" | "openai") {
    const setL = provider === "claude" ? setClaudeLogging : setOpenaiLogging;
    setL(true); setError(null); setSaveMessage(null);
    try {
      const res = await fetch(`/api/monitor/accounts/${id}/${provider}-login`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (!res.ok || !json.ok) setError(json.error || "detail.loginFailed");
      else { setSaveMessage(json.message || t("detail.loginSuccess")); void load(); }
    } catch (err) { console.error(err); setError("detail.loginErrorGeneric"); } finally { setL(false); }
  }

  async function handleTestConnection() {
    setConnecting(true); setSaveMessage(null); setError(null);
    try {
      const res = await fetch(`/api/monitor/accounts/${id}/connect`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; account?: PublicMonitorAccount; error?: string; message?: string };
      if (!res.ok || !json.ok) { setError(json.error || "detail.connectError"); if (json.account) setAccount(json.account); return; }
      setSaveMessage(json.message || t("detail.connectSuccess")); if (json.account) setAccount(json.account); await load();
    } catch { setError("detail.connectError"); } finally { setConnecting(false); }
  }

  async function handleAccountLogout() {
    if (!confirm(t("detail.logoutConfirm"))) return;
    setLoggingOut(true); setSaveMessage(null); setError(null);
    try {
      const res = await fetch(`/api/monitor/accounts/${id}/logout`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) { setError(json.error || "detail.saveError"); return; }
      setSaveMessage(t("detail.logoutSuccess")); setForm((p) => ({ ...p, sessionCookie: "", apiKey: "", organizationId: "" })); await load();
    } catch { setError("detail.saveApiError"); } finally { setLoggingOut(false); }
  }

  return (
    <main className="min-h-screen surface-page">
      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">

        {/* Header */}
        <div className="glass-card rounded-2xl px-5 py-4 flex items-center justify-between gap-3">
          <div>
            <Link href="/monitor/accounts" className="group inline-flex items-center gap-1 text-sm font-bold text-[var(--text-muted)] hover:text-[var(--text-heading)] transition-colors mb-1">
              <span className="group-hover:-translate-x-0.5 transition-transform">←</span> {t("detail.accountList")}
            </Link>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-black text-[var(--text-heading)]">{title}</h1>
              <span className="text-sm font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${brand} 12%, transparent)`, color: brand }}>
                {isClaude ? "Claude" : "OpenAI"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <LanguageSelector />
            <ThemeToggle />
            <Link href="/monitor" className="px-3 py-2 rounded-xl text-base font-bold text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--surface-raised)] transition-all">{t("dashboard")}</Link>
          </div>
        </div>

        {/* Banners */}
        <AnimatePresence>
          {errorMsg && (
            <motion.div key="err" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              className="rounded-xl p-4 text-base font-bold text-rose-400" style={{ background: "var(--error-bg)", border: "1px solid var(--error-border)" }}>{errorMsg}</motion.div>
          )}
          {saveMessage && (
            <motion.div key="ok" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              className="rounded-xl p-4 text-base font-bold text-emerald-400" style={{ background: "var(--success-bg)", border: "1px solid var(--success-border)" }}>{saveMessage}</motion.div>
          )}
        </AnimatePresence>

        {/* Settings - compact */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-[var(--text-heading)]">{t("detail.accountSettings")}</h2>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-[var(--text-muted)]">{t("enabled")}</span>
              <ToggleSwitch checked={form.enabled} onChange={(v) => setForm((p) => ({ ...p, enabled: v }))} color={brand} label={t("enabled")} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-bold text-[var(--text-muted)] mb-1">{t("detail.name")}</label>
              <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="surface-input rounded-xl px-3 py-2.5 text-base border w-full" />
            </div>
            <div>
              <label className="block text-sm font-bold text-[var(--text-muted)] mb-1">{t("detail.provider")}</label>
              <div className="flex gap-1 p-0.5 bg-[var(--surface-input)] rounded-lg border border-[var(--border-input)]">
                {(["claude", "openai"] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setForm((f) => ({ ...f, provider: p }))}
                    className="flex-1 py-2 rounded-md text-base font-bold transition-all"
                    style={{ backgroundColor: form.provider === p ? brandVar(p) : "transparent", color: form.provider === p ? "white" : "var(--text-secondary)" }}>
                    {p === "claude" ? "Claude" : "OpenAI"}
                  </button>
                ))}
              </div>
            </div>

            {/* Login section */}
            <div className="md:col-span-2">
              <div className="rounded-xl p-4 space-y-2.5" style={{ backgroundColor: `color-mix(in srgb, ${brand} 6%, transparent)`, border: `1px solid color-mix(in srgb, ${brand} 20%, transparent)` }}>
                <p className="text-base font-black" style={{ color: brand }}>
                  {isClaude ? t("detail.browserLoginClaude") : t("detail.browserLoginOpenai")}
                </p>
                <p className="text-sm text-[var(--text-muted)]">
                  {isClaude ? t("detail.claudeLoginDesc") : t("detail.openaiLoginDesc")}
                </p>
                <button onClick={() => void handleProviderLogin(isClaude ? "claude" : "openai")}
                  disabled={isClaude ? claudeLogging : openaiLogging}
                  className="inline-flex items-center gap-2 rounded-xl text-white px-4 py-2.5 font-bold text-base disabled:opacity-50 transition-all"
                  style={{ background: `linear-gradient(to right, ${brand}, ${brandLightVar(form.provider)})` }}>
                  {(isClaude ? claudeLogging : openaiLogging) && <Spinner className="h-4 w-4" />}
                  {(isClaude ? claudeLogging : openaiLogging) ? t("detail.loggingInMax") : (isClaude ? t("detail.claudeLogin") : t("detail.openaiLogin"))}
                </button>
              </div>

              <details className="mt-2 group">
                <summary className="text-sm font-bold text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)] transition-colors">
                  {isClaude ? t("detail.manualCookie") : t("detail.adminApiKey")}
                </summary>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {isClaude ? (
                    <input type="password" value={form.sessionCookie} onChange={(e) => setForm((p) => ({ ...p, sessionCookie: e.target.value }))}
                      className="surface-input rounded-xl px-3 py-2.5 text-base border md:col-span-2"
                      placeholder={account?.sessionCookieMasked ? `${t("detail.current")}: ${account.sessionCookieMasked}` : "sessionKey=sk-ant-sid01-..."} />
                  ) : (
                    <>
                      <input type="password" value={form.apiKey} onChange={(e) => setForm((p) => ({ ...p, apiKey: e.target.value }))}
                        className="surface-input rounded-xl px-3 py-2.5 text-base border" placeholder={account?.apiKeyMasked ? `${t("detail.current")}: ${account.apiKeyMasked}` : "sk-admin-..."} />
                      <input value={form.organizationId} onChange={(e) => setForm((p) => ({ ...p, organizationId: e.target.value }))}
                        className="surface-input rounded-xl px-3 py-2.5 text-base border" placeholder="org-..." />
                    </>
                  )}
                </div>
              </details>
            </div>
          </div>

          {/* Credential status */}
          <div className="rounded-lg bg-[var(--surface-raised)] px-4 py-3 text-sm font-semibold text-[var(--text-muted)] space-y-1">
            {isClaude ? (
              <p>{t("accounts.cookie")}: <span className="text-[var(--text-secondary)]">{account?.sessionCookieMasked || t("accounts.none")}</span></p>
            ) : (
              <>
                <p>{t("accounts.cookie")}: <span className="text-[var(--text-secondary)]">{account?.sessionCookieMasked || t("accounts.none")}</span></p>
                <p>{t("accounts.key")}: <span className="text-[var(--text-secondary)]">{account?.apiKeyMasked || t("accounts.none")}</span></p>
                <p>{t("detail.orgLabel")}: <span className="text-[var(--text-secondary)]">{account?.organizationId || t("accounts.none")}</span></p>
              </>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={() => void saveAccount()} disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl text-white px-4 py-2.5 font-bold text-base disabled:opacity-50"
              style={{ background: `linear-gradient(to right, ${brand}, ${brandLightVar(form.provider)})` }}>
              {saving && <Spinner className="h-4 w-4" />}{saving ? t("detail.saving") : t("detail.saveSettings")}
            </button>
            <button onClick={() => void handleTestConnection()} disabled={connecting}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-card)] px-4 py-2.5 font-bold text-base text-[var(--text-body)] hover:border-[var(--border-hover)] disabled:opacity-50 transition-all">
              {connecting && <Spinner className="h-4 w-4" />}{connecting ? t("detail.testing") : t("detail.testConnection")}
            </button>
            {(account?.hasSessionCookie || account?.hasApiKey) && (
              <button onClick={() => void handleAccountLogout()} disabled={loggingOut}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-500/30 px-4 py-2.5 font-bold text-base text-rose-400 hover:bg-rose-500/10 disabled:opacity-50 transition-all ml-auto">
                {loggingOut && <Spinner className="h-4 w-4" />}{loggingOut ? t("detail.loggingOut") : t("detail.accountLogout")}
              </button>
            )}
          </div>
        </div>

        {/* Usage */}
        {loading ? (
          <div className="space-y-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass-card rounded-2xl p-6 animate-pulse">
                <div className="h-6 w-48 rounded-lg bg-[var(--surface-raised)] mb-4" />
                <div className="h-4 w-full rounded-lg bg-[var(--surface-raised)] mb-2" />
                <div className="h-4 w-2/3 rounded-lg bg-[var(--surface-raised)]" />
              </div>
            ))}
          </div>
        ) : report && (
          <div className="space-y-3">
            {/* Utilization */}
            {report.usageInfo && report.usageInfo.windows.length > 0 ? (
              <div className="glass-card rounded-xl p-5 space-y-3">
                <h2 className="text-lg font-black text-[var(--text-heading)]">{t("detail.usageRateLimit")}</h2>
                {report.usageInfo.windows.map((win) => <UtilBar key={win.label} window={win} />)}
              </div>
            ) : (
              <div className="glass-card rounded-xl p-5">
                <h2 className="text-lg font-black text-[var(--text-heading)] mb-1">{t("detail.usage")}</h2>
                <p className="text-base text-[var(--text-muted)]">
                  {report.status === "disabled" ? t("detail.disabledStatus") : report.status === "not_configured" ? t("detail.needsSetup") : t("noData")}
                </p>
              </div>
            )}

            {report.usageInfo?.codexMetrics && <CodexMetricsPanel metrics={report.usageInfo.codexMetrics} nowTs={nowTs} />}

            {report.usageInfo?.extraUsage?.enabled && (
              <div className="glass-card rounded-xl p-5">
                <h2 className="text-lg font-black text-[var(--text-heading)] mb-1">{t("detail.extraUsage")}</h2>
                <p className="text-base text-[var(--text-body)]">
                  ${report.usageInfo.extraUsage.usedCredits.toFixed(2)}
                  {report.usageInfo.extraUsage.monthlyLimit != null && <span className="text-[var(--text-muted)]"> / ${report.usageInfo.extraUsage.monthlyLimit.toFixed(2)}</span>}
                </p>
              </div>
            )}

            {report.usageInfo?.billing && (
              <div className="glass-card rounded-xl p-5">
                <h2 className="text-lg font-black text-[var(--text-heading)] mb-2">{t("detail.subscription")}</h2>
                <div className="grid grid-cols-3 gap-3 text-base">
                  <div><p className="text-sm text-[var(--text-muted)]">{t("detail.status")}</p><p className="font-black text-[var(--text-heading)] capitalize">{report.usageInfo.billing.status}</p></div>
                  {report.usageInfo.billing.nextChargeDate && <div><p className="text-sm text-[var(--text-muted)]">{t("detail.chargeDate")}</p><p className="font-black text-[var(--text-heading)]">{report.usageInfo.billing.nextChargeDate}</p></div>}
                  {report.usageInfo.billing.interval && <div><p className="text-sm text-[var(--text-muted)]">{t("detail.interval")}</p><p className="font-black text-[var(--text-heading)] capitalize">{report.usageInfo.billing.interval}</p></div>}
                </div>
              </div>
            )}

            {report.provider === "openai" && (report.costUsd > 0 || report.requests > 0 || report.tokens > 0) && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {([[t("cost"), `$${report.costUsd.toFixed(2)}`], [t("requests"), report.requests.toLocaleString()], [t("tokens"), report.tokens.toLocaleString()]] as [string, string][]).map(([l, v]) => (
                    <div key={l} className="glass-card rounded-xl p-4">
                      <p className="text-sm text-[var(--text-muted)]">{l}</p>
                      <p className="text-xl font-black text-[var(--text-heading)]">{v}</p>
                    </div>
                  ))}
                </div>
                {report.points.length > 0 && (
                  <div className="glass-card rounded-xl p-5">
                    <h2 className="text-lg font-black text-[var(--text-heading)] mb-2">{t("detail.daily")}</h2>
                    <table className="w-full text-base">
                      <thead><tr className="text-sm text-[var(--text-muted)]"><th className="py-1 text-left">{t("detail.date")}</th><th className="py-1 text-right">{t("cost")}</th><th className="py-1 text-right">{t("requests")}</th><th className="py-1 text-right">{t("tokens")}</th></tr></thead>
                      <tbody>
                        {report.points.map((p) => (
                          <tr key={p.date} className="border-t border-[var(--border-card)]">
                            <td className="py-1.5 text-[var(--text-secondary)]">{p.date}</td>
                            <td className="py-1.5 text-right font-mono text-[var(--text-body)]">${p.costUsd.toFixed(2)}</td>
                            <td className="py-1.5 text-right font-mono text-[var(--text-body)]">{p.requests.toLocaleString()}</td>
                            <td className="py-1.5 text-right font-mono text-[var(--text-body)]">{p.tokens.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {report.error && <div className="rounded-xl p-4 text-base font-bold text-rose-400" style={{ background: "var(--error-bg)" }}>{t("detail.errorPrefix")}: {report.error}</div>}
          </div>
        )}
      </div>
    </main>
  );
}

function CodexMetricsPanel({ metrics, nowTs }: { metrics: CodexMetrics; nowTs: number }) {
  const hasTokens = metrics.sessionTotalTokens > 0;
  const hasTurns = metrics.totalTurns > 0;
  if (!hasTokens && !hasTurns && !metrics.lastActivity) return null;

  function formatRelative(isoStr: string): string {
    const diff = nowTs - new Date(isoStr).getTime();
    if (diff < 0 || isNaN(diff)) return "";
    const m = Math.floor(diff / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  return (
    <div className="glass-card rounded-xl p-5">
      <h2 className="text-lg font-black text-[var(--text-heading)] mb-2">Codex Metrics</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-base">
        {hasTurns && (
          <div>
            <p className="text-sm text-[var(--text-muted)]">Total Turns</p>
            <p className="font-black text-[var(--text-heading)]">{metrics.totalTurns.toLocaleString()}</p>
          </div>
        )}
        {metrics.sessionTurns > 0 && (
          <div>
            <p className="text-sm text-[var(--text-muted)]">Session Turns</p>
            <p className="font-black text-[var(--text-heading)]">{metrics.sessionTurns.toLocaleString()}</p>
          </div>
        )}
        {hasTokens && (
          <>
            <div>
              <p className="text-sm text-[var(--text-muted)]">Input Tokens</p>
              <p className="font-black text-[var(--text-heading)]">{metrics.sessionInputTokens.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--text-muted)]">Output Tokens</p>
              <p className="font-black text-[var(--text-heading)]">{metrics.sessionOutputTokens.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--text-muted)]">Total Tokens</p>
              <p className="font-black text-[var(--text-heading)]">{metrics.sessionTotalTokens.toLocaleString()}</p>
            </div>
          </>
        )}
        {metrics.lastActivity && (
          <div>
            <p className="text-sm text-[var(--text-muted)]">Last Activity</p>
            <p className="font-black text-[var(--text-heading)]">{formatRelative(metrics.lastActivity)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function UtilBar({ window: win }: { window: UtilizationWindow }) {
  const { t } = useTranslation();
  const pct = Math.min(Math.round(win.utilization), 100);
  const grad = pct >= 80 ? "from-rose-500 to-rose-400" : pct >= 50 ? "from-amber-500 to-amber-400" : "from-emerald-500 to-emerald-400";
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-base font-bold text-[var(--text-body)]">{win.label}</span>
        <span className={`text-base font-black ${pct >= 80 ? "text-rose-400" : pct >= 50 ? "text-amber-400" : "text-[var(--text-heading)]"}`}>{pct}%</span>
      </div>
      <div className="w-full h-2.5 bg-[var(--surface-raised)] rounded-full overflow-hidden">
        <motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(pct, 1)}%` }} transition={{ duration: 0.6, ease: "easeOut" }} className={`h-full rounded-full bg-gradient-to-r ${grad}`} />
      </div>
      {win.resetsAt && <p className="text-sm text-[var(--text-dim)] mt-0.5">{t("detail.reset")} {new Date(win.resetsAt).toLocaleString()}</p>}
    </div>
  );
}
