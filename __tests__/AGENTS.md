# __tests__/

This folder contains Vitest node tests for usage-monitor domain behavior.

## Important files

- `setup.ts` - shared test DB path, required env vars, and database reset hooks.
- `db.test.ts` - SQLite migrations and retired schema behavior.
- `store.test.ts`, `users.test.ts`, `sessions.test.ts`, and `account-sync.test.ts` - account, user, session, and sync-session behavior.
- `usage-adapters.*.test.ts`, `history.test.ts`, and `usage-cache.test.ts` - provider usage, matching, history, and cache behavior.
- `rate-limiter.test.ts`, `cookies.test.ts`, `range.test.ts`, `browser-profile-path.test.ts`, and `cliproxy-auth-store.test.ts` - supporting utility coverage.

## Notes

- Use `*.test.ts` files under `__tests__/`; Vitest includes this folder via `vitest.config.ts`.
- Tests share one SQLite test database and run with `fileParallelism: false`; keep setup/reset behavior deterministic.
- `tsconfig.json` excludes `__tests__`, so `npm run typecheck` does not typecheck test files.
- Legacy fallback tests are intentional compatibility coverage until the code and docs explicitly retire that behavior.
