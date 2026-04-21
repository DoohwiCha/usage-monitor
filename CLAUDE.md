# CLAUDE.md

Start with `AGENTS.md`, then read the nearest subfolder `AGENTS.md` before editing files under `app/`, `components/`, `lib/`, `scripts/`, `ops/`, `docs/`, or `__tests__/`.

## Repository model

- The app is a Next.js 16 / React 19 / TypeScript usage monitor.
- SQLite is the persistence layer; schema and migrations live in `lib/usage-monitor/db.ts`.
- Claude production guidance favors manual cookie-backed accounts; Claude local sync remains a helper path.
- OpenAI/Codex accounts are imported from CLIProxyAPI auth-store files and read on demand.
- Usage history is sampled into SQLite by `scripts/run-history-sampler.ts` and the launchd job under `ops/`.

## Useful references

- `README.md` - setup and operating overview.
- `docs/ai-agent-operating-state.md` - current architecture and provider-source decisions.
- `docs/llm-agent-account-setup.md` - account onboarding workflow and active DB caveats.
- `package.json` - available npm scripts.

## Commands

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run check`

Never expose secret values from environment files, auth stores, cookies, sessions, database rows, or logs.
