# Account Setup Guide for LLM Agents

This document explains how an LLM agent should make **Claude** and **GPT/OpenAI/Codex** accounts appear in this `usage-monitor` deployment.

It is written for agents working inside this repository and on this server.

## Purpose

The goal is simple:

- make a Claude account show up in `usage-monitor`
- make a GPT/OpenAI/Codex account show up in `usage-monitor`
- avoid using the wrong source path
- understand what kind of account row was created

This deployment uses two different recommended account sources:

- **Claude**: manual cookie
- **GPT / OpenAI / Codex**: CLIProxyAPI auth-store import

## Important Runtime Paths

The active database is not the repo-local default.

- Active DB: `/Users/hjyeo/srv/data/usage-monitor/usage-monitor.db`
- Config source: `.env.local`
- OpenAI/Codex auth store: `/Users/hjyeo/.cli-proxy-api`

Relevant environment behavior:

- `MONITOR_DB_PATH` in `.env.local` points the app to `/Users/hjyeo/srv/data/usage-monitor/usage-monitor.db`
- if an agent inspects `./data/usage-monitor.db` only, it may see stale or wrong data

## Mental Model

There is one supported OpenAI account type in this app.

### 1. Imported auth-store OpenAI account

This is the preferred multi-account GPT/Codex setup.

Characteristics:

- `provider = openai`
- `authMode = auth_store`
- `syncSource = cliproxy_codex`
- `sourcePath` points to a `codex-*.json` file under `~/.cli-proxy-api`
- usage is account-scoped
- each imported row maps to one actual ChatGPT/Codex account

This is what you want for accounts like:

- `dominic.d.cha@gmail.com`
- `ociomirae1@gmail.com`

## How To Add a GPT / OpenAI / Codex Account

Use this path when the target account has a server-local CLIProxyAPI auth file.

### Preconditions

The auth file must exist under:

- `/Users/hjyeo/.cli-proxy-api`

The scanner only recognizes:

- `codex-*.json` for OpenAI/Codex
- `claude-*.json` for Claude

Files that do not match those name patterns are ignored by the import UI.

For OpenAI/Codex import, the file must also contain usable auth data, especially:

- `access_token`
- `account_id`
- `email`

### Steps

1. Open the Accounts page in `usage-monitor`.
2. Look at the `Import from CLIProxyAPI auth store` section.
3. Find the OpenAI/Codex candidate.
4. Click `Import`.

### What import actually does

Import does **not** copy the access token into the database.

Instead it creates a DB row that stores metadata such as:

- account name
- provider
- auth mode
- sync source
- `sourcePath`
- `sourceAccountId`
- expiry metadata

At runtime, `usage-monitor` reads the auth file again from disk and uses it to fetch usage.

### Expected DB shape after successful import

Example of a correct imported OpenAI row:

```text
name=dominic.d.cha@gmail.com
provider=openai
auth_mode=auth_store
sync_source=cliproxy_codex
source_path=/Users/hjyeo/.cli-proxy-api/codex-dominic.d.cha@gmail.com-pro.json
```

## How To Add a Claude Account

Preferred production path: manual cookie.

### Recommended path

1. Create or open a Claude account row in `usage-monitor`.
2. Open that account's detail page.
3. Paste a valid Claude cookie header string.
4. Save settings.
5. Test connection.

### Expected DB shape after successful Claude setup

Typical correct Claude row:

```text
provider=claude
auth_mode=manual_cookie
sync_source=manual_cookie
```

### Alternative path

This app can also import `claude-*.json` auth-store files, but that is not the preferred production model here.

Use auth-store Claude only if the operator explicitly wants it.

## Why a New Codex File Does Not Automatically Appear

Adding a new file under `~/.cli-proxy-api` and importing it are separate things.

The chain is:

1. a `codex-*.json` file appears in `/Users/hjyeo/.cli-proxy-api`
2. `usage-monitor` scans that directory
3. the file appears as an import candidate on the Accounts page
4. the operator clicks `Import`
5. only then is a new account row created in the DB

So:

- **new file exists** does not mean **account row already exists**
- the file is the source
- the DB row is the imported monitor entry

## Why Some Files May Not Show As Import Candidates

The scanner currently only imports specific filename patterns.

Recognized:

- `codex-*.json`
- `claude-*.json`

Ignored:

- other prefixes such as `antigravity-*.json`

If the operator says a file exists but it does not appear in the import list, first check:

1. does the filename start with `codex-` or `claude-`?
2. does the file contain the expected fields?
3. is the account already imported with the same `sourcePath`?

## How To Verify What Is Currently Active

Check the active DB, not the repo-local fallback DB.

Useful query:

```sql
SELECT
  id,
  name,
  provider,
  enabled,
  auth_mode,
  auth_identity,
  sync_source,
  source_path,
  source_account_id,
  deleted_at
FROM accounts
ORDER BY sort_order, created_at;
```

Interpretation:

- `deleted_at IS NULL` means the account is active
- `sync_source = cliproxy_codex` means imported GPT/Codex auth-store account
- `sync_source = manual_cookie` means cookie-backed Claude account

## Current Known Good OpenAI Accounts On This Server

At the time of writing, the active imported GPT/OpenAI/Codex accounts are:

- `ociomirae1@gmail.com`
- `dominic.d.cha@gmail.com`

These are represented as:

- `provider = openai`
- `auth_mode = auth_store`
- `sync_source = cliproxy_codex`

The deleted OpenAI row for `ociomirae@gmail.com` should not be treated as active.

## What To Avoid

- Do not assume `./data/usage-monitor.db` is the active DB.
- Do not assume every JSON file in `~/.cli-proxy-api` is importable.
- Do not assume adding a file automatically creates a visible account row.

## Short Decision Rules for Agents

If asked to make a GPT/Codex account appear:

- first inspect `/Users/hjyeo/.cli-proxy-api`
- prefer a `codex-*.json` source
- verify it appears as an import candidate
- import it into the active DB
- confirm the row has `sync_source = cliproxy_codex`

If asked to make a Claude account appear:

- prefer manual cookie setup
- do not default to Claude auth-store unless explicitly requested

If the UI already shows an OpenAI account:

- confirm it is `cliproxy_codex`
- if it is not, treat it as legacy data rather than a supported monitoring path
