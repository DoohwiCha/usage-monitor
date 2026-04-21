import { describe, it, expect } from "vitest";
import {
  addMonitorAccount,
  updateMonitorAccount,
  deleteMonitorAccount,
  reorderMonitorAccounts,
  readMonitorConfig,
  toPublicAccount,
  ENCRYPTION_KEY_MISMATCH_ERROR,
} from "@/lib/usage-monitor/store";

describe("addMonitorAccount", () => {
  it("creates an account successfully", async () => {
    const config = await addMonitorAccount({
      name: "My Claude Account",
      provider: "claude",
      enabled: true,
      sessionCookie: "session=abc123",
    });

    expect(config.accounts).toHaveLength(1);
    const account = config.accounts[0];
    expect(account.name).toBe("My Claude Account");
    expect(account.provider).toBe("claude");
    expect(account.enabled).toBe(true);
    expect(account.id).toBeTruthy();
    // sessionCookie is stored encrypted but returned decrypted
    expect(account.sessionCookie).toBe("session=abc123");
  });

  it("uses default name when name is not provided", async () => {
    const config = await addMonitorAccount({ provider: "claude" });
    expect(config.accounts[0].name).toBe("Account 1");
  });

  it("enforces max 12 accounts", async () => {
    for (let i = 0; i < 12; i++) {
      await addMonitorAccount({ name: `Account ${i}`, provider: "claude" });
    }
    await expect(addMonitorAccount({ name: "One too many", provider: "claude" })).rejects.toThrow(
      "Maximum 12 accounts allowed."
    );
  });

  it("assigns incrementing sort_order", async () => {
    await addMonitorAccount({ name: "First", provider: "claude" });
    await addMonitorAccount({ name: "Second", provider: "claude" });
    const config = await readMonitorConfig();
    expect(config.accounts[0].name).toBe("First");
    expect(config.accounts[1].name).toBe("Second");
  });
});

