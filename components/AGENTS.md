# components/

This folder contains the client-side monitor UI components.

## Important files

- `monitor/MonitorDashboard.tsx` - dashboard cards, provider grouping, refresh loop, and usage-history chart hookup.
- `monitor/AccountDetail.tsx` - per-account settings, connection tests, local sync, manual cookie input, usage, and history.
- `monitor/AccountsManager.tsx` - account CRUD, ordering, soft delete, and CLIProxyAPI auth-store import UI.
- `monitor/UsageHistoryChart.tsx` - SVG chart for sampled 5h/7d utilization and reset markers.
- `monitor/LoginForm.tsx` - login UI.
- `monitor/shared.tsx` - shared UI helpers such as switches, spinners, and brand helpers.
- `monitor/ThemeToggle.tsx`, `monitor/LanguageSelector.tsx`, and `monitor/ErrorBoundary.tsx` - reusable shell controls.

## Notes

- Keep fetch paths and response assumptions in sync with `app/api/monitor/*` route handlers.
- Keep provider-specific behavior in UI aligned with `lib/usage-monitor/types.ts` and `usage-adapters.ts`.
- Do not put backend secrets, auth-store parsing, or database logic in components.
