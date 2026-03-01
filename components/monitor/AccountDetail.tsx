"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { AccountUsageReport, UtilizationWindow, ProviderType, PublicMonitorAccount } from "@/lib/usage-monitor/types";
import ThemeToggle from "./ThemeToggle";

function brandVar(p: string) { return p === "claude" ? "var(--brand-claude)" : "var(--brand-openai)"; }
function brandLightVar(p: string) { return p === "claude" ? "var(--brand-claude-light)" : "var(--brand-openai-light)"; }

function Spinner() {
  return <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>;
}

function ToggleSwitch({ checked, onChange, color }: { checked: boolean; onChange: (v: boolean) => void; color: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-[var(--border-card)] transition-colors"
      style={{ backgroundColor: checked ? color : "var(--text-dim)" }}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"} mt-0.5`} />
    </button>
  );
}

export default function AccountDetail({ id }: { id: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<PublicMonitorAccount | null>(null);
  const [report, setReport] = useState<AccountUsageReport | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [claudeLogging, setClaudeLogging] = useState(false);
  const [openaiLogging, setOpenaiLogging] = useState(false);
  const [form, setForm] = useState({ name: "", provider: "claude" as ProviderType, enabled: false, sessionCookie: "", apiKey: "", organizationId: "" });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [aRes, uRes] = await Promise.all([
        fetch(`/api/monitor/accounts/${id}`, { cache: "no-store" }),
        fetch(`/api/monitor/usage?accountId=${id}&range=month`, { cache: "no-store" }),
      ]);
      const aJson = (await aRes.json()) as { ok: boolean; account?: PublicMonitorAccount; error?: string };
      const uJson = (await uRes.json()) as { ok: boolean; accounts?: AccountUsageReport[]; error?: string };
      if (!aRes.ok || !aJson.ok || !aJson.account) { setError(aJson.error || "계정 정보 불러오기 실패"); setLoading(false); return; }
      if (!uRes.ok || !uJson.ok || !uJson.accounts?.[0]) { setError(uJson.error || "사용량 불러오기 실패"); setLoading(false); return; }
      setAccount(aJson.account);
      setForm({ name: aJson.account.name, provider: aJson.account.provider, enabled: aJson.account.enabled, sessionCookie: "", apiKey: "", organizationId: aJson.account.organizationId || "" });
      setReport(uJson.accounts[0]);
    } catch { setError("API 호출 실패"); } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = window.setInterval(() => { void load(); }, 60_000); return () => window.clearInterval(t); }, [load]);

  const title = useMemo(() => account?.name || "계정 상세", [account]);
  const isClaude = form.provider === "claude";
  const brand = brandVar(form.provider);

  async function saveAccount() {
    setSaving(true); setSaveMessage(null); setError(null);
    try {
      const payload: Record<string, unknown> = { name: form.name, provider: form.provider, enabled: form.enabled, organizationId: form.organizationId };
      if (form.sessionCookie.trim()) payload.sessionCookie = form.sessionCookie.trim();
      if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();
      const res = await fetch(`/api/monitor/accounts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) { setError(json.error || "저장 실패"); setSaving(false); return; }
      setSaveMessage("저장 완료"); setForm((p) => ({ ...p, sessionCookie: "", apiKey: "" })); await load();
    } catch { setError("저장 API 실패"); } finally { setSaving(false); }
  }

  async function handleProviderLogin(provider: "claude" | "openai") {
    const setL = provider === "claude" ? setClaudeLogging : setOpenaiLogging;
    setL(true); setError(null); setSaveMessage(null);
    try {
      const res = await fetch(`/api/monitor/accounts/${id}/${provider}-login`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (!res.ok || !json.ok) setError(json.error || `${provider} 로그인 실패`);
      else { setSaveMessage(json.message || "로그인 성공"); void load(); }
    } catch (err) { console.error(err); setError(`${provider} 로그인 오류`); } finally { setL(false); }
  }

  async function handleTestConnection() {
    setConnecting(true); setSaveMessage(null); setError(null);
    try {
      const res = await fetch(`/api/monitor/accounts/${id}/connect`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; account?: PublicMonitorAccount; error?: string; message?: string };
      if (!res.ok || !json.ok) { setError(json.error || "연결 테스트 실패"); if (json.account) setAccount(json.account); return; }
      setSaveMessage(json.message || "연결 성공"); if (json.account) setAccount(json.account); await load();
    } catch { setError("연결 테스트 실패"); } finally { setConnecting(false); }
  }

  return (
    <main className="min-h-screen surface-page">
      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">

        {/* Header */}
        <div className="glass-card rounded-2xl px-5 py-4 flex items-center justify-between gap-3">
          <div>
            <Link href="/monitor/accounts" className="group inline-flex items-center gap-1 text-sm font-bold text-[var(--text-muted)] hover:text-[var(--text-heading)] transition-colors mb-1">
              <span className="group-hover:-translate-x-0.5 transition-transform">←</span> 계정 목록
            </Link>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-black text-[var(--text-heading)]">{title}</h1>
              <span className="text-sm font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${brand} 12%, transparent)`, color: brand }}>
                {isClaude ? "Claude" : "OpenAI"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <Link href="/monitor" className="px-3 py-2 rounded-xl text-base font-bold text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--surface-raised)] transition-all">대시보드</Link>
          </div>
        </div>

        {/* Banners */}
        <AnimatePresence>
          {error && (
            <motion.div key="err" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              className="rounded-xl p-4 text-base font-bold text-rose-400" style={{ background: "var(--error-bg)", border: "1px solid var(--error-border)" }}>{error}</motion.div>
          )}
          {saveMessage && (
            <motion.div key="ok" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              className="rounded-xl p-4 text-base font-bold text-emerald-400" style={{ background: "var(--success-bg)", border: "1px solid var(--success-border)" }}>{saveMessage}</motion.div>
          )}
        </AnimatePresence>

        {/* Settings - compact */}
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-[var(--text-heading)]">계정 설정</h2>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-[var(--text-muted)]">활성화</span>
              <ToggleSwitch checked={form.enabled} onChange={(v) => setForm((p) => ({ ...p, enabled: v }))} color={brand} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-bold text-[var(--text-muted)] mb-1">이름</label>
              <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="surface-input rounded-xl px-3 py-2.5 text-base border w-full" />
            </div>
            <div>
              <label className="block text-sm font-bold text-[var(--text-muted)] mb-1">Provider</label>
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
                  {isClaude ? "브라우저 로그인 (권장)" : "브라우저 로그인 (정액제 권장)"}
                </p>
                <p className="text-sm text-[var(--text-muted)]">
                  {isClaude ? "claude.ai에 로그인하면 쿠키가 자동 저장됩니다." : "ChatGPT에 로그인하면 쿠키가 자동 저장됩니다."}
                </p>
                <button onClick={() => void handleProviderLogin(isClaude ? "claude" : "openai")}
                  disabled={isClaude ? claudeLogging : openaiLogging}
                  className="inline-flex items-center gap-2 rounded-xl text-white px-4 py-2.5 font-bold text-base disabled:opacity-50 transition-all"
                  style={{ background: `linear-gradient(to right, ${brand}, ${brandLightVar(form.provider)})` }}>
                  {(isClaude ? claudeLogging : openaiLogging) && <Spinner />}
                  {(isClaude ? claudeLogging : openaiLogging) ? "로그인 중... (최대 3분)" : `${isClaude ? "Claude" : "OpenAI"} 로그인`}
                </button>
              </div>

              <details className="mt-2 group">
                <summary className="text-sm font-bold text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)] transition-colors">
                  {isClaude ? "수동 쿠키 입력" : "Admin API Key (종량제)"}
                </summary>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {isClaude ? (
                    <input type="password" value={form.sessionCookie} onChange={(e) => setForm((p) => ({ ...p, sessionCookie: e.target.value }))}
                      className="surface-input rounded-xl px-3 py-2.5 text-base border md:col-span-2"
                      placeholder={account?.sessionCookieMasked ? `현재: ${account.sessionCookieMasked}` : "sessionKey=sk-ant-sid01-..."} />
                  ) : (
                    <>
                      <input type="password" value={form.apiKey} onChange={(e) => setForm((p) => ({ ...p, apiKey: e.target.value }))}
                        className="surface-input rounded-xl px-3 py-2.5 text-base border" placeholder={account?.apiKeyMasked ? `현재: ${account.apiKeyMasked}` : "sk-admin-..."} />
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
              <p>쿠키: <span className="text-[var(--text-secondary)]">{account?.sessionCookieMasked || "(없음)"}</span></p>
            ) : (
              <>
                <p>쿠키: <span className="text-[var(--text-secondary)]">{account?.sessionCookieMasked || "(없음)"}</span></p>
                <p>API 키: <span className="text-[var(--text-secondary)]">{account?.apiKeyMasked || "(없음)"}</span></p>
                <p>Org: <span className="text-[var(--text-secondary)]">{account?.organizationId || "(없음)"}</span></p>
              </>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={() => void saveAccount()} disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl text-white px-4 py-2.5 font-bold text-base disabled:opacity-50"
              style={{ background: `linear-gradient(to right, ${brand}, ${brandLightVar(form.provider)})` }}>
              {saving && <Spinner />}{saving ? "저장 중..." : "설정 저장"}
            </button>
            <button onClick={() => void handleTestConnection()} disabled={connecting}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-card)] px-4 py-2.5 font-bold text-base text-[var(--text-body)] hover:border-[var(--border-hover)] disabled:opacity-50 transition-all">
              {connecting && <Spinner />}{connecting ? "테스트 중..." : "연결 테스트"}
            </button>
          </div>
        </div>

        {/* Usage */}
        {loading ? (
          <div className="glass-card rounded-xl p-6 text-center text-[var(--text-muted)] font-bold text-lg">불러오는 중...</div>
        ) : report && (
          <div className="space-y-3">
            {/* Utilization */}
            {report.usageInfo && report.usageInfo.windows.length > 0 ? (
              <div className="glass-card rounded-xl p-5 space-y-3">
                <h2 className="text-lg font-black text-[var(--text-heading)]">사용량 (Rate Limit)</h2>
                {report.usageInfo.windows.map((win) => <UtilBar key={win.label} window={win} />)}
              </div>
            ) : (
              <div className="glass-card rounded-xl p-5">
                <h2 className="text-lg font-black text-[var(--text-heading)] mb-1">사용량</h2>
                <p className="text-base text-[var(--text-muted)]">
                  {report.status === "disabled" ? "비활성화됨" : report.status === "not_configured" ? "설정 필요" : "데이터 없음"}
                </p>
              </div>
            )}

            {report.usageInfo?.extraUsage?.enabled && (
              <div className="glass-card rounded-xl p-5">
                <h2 className="text-lg font-black text-[var(--text-heading)] mb-1">추가 사용량</h2>
                <p className="text-base text-[var(--text-body)]">
                  ${report.usageInfo.extraUsage.usedCredits.toFixed(2)}
                  {report.usageInfo.extraUsage.monthlyLimit != null && <span className="text-[var(--text-muted)]"> / ${report.usageInfo.extraUsage.monthlyLimit.toFixed(2)}</span>}
                </p>
              </div>
            )}

            {report.usageInfo?.billing && (
              <div className="glass-card rounded-xl p-5">
                <h2 className="text-lg font-black text-[var(--text-heading)] mb-2">구독 정보</h2>
                <div className="grid grid-cols-3 gap-3 text-base">
                  <div><p className="text-sm text-[var(--text-muted)]">상태</p><p className="font-black text-[var(--text-heading)] capitalize">{report.usageInfo.billing.status}</p></div>
                  {report.usageInfo.billing.nextChargeDate && <div><p className="text-sm text-[var(--text-muted)]">결제일</p><p className="font-black text-[var(--text-heading)]">{report.usageInfo.billing.nextChargeDate}</p></div>}
                  {report.usageInfo.billing.interval && <div><p className="text-sm text-[var(--text-muted)]">주기</p><p className="font-black text-[var(--text-heading)] capitalize">{report.usageInfo.billing.interval}</p></div>}
                </div>
              </div>
            )}

            {report.provider === "openai" && (report.costUsd > 0 || report.requests > 0) && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {[["비용", `$${report.costUsd.toFixed(2)}`], ["요청", report.requests.toLocaleString()], ["토큰", report.tokens.toLocaleString()]].map(([l, v]) => (
                    <div key={l} className="glass-card rounded-xl p-4">
                      <p className="text-sm text-[var(--text-muted)]">{l}</p>
                      <p className="text-xl font-black text-[var(--text-heading)]">{v}</p>
                    </div>
                  ))}
                </div>
                {report.points.length > 0 && (
                  <div className="glass-card rounded-xl p-5">
                    <h2 className="text-lg font-black text-[var(--text-heading)] mb-2">일자별</h2>
                    <table className="w-full text-base">
                      <thead><tr className="text-sm text-[var(--text-muted)]"><th className="py-1 text-left">날짜</th><th className="py-1 text-right">비용</th><th className="py-1 text-right">요청</th><th className="py-1 text-right">토큰</th></tr></thead>
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

            {report.error && <div className="rounded-xl p-4 text-base font-bold text-rose-400" style={{ background: "var(--error-bg)" }}>오류: {report.error}</div>}
          </div>
        )}
      </div>
    </main>
  );
}

function UtilBar({ window: win }: { window: UtilizationWindow }) {
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
      {win.resetsAt && <p className="text-sm text-[var(--text-dim)] mt-0.5">리셋: {new Date(win.resetsAt).toLocaleString("ko-KR")}</p>}
    </div>
  );
}
