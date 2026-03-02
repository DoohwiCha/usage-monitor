import { describe, it, expect, beforeEach } from "vitest";
import {
  createUser,
  authenticateUser,
  changePassword,
  ensureAdminExists,
  getUserCount,
  getUserByUsername,
} from "@/lib/usage-monitor/users";
import { resetDb } from "./setup";

describe("createUser", () => {
  it("creates a user successfully", async () => {
    const user = await createUser("alice", "password123");
    expect(user.username).toBe("alice");
    expect(user.role).toBe("viewer");
    expect(user.id).toBeTruthy();
    expect(user.createdAt).toBeTruthy();
  });

  it("rejects duplicate usernames (case-insensitive)", async () => {
    await createUser("alice", "password123");
    await expect(createUser("ALICE", "password456")).rejects.toThrow("Username already exists.");
  });

  it("rejects short passwords (<8 chars)", async () => {
    await expect(createUser("bob", "short")).rejects.toThrow("Password must be at least 8 characters.");
  });

  it("rejects invalid username characters", async () => {
    await expect(createUser("bad user!", "password123")).rejects.toThrow(
      "Username can only contain letters, numbers, dots, hyphens, and underscores."
    );
  });

  it("rejects username shorter than 2 characters", async () => {
    await expect(createUser("a", "password123")).rejects.toThrow("Username must be 2-50 characters.");
  });

  it("creates an admin user when role is specified", async () => {
    const user = await createUser("adminuser", "password123", "admin");
    expect(user.role).toBe("admin");
  });
});

describe("authenticateUser", () => {
  it("returns user for correct credentials", async () => {
    await createUser("alice", "password123");
    const user = await authenticateUser("alice", "password123");
    expect(user).not.toBeNull();
    expect(user!.username).toBe("alice");
  });

  it("returns null for wrong password", async () => {
    await createUser("alice", "password123");
    const user = await authenticateUser("alice", "wrongpassword");
    expect(user).toBeNull();
  });

  it("returns null for non-existent user", async () => {
    const user = await authenticateUser("nobody", "password123");
    expect(user).toBeNull();
  });

  it("is case-insensitive for username", async () => {
    await createUser("alice", "password123");
    const user = await authenticateUser("ALICE", "password123");
    expect(user).not.toBeNull();
    expect(user!.username).toBe("alice");
  });
});

describe("changePassword", () => {
  it("changes password and old password stops working", async () => {
    const user = await createUser("alice", "password123");
    await changePassword(user.id, "newpassword456");

    const withOld = await authenticateUser("alice", "password123");
    expect(withOld).toBeNull();

    const withNew = await authenticateUser("alice", "newpassword456");
    expect(withNew).not.toBeNull();
  });

  it("rejects short new password", async () => {
    const user = await createUser("alice", "password123");
    await expect(changePassword(user.id, "short")).rejects.toThrow("Password must be at least 8 characters.");
  });

  it("throws for non-existent user id", async () => {
    await expect(changePassword("nonexistent-id", "newpassword456")).rejects.toThrow("User not found.");
  });
});

describe("ensureAdminExists", () => {
  it("creates admin from env vars when no users exist", async () => {
    expect(getUserCount()).toBe(0);
    await ensureAdminExists();
    expect(getUserCount()).toBe(1);
    const admin = getUserByUsername("testadmin");
    expect(admin).not.toBeNull();
    expect(admin!.role).toBe("admin");
  });

  it("does not create a second admin if users already exist", async () => {
    await createUser("existing", "password123");
    await ensureAdminExists();
    expect(getUserCount()).toBe(1);
  });
});
