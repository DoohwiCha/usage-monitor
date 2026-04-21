#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

type CliOptions = {
  provider: "claude";
  server: string;
  accountId: string;
  token?: string;
  profileDir?: string;
  browserChannel?: string;
};

function usage(): never {
  console.error(
    [
      "Usage:",
      "  npx tsx scripts/local-sync.ts claude --server https://usage-monitor.hjyeo.com --account-id <id>",
      "",
      "The script will prompt for the sync token so it does not end up in shell history.",
    ].join("\n"),
  );
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const [providerRaw, ...rest] = argv;
  if (providerRaw !== "claude") {
    usage();
  }

  const args = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!key?.startsWith("--") || !value) usage();
    args.set(key, value);
  }

  const server = args.get("--server");
  const accountId = args.get("--account-id");
  if (!server || !accountId) usage();

  return {
    provider: "claude",
    server,
    accountId,
    token: args.get("--token"),
    profileDir: args.get("--profile-dir"),
    browserChannel: args.get("--browser-channel"),
  };
}

async function promptLine(prompt: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

async function promptYesNo(prompt: string): Promise<boolean> {
  const answer = (await promptLine(prompt)).toLowerCase();
  return answer === "y" || answer === "yes";
}

function normalizeServer(server: string): string {
  return server.endsWith("/") ? server.slice(0, -1) : server;
}

function resolveDefaultClaudeProfileDir(accountId: string): string {
  return path.join(process.env.HOME || "", ".usage-monitor-sync", "browser-profiles", "claude", accountId);
}

async function uploadPayload(server: string, accountId: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${server}/api/monitor/accounts/${accountId}/sync-upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({ ok: false, error: "Upload failed." })) as {
    ok?: boolean;
    error?: string;
    message?: string;
  };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Upload failed (HTTP ${response.status}).`);
  }

  console.log(payload.message || "Sync upload completed.");
}

function resolveClaudeBrowserChannels(preferred?: string): Array<"chrome" | "msedge" | "chromium"> {
  if (preferred === "chrome" || preferred === "msedge" || preferred === "chromium") {
    return [preferred];
  }
  return ["chrome", "msedge", "chromium"];
}

async function runClaudeSync(options: CliOptions, token: string): Promise<void> {
  const playwright = await import("playwright").catch(() => null);
  if (!playwright) {
    throw new Error("Playwright is not installed on this machine. Run `npm install` and `npx playwright install chromium` first.");
  }

  const profileDir = options.profileDir || resolveDefaultClaudeProfileDir(options.accountId);
  fs.mkdirSync(profileDir, { recursive: true });

  console.log(`Opening local Claude browser profile: ${profileDir}`);
  let browserContext: Awaited<ReturnType<typeof playwright.chromium.launchPersistentContext>> | null = null;
  const launchErrors: string[] = [];

  for (const channel of resolveClaudeBrowserChannels(options.browserChannel)) {
    try {
      console.log(`Trying browser channel: ${channel}`);
      browserContext = await playwright.chromium.launchPersistentContext(profileDir, {
        headless: false,
        channel: channel === "chromium" ? undefined : channel,
        locale: "en-US",
        viewport: { width: 1365, height: 900 },
        ignoreDefaultArgs: ["--enable-automation"],
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-features=IsolateOrigins,site-per-process",
        ],
      });
      break;
    } catch (error) {
      launchErrors.push(`${channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!browserContext) {
    throw new Error(`Failed to launch a local browser. ${launchErrors.join(" | ")}`);
  }

  try {
    await browserContext.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = browserContext.pages()[0] || await browserContext.newPage();
    await page.goto("https://claude.ai/login", { waitUntil: "domcontentloaded", timeout: 30_000 });
    console.log("Complete Claude login in the opened browser window. If Google SSO says the browser is not secure, use Claude email login instead. Waiting up to 5 minutes...");

    const deadline = Date.now() + 5 * 60 * 1000;
    let verified: {
      ok: boolean;
      email: string;
      orgId: string;
      orgName: string;
    } | null = null;

    while (Date.now() < deadline) {
      verified = await page.evaluate(async () => {
        let email = "";
        try {
          const authRes = await fetch("/api/auth/current_account", {
            headers: { "Content-Type": "application/json" },
          });
          if (authRes.ok) {
            const authData = await authRes.json() as { account?: { email_address?: string }; email_address?: string };
            email = authData.account?.email_address || authData.email_address || "";
          }
        } catch {
          // Ignore until login settles.
        }

        try {
          const orgRes = await fetch("/api/organizations", {
            headers: { "Content-Type": "application/json" },
          });
          if (!orgRes.ok) {
            return { ok: false, email, orgId: "", orgName: "" };
          }
          const orgs = await orgRes.json() as Array<{ uuid: string; name?: string }>;
          if (!Array.isArray(orgs) || orgs.length === 0) {
            return { ok: false, email, orgId: "", orgName: "" };
          }
          return {
            ok: true,
            email,
            orgId: orgs[0].uuid,
            orgName: orgs[0].name || "",
          };
        } catch {
          return { ok: false, email, orgId: "", orgName: "" };
        }
      });

      if (verified?.ok) break;
      await page.waitForTimeout(2500);
    }

    if (!verified?.ok) {
      throw new Error("Claude login was not verified within 5 minutes.");
    }

    const cookies = await browserContext.cookies("https://claude.ai");
    const sessionCookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    if (!sessionCookie) {
      throw new Error("Failed to extract Claude cookies from the local browser session.");
    }

    const displayIdentity = verified.email || verified.orgName || verified.orgId;
    console.log(`Detected Claude identity: ${displayIdentity}`);
    console.log(`Detected organization: ${verified.orgId}`);

    const confirmed = await promptYesNo(`Upload this session to account ${options.accountId}? [y/N] `);
    if (!confirmed) {
      throw new Error("Upload cancelled.");
    }

    await uploadPayload(normalizeServer(options.server), options.accountId, {
      token,
      provider: "claude",
      sessionCookie,
      organizationId: verified.orgId,
      authIdentity: verified.email || "",
    });
  } finally {
    await browserContext.close().catch(() => {});
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = options.token || process.env.MONITOR_SYNC_TOKEN || await promptLine("Paste sync token from the usage-monitor page: ");
  if (!token) {
    throw new Error("Sync token is required.");
  }
  await runClaudeSync(options, token);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
