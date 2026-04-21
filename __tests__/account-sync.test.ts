import { describe, expect, it } from "vitest";

import { addMonitorAccount } from "@/lib/usage-monitor/store";
import { consumeAccountSyncSession, createAccountSyncSession } from "@/lib/usage-monitor/account-sync";
import { getDb } from "@/lib/usage-monitor/db";

describe("account sync sessions", () => {
  function createUser(id = "user-1"): string {
    getDb().prepare(`
      INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', ?, ?)
    `).run(id, `user-${id}`, "hash", "2026-03-30T00:00:00.000Z", "2026-03-30T00:00:00.000Z");
    return id;
  }

  it("creates and consumes a one-time sync token", async () => {
    const { accounts } = await addMonitorAccount({ name: "Claude", provider: "claude" });
    const account = accounts[0];
    const userId = createUser();

    const { token, session } = createAccountSyncSession(account.id, account.provider, userId);
    expect(token).toBeTruthy();
    expect(session.accountId).toBe(account.id);

    const consumed = consumeAccountSyncSession(account.id, account.provider, token);
    expect(consumed?.id).toBe(session.id);
    expect(consumed?.usedAt).toBeTruthy();

    const reused = consumeAccountSyncSession(account.id, account.provider, token);
    expect(reused).toBeNull();
  });

  it("rejects account/provider mismatches", async () => {
    const { accounts } = await addMonitorAccount({ name: "OpenAI", provider: "openai" });
    const account = accounts[0];
    const { token } = createAccountSyncSession(account.id, account.provider, createUser());

    expect(consumeAccountSyncSession("different-account", "openai", token)).toBeNull();
    expect(consumeAccountSyncSession(account.id, "claude", token)).toBeNull();
  });

  it("rejects expired sync tokens", async () => {
    const { accounts } = await addMonitorAccount({ name: "Claude", provider: "claude" });
    const account = accounts[0];
    const { token, session } = createAccountSyncSession(account.id, account.provider, createUser());

    getDb().prepare("UPDATE account_sync_sessions SET expires_at = ? WHERE id = ?").run(
      "2000-01-01T00:00:00.000Z",
      session.id,
    );

    expect(consumeAccountSyncSession(account.id, account.provider, token)).toBeNull();
  });
});
