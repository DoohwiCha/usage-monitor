# lib/

This folder contains shared application logic for i18n and the usage-monitor domain.

## Important files

- `i18n/context.tsx` and `i18n/translations.ts` - locale state and UI copy.
- `usage-monitor/db.ts` - SQLite path resolution, migrations, and schema source of truth.
- `usage-monitor/store.ts` - account CRUD, soft delete/restore, encryption, and public account shaping.
- `usage-monitor/types.ts` - shared provider, account, usage, and history contracts.
- `usage-monitor/usage-adapters.ts` - Claude/OpenAI usage fetchers, connection tests, cache/snapshot fallback, and provider-specific parsing.
- `usage-monitor/history.ts` - usage-history sampler and read path for `usage_window_samples` and `usage_sampler_runs`.
- `usage-monitor/cliproxy-auth-store.ts` - CLIProxyAPI auth-store scan/import helpers.
- `usage-monitor/auth.ts`, `sessions.ts`, `server-auth.ts`, `api-auth.ts`, and `users.ts` - login, sessions, page/API gates, and user management.
- `usage-monitor/account-sync.ts`, `browser-profile-path.ts`, and `browser-pool.ts` - account sync and browser-helper support.
- `usage-monitor/audit.ts`, `rate-limiter.ts`, `response.ts`, `cookies.ts`, and `logger.ts` - security and operational helpers.

## Notes

- Treat SQLite migrations in `usage-monitor/db.ts` as the durable data contract.
- Preserve encrypted secret handling; never log raw cookies, tokens, auth files, passwords, or encryption keys.
- Retired OpenAI legacy modes (`api_key`, `local_sync`, `openai_metrics`, `.omx/metrics.json`) must stay retired unless the architecture changes deliberately.
- OpenAI/Codex active usage collection is account-scoped via CLIProxyAPI auth-store imports; Claude supports cookie-backed and CLIProxy auth-store fetch paths.
