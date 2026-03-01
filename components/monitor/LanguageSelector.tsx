"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "@/lib/i18n/context";
import { locales, localeNames, type Locale } from "@/lib/i18n/translations";

export default function LanguageSelector() {
  const { locale, setLocale } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="px-2 py-1.5 rounded-xl text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-heading)] hover:bg-[var(--surface-raised)] transition-all"
      >
        {localeNames[locale].slice(0, 3).toUpperCase()}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-xl border border-[var(--border-card)] shadow-lg overflow-hidden"
          style={{ background: "var(--surface-card)" }}
          role="listbox"
          aria-label="Select language"
        >
          {locales.map((l: Locale) => (
            <button
              key={l}
              onClick={() => { setLocale(l); setOpen(false); }}
              role="option"
              aria-selected={l === locale}
              className="w-full text-left px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--surface-raised)]"
              style={{ color: l === locale ? "var(--brand-claude)" : "var(--text-body)" }}
            >
              {localeNames[l]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
