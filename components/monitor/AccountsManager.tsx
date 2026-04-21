"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import type { ProviderType, PublicMonitorAccount } from "@/lib/usage-monitor/types";
import { useTranslation } from "@/lib/i18n/context";
import LanguageSelector from "./LanguageSelector";
import ThemeToggle from "./ThemeToggle";
import { ToggleSwitch, brandVar } from "./shared";

interface AccountsResponse {
  ok: boolean;
  maxAccounts: number;
  accounts: PublicMonitorAccount[];
  error?: string;
}

interface CliProxyCandidate {
  provider: ProviderType;
  syncSource: string;
  sourcePath: string;
  fileName: string;
  displayName: string;
  email: string;
  sourceAccountId?: string;
  sourceExpiresAt?: string;
  disabled: boolean;
  planType?: string | null;
  imported: boolean;
  existingAccountId?: string | null;
}

export default function AccountsManager() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;

  const [accounts, setAccounts] = useState<PublicMonitorAccount[]>([]);
  const [maxAccounts, setMaxAccounts] = useState(12);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cliproxyCandidates, setCliProxyCandidates] = useState<CliProxyCandidate[]>([]);
  const [loadingCliProxy, setLoadingCliProxy] = useState(false);
  const [importingPath, setImportingPath] = useState<string | null>(null);
  const [newAccount, setNewAccount] = useState({ name: "", enabled: false, sessionCookie: "" });

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/monitor/accounts", { cache: "no-store" });
      const json = (await response.json()) as AccountsResponse;
      if (!response.ok || !json.ok) {
        setError(json.error || tRef.current("accounts.loadError"));
        return;
      }
      setAccounts(json.accounts);
      setMaxAccounts(json.maxAccounts);
    } catch (loadError) {
      console.error(loadError);
      setError(tRef.current("accounts.apiCallError"));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCliProxyCandidates = useCallback(async () => {
    setLoadingCliProxy(true);
    try {
      const response = await fetch("/api/monitor/auth-sources/cliproxy", { cache: "no-store" });
      const json = (await response.json()) as { ok: boolean; candidates?: CliProxyCandidate[]; error?: string };
      if (!response.ok || !json.ok) {
        setError(json.error || "Failed to load CLIProxyAPI auth sources.");
        return;
      }
      setCliProxyCandidates(json.candidates || []);
    } catch (loadError) {
      console.error(loadError);
      setError("Failed to load CLIProxyAPI auth sources.");
    } finally {
      setLoadingCliProxy(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
    void loadCliProxyCandidates();
  }, [loadAccounts, loadCliProxyCandidates]);

  async function addAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const payload: Record<string, unknown> = {
      name: newAccount.name,
      provider: "claude",
      enabled: newAccount.enabled,
    };
    if (newAccount.sessionCookie.trim()) {
      payload.sessionCookie = newAccount.sessionCookie.trim();
    }

    const response = await fetch("/api/monitor/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await response.json()) as { ok: boolean; accounts?: PublicMonitorAccount[]; error?: string };
    if (!response.ok || !json.ok) {
      setError(json.error || t("accounts.addError"));
      return;
    }
    setNewAccount({ name: "", enabled: false, sessionCookie: "" });
    setAccounts(json.accounts || []);
  }

  async function patchAccount(id: string, payload: Record<string, unknown>) {
    setError(null);
    const response = await fetch(`/api/monitor/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await response.json()) as { ok: boolean; accounts?: PublicMonitorAccount[]; error?: string };
    if (!response.ok || !json.ok) {
      setError(json.error || t("accounts.patchError"));
      return;
    }
    setAccounts(json.accounts || []);
  }

  async function deleteAccount(id: string) {
    setError(null);
    const response = await fetch(`/api/monitor/accounts/${id}`, { method: "DELETE" });
    const json = (await response.json()) as { ok: boolean; accounts?: PublicMonitorAccount[]; error?: string };
    if (!response.ok || !json.ok) {
      setError(json.error || t("accounts.deleteError"));
      return;
    }
    setAccounts(json.accounts || []);
    await loadCliProxyCandidates();
  }

  async function moveAccount(index: number, direction: "up" | "down") {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= accounts.length) return;
    const ids = accounts.map((account) => account.id);
    [ids[index], ids[newIndex]] = [ids[newIndex], ids[index]];
    setError(null);

    const response = await fetch("/api/monitor/accounts/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: ids }),
    });
    const json = (await response.json()) as { ok: boolean; accounts?: PublicMonitorAccount[]; error?: string };
    if (!response.ok || !json.ok) {
      setError(json.error || t("accounts.reorderError"));
      return;
    }
    setAccounts(json.accounts || []);
  }

  async function importCliProxyCandidate(sourcePath: string) {
    setImportingPath(sourcePath);
    setError(null);
    try {
      const response = await fetch("/api/monitor/accounts/import-cliproxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath }),
      });
      const json = (await response.json()) as { ok: boolean; accounts?: PublicMonitorAccount[]; error?: string };
      if (!response.ok || !json.ok) {
        setError(json.error || "Failed to import CLIProxyAPI account.");
        return;
      }
      if (json.accounts) {
        setAccounts(json.accounts);
      }
      await loadCliProxyCandidates();
    } catch (loadError) {
      console.error(loadError);
      setError("Failed to import CLIProxyAPI account.");
    } finally {
      setImportingPath(null);
    }
  }

  const claudeAccounts = accounts.filter((account) => account.provider === "claude");
  const openaiAccounts = accounts.filter((account) => account.provider === "openai");
  const cliproxyOpenAI = cliproxyCandidates.filter((candidate) => candidate.provider === "openai");
  const cliproxyClaude = cliproxyCandidates.filter((candidate) => candidate.provider === "claude");
  const countUnit = t("countUnit");

  return (
    <main className="min-h-screen surface-page">
      <div className="max-w-6xl mx-auto px-4 py-5 space-y-4">
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
            <Link
              href="/monitor"
              className="px-3 py-2 rounded-xl text-base font-bold text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--surface-raised)] transition-all"
            >
              {t("dashboard")}
            </Link>
          </div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-xl p-4 font-bold text-base text-rose-400 flex items-center gap-2"
              style={{ background: "var(--error-bg)", borderColor: "var(--error-border)", border: "1px solid" }}
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={addAccount} className="glass-card rounded-2xl p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-black text-[var(--text-heading)]">{t("accounts.addAccount")}</h2>
              <p className="text-sm text-[var(--text-muted)]">Manual add is Claude-only. OpenAI accounts must be imported from the CLIProxyAPI auth store.</p>
            </div>
            <span
              className="rounded-full px-3 py-1 text-sm font-bold text-white"
              style={{ backgroundColor: brandVar("claude") }}
            >
              Claude
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              value={newAccount.name}
              onChange={(event) => setNewAccount((prev) => ({ ...prev, name: event.target.value }))}
              placeholder={t("accounts.accountName")}
              className="surface-input rounded-xl px-3 py-2.5 text-base border"
            />
            <div className="flex items-center gap-2 surface-input rounded-xl px-3 py-2.5 border">
              <ToggleSwitch
                checked={newAccount.enabled}
                onChange={(value) => setNewAccount((prev) => ({ ...prev, enabled: value }))}
                color={brandVar("claude")}
                label={t("enabled")}
              />
              <span className="text-base font-bold text-[var(--text-secondary)]">{t("enabled")}</span>
            </div>
            <input
              value={newAccount.sessionCookie}
              onChange={(event) => setNewAccount((prev) => ({ ...prev, sessionCookie: event.target.value }))}
              placeholder="sessionKey=sk-ant-sid01-..."
              className="surface-input rounded-xl px-3 py-2.5 text-base border"
            />
          </div>

          <p className="text-sm text-[var(--text-muted)]">{t("accounts.cookieNote")}</p>
          <button
            type="submit"
            disabled={accounts.length >= maxAccounts}
            className="w-full rounded-xl text-white font-black py-2.5 text-base disabled:opacity-30"
            style={{ background: `linear-gradient(to right, ${brandVar("claude")}, var(--brand-claude-light))` }}
          >
            {t("accounts.addAccount")}
          </button>
        </form>

        <div className="glass-card rounded-2xl p-5 space-y-3.5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-[var(--text-heading)]">Import from CLIProxyAPI auth store</h2>
              <p className="text-sm text-[var(--text-muted)]">Reads server-local accounts from ~/.cli-proxy-api and imports them as file-backed sources.</p>
            </div>
            <button
              type="button"
              onClick={() => void loadCliProxyCandidates()}
              disabled={loadingCliProxy}
              className="rounded-lg border border-[var(--border-card)] px-3 py-1.5 text-sm font-bold text-[var(--text-secondary)] disabled:opacity-40"
            >
              {loadingCliProxy ? t("loading") : "Refresh"}
            </button>
          </div>

          {[{ title: "OpenAI / Codex", items: cliproxyOpenAI }, { title: "Claude", items: cliproxyClaude }].map((group) => (
            <div key={group.title} className="space-y-2">
              <div className="text-sm font-black text-[var(--text-heading)]">{group.title}</div>
              {group.items.length === 0 ? (
                <div className="rounded-xl bg-[var(--surface-raised)] px-3 py-3 text-sm text-[var(--text-muted)]">No detected accounts.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {group.items.map((candidate) => (
                    <div key={candidate.sourcePath} className="rounded-xl border border-[var(--border-card)] bg-[var(--surface-raised)] px-4 py-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-base text-[var(--text-heading)] truncate">{candidate.displayName}</p>
                          <p className="text-xs text-[var(--text-dim)] truncate">{candidate.fileName}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void importCliProxyCandidate(candidate.sourcePath)}
                          disabled={candidate.imported || importingPath === candidate.sourcePath}
                          className="rounded-lg px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40"
                          style={{ backgroundColor: brandVar(candidate.provider) }}
                        >
                          {candidate.imported ? "Imported" : importingPath === candidate.sourcePath ? "Importing..." : "Import"}
                        </button>
                      </div>
                      <p className="text-sm text-[var(--text-muted)] truncate">{candidate.email}</p>
                      {candidate.sourceAccountId && <p className="text-xs text-[var(--text-dim)] truncate">Account ID: {candidate.sourceAccountId}</p>}
                      {candidate.planType && <p className="text-xs text-[var(--text-dim)] truncate">Plan: {candidate.planType}</p>}
                      {candidate.sourceExpiresAt && <p className="text-xs text-[var(--text-dim)] truncate">Expires: {candidate.sourceExpiresAt}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

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
                  {claudeAccounts.map((account) => {
                    const index = accounts.indexOf(account);
                    return <AccCard key={account.id} account={account} idx={index} total={accounts.length} onMove={moveAccount} onPatch={patchAccount} onDelete={deleteAccount} />;
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
                  {openaiAccounts.map((account) => {
                    const index = accounts.indexOf(account);
                    return <AccCard key={account.id} account={account} idx={index} total={accounts.length} onMove={moveAccount} onPatch={patchAccount} onDelete={deleteAccount} />;
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

function AccCard({
  account,
  idx,
  total,
  onMove,
  onPatch,
  onDelete,
}: {
  account: PublicMonitorAccount;
  idx: number;
  total: number;
  onMove: (index: number, direction: "up" | "down") => void;
  onPatch: (id: string, payload: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const brand = brandVar(account.provider);
  const credentialLabel = account.provider === "claude"
    ? `${t("accounts.cookie")}: ${account.sessionCookieMasked || t("accounts.none")}`
    : `Auth: ${account.authIdentity || account.sourcePath || t("accounts.none")}`;

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-lg text-[var(--text-heading)] truncate">{account.name}</p>
          <p className="text-sm text-[var(--text-muted)] mt-0.5 truncate">{credentialLabel}</p>
          {account.sourceAccountId && <p className="text-xs text-[var(--text-dim)] truncate">Account ID: {account.sourceAccountId}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex flex-col gap-0.5">
            <button onClick={() => void onMove(idx, "up")} disabled={idx === 0} className="rounded bg-[var(--surface-raised)] text-[var(--text-muted)] px-1.5 py-0.5 text-xs font-bold disabled:opacity-20">▲</button>
            <button onClick={() => void onMove(idx, "down")} disabled={idx === total - 1} className="rounded bg-[var(--surface-raised)] text-[var(--text-muted)] px-1.5 py-0.5 text-xs font-bold disabled:opacity-20">▼</button>
          </div>
          <ToggleSwitch checked={account.enabled} onChange={(value) => void onPatch(account.id, { enabled: value })} color={brand} label={t("enabled")} />
        </div>
      </div>
      <div className="mt-2.5 flex gap-2">
        <Link
          href={`/monitor/accounts/${account.id}`}
          className="rounded-lg border border-[var(--border-card)] px-3 py-1.5 text-sm font-bold transition-all hover:border-[var(--border-hover)]"
          style={{ color: brand }}
        >
          {t("detail")}
        </Link>
        <button
          onClick={() => { if (window.confirm(t("accounts.confirmDelete"))) void onDelete(account.id); }}
          className="rounded-lg border border-[var(--border-card)] px-3 py-1.5 text-sm font-bold text-rose-400 hover:bg-[var(--error-bg)] transition-all"
        >
          {t("delete")}
        </button>
      </div>
    </div>
  );
}
