# Usage Monitor — current operating state for AI agents

_Last updated: 2026-03-30 (server-local Mac mini reality)_

This document explains **how the current production-like setup actually works**, **why it was changed**, and **what future agents should preserve unless they have a strong reason to change it**.

---

## 1. High-level conclusion

The project now uses a **provider-specific production model** rather than forcing one uniform auth path for every provider.

### Current recommended production model

- **Claude** → `manual_cookie`
- **OpenAI / Codex** → `CLIProxyAPI auth store direct`

This split is intentional and is currently the most stable arrangement for this server.

---

## 2. Why the original browser-login idea was abandoned

### Claude server-side browser login

Old design:
- Next.js route launched Playwright on the server
- user completed login / Cloudflare verification in that browser
- cookies were extracted and saved

Why it broke:
- this app is deployed on a **headless Mac mini**
- server-side interactive browser flows are unreliable there
- Cloudflare and Google auth both treat automation harshly

Result:
- server-side browser login is no longer the primary path
- those legacy browser-login routes have been removed

---

## 3. Why Claude uses cookies in production

Claude currently works best in production via **real browser session cookies** captured from a normal user browser.

### Why not Claude auth-store direct as the default?

It is technically possible to read `~/.cli-proxy-api/claude-*.json` and call:
- `https://api.anthropic.com/api/oauth/profile`
- `https://api.anthropic.com/api/oauth/usage`

That path was implemented and verified to work.

However, in interactive dashboard use it is more prone to upstream rate-limiting than the stable cookie path. In practice, detail-page viewing could hit temporary rate-limit behavior that made the dashboard less reliable.

### Therefore the operational choice is:
- keep **Claude cookie/manual-cookie** as the recommended source
- keep Claude auth-store support as an available implementation path, but **not the preferred production model**

### Claude production workflow

1. Sign in to `claude.ai` in a normal browser
2. Complete Cloudflare verification there
3. Extract cookies
4. Save the cookie header string into the Claude account in usage-monitor

Minimum useful cookies usually include:
- `sessionKey`
- `cf_clearance`
- `lastActiveOrg`

Optional fallback cookies if needed:
- `routingHint`
- `activitySessionId`
- `anthropic-device-id`

Relevant files:
- `lib/usage-monitor/usage-adapters.ts`
- `components/monitor/AccountDetail.tsx`
- `README.md`

---

## 4. Why OpenAI / Codex uses CLIProxyAPI auth-store direct

This Mac mini already runs CLIProxyAPI locally and already has per-account auth files under:

- `~/.cli-proxy-api/codex-*.json`
- `~/.cli-proxy-api/claude-*.json`

For Codex/OpenAI, these files are an excellent source because they are already:
- account-scoped
- server-local
- non-GUI
- multi-account friendly

### What usage-monitor now does for Codex/OpenAI

It can scan `~/.cli-proxy-api/codex-*.json`, import those accounts, and read usage directly from upstream using:
- `access_token`
- `account_id`

The current OpenAI/Codex direct fetch path hits ChatGPT/Codex usage endpoints and parses:
- plan type
- account identity
- 5h / weekly utilization
- reset timestamps

### Why this is better than local sync / shared metrics for production

Compared with older shared-metrics or Windows/WSL helper flows:
- this is **truly account-scoped**
- this scales to multiple Codex accounts on the same server
- this does not depend on a separate GUI machine
- this avoids ambiguity from one shared local metrics file

Relevant files:
- `lib/usage-monitor/cliproxy-auth-store.ts`
- `lib/usage-monitor/usage-adapters.ts`
- `app/api/monitor/auth-sources/cliproxy/route.ts`
- `app/api/monitor/accounts/import-cliproxy/route.ts`
- `components/monitor/AccountsManager.tsx`

---

## 5. Current active account model on the server

After cleanup, the intended active layout is:

