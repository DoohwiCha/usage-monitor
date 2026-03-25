import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type BrowserProfileProvider = "claude" | "openai";

export function resolveBrowserProfileRoot(): string {
  const configuredRoot = process.env.MONITOR_BROWSER_PROFILE_ROOT?.trim();
  if (!configuredRoot) {
    return path.join(os.homedir(), ".usage-monitor", "browser-profiles");
  }

  return path.isAbsolute(configuredRoot)
    ? configuredRoot
    : path.resolve(configuredRoot);
}

export function resolveBrowserProfilePath(provider: BrowserProfileProvider, accountId: string): string {
  const root = resolveBrowserProfileRoot();
  const separator = root.endsWith(path.sep) ? "" : path.sep;
  return `${root}${separator}${provider}-${accountId}`;
}

export function resolveBrowserProfileCandidates(provider: BrowserProfileProvider, accountId: string): string[] {
  const configured = resolveBrowserProfilePath(provider, accountId);
  const legacy = path.resolve("data", "browser-profiles", `${provider}-${accountId}`);
  return Array.from(new Set([configured, legacy]));
}

export function resolveExistingBrowserProfilePath(provider: BrowserProfileProvider, accountId: string): string | null {
  for (const candidate of resolveBrowserProfileCandidates(provider, accountId)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
