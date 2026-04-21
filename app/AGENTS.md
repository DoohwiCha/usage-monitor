# app/

This folder contains the Next App Router pages and `/api/monitor/*` route handlers.

## Important files

- `page.tsx` - public landing page.
- `layout.tsx` and `globals.css` - app shell, theme bootstrap, and global styling.
- `monitor/page.tsx` - authenticated dashboard page.
- `monitor/login/page.tsx` - login page.
- `monitor/accounts/page.tsx` and `monitor/accounts/[id]/page.tsx` - admin account management pages.
- `api/monitor/auth/*` - login, logout, and session-check endpoints.
- `api/monitor/accounts/*` - account CRUD, reorder, restore, connect, sync, logout, and CLIProxy import endpoints.
- `api/monitor/usage/route.ts` - current usage overview API.
- `api/monitor/history/route.ts` - sampled usage-history API for dashboard and account detail charts.
- `api/monitor/auth-sources/cliproxy/route.ts` - CLIProxyAPI auth-store discovery endpoint.

## Notes

- Preserve page/API auth checks and CSRF origin checks on mutating monitor routes.
- Keep API response shapes aligned with `components/monitor/*`, especially usage, history, account sync, and CLIProxy import flows.
- Deleted browser-login routes are legacy cleanup; do not restore them unless current UI and provider logic require it.
