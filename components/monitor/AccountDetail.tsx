"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AccountUsageReport, ClaudeUtilizationWindow, ProviderType, PublicMonitorAccount, RangePreset } from "@/lib/usage-monitor/types";

const options: RangePreset[] = ["day", "week", "month"];


export default function AccountDetail({ id }: { id: string }) {
  const [range, setRange] = useState<RangePreset>("week");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<PublicMonitorAccount | null>(null);
  const [report, setReport] = useState<AccountUsageReport | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [claudeLogging, setClaudeLogging] = useState(false);
  const [form, setForm] = useState({
    name: "",
    provider: "claude" as ProviderType,
    enabled: false,
    sessionCookie: "",
    apiKey: "",
    organizationId: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [accountRes, usageRes] = await Promise.all([
        fetch(`/api/monitor/accounts/${id}`, { cache: "no-store" }),
        fetch(`/api/monitor/usage?accountId=${id}&range=${range}`, { cache: "no-store" }),
      ]);

      const accountJson = (await accountRes.json()) as { ok: boolean; account?: PublicMonitorAccount; error?: string };
      const usageJson = (await usageRes.json()) as { ok: boolean; accounts?: AccountUsageReport[]; error?: string };

      if (!accountRes.ok || !accountJson.ok || !accountJson.account) {
        setError(accountJson.error || "계정 정보를 불러오지 못했습니다.");
        setLoading(false);
        return;
      }
      if (!usageRes.ok || !usageJson.ok || !usageJson.accounts?.[0]) {
        setError(usageJson.error || "사용량을 불러오지 못했습니다.");
        setLoading(false);
        return;
      }

      setAccount(accountJson.account);
      setForm({
        name: accountJson.account.name,
        provider: accountJson.account.provider,
        enabled: accountJson.account.enabled,
        sessionCookie: "",
        apiKey: "",
        organizationId: accountJson.account.organizationId || "",
      });
      setReport(usageJson.accounts[0]);
    } catch {
      setError("상세 API 호출 실패");
    } finally {
      setLoading(false);
    }
  }, [id, range]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const title = useMemo(() => account?.name || "계정 상세", [account]);

  async function saveAccount() {
    setSaving(true);
    setSaveMessage(null);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        provider: form.provider,
        enabled: form.enabled,
        organizationId: form.organizationId,
      };
      if (form.sessionCookie.trim()) {
        payload.sessionCookie = form.sessionCookie.trim();
      }
      if (form.apiKey.trim()) {
        payload.apiKey = form.apiKey.trim();
      }

      const res = await fetch(`/api/monitor/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };

      if (!res.ok || !json.ok) {
        setError(json.error || "저장에 실패했습니다.");
        setSaving(false);
        return;
      }

      setSaveMessage("저장 완료");
      setForm((prev) => ({ ...prev, sessionCookie: "", apiKey: "" }));
      await load();
    } catch {
      setError("저장 API 호출 실패");
    } finally {
      setSaving(false);
    }
  }

  async function handleClaudeLogin() {
    setClaudeLogging(true);
    setSaveMessage(null);
    setError(null);

    try {
      const res = await fetch(`/api/monitor/accounts/${id}/claude-login`, {
        method: "POST",
        signal: AbortSignal.timeout(200_000),
      });
      const json = (await res.json()) as { ok: boolean; account?: PublicMonitorAccount; error?: string; message?: string };
      if (!res.ok || !json.ok) {
        setError(json.error || "브라우저 로그인 실패");
        if (json.account) setAccount(json.account);
        return;
      }

      setSaveMessage(json.message || "로그인 성공");
      if (json.account) setAccount(json.account);
      await load();
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        setError("로그인 시간 초과. 다시 시도해 주세요.");
      } else {
        setError("브라우저 로그인 API 호출 실패");
      }
    } finally {
      setClaudeLogging(false);
    }
  }

  async function handleTestConnection() {
    setConnecting(true);
    setSaveMessage(null);
    setError(null);

    try {
      const res = await fetch(`/api/monitor/accounts/${id}/connect`, {
        method: "POST",
      });
      const json = (await res.json()) as { ok: boolean; account?: PublicMonitorAccount; error?: string; message?: string };
      if (!res.ok || !json.ok) {
        setError(json.error || "연결 테스트 실패");
        if (json.account) {
          setAccount(json.account);
        }
        return;
      }

      setSaveMessage(json.message || "연결 성공");
      if (json.account) {
        setAccount(json.account);
      }
      await load();
    } catch {
      setError("연결 테스트 API 호출 실패");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-200 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-black text-slate-900">{title}</h1>
            <p className="text-sm text-slate-600 font-medium">계정 단일 사용량 화면</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/monitor/accounts" className="rounded-lg bg-slate-200 text-slate-800 px-3 py-2 text-sm font-bold">계정 목록</Link>
            <Link href="/monitor" className="rounded-lg bg-slate-900 text-white px-3 py-2 text-sm font-bold">대시보드</Link>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 flex items-center gap-2">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => setRange(opt)}
              className={`rounded-lg px-3 py-2 text-sm font-bold ${range === opt ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              {opt === "day" ? "24시간" : opt === "week" ? "7일" : "30일"}
            </button>
          ))}
          <button onClick={() => void load()} className="ml-auto rounded-lg bg-slate-900 text-white px-3 py-2 text-sm font-bold">새로고침</button>
        </div>

        {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-3 font-bold">{error}</div>}
        {saveMessage && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3 font-bold">{saveMessage}</div>}

        <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3">
          <h2 className="text-lg font-black text-slate-900">계정 설정</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm font-bold text-slate-700">
              이름
              <input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm font-bold text-slate-700">
              Provider
              <select
                value={form.provider}
                onChange={(e) => setForm((prev) => ({ ...prev, provider: e.target.value as ProviderType }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="claude">Claude</option>
                <option value="openai">OpenAI</option>
              </select>
            </label>

            {form.provider === "claude" && (
              <div className="md:col-span-2 space-y-3">
                <div className="rounded-lg bg-violet-50 border border-violet-200 px-3 py-3 space-y-2">
                  <p className="text-sm font-black text-violet-900">브라우저 로그인 (권장)</p>
                  <p className="text-xs text-violet-700 font-medium">
                    버튼을 누르면 브라우저가 열립니다. claude.ai에 로그인하면 쿠키가 자동으로 저장됩니다.
                  </p>
                  <button
                    onClick={() => void handleClaudeLogin()}
                    disabled={claudeLogging}
                    className="rounded-lg bg-violet-600 text-white px-4 py-2 font-black text-sm disabled:opacity-60"
                  >
                    {claudeLogging ? "브라우저에서 로그인 중... (최대 3분)" : "Claude 로그인"}
                  </button>
                </div>
                <details className="group">
                  <summary className="text-xs font-bold text-slate-500 cursor-pointer hover:text-slate-700">
                    수동 입력 (브라우저 로그인이 안 될 때)
                  </summary>
                  <div className="mt-2 space-y-1">
                    <input
                      type="password"
                      value={form.sessionCookie}
                      onChange={(e) => setForm((prev) => ({ ...prev, sessionCookie: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder={account?.sessionCookieMasked ? `현재: ${account.sessionCookieMasked}` : "sessionKey=sk-ant-sid01-..."}
                    />
                    <p className="text-xs text-slate-500 font-medium">
                      F12 → Application → Cookies → claude.ai → <code className="bg-slate-100 px-1 rounded">sessionKey</code> 값 복사
                    </p>
                  </div>
                </details>
              </div>
            )}

            {form.provider === "openai" && (
              <>
                <label className="text-sm font-bold text-slate-700">
                  Admin API Key (입력 시 갱신)
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    placeholder={account?.apiKeyMasked ? `현재: ${account.apiKeyMasked}` : "sk-admin-..."}
                  />
                </label>
                <label className="text-sm font-bold text-slate-700">
                  Organization ID
                  <input
                    value={form.organizationId}
                    onChange={(e) => setForm((prev) => ({ ...prev, organizationId: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    placeholder="org-..."
                  />
                </label>
              </>
            )}
          </div>

          {form.provider === "claude" && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 space-y-1">
              <p>현재 쿠키: {account?.sessionCookieMasked || "(없음)"}</p>
            </div>
          )}
          {form.provider === "openai" && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 space-y-1">
              <p>현재 키: {account?.apiKeyMasked || "(없음)"}</p>
              <p>Organization: {account?.organizationId || "(없음)"}</p>
            </div>
          )}

          <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            계정 활성화
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => void saveAccount()}
              disabled={saving}
              className="rounded-lg bg-blue-600 text-white px-4 py-2 font-black text-sm disabled:opacity-60"
            >
              {saving ? "저장 중..." : "설정 저장"}
            </button>
            <button
              onClick={() => void handleTestConnection()}
              disabled={connecting}
              className="rounded-lg bg-emerald-600 text-white px-4 py-2 font-black text-sm disabled:opacity-60"
            >
              {connecting ? "테스트 중..." : "연결 테스트"}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center font-bold">불러오는 중...</div>
        ) : report && (
          <>
            {/* Claude: 사용량 utilization 표시 */}
            {report.provider === "claude" ? (
              <>
                <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-4">
                  <h2 className="text-lg font-black text-slate-900">사용량 (Rate Limit)</h2>
                  {!report.claudeUsage || report.claudeUsage.windows.length === 0 ? (
                    <p className="text-sm text-slate-500 font-semibold">
                      {report.status === "disabled" ? "계정이 비활성화되어 있습니다." : report.status === "not_configured" ? "세션 쿠키가 설정되지 않았습니다." : "사용량 데이터가 없습니다."}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {report.claudeUsage.windows.map((win) => (
                        <UtilizationBar key={win.label} window={win} />
                      ))}
                    </div>
                  )}
                </div>

                {report.claudeUsage?.extraUsage && report.claudeUsage.extraUsage.enabled && (
                  <div className="bg-white rounded-2xl p-4 border border-slate-200">
                    <h2 className="text-lg font-black text-slate-900 mb-2">추가 사용량</h2>
                    <p className="text-sm font-semibold text-slate-700">
                      사용: ${report.claudeUsage.extraUsage.usedCredits.toFixed(2)}
                      {report.claudeUsage.extraUsage.monthlyLimit != null && (
                        <span className="text-slate-500"> / ${report.claudeUsage.extraUsage.monthlyLimit.toFixed(2)} 한도</span>
                      )}
                    </p>
                  </div>
                )}

                {report.claudeUsage?.billing && (
                  <div className="bg-white rounded-2xl p-4 border border-slate-200">
                    <h2 className="text-lg font-black text-slate-900 mb-2">구독 정보</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-xs font-bold text-slate-500">상태</p>
                        <p className="font-black text-slate-900 capitalize">{report.claudeUsage.billing.status}</p>
                      </div>
                      {report.claudeUsage.billing.nextChargeDate && (
                        <div>
                          <p className="text-xs font-bold text-slate-500">다음 결제일</p>
                          <p className="font-black text-slate-900">{report.claudeUsage.billing.nextChargeDate}</p>
                        </div>
                      )}
                      {report.claudeUsage.billing.interval && (
                        <div>
                          <p className="text-xs font-bold text-slate-500">결제 주기</p>
                          <p className="font-black text-slate-900 capitalize">{report.claudeUsage.billing.interval}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* OpenAI: 기존 비용/토큰 표시 */
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Tile label="비용(USD)" value={`$${report.costUsd.toFixed(2)}`} />
                  <Tile label="요청 수" value={report.requests.toLocaleString()} />
                  <Tile label="토큰" value={report.tokens.toLocaleString()} />
                </div>

                <div className="bg-white rounded-2xl p-4 border border-slate-200">
                  <h2 className="text-lg font-black text-slate-900 mb-3">일자별 사용량</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-slate-500">
                          <th className="py-2">날짜</th>
                          <th className="py-2">비용</th>
                          <th className="py-2">요청</th>
                          <th className="py-2">토큰</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.points.map((point) => (
                          <tr key={point.date} className="border-t border-slate-100">
                            <td className="py-2 font-semibold text-slate-700">{point.date}</td>
                            <td className="py-2">${point.costUsd.toFixed(2)}</td>
                            <td className="py-2">{point.requests.toLocaleString()}</td>
                            <td className="py-2">{point.tokens.toLocaleString()}</td>
                          </tr>
                        ))}
                        {report.points.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-6 text-center text-slate-500 font-semibold">표시할 데이터가 없습니다.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
            {report.error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-3 text-xs font-bold">오류: {report.error}</div>}
          </>
        )}
      </div>
    </main>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="text-xl font-black text-slate-900 mt-1">{value}</p>
    </div>
  );
}

function UtilizationBar({ window: win }: { window: ClaudeUtilizationWindow }) {
  // Claude API returns utilization as 0–100 percentage directly
  const pct = Math.min(Math.round(win.utilization), 100);
  const barColor = pct >= 80 ? "bg-rose-500" : pct >= 50 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-bold text-slate-700">{win.label}</span>
        <span className="text-sm font-black text-slate-900">{pct}%</span>
      </div>
      <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
      {win.resetsAt && (
        <p className="text-xs text-slate-500 mt-0.5">리셋: {new Date(win.resetsAt).toLocaleString("ko-KR")}</p>
      )}
    </div>
  );
}
