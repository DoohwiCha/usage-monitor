/**
 * Migration script: JSON file store -> SQLite
 * Run with: npx tsx scripts/migrate-json-to-sqlite.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { getDb } from "../lib/usage-monitor/db";

const JSON_PATH = path.join(process.cwd(), "data", "usage-monitor.json");

interface JsonAccount {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
  sessionCookie?: string;
  apiKey?: string;
  organizationId?: string;
  subscriptionInfo?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface JsonConfig {
  accounts: JsonAccount[];
}

async function main() {
  let raw: string;
  try {
    raw = await fs.readFile(JSON_PATH, "utf-8");
  } catch {
    console.log("No JSON file found at", JSON_PATH, "— nothing to migrate.");
    return;
  }

  const config = JSON.parse(raw) as JsonConfig;
  if (!config.accounts || config.accounts.length === 0) {
    console.log("JSON file has no accounts — nothing to migrate.");
    return;
  }

  const db = getDb();
  const existing = (db.prepare("SELECT COUNT(*) as cnt FROM accounts").get() as { cnt: number }).cnt;
  if (existing > 0) {
    console.log(`SQLite already has ${existing} accounts. Skipping migration to avoid duplicates.`);
    return;
  }

  const insert = db.prepare(`
    INSERT INTO accounts (id, name, provider, enabled, session_cookie, api_key, organization_id, subscription_info, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const migrate = db.transaction(() => {
    for (let i = 0; i < config.accounts.length; i++) {
      const acct = config.accounts[i];
      insert.run(
        acct.id,
        acct.name || "Account",
        acct.provider || "claude",
        acct.enabled ? 1 : 0,
        acct.sessionCookie || null,
        acct.apiKey || null,
        acct.organizationId || null,
        acct.subscriptionInfo ? JSON.stringify(acct.subscriptionInfo) : null,
        i,
        acct.createdAt || new Date().toISOString(),
        acct.updatedAt || new Date().toISOString(),
      );
    }
  });

  migrate();
  console.log(`Migrated ${config.accounts.length} accounts from JSON to SQLite.`);

  const backupPath = JSON_PATH + ".bak";
  await fs.rename(JSON_PATH, backupPath);
  console.log(`JSON file backed up to ${backupPath}`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
