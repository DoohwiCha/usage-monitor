import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";

const DB_PATH = path.join(process.cwd(), "data", "usage-monitor.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  mkdirSync(path.dirname(DB_PATH), { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.pragma("busy_timeout = 5000");
  _db.pragma("wal_autocheckpoint = 100");

  runMigrations(_db);
  return _db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 0);
  `);

  const currentVersion = (db.prepare("SELECT version FROM schema_version WHERE id = 1").get() as { version: number }).version;

  const migrations: Array<(db: Database.Database) => void> = [
    // v1: accounts table
    (db) => {
      db.exec(`
        CREATE TABLE accounts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT 'Account',
          provider TEXT NOT NULL CHECK (provider IN ('claude', 'openai')),
          enabled INTEGER NOT NULL DEFAULT 1,
          session_cookie TEXT,
          api_key TEXT,
          organization_id TEXT,
          subscription_info TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
    // v2: users table
    (db) => {
      db.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
    // v3: sessions table
    (db) => {
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          ip_address TEXT,
          user_agent TEXT
        );
        CREATE INDEX idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
      `);
    },
    // v4: rate_limits table
    (db) => {
      db.exec(`
        CREATE TABLE rate_limits (
          key TEXT NOT NULL,
          window_start INTEGER NOT NULL,
          count INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (key, window_start)
        );
        CREATE INDEX idx_rate_limits_key ON rate_limits(key);
      `);
    },
    // v5: audit_log table
    (db) => {
      db.exec(`
        CREATE TABLE audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          user_id TEXT,
          action TEXT NOT NULL,
          resource_type TEXT,
          resource_id TEXT,
          details TEXT,
          ip_address TEXT
        );
        CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);
        CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
      `);
    },
    // v6: usage_snapshots — persist last-known-good usage data across restarts
    (db) => {
      db.exec(`
        CREATE TABLE usage_snapshots (
          account_id TEXT NOT NULL PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
          fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
          usage_json TEXT NOT NULL
        );
      `);
    },
    // v7: soft-delete — add deleted_at column to accounts for data protection
    (db) => {
      db.exec(`
        ALTER TABLE accounts ADD COLUMN deleted_at TEXT DEFAULT NULL;
      `);
    },
  ];

  if (currentVersion < migrations.length) {
    const applyMigrations = db.transaction(() => {
      for (let i = currentVersion; i < migrations.length; i++) {
        migrations[i](db);
      }
      db.prepare("UPDATE schema_version SET version = ? WHERE id = 1").run(migrations.length);
    });
    applyMigrations();
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