describe("updateMonitorAccount", () => {
  it("updates fields correctly", async () => {
    const { accounts } = await addMonitorAccount({ name: "Original", provider: "claude", enabled: false });
    const id = accounts[0].id;

    const updated = await updateMonitorAccount(id, { name: "Updated", enabled: true });
    const account = updated.accounts.find((a) => a.id === id)!;
    expect(account.name).toBe("Updated");
    expect(account.enabled).toBe(true);
  });

  it("stores OpenAI auth-store metadata", async () => {
    const { accounts } = await addMonitorAccount({ name: "OpenAI Acct", provider: "openai" });
    const id = accounts[0].id;

    const updated = await updateMonitorAccount(id, {
      authMode: "auth_store",
      authIdentity: "dominic.d.cha@gmail.com",
      lastSyncedAt: "2026-03-30T00:00:00.000Z",
      syncSource: "cliproxy_codex",
      sourcePath: "/Users/hjyeo/.cli-proxy-api/codex-dominic.d.cha@gmail.com-pro.json",
      sourceAccountId: "acct-123",
      sourceExpiresAt: "2026-04-30T00:00:00.000Z",
    });
    const account = updated.accounts.find((a) => a.id === id)!;
    expect(account.authMode).toBe("auth_store");
    expect(account.authIdentity).toBe("dominic.d.cha@gmail.com");
    expect(account.syncSource).toBe("cliproxy_codex");
    expect(account.sourcePath).toBe("/Users/hjyeo/.cli-proxy-api/codex-dominic.d.cha@gmail.com-pro.json");
    expect(account.sourceAccountId).toBe("acct-123");
    expect(account.sourceExpiresAt).toBe("2026-04-30T00:00:00.000Z");
  });

  it("stores local sync auth metadata", async () => {
    const { accounts } = await addMonitorAccount({ name: "Claude Sync", provider: "claude" });
    const id = accounts[0].id;

    const updated = await updateMonitorAccount(id, {
      sessionCookie: "session=abc123",
      authMode: "local_sync",
      authIdentity: "user@example.com",
      lastSyncedAt: "2026-03-30T00:00:00.000Z",
      syncSource: "claude_cookie",
    });
    const account = updated.accounts.find((a) => a.id === id)!;
    expect(account.sessionCookie).toBe("session=abc123");
    expect(account.authMode).toBe("local_sync");
    expect(account.authIdentity).toBe("user@example.com");
    expect(account.lastSyncedAt).toBe("2026-03-30T00:00:00.000Z");
    expect(account.syncSource).toBe("claude_cookie");
  });

  it("throws for non-existent account id", async () => {
    await expect(updateMonitorAccount("nonexistent-id", { name: "x" })).rejects.toThrow("Account not found.");
  });

  it("clears sessionCookie when set to empty string", async () => {
    const { accounts } = await addMonitorAccount({ name: "Acct", provider: "claude", sessionCookie: "old=value" });
    const id = accounts[0].id;

    const updated = await updateMonitorAccount(id, { sessionCookie: "" });
    const account = updated.accounts.find((a) => a.id === id)!;
    expect(account.sessionCookie).toBeUndefined();
  });

  it("clears incompatible secrets when switching provider", async () => {
    const { accounts } = await addMonitorAccount({ name: "Switch", provider: "claude", sessionCookie: "old=value", enabled: true });
    const id = accounts[0].id;

    const switchedToOpenAI = await updateMonitorAccount(id, {
      provider: "openai",
      authMode: "auth_store",
      syncSource: "cliproxy_codex",
      sourcePath: "/Users/hjyeo/.cli-proxy-api/codex-switch@example.com-pro.json",
      sourceAccountId: "acct-openai",
    });
    const openaiAccount = switchedToOpenAI.accounts.find((a) => a.id === id)!;
    expect(openaiAccount.provider).toBe("openai");
    expect(openaiAccount.sessionCookie).toBeUndefined();
    expect(openaiAccount.authMode).toBe("auth_store");
    expect(openaiAccount.syncSource).toBe("cliproxy_codex");
    expect(openaiAccount.sourcePath).toBe("/Users/hjyeo/.cli-proxy-api/codex-switch@example.com-pro.json");
    expect(openaiAccount.sourceAccountId).toBe("acct-openai");

    const switchedBackToClaude = await updateMonitorAccount(id, { provider: "claude", sessionCookie: "new=value" });
    const claudeAccount = switchedBackToClaude.accounts.find((a) => a.id === id)!;
    expect(claudeAccount.provider).toBe("claude");
    expect(claudeAccount.sessionCookie).toBe("new=value");
    expect(claudeAccount.sourcePath).toBeUndefined();
    expect(claudeAccount.sourceAccountId).toBeUndefined();
  });
});

describe("deleteMonitorAccount", () => {
  it("removes the account", async () => {
    const { accounts } = await addMonitorAccount({ name: "ToDelete", provider: "claude" });
    const id = accounts[0].id;

    const config = await deleteMonitorAccount(id);
    expect(config.accounts).toHaveLength(0);
    expect(config.accounts.find((a) => a.id === id)).toBeUndefined();
  });

  it("throws for non-existent account id", async () => {
    await expect(deleteMonitorAccount("nonexistent-id")).rejects.toThrow("Account not found.");
  });
});

describe("reorderMonitorAccounts", () => {
  it("changes order correctly", async () => {
    await addMonitorAccount({ name: "First", provider: "claude" });
    await addMonitorAccount({ name: "Second", provider: "claude" });
    await addMonitorAccount({ name: "Third", provider: "claude" });

    const original = await readMonitorConfig();
    const [a, b, c] = original.accounts.map((acc) => acc.id);

    // Reverse order
    const reordered = await reorderMonitorAccounts([c, b, a]);
    expect(reordered.accounts[0].name).toBe("Third");
    expect(reordered.accounts[1].name).toBe("Second");
    expect(reordered.accounts[2].name).toBe("First");
  });

  it("throws when orderedIds contains duplicates", async () => {
    await addMonitorAccount({ name: "First", provider: "claude" });
    await addMonitorAccount({ name: "Second", provider: "claude" });
    const config = await readMonitorConfig();
    const [a, b] = config.accounts.map((acc) => acc.id);

    await expect(reorderMonitorAccounts([a, a])).rejects.toThrow("orderedIds must not contain duplicates.");
    await expect(reorderMonitorAccounts([a])).rejects.toThrow("orderedIds must include every account exactly once.");
    await expect(reorderMonitorAccounts([a, "missing"])).rejects.toThrow("orderedIds contains unknown account id.");
    await expect(reorderMonitorAccounts([b, a, "extra"])).rejects.toThrow("orderedIds must include every account exactly once.");
  });
});

