"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "@/lib/i18n/context";
import { type TranslationKey } from "@/lib/i18n/translations";
import ThemeToggle from "@/components/monitor/ThemeToggle";
import LanguageSelector from "@/components/monitor/LanguageSelector";

const features: { titleKey: TranslationKey; descKey: TranslationKey; icon: ReactNode }[] = [
  {
    titleKey: "landing.feature1Title",
    descKey: "landing.feature1Desc",
    icon: (
      <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    titleKey: "landing.feature2Title",
    descKey: "landing.feature2Desc",
    icon: (
      <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    titleKey: "landing.feature3Title",
    descKey: "landing.feature3Desc",
    icon: (
      <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    titleKey: "landing.feature4Title",
    descKey: "landing.feature4Desc",
    icon: (
      <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    ),
  },
];

const techStack = [
  "Next.js 16", "React 19", "TypeScript", "Tailwind CSS", "Framer Motion",
];

export default function LandingPage() {
  const { t } = useTranslation();

  return (
    <main className="min-h-screen surface-page relative overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full blur-3xl" style={{ backgroundColor: "color-mix(in srgb, var(--brand-claude) 12%, transparent)" }} />
        <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full blur-3xl" style={{ backgroundColor: "color-mix(in srgb, var(--brand-openai) 10%, transparent)" }} />
      </div>

      {/* Nav */}
      <nav className="relative z-10 max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--brand-claude)] to-[var(--brand-openai)] flex items-center justify-center">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 5.5V10.5L8 14L2 10.5V5.5L8 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round" /><circle cx="8" cy="8" r="2" fill="white" /></svg>
          </div>
          <span className="text-xl font-black gradient-text-brand">Usage Monitor</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <LanguageSelector />
          <ThemeToggle />
          <Link href="/monitor/login" className="px-4 py-2 rounded-xl text-base font-bold text-white transition-all hover:opacity-90"
            style={{ background: "linear-gradient(to right, var(--brand-claude), var(--brand-openai))" }}>
            {t("login")}
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pt-16 pb-20 text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <h1 className="text-5xl md:text-6xl font-black gradient-text-brand leading-tight mb-6">
            {t("landing.hero")}
          </h1>
          <p className="text-xl md:text-2xl text-[var(--text-secondary)] max-w-2xl mx-auto mb-10 leading-relaxed">
            {t("landing.subtitle")}
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link href="/monitor/login" className="px-8 py-3.5 rounded-2xl text-lg font-black text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl"
              style={{ background: "linear-gradient(135deg, var(--brand-claude), var(--brand-claude-light), var(--brand-openai))" }}>
              {t("landing.getStarted")}
            </Link>
            <a href="https://github.com/DoohwiCha/usage-monitor" target="_blank" rel="noopener noreferrer"
              className="px-8 py-3.5 rounded-2xl text-lg font-bold border border-[var(--border-card)] text-[var(--text-body)] hover:border-[var(--border-hover)] hover:bg-[var(--surface-raised)] transition-all">
              {t("landing.viewGithub")}
            </a>
          </div>
        </motion.div>

        {/* Dashboard preview mockup */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-16 max-w-4xl mx-auto"
        >
          <div className="glass-card rounded-2xl p-6 md:p-8 border border-[var(--border-card)]">
            {/* Fake header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--brand-claude)] to-[var(--brand-openai)]" />
                <span className="text-2xl font-black gradient-text-brand">Usage Monitor</span>
              </div>
              <div className="flex gap-2">
                <div className="w-16 h-7 rounded-lg bg-[var(--surface-raised)]" />
                <div className="w-16 h-7 rounded-lg bg-[var(--surface-raised)]" />
              </div>
            </div>

            {/* Fake summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="rounded-xl p-4 border" style={{ borderColor: "color-mix(in srgb, var(--brand-claude) 25%, transparent)", background: "color-mix(in srgb, var(--brand-claude) 4%, transparent)" }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full bg-[var(--brand-claude)]" />
                  <span className="text-base font-black" style={{ color: "var(--brand-claude)" }}>Claude</span>
                </div>
                <div className="space-y-2">
                  {[["Opus", 72], ["Sonnet", 45], ["Haiku", 18]].map(([name, pct]) => (
                    <div key={name as string} className="flex items-center gap-2">
                      <span className="text-xs text-[var(--text-muted)] w-14">{name as string}</span>
                      <div className="flex-1 h-2 bg-[var(--surface-raised)] rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct as number}%`, background: `linear-gradient(to right, var(--brand-claude), var(--brand-claude-light))` }} />
                      </div>
                      <span className="text-xs font-bold text-[var(--text-body)] w-8 text-right">{pct as number}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl p-4 border" style={{ borderColor: "color-mix(in srgb, var(--brand-openai) 25%, transparent)", background: "color-mix(in srgb, var(--brand-openai) 4%, transparent)" }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full bg-[var(--brand-openai)]" />
                  <span className="text-base font-black" style={{ color: "var(--brand-openai)" }}>OpenAI</span>
                </div>
                <div className="space-y-2">
                  {[["GPT-4o", 56], ["o1", 23], ["o3", 8]].map(([name, pct]) => (
                    <div key={name as string} className="flex items-center gap-2">
                      <span className="text-xs text-[var(--text-muted)] w-14">{name as string}</span>
                      <div className="flex-1 h-2 bg-[var(--surface-raised)] rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct as number}%`, background: `linear-gradient(to right, var(--brand-openai), var(--brand-openai-light))` }} />
                      </div>
                      <span className="text-xs font-bold text-[var(--text-body)] w-8 text-right">{pct as number}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Fake account cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { name: "Team Claude Pro", provider: "claude", pct: 72, status: "ok" },
                { name: "Personal Account", provider: "openai", cost: "$12.40", status: "ok" },
                { name: "Research Lab", provider: "claude", pct: 45, status: "ok" },
              ].map((acc) => (
                <div key={acc.name} className="rounded-xl p-3 border border-[var(--border-card)]" style={{ borderLeftWidth: 2, borderLeftColor: acc.provider === "claude" ? "var(--brand-claude)" : "var(--brand-openai)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-[var(--text-heading)]">{acc.name}</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  </div>
                  {acc.pct ? (
                    <div className="h-1.5 bg-[var(--surface-raised)] rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500" style={{ width: `${acc.pct}%` }} />
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">{acc.cost}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {features.map((feat, i) => (
            <motion.div
              key={feat.titleKey}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 * i }}
              className="glass-card rounded-2xl p-6 text-center"
            >
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-4 text-[var(--text-secondary)]"
                style={{ background: "color-mix(in srgb, var(--brand-claude) 8%, transparent)" }}>
                {feat.icon}
              </div>
              <h3 className="text-lg font-black text-[var(--text-heading)] mb-2">
                {t(feat.titleKey)}
              </h3>
              <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                {t(feat.descKey)}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Tech stack */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pb-20 text-center">
        <p className="text-sm font-bold text-[var(--text-dim)] uppercase tracking-widest mb-4">{t("landing.techStack")}</p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          {techStack.map((tech) => (
            <span key={tech} className="px-4 py-2 rounded-xl text-sm font-semibold text-[var(--text-secondary)] border border-[var(--border-card)] bg-[var(--surface-card)]">
              {tech}
            </span>
          ))}
        </div>
      </section>
    </main>
  );
}
