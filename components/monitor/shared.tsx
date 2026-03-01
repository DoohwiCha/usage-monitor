"use client";

export function brandVar(provider: string) {
  return provider === "claude" ? "var(--brand-claude)" : "var(--brand-openai)";
}

export function brandLightVar(provider: string) {
  return provider === "claude" ? "var(--brand-claude-light)" : "var(--brand-openai-light)";
}

export function ToggleSwitch({ checked, onChange, color, label }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  color: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-[var(--border-card)] transition-colors"
      style={{ backgroundColor: checked ? color : "var(--text-dim)" }}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"} mt-0.5`} />
    </button>
  );
}

export function Spinner({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
