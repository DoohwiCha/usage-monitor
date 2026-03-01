"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountUsageReport, RangePreset, UsageOverviewResponse } from "@/lib/usage-monitor/types";

const RANGE_OPTIONS: Array<{ value: RangePreset; label: string }> = [
  { value: "day", label: "최근 24시간" },
  { value: "week", label: "최근 7일" },
  { value: "month", label: "최근 30일" },
];

function statusBadge(status: AccountUsageReport["status"]): string {
  if (status === "ok") return "bg-emerald-100 text-emerald-800";
  if (status === "disabled") return "bg-slate-200 text-slate-700";
  if (status === "not_configured") return "bg-amber-100 text-amber-800";
  return "bg-rose-100 text-rose-700";
}

function statusLabel(status: AccountUsageReport["status"]): string {
  if (status === "ok") return "정상";
  if (status === "disabled") return "비활성";
  if (status === "not_configured") return "미설정";
  return "오류";
}

function providerLabel(provider: string): string {
  if (provider === "claude") return "Claude";
  if (provider === "openai") return "OpenAI";
  return provider;
}

export default function MonitorDashboard({ username }: { username: string }) {
  const router = useRouter();
  const [range, setRange] = useState<RangePreset>("week");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UsageOverviewResponse | null>(null);

  const loadUsage = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/monitor/usage?range=${range}`, { cache: "no-store" });
      const json = (await response.json()) as { ok: boolean; error?: string } & Partial<UsageOverviewResponse>;

      if (!response.ok || !json.ok) {
        setError(json.error || "사용량을 불러오지 못했습니다.");
        setLoading(false);
        return;
      }

      setData(json as UsageOverviewResponse);
    } catch {
      setError("사용량 API 호출에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadUsage();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadUsage]);

  const sortedAccounts = useMemo(() => {
    if (!data) return [];
    return [...data.accounts].sort((a, b) => {
      if (a.status === "ok" && b.status !== "ok") return -1;
      if (a.status !== "ok" && b.status === "ok") return 1;
      return b.costUsd - a.costUsd;
    });
  }, [data]);

  async function handleLogout() {
    await fetch("/api/monitor/auth/logout", { method: "POST" });
    router.replace("/monitor/login");
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-5">
        <div className="bg-white rounded-2xl p-4 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-900">사용량 대시보드</h1>
            <p className="text-sm font-medium text-slate-600">로그인 사용자: {username}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/monitor/accounts" className="rounded-xl bg-slate-900 text-white px-3 py-2 font-bold text-sm">계정 관리</Link>
            <button onClick={handleLogout} className="rounded-xl bg-slate-200 text-slate-800 px-3 py-2 font-bold text-sm">로그아웃</button>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRange(opt.value)}
                className={`px-3 py-2 rounded-lg text-sm font-bold ${range === opt.value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button onClick={() => void loadUsage()} className="px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-bold">
            새로고침
          </button>
        </div>

        {error && (
          <div className="bg-rose-50 text-rose-700 font-bold border border-rose-200 rounded-2xl p-3">
            {error}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-2xl p-8 border border-slate-200 text-center font-bold text-slate-700">불러오는 중...</div>
        ) : data && (
          <>
            <div className="bg-white rounded-2xl p-4 border border-slate-200">
              <h2 className="text-lg font-black text-slate-900 mb-3">총 사용량 현황</h2>
              <ProviderSummary accounts={sortedAccounts} />
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-200">
              <h2 className="text-lg font-black text-slate-900 mb-3">계정별 현황</h2>
              {sortedAccounts.length === 0 && (
                <p className="text-center text-slate-500 font-semibold py-6">등록된 계정이 없습니다.</p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {sortedAccounts.map((account) => (
                  <div key={account.accountId} className="rounded-xl border border-slate-200 p-3 bg-slate-50">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-black text-slate-900">{account.name}</p>
                        <p className="text-xs font-semibold text-slate-600">{providerLabel(account.provider)}</p>
                      </div>
                      <span className={`text-xs font-black px-2 py-1 rounded-full ${statusBadge(account.status)}`}>
                        {statusLabel(account.status)}
                      </span>
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-700 space-y-0.5">
                      {account.provider === "claude" ? (
                        account.claudeUsage && account.claudeUsage.windows.length > 0 ? (
                          account.claudeUsage.windows.map((win) => {
                            const pct = Math.min(Math.round(win.utilization), 100);
                            return (
                              <div key={win.label} className="flex items-center gap-2">
                                <span className="text-xs w-20 shrink-0">{win.label}</span>
                                <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${pct >= 80 ? "bg-rose-500" : pct >= 50 ? "bg-amber-500" : "bg-emerald-500"}`}
                                    style={{ width: `${Math.max(pct, 1)}%` }}
                                  />
                                </div>
                                <span className="text-xs font-black w-10 text-right">{pct}%</span>
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-xs text-slate-500">사용량 없음</p>
                        )
                      ) : (
                        <>
                          <p>비용: ${account.costUsd.toFixed(2)}</p>
                          <p>요청: {account.requests.toLocaleString()}</p>
                          <p>토큰: {account.tokens.toLocaleString()}</p>
                        </>
                      )}
                    </div>
                    {account.error && <p className="mt-2 text-xs font-bold text-rose-600">{account.error}</p>}
                    <Link href={`/monitor/accounts/${account.accountId}`} className="mt-3 inline-block text-sm font-black text-blue-700">
                      상세 보기 →
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function ProviderSummary({ accounts }: { accounts: AccountUsageReport[] }) {
  const claudeAccounts = accounts.filter((a) => a.provider === "claude" && a.status === "ok");
  const openaiAccounts = accounts.filter((a) => a.provider === "openai" && a.status === "ok");

  // Claude: 윈도우별 평균 utilization
  const claudeWindowMap = new Map<string, number[]>();
  for (const acc of claudeAccounts) {
    for (const win of acc.claudeUsage?.windows || []) {
      const pct = Math.min(Math.round(win.utilization), 100);
      const list = claudeWindowMap.get(win.label) || [];
      list.push(pct);
      claudeWindowMap.set(win.label, list);
    }
  }

  const openaiTotalCost = openaiAccounts.reduce((s, a) => s + a.costUsd, 0);
  const openaiTotalTokens = openaiAccounts.reduce((s, a) => s + a.tokens, 0);
  const openaiTotalRequests = openaiAccounts.reduce((s, a) => s + a.requests, 0);

  if (claudeAccounts.length === 0 && openaiAccounts.length === 0) {
    return <p className="text-sm text-slate-500 font-semibold py-3">정상 계정이 없습니다.</p>;
  }

  return (
    <div className="space-y-4">
      {claudeAccounts.length > 0 && (
        <div>
          <p className="text-sm font-black text-violet-700 mb-2">Claude ({claudeAccounts.length}개 계정)</p>
          <div className="space-y-2">
            {Array.from(claudeWindowMap.entries()).map(([label, pcts]) => {
              const avg = Math.round(pcts.reduce((s, v) => s + v, 0) / pcts.length);
              return (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-600 w-24 shrink-0">{label}</span>
                  <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${avg >= 80 ? "bg-rose-500" : avg >= 50 ? "bg-amber-500" : "bg-emerald-500"}`}
                      style={{ width: `${Math.max(avg, 1)}%` }}
                    />
                  </div>
                  <span className="text-sm font-black w-12 text-right">{avg}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {openaiAccounts.length > 0 && (
        <div>
          <p className="text-sm font-black text-emerald-700 mb-2">OpenAI ({openaiAccounts.length}개 계정)</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="text-[10px] font-bold text-slate-500">비용</p>
              <p className="text-sm font-black text-slate-900">${openaiTotalCost.toFixed(2)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="text-[10px] font-bold text-slate-500">요청</p>
              <p className="text-sm font-black text-slate-900">{openaiTotalRequests.toLocaleString()}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <p className="text-[10px] font-bold text-slate-500">토큰</p>
              <p className="text-sm font-black text-slate-900">{openaiTotalTokens.toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
