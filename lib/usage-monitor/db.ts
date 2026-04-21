import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";

let _db: Database.Database | null = null;
let _dbPath: string | null = null;

function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

export function resolveDbPath(): string {
  const configuredPath = process.env.MONITOR_DB_PATH?.trim();
  if (!configuredPath) {
    return path.join(process.cwd(), "data", "usage-monitor.db");
  }

  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(configuredPath);
}

export function getDb(): Database.Database {
  const dbPath = resolveDbPath();

  if (_db && _dbPath === dbPath) return _db;
  if (_db && _dbPath !== dbPath) {
    _db.close();
    _db = null;
  }

  mkdirSync(path.dirname(dbPath), { recursive: true });

  _db = new Database(dbPath);
  _dbPath = dbPath;
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
    // v8: account auth metadata for local sync flows
    (db) => {
      db.exec(`
        ALTER TABLE accounts ADD COLUMN auth_mode TEXT DEFAULT NULL;
        ALTER TABLE accounts ADD COLUMN auth_identity TEXT DEFAULT NULL;
        ALTER TABLE accounts ADD COLUMN last_synced_at TEXT DEFAULT NULL;
        ALTER TABLE accounts ADD COLUMN sync_source TEXT DEFAULT NULL;
      `);
    },
    // v9: one-time account sync sessions for local helper uploads
    (db) => {
      db.exec(`
        CREATE TABLE account_sync_sessions (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          provider TEXT NOT NULL CHECK (provider IN ('claude', 'openai')),
          issued_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          used_at TEXT DEFAULT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_account_sync_sessions_account_id ON account_sync_sessions(account_id);
        CREATE INDEX idx_account_sync_sessions_expires_at ON account_sync_sessions(expires_at);
      `);
    },
    // v10: auth store metadata for file-backed credential sources
    (db) => {
      db.exec(`
        ALTER TABLE accounts ADD COLUMN source_path TEXT DEFAULT NULL;
        ALTER TABLE accounts ADD COLUMN source_account_id TEXT DEFAULT NULL;
        ALTER TABLE accounts ADD COLUMN source_expires_at TEXT DEFAULT NULL;
      `);
    },
    // v11: append-only usage window history and sampler runs
    (db) => {
      db.exec(`
        CREATE TABLE usage_window_samples (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          provider TEXT NOT NULL CHECK (provider IN ('claude', 'openai')),
          window_key TEXT NOT NULL,
          bucket_start TEXT NOT NULL,
          sampled_at TEXT NOT NULL,
          utilization_pct REAL NOT NULL,
          resets_at TEXT DEFAULT NULL,
          sample_kind TEXT NOT NULL CHECK (sample_kind IN ('observed', 'carried_forward')),
          UNIQUE(account_id, window_key, bucket_start)
        );
        CREATE INDEX idx_usage_window_samples_account_bucket
          ON usage_window_samples(account_id, bucket_start);
        CREATE INDEX idx_usage_window_samples_window_bucket
          ON usage_window_samples(window_key, bucket_start);

        CREATE TABLE usage_sampler_runs (
          id TEXT PRIMARY KEY,
          bucket_start TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT DEFAULT NULL,
          status TEXT NOT NULL CHECK (status IN ('ok', 'partial', 'error')),
          observed_count INTEGER NOT NULL DEFAULT 0,
          carried_forward_count INTEGER NOT NULL DEFAULT 0,
          details_json TEXT,
          UNIQUE(bucket_start)
        );
        CREATE INDEX idx_usage_sampler_runs_bucket_start ON usage_sampler_runs(bucket_start);
      `);
    },
    // v12: retire legacy/conflicting OpenAI account modes
    (db) => {
      db.exec(`
        UPDATE accounts
        SET
          deleted_at = COALESCE(deleted_at, datetime('now')),
          updated_at = datetime('now')
        WHERE
          provider = 'openai'
          AND deleted_at IS NULL
          AND (
            auth_mode = 'api_key'
            OR auth_mode = 'local_sync'
            OR sync_source = 'openai_api_key'
            OR sync_source = 'openai_metrics'
          );
      `);
    },
    // v13: remove retired api_key storage column from accounts
    (db) => {
      if (columnExists(db, "accounts", "api_key")) {
        db.exec(`
          ALTER TABLE accounts DROP COLUMN api_key;
        `);
      }
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
  _dbPath = null;
}