describe("toPublicAccount", () => {
  it("masks session cookie", async () => {
    const { accounts } = await addMonitorAccount({
      name: "Masked",
      provider: "claude",
      sessionCookie: "sessionKey=supersecretvalue",
    });
    const pub = toPublicAccount(accounts[0]);

    expect(pub.hasSessionCookie).toBe(true);
    expect(pub.sessionCookieMasked).toMatch(/^\*{4}/);
    expect(pub.sessionCookieMasked).not.toContain("supersecret");
    // The actual cookie value should not appear in the public object
    expect("sessionCookie" in pub).toBe(false);
  });

  it("does not expose unsupported OpenAI API key fields", async () => {
    const { accounts } = await addMonitorAccount({
      name: "OpenAI",
      provider: "openai",
      authMode: "auth_store",
      syncSource: "cliproxy_codex",
      sourcePath: "/Users/hjyeo/.cli-proxy-api/codex-openai@example.com-pro.json",
    });
    const pub = toPublicAccount(accounts[0]);

    expect(pub.authMode).toBe("auth_store");
    expect(pub.syncSource).toBe("cliproxy_codex");
    expect(pub.sourcePath).toBe("/Users/hjyeo/.cli-proxy-api/codex-openai@example.com-pro.json");
    expect("hasApiKey" in pub).toBe(false);
    expect("apiKeyMasked" in pub).toBe(false);
  });

  it("sets hasSessionCookie=false when no cookie set", async () => {
    const { accounts } = await addMonitorAccount({ name: "NoCookie", provider: "claude" });
    const pub = toPublicAccount(accounts[0]);
    expect(pub.hasSessionCookie).toBe(false);
    expect(pub.sessionCookieMasked).toBe("");
  });

  it("exposes auth metadata without leaking secrets", async () => {
    const { accounts } = await addMonitorAccount({
      name: "Synced",
      provider: "claude",
      sessionCookie: "sessionKey=supersecretvalue",
      authMode: "local_sync",
      authIdentity: "synced@example.com",
      lastSyncedAt: "2026-03-30T00:00:00.000Z",
      syncSource: "claude_cookie",
    });
    const pub = toPublicAccount(accounts[0]);

    expect(pub.authMode).toBe("local_sync");
    expect(pub.authIdentity).toBe("synced@example.com");
    expect(pub.lastSyncedAt).toBe("2026-03-30T00:00:00.000Z");
    expect(pub.syncSource).toBe("claude_cookie");
    expect("sessionCookie" in pub).toBe(false);
  });
});

describe("encryption key mismatch handling", () => {
  it("throws actionable error when existing encrypted data cannot be decrypted with current key", async () => {
    await addMonitorAccount({
      name: "Encrypted",
      provider: "claude",
      sessionCookie: "session=value",
    });

    const originalKey = process.env.MONITOR_ENCRYPTION_KEY;
    process.env.MONITOR_ENCRYPTION_KEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    try {
      await expect(readMonitorConfig()).rejects.toThrow(ENCRYPTION_KEY_MISMATCH_ERROR);
    } finally {
      process.env.MONITOR_ENCRYPTION_KEY = originalKey;
    }
  });

  it("requires MONITOR_ENCRYPTION_KEY to save secrets", async () => {
    const originalKey = process.env.MONITOR_ENCRYPTION_KEY;
    delete process.env.MONITOR_ENCRYPTION_KEY;

    try {
      await expect(addMonitorAccount({
        name: "NoKey",
        provider: "claude",
        sessionCookie: "session=value",
      })).rejects.toThrow("MONITOR_ENCRYPTION_KEY must be set.");
    } finally {
      process.env.MONITOR_ENCRYPTION_KEY = originalKey;
    }
  });
});
