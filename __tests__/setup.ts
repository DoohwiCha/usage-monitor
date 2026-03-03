import { closeDb, getDb } from "@/lib/usage-monitor/db";

process.env.MONITOR_ADMIN_USER = "testadmin";
process.env.MONITOR_ADMIN_PASS = "testpassword123";
process.env.MONITOR_SESSION_SECRET = "test-secret-key-for-testing-only-1234567890abcdef";
process.env.MONITOR_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export function resetDb(): void {
  const db = getDb();
  db.exec(`
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
});
