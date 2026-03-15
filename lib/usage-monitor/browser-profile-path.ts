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