### OpenAI / Codex
- imported from `~/.cli-proxy-api/codex-*.json`
- `authMode = auth_store`
- `syncSource = cliproxy_codex`

### Claude
- cookie-backed manual accounts
- `authMode = manual_cookie`
- `syncSource = manual_cookie`

Soft-deleted/duplicate rows from earlier experiments were purged from the live DB.

---

## 6. What “local sync” still means now

Local sync still exists for Claude, but it is **not the preferred production path** for OpenAI / Codex.

### Keep it for:
- one-off troubleshooting
- fallback when a remote machine must provide local metrics

### Do not treat it as the main architecture for this server

In particular:
- **Claude local sync** is not the best production path because of login/Cloudflare friction
- **OpenAI local sync / shared metrics** is legacy and should not be treated as a supported production monitoring path

---

## 7. Current UI/feature expectations

### Accounts page

The Accounts page now has an import surface for CLIProxyAPI auth-store accounts.

Expected behavior:
- scan local auth-store files on the server
- show import candidates
- import OpenAI/Codex accounts as file-backed sources
- Claude import may exist technically, but production operators should prefer cookie-backed Claude accounts

### Account detail page

Expected behavior:
- show auth mode
- show sync/source type
- show identity and metadata
- show source path / source account id / expiry when relevant
- for Claude cookie accounts, manual cookie input remains the important operational tool

---

## 8. Reset-time behavior

### Claude
Claude sources already expose reset times naturally and the UI displays them.

### OpenAI / Codex
OpenAI/Codex reset times are now also parsed from upstream rate-limit window metadata and shown in the UI.

This was specifically added so Codex/OpenAI rate-limit bars behave more like the Claude display.

---

## 9. Important file map for future agents

### Data model / DB
- `lib/usage-monitor/types.ts`
- `lib/usage-monitor/db.ts`
- `lib/usage-monitor/store.ts`

### Provider fetch logic
- `lib/usage-monitor/usage-adapters.ts`
- `lib/usage-monitor/cliproxy-auth-store.ts`

### API routes
- `app/api/monitor/accounts/import-cliproxy/route.ts`
- `app/api/monitor/auth-sources/cliproxy/route.ts`
- `app/api/monitor/accounts/[id]/sync-session/route.ts`
- `app/api/monitor/accounts/[id]/sync-upload/route.ts`

### UI
- `components/monitor/AccountsManager.tsx`
- `components/monitor/AccountDetail.tsx`

### Documentation
- `README.md`
- `docs/ai-agent-operating-state.md` (this file)

---

## 10. Rules future agents should preserve

### Preserve these unless you have strong evidence otherwise

1. **Do not force Claude onto auth-store direct as the only path.**
   - Cookie-backed Claude collection is still the most operationally stable path here.

2. **Do not regress Codex/OpenAI back to shared local metrics or API-key-style setup.**
   - The auth-store direct path is the real multi-account solution.

3. **Do not duplicate auth-store access tokens into the usage-monitor DB unless absolutely necessary.**
   - Prefer file-backed references (`sourcePath`, `sourceAccountId`, etc.).

4. **Treat Windows / WSL helper flows as fallback tooling, not the server’s main architecture.**

5. **If changing provider fetch paths, verify both current provider reality and production stability.**
   - A path can be technically valid but still wrong for the dashboard if it rate-limits too aggressively.

---

## 11. Open questions / future improvement ideas

1. Add a clearer UI distinction between:
   - recommended production source
   - supported but less stable source

2. Add provider-specific import guidance inline in the Accounts page.

3. If Anthropic OAuth usage limits improve, reconsider Claude auth-store direct as a first-class production source.

4. If CLIProxyAPI later exposes a reliable per-account usage-management API, evaluate whether that is better than file-backed direct reads.

---

## 12. Summary in one sentence

**Production reality today:** Claude works best via real browser cookies, while Codex/OpenAI works best by directly importing and reading the server-local CLIProxyAPI auth store.
