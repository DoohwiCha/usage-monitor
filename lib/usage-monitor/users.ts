import { randomUUID, scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/usage-monitor/db";

export type UserRole = "admin" | "viewer";

export interface User {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export const INITIAL_ADMIN_ENV_ERROR =
  "MONITOR_ADMIN_USER and MONITOR_ADMIN_PASS must be set to create initial admin.";

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    role: row.role as UserRole,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- Password hashing (scrypt, Node.js built-in) ---

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
  });
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expectedHash = Buffer.from(hashHex, "hex");

  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
  });

  return timingSafeEqual(derived, expectedHash);
}

// --- User CRUD ---

export function getUserCount(): number {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number }).cnt;
}

export function getUserById(id: string): User | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function getUserByUsername(username: string): User | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function listUsers(): User[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as UserRow[];
  return rows.map(rowToUser);
}

export async function createUser(username: string, password: string, role: UserRole = "viewer"): Promise<User> {
  if (!username || username.length < 2 || username.length > 50) {
    throw new Error("Username must be 2-50 characters.");
  }
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    throw new Error("Username can only contain letters, numbers, dots, hyphens, and underscores.");
  }

  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(username) as { id: string } | undefined;
  if (existing) {
    throw new Error("Username already exists.");
  }

  const id = randomUUID();
  const stamp = new Date().toISOString();
  const passwordHash = await hashPassword(password);

  db.prepare(`
    INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, username, passwordHash, role, stamp, stamp);

  return { id, username, role, createdAt: stamp, updatedAt: stamp };
}

export async function authenticateUser(username: string, password: string): Promise<User | null> {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username) as UserRow | undefined;
  if (!row) return null;

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) return null;

  return rowToUser(row);
}

export async function changePassword(userId: string, newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const db = getDb();
  const passwordHash = await hashPassword(newPassword);
  const result = db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(passwordHash, new Date().toISOString(), userId);
  if (result.changes === 0) {
    throw new Error("User not found.");
  }
}

export async function deleteUser(userId: string): Promise<void> {
  const db = getDb();
  const result = db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  if (result.changes === 0) {
    throw new Error("User not found.");
  }
}

export async function updateUserRole(userId: string, role: UserRole): Promise<void> {
  const db = getDb();
  const result = db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(role, new Date().toISOString(), userId);
  if (result.changes === 0) {
    throw new Error("User not found.");
  }
}

/**
 * Ensure at least one admin exists. Called during app startup.
 * Creates default admin from env vars if no users exist.
 */
export async function ensureAdminExists(): Promise<void> {
  const count = getUserCount();
  if (count > 0) return;

  const username = process.env.MONITOR_ADMIN_USER;
  const password = process.env.MONITOR_ADMIN_PASS;
  if (!username || !password) {
    throw new Error(INITIAL_ADMIN_ENV_ERROR);
  }

  await createUser(username, password, "admin");
}
