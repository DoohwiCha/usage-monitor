import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { closeDb, getDb } from "@/lib/usage-monitor/db";

const TEST_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "usage-monitor-tests-"));
process.env.MONITOR_DB_PATH = path.join(TEST_DATA_DIR, "usage-monitor.db");

process.env.MONITOR_ADMIN_USER = "testadmin";
process.env.MONITOR_ADMIN_PASS = "testpassword123";
process.env.MONITOR_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export function resetDb(): void {
  const db = getDb();
  db.exec(`
    DELETE FROM usage_snapshots;
    DELETE FROM audit_log;
    DELETE FROM rate_limits;
    DELETE FROM sessions;
    DELETE FROM users;
    DELETE FROM accounts;
  `);
}

beforeAll(() => {
  resetDb();
});

afterEach(() => {
  resetDb();
});

afterAll(() => {
  closeDb();
  rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});
