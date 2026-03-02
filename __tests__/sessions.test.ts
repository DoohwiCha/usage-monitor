import { describe, it, expect, beforeEach } from "vitest";
import {
  createSession,
  validateSession,
  revokeSession,
  revokeAllUserSessions,
  cleanExpiredSessions,
  getUserSessions,
} from "@/lib/usage-monitor/sessions";
import { createUser } from "@/lib/usage-monitor/users";
import { getDb } from "@/lib/usage-monitor/db";
import { resetDb } from "./setup";

async function makeUser(username = "sessionuser"): Promise<string> {
  const user = await createUser(username, "password123");
  return user.id;
}

describe("createSession", () => {
  it("returns a token and session", async () => {
    const userId = await makeUser();
    const { token, session } = createSession(userId, "127.0.0.1", "TestAgent/1.0");

    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
    expect(session.id).toBeTruthy();
    expect(session.userId).toBe(userId);
    expect(session.ipAddress).toBe("127.0.0.1");
    expect(session.userAgent).toBe("TestAgent/1.0");
    expect(session.expiresAt).toBeTruthy();
    expect(session.createdAt).toBeTruthy();
  });

  it("stores null ip and userAgent when not provided", async () => {
    const userId = await makeUser("nometauser");
    const { session } = createSession(userId);
    expect(session.ipAddress).toBeNull();
    expect(session.userAgent).toBeNull();
  });
});

describe("validateSession", () => {
  it("returns session for valid token", async () => {
    const userId = await makeUser();
    const { token, session } = createSession(userId);
    const found = validateSession(token);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(session.id);
    expect(found!.userId).toBe(userId);
  });

  it("returns null for invalid token", () => {
    const found = validateSession("totally-invalid-token");
    expect(found).toBeNull();
  });

  it("returns null for expired session", async () => {
    const userId = await makeUser("expireduser");
    const { token, session } = createSession(userId);

    // Manually expire the session in the DB using SQLite datetime format
    const db = getDb();
    db.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 second') WHERE id = ?").run(
      session.id
    );

    const found = validateSession(token);
    expect(found).toBeNull();
  });
});

describe("revokeSession", () => {
  it("invalidates the session", async () => {
    const userId = await makeUser("revokeuser");
    const { token } = createSession(userId);

    const revoked = revokeSession(token);
    expect(revoked).toBe(true);

    const found = validateSession(token);
    expect(found).toBeNull();
  });

  it("returns false for non-existent token", () => {
    const revoked = revokeSession("nonexistent-token");
    expect(revoked).toBe(false);
  });
});

describe("revokeAllUserSessions", () => {
  it("clears all sessions for a user", async () => {
    const userId = await makeUser("multiuser");
    const { token: t1 } = createSession(userId);
    const { token: t2 } = createSession(userId);

    const count = revokeAllUserSessions(userId);
    expect(count).toBe(2);

    expect(validateSession(t1)).toBeNull();
    expect(validateSession(t2)).toBeNull();
  });

  it("returns 0 when user has no sessions", async () => {
    const userId = await makeUser("nosessuser");
    const count = revokeAllUserSessions(userId);
    expect(count).toBe(0);
  });
});

describe("cleanExpiredSessions", () => {
  it("removes old sessions and keeps valid ones", async () => {
    const userId = await makeUser("cleanuser");
    const { session: validSession } = createSession(userId);

    // Insert an already-expired session using SQLite datetime format
    const db = getDb();
    const { randomUUID, createHash } = await import("node:crypto");
    const expiredToken = randomUUID();
    const expiredHash = createHash("sha256").update(expiredToken).digest("hex");
    db.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, datetime('now', '-1 second'), datetime('now', '-10 seconds'))
    `).run(
      randomUUID(),
      userId,
      expiredHash,
    );

    const removed = cleanExpiredSessions();
    expect(removed).toBe(1);

    // Valid session should still exist
    const remaining = getUserSessions(userId);
    expect(remaining.some((s) => s.id === validSession.id)).toBe(true);
  });
});
