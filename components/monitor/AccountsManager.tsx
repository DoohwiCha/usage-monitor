"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProviderType, PublicMonitorAccount } from "@/lib/usage-monitor/types";

interface AccountsResponse {
  ok: boolean;
  maxAccounts: number;
  accounts: PublicMonitorAccount[];
  error?: string;
}

const providers: ProviderType[] = ["claude", "openai"];


export default function AccountsManager() {
  const [accounts, setAccounts] = useState<PublicMonitorAccount[]>([]);
  const [maxAccounts, setMaxAccounts] = useState(12);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newAccount, setNewAccount] = useState({
    name: "",
    provider: "claude" as ProviderType,
    enabled: false,
    sessionCookie: "",
    apiKey: "",
    organizationId: "",
  });

  async function loadAccounts() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/monitor/accounts", { cache: "no-store" });
      const json = (await res.json()) as AccountsResponse;
      if (!res.ok || !json.ok) {
        setError(json.error || "계정을 불러오지 못했습니다.");
        setLoading(false);
        return;
      }
      setAccounts(json.accounts);
      setMaxAccounts(json.maxAccounts);
    } catch {
      setError("계정 API 호출 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAccounts();
  }, []);

  async function addAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const payload: Record<string, unknown> = {
      name: newAccount.name,
      provider: newAccount.provider,
      enabled: newAccount.enabled,
    };

    if (newAccount.provider === "claude") {
      payload.sessionCookie = newAccount.sessionCookie;
    } else {
      payload.apiKey = newAccount.apiKey;
      payload.organizationId = newAccount.organizationId;
    }

    const res = await fetch("/api/monitor/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { ok: boolean; accounts?: PublicMonitorAccount[]; error?: string };

    if (!res.ok || !json.ok) {
      setError(json.error || "계정 추가 실패");
      return;
    }

    setNewAccount({
      name: "",
      provider: "claude",
      enabled: false,
      sessionCookie: "",
      apiKey: "",
      organizationId: "",
    });
    setAccounts(json.accounts || []);
  }

  async function patchAccount(id: string, payload: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/monitor/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { ok: boolean; accounts?: PublicMonitorAccount[]; error?: string };

    if (!res.ok || !json.ok) {
      setError(json.error || "계정 수정 실패");
      return;
    }

    setAccounts(json.accounts || []);
  }

  async function deleteAccount(id: string) {
    setError(null);
    const res = await fetch(`/api/monitor/accounts/${id}`, { method: "DELETE" });
    const json = (await res.json()) as { ok: boolean; accounts?: PublicMonitorAccount[]; error?: string };

    if (!res.ok || !json.ok) {
      setError(json.error || "계정 삭제 실패");
      return;
    }

    setAccounts(json.accounts || []);
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-5">
        <div className="bg-white rounded-2xl p-4 border border-slate-200 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-black text-slate-900">계정 관리</h1>
            <p className="text-sm font-medium text-slate-600">최대 {maxAccounts}개</p>
          </div>
          <Link href="/monitor" className="rounded-xl bg-slate-900 text-white px-3 py-2 font-bold text-sm">대시보드</Link>
        </div>

        {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-3 font-bold">{error}</div>}

        <form onSubmit={addAccount} className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3">
          <h2 className="text-lg font-black text-slate-900">계정 추가</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <input
              value={newAccount.name}
              onChange={(e) => setNewAccount((p) => ({ ...p, name: e.target.value }))}
              placeholder="계정 이름"
              className="rounded-xl border border-slate-300 px-3 py-2"
            />
            <select
              value={newAccount.provider}
              onChange={(e) => setNewAccount((p) => ({ ...p, provider: e.target.value as ProviderType }))}
              className="rounded-xl border border-slate-300 px-3 py-2"
            >
              {providers.map((provider) => <option key={provider} value={provider}>{provider === "claude" ? "Claude" : "OpenAI"}</option>)}
            </select>
            <label className="rounded-xl border border-slate-300 px-3 py-2 flex items-center gap-2 text-sm font-bold text-slate-700">
              <input
                type="checkbox"
                checked={newAccount.enabled}
                onChange={(e) => setNewAccount((p) => ({ ...p, enabled: e.target.checked }))}
              />
              활성화
            </label>

            {newAccount.provider === "claude" && (
              <div className="lg:col-span-3 md:col-span-2">
                <p className="text-xs font-medium text-slate-500">
                  계정 추가 후 상세 페이지에서 "Claude 로그인" 버튼으로 쿠키를 자동 설정합니다.
                </p>
              </div>
            )}

            {newAccount.provider === "openai" && (
              <>
                <input
                  value={newAccount.apiKey}
                  onChange={(e) => setNewAccount((p) => ({ ...p, apiKey: e.target.value }))}
                  placeholder="Admin API Key (sk-admin-...)"
                  className="rounded-xl border border-slate-300 px-3 py-2"
                />
                <input
                  value={newAccount.organizationId}
                  onChange={(e) => setNewAccount((p) => ({ ...p, organizationId: e.target.value }))}
                  placeholder="Organization ID (org-...)"
                  className="rounded-xl border border-slate-300 px-3 py-2"
                />
              </>
            )}
          </div>
          <button
            type="submit"
            disabled={accounts.length >= maxAccounts}
            className="w-full rounded-xl bg-blue-600 text-white font-black py-2.5 disabled:opacity-50"
          >
            계정 추가
          </button>
        </form>

        {loading ? (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 text-center font-bold">불러오는 중...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {accounts.length === 0 && (
              <div className="md:col-span-2 bg-white rounded-2xl p-6 border border-slate-200 text-center font-semibold text-slate-500">
                등록된 계정이 없습니다. 위에서 계정을 추가해 주세요.
              </div>
            )}
            {accounts.map((account) => (
              <div key={account.id} className="bg-white rounded-2xl p-4 border border-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-black text-slate-900">{account.name}</p>
                    <p className="text-xs font-semibold text-slate-500 uppercase">{account.provider === "claude" ? "Claude" : "OpenAI"}</p>
                  </div>
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={account.enabled}
                      onChange={(e) => void patchAccount(account.id, { enabled: e.target.checked })}
                    />
                    활성화
                  </label>
                </div>
                <p className="mt-2 text-xs font-medium text-slate-600">
                  {account.provider === "claude"
                    ? `쿠키: ${account.sessionCookieMasked || "(없음)"}`
                    : `키: ${account.apiKeyMasked || "(없음)"}`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/monitor/accounts/${account.id}`} className="rounded-lg bg-slate-900 text-white px-2.5 py-1.5 text-xs font-bold">상세</Link>
                  <button onClick={() => void deleteAccount(account.id)} className="rounded-lg bg-rose-100 text-rose-700 px-2.5 py-1.5 text-xs font-bold">삭제</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
