#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sampleUsageHistory } from "@/lib/usage-monitor/history";

function loadRepoEnvFile(): void {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.join(scriptDir, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const key = match[1];
    if (process.env[key] !== undefined) continue;

    let value = match[2].trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main() {
  loadRepoEnvFile();
  const result = await sampleUsageHistory();
  console.log(JSON.stringify({
    ok: true,
    ...result,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: String(error),
  }));
  process.exit(1);
});
