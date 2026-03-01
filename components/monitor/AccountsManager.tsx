"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ProviderType, PublicMonitorAccount } from "@/lib/usage-monitor/types";
import ThemeToggle from "./ThemeToggle";
import { useTranslation } from "@/lib/i18n/context";
import LanguageSelector from "./LanguageSelector";

interface AccountsResponse {
  ok: boolean;
  maxAccounts: number;
  accounts: PublicMonitorAccount[];
  error?: string;
}

function brandVar(provider: string) {
  return provider === "claude" ? "var(--brand-claude)" : "var(--brand-openai)";
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

export default function AccountsManager() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<PublicMonitorAccount[]>([]);
  const [maxAccounts, setMaxAccounts] = useState(12);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newAccount, setNewAccount] = useState({ name: "", provider: "claude" as ProviderType, enabled: false, sessionCookie: "", apiKey: "", organizationId: "" });

  const loadAccounts = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/monitor/accounts", { cache: "no-store" });
      const json = (await res.json()) as AccountsResponse;
      if (!res.ok || !json.ok) { setError(json.error || t("accounts.loadError")); setLoading(false); return; }
      setAccounts(json.accounts); setMaxAccounts(json.maxAccounts);
    } catch (err) { console.error(err); setError(t("accounts.apiCallError")); } finally { setLoading(false); }
  }, [t]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  async function addAccount(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null);
    const payload: Record<string, unknown> = { name: newAccount.name, provider: newAccount.provider, enabled: newAccount.enabled };
    if (newAccount.provider === "claude") payload.sessionCookie = newAccount.sessionCookie;
    else { payload.apiKey = newAccount.apiKey; payload.organizationId = newAccount.organizationId; }
    const res = await fetch("/api/monitor/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const json = (await res.json()) as { ok: boolean; accounts?: PublicMonitorAccount[]; error?: string };
    if (!res.ok || !json.ok) { setError(json.error || t("accounts.addError")); return; }
    setNewAccount({ name: "", provider: "claude", enabled: false, sessionCookie: "", apiKey: "", organizationId: "" });
    setAccounts(json.accounts || []);
  }

  async function patchAccount(id: string, payload: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/monitor/accounts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const json = (await res.json()) as { ok: boolean; accounts?: PublicMonitorAccount[]; error?: string };
    if (!res.ok || !json.ok) { setError(json.error || t("accounts.patchError")); return; }
    setAccounts(json.accounts || []);
  }

  async function deleteAccount(id: string) {
    setError(null);
    const res = await fetch(`/api/monitor/accounts/${id}`, { method: "DELETE" });
    const json = (await res.json()) as { ok: boolean; accounts?: PublicMonitorAccount[]; error?: string };
    if (!res.ok || !json.ok) { setError(json.error || t("accounts.deleteError")); return; }
    setAccounts(json.accounts || []);
  }

  async function moveAccount(index: number, direction: "up" | "down") {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= accounts.length) return;
    const ids = accounts.map((a) => a.id);
    [ids[index], ids[newIndex]] = [ids[newIndex], ids[index]];
    setError(null);
    const res = await fetch("/api/monitor/accounts/reorder", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderedIds: ids }) });
    const json = (await res.json()) as { ok: boolean; accounts?: PublicMonitorAccount[]; error?: string };
    if (!res.ok || !json.ok) { setError(json.error || t("accounts.reorderError")); return; }
    setAccounts(json.accounts || []);
  }

  const claudeAccounts = accounts.filter((a) => a.provider === "claude");
  const openaiAccounts = accounts.filter((a) => a.provider === "openai");

  const countUnit = t("countUnit");

  return (
    <main className="min-h-screen surface-page">
      <div className="max-w-6xl mx-auto px-4 py-5 space-y-4">

        {/* Header */}
        <div className="glass-card rounded-2xl px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-black text-[var(--text-heading)]">{t("accountManage")}</h1>
            <span className="text-base font-bold text-[var(--text-muted)] bg-[var(--surface-raised)] px-2.5 py-1 rounded-full">
              {accounts.length}/{maxAccounts}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <LanguageSelector />
            <ThemeToggle />
            <Link href="/monitor" className="px-3 py-2 rounded-xl text-base font-bold text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--surface-raised)] transition-all">
              {t("dashboard")}
            </Link>
          </div>
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="rounded-xl p-4 font-bold text-base text-rose-400 flex items-center gap-2"
              style={{ background: "var(--error-bg)", borderColor: "var(--error-border)", border: "1px solid" }}>
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Add account form - compact */}
        <form onSubmit={addAccount} className="glass-card rounded-2xl p-5 space-y-3.5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-[var(--text-heading)]">{t("accounts.addAccount")}</h2>
            <div className="flex gap-1 p-0.5 bg-[var(--surface-input)] rounded-lg border border-[var(--border-input)]">
              {(["claude", "openai"] as const).map((p) => (
                <button key={p} type="button" onClick={() => setNewAccount((prev) => ({ ...prev, provider: p }))}
                  className="px-3 py-1.5 rounded-md text-base font-bold transition-all"
                  style={{ backgroundColor: newAccount.provider === p ? brandVar(p) : "transparent", color: newAccount.provider === p ? "white" : "var(--text-secondary)" }}>
                  {p === "claude" ? "Claude" : "OpenAI"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input value={newAccount.name} onChange={(e) => setNewAccount((p) => ({ ...p, name: e.target.value }))} placeholder={t("accounts.accountName")}
              className="surface-input rounded-xl px-3 py-2.5 text-base border" />
            <div className="flex items-center gap-2 surface-input rounded-xl px-3 py-2.5 border">
              <ToggleSwitch checked={newAccount.enabled} onChange={(v) => setNewAccount((p) => ({ ...p, enabled: v }))} color={brandVar(newAccount.provider)} />
              <span className="text-base font-bold text-[var(--text-secondary)]">{t("enabled")}</span>
            </div>
            {newAccount.provider === "openai" && (
              <input value={newAccount.apiKey} onChange={(e) => setNewAccount((p) => ({ ...p, apiKey: e.target.value }))} placeholder="Admin API Key (sk-admin-...)"
                className="surface-input rounded-xl px-3 py-2.5 text-base border" />
            )}
          </div>
          {newAccount.provider === "claude" && (
            <p className="text-sm text-[var(--text-muted)]">{t("accounts.cookieNote")}</p>
          )}
          <button type="submit" disabled={accounts.length >= maxAccounts}
            className="w-full rounded-xl text-white font-black py-2.5 text-base disabled:opacity-30"
            style={{ background: `linear-gradient(to right, ${brandVar(newAccount.provider)}, ${newAccount.provider === "claude" ? "var(--brand-claude-light)" : "var(--brand-openai-light)"})` }}>
            {t("accounts.addAccount")}
          </button>
        </form>

        {/* Account list - grouped */}
        {loading ? (
          <div className="glass-card rounded-xl p-8 text-center text-[var(--text-muted)] font-bold text-lg">{t("loading")}</div>
        ) : accounts.length === 0 ? (
          <div className="glass-card rounded-xl p-8 text-center">
            <p className="text-[var(--text-muted)] font-semibold text-lg">{t("noAccounts")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {claudeAccounts.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 px-1">
                  <div className="w-3 h-3 rounded-full bg-[var(--brand-claude)]" />
                  <span className="text-lg font-black" style={{ color: "var(--brand-claude)" }}>Claude</span>
                  <span className="text-base text-[var(--text-muted)]">{claudeAccounts.length}{countUnit ? countUnit : ""}</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: "color-mix(in srgb, var(--brand-claude) 20%, transparent)" }} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {claudeAccounts.map((acc) => {
                    const idx = accounts.indexOf(acc);
                    return <AccCard key={acc.id} account={acc} idx={idx} total={accounts.length} onMove={moveAccount} onPatch={patchAccount} onDelete={deleteAccount} />;
                  })}
                </div>
              </div>
            )}
            {openaiAccounts.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 px-1">
                  <div className="w-3 h-3 rounded-full bg-[var(--brand-openai)]" />
                  <span className="text-lg font-black" style={{ color: "var(--brand-openai)" }}>OpenAI</span>
                  <span className="text-base text-[var(--text-muted)]">{openaiAccounts.length}{countUnit ? countUnit : ""}</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: "color-mix(in srgb, var(--brand-openai) 20%, transparent)" }} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {openaiAccounts.map((acc) => {
                    const idx = accounts.indexOf(acc);
                    return <AccCard key={acc.id} account={acc} idx={idx} total={accounts.length} onMove={moveAccount} onPatch={patchAccount} onDelete={deleteAccount} />;
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function AccCard({ account, idx, total, onMove, onPatch, onDelete }: {
  account: PublicMonitorAccount; idx: number; total: number;
  onMove: (i: number, d: "up" | "down") => void;
  onPatch: (id: string, p: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const brand = brandVar(account.provider);
  const credentialLabel = account.provider === "claude"
    ? `${t("accounts.cookie")}: ${account.sessionCookieMasked || t("accounts.none")}`
    : `${t("accounts.key")}: ${account.apiKeyMasked || t("accounts.none")}`;
  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-lg text-[var(--text-heading)] truncate">{account.name}</p>
          <p className="text-sm text-[var(--text-muted)] mt-0.5 truncate">
            {credentialLabel}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex flex-col gap-0.5">
            <button onClick={() => void onMove(idx, "up")} disabled={idx === 0} className="rounded bg-[var(--surface-raised)] text-[var(--text-muted)] px-1.5 py-0.5 text-xs font-bold disabled:opacity-20">▲</button>
            <button onClick={() => void onMove(idx, "down")} disabled={idx === total - 1} className="rounded bg-[var(--surface-raised)] text-[var(--text-muted)] px-1.5 py-0.5 text-xs font-bold disabled:opacity-20">▼</button>
          </div>
          <ToggleSwitch checked={account.enabled} onChange={(v) => void onPatch(account.id, { enabled: v })} color={brand} />
        </div>
      </div>
      <div className="mt-2.5 flex gap-2">
        <Link href={`/monitor/accounts/${account.id}`} className="rounded-lg border border-[var(--border-card)] px-3 py-1.5 text-sm font-bold transition-all hover:border-[var(--border-hover)]" style={{ color: brand }}>{t("detail")}</Link>
        <button onClick={() => void onDelete(account.id)} className="rounded-lg border border-[var(--border-card)] px-3 py-1.5 text-sm font-bold text-rose-400 hover:bg-[var(--error-bg)] transition-all">{t("delete")}</button>
      </div>
    </div>
  );
}
