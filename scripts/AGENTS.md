# scripts/

This folder contains operational and migration scripts for local sync and history sampling.

## Important files

- `run-history-sampler.ts` - loads `.env.local` and calls `sampleUsageHistory()`.
- `run-history-sampler.sh` - launchd-friendly wrapper that sets repo env and runs the sampler.
- `local-sync.ts` - Claude-only interactive Playwright helper that uploads a session via sync token.
- `migrate-json-to-sqlite.ts` - one-way migration from legacy `data/usage-monitor.json` to SQLite.

## Notes

- Keep sampler scripts thin wrappers around `lib/usage-monitor/history.ts`.
- Keep sync tokens, cookies, and auth data out of shell history and logs.
- The JSON migration is legacy and intentionally skips unsupported OpenAI rows; do not turn it into a live code path.
- Do not add dependencies on `.omx/metrics.json` or other retired local metrics files.
