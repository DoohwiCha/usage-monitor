# usage-monitor public verification — 2026-03-30

## Live verification

- Hostname: `https://usage-monitor.hjyeo.com`
- Login: passed with the shared admin credential from local `.env.local`
- Dashboard: loaded after login
- Accounts page: loaded after login
- Logout: returned to `/monitor/login`
- Re-login: succeeded after logout

## Authenticated data checks

- `GET /api/monitor/auth/me` returned `200`
- `GET /api/monitor/accounts` returned `200` with `0` configured accounts
- Because there were no account records, no account-detail-level safe authenticated action was available to run without creating or mutating data

## Runtime evidence

- `pm2 describe usage-monitor` showed the service online
- Runtime command line: `start -- --hostname 127.0.0.1 --port 3001`
- Runtime env / backup notes live in `~/srv/configs/usage-monitor/runtime.md`

## Documentation gaps confirmed

- Shared admin credential source is local `.env.local`, but a separate credential-rotation runbook was not found
- `TRUST_PROXY_SHARED_SECRET` is configured, but a rotation procedure was not found
- Cloudflare WAF / rate-limit status is still referenced only as planned work in `~/MAC_MINI_HOSTING_PLAN.md`
- No hostname-specific WAF / rate-limit evidence artifact was found in `~/srv/` or this repo
