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
    INSERT INTO accounts (
      id, name, provider, enabled, session_cookie, organization_id,
      auth_mode, last_synced_at, sync_source, subscription_info, sort_order, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let migratedCount = 0;
  let skippedOpenAICount = 0;
  const migrate = db.transaction(() => {
    for (let i = 0; i < config.accounts.length; i++) {
      const acct = config.accounts[i];
      if ((acct.provider || "claude") === "openai") {
        skippedOpenAICount += 1;
        continue;
      }
      const sessionCookie = acct.sessionCookie || null;
      const stamp = acct.updatedAt || acct.createdAt || new Date().toISOString();
      insert.run(
        acct.id,
        acct.name || "Account",
        "claude",
        acct.enabled ? 1 : 0,
        sessionCookie,
        acct.organizationId || null,
        sessionCookie ? "manual_cookie" : null,
        sessionCookie ? stamp : null,
        sessionCookie ? "manual_cookie" : null,
        acct.subscriptionInfo ? JSON.stringify(acct.subscriptionInfo) : null,
        migratedCount,
        acct.createdAt || new Date().toISOString(),
        stamp,
      );
      migratedCount += 1;
    }
  });

  migrate();
  console.log(`Migrated ${migratedCount} Claude accounts from JSON to SQLite.`);
  if (skippedOpenAICount > 0) {
    console.log(`Skipped ${skippedOpenAICount} unsupported legacy OpenAI accounts from JSON.`);
  }

  const backupPath = JSON_PATH + ".bak";
  await fs.rename(JSON_PATH, backupPath);
  console.log(`JSON file backed up to ${backupPath}`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
