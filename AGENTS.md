# usage-monitor

This repository is a Next.js monitor for Claude and OpenAI/Codex account usage, backed by SQLite and local operational scripts.

## Important areas

- `app/` - Next App Router pages and `/api/monitor/*` route handlers.
- `components/` - Monitor dashboard, account management, auth, and chart UI.
- `lib/` - Domain logic for accounts, auth, SQLite persistence, provider usage, and history sampling.
- `scripts/` - Local sync, migration, and history sampler entrypoints.
- `ops/` - Service operation files such as launchd manifests.
- `docs/` - Architecture, account onboarding, and verification notes.
- `__tests__/` - Vitest coverage for monitor domain behavior.

## Agent workflow

- Read the nearest `AGENTS.md` before editing inside a subfolder; deeper files override this root guidance.
- Do not document or depend on generated, vendor, cache, database, log, or secret files.
- Do not reintroduce stale OpenAI local metrics behavior such as `.omx/metrics.json`; current OpenAI/Codex monitoring uses CLIProxyAPI auth-store imports.
- Do not print or commit secret values from `.env.local`, auth stores, cookies, session material, or SQLite data.

## Commands

- `npm run lint` - ESLint.
- `npm run typecheck` - TypeScript check for app/source files.
- `npm test` - Vitest test suite.
- `npm run check` - lint, typecheck, then tests.
