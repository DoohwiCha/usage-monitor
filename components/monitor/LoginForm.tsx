"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useTranslation } from "@/lib/i18n/context";
import LanguageSelector from "./LanguageSelector";
import { Spinner } from "./shared";

export default function LoginForm() {
  const router = useRouter();
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/monitor/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(data.error || t("login.failed"));
        setLoading(false);
        return;
      }

      router.replace("/monitor");
      router.refresh();
      // Reset loading in case navigation is slow
      setLoading(false);
    } catch {
      setError(t("login.networkError"));
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.25, 0.4, 0.25, 1] }}
      className="w-full max-w-md relative"
    >
      {/* Card with gradient top border */}
      <div className="relative rounded-2xl glass-card overflow-hidden">
        {/* Gradient top border */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[#D97757] via-[#E8956F] to-[#10A37F]" />

        {/* Language selector — absolute top-right of the card */}
        <div className="absolute top-4 right-4 z-10">
          <LanguageSelector />
        </div>

        <div className="px-8 pt-8 pb-8">
          {/* Brand */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#D97757] to-[#10A37F] flex items-center justify-center shadow-lg shadow-[#D97757]/30">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 2L14 5.5V10.5L8 14L2 10.5V5.5L8 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
                  <circle cx="8" cy="8" r="2" fill="white" />
                </svg>
              </div>
              <h1 className="text-3xl font-bold gradient-text-brand tracking-tight">
                {t("usageMonitor")}
              </h1>
            </div>
            <p className="text-lg text-[var(--text-muted)] leading-relaxed">
              {t("login.subtitle")}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="username"
                className="block text-base font-semibold text-[var(--text-secondary)] uppercase tracking-wider"
              >
                {t("login.username")}
              </label>
              <input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                className="w-full rounded-xl surface-input border border-[var(--border-input)] px-4 py-3.5 text-lg text-[var(--text-heading)] placeholder:text-[var(--text-dim)] font-medium input-focus-brand"
                placeholder={t("login.usernamePlaceholder")}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="block text-base font-semibold text-[var(--text-secondary)] uppercase tracking-wider"
              >
                {t("login.password")}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded-xl surface-input border border-[var(--border-input)] px-4 py-3.5 text-lg text-[var(--text-heading)] placeholder:text-[var(--text-dim)] font-medium input-focus-brand"
                placeholder="••••••••"
              />
            </div>

            {/* Error message */}
            {error && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl px-4 py-3 text-base font-medium text-rose-300 bg-rose-500/10 border border-rose-500/20 backdrop-blur-sm"
              >
                {error}
              </motion.div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-b from-[#D97757] to-[#C4603D] hover:from-[#E8956F] hover:to-[#D97757] text-white font-semibold py-3.5 text-lg shadow-lg shadow-[#D97757]/30 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 mt-2"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner className="w-4 h-4" />
                  {t("login.loggingIn")}
                </span>
              ) : (
                t("login")
              )}
            </button>
          </form>

          {/* Footer */}
          <p className="mt-6 text-center text-sm text-[var(--text-dim)]">
            {t("login.adminNote")}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
