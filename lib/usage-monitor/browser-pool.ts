import type { Browser } from "playwright";

const MAX_CONCURRENT_BROWSERS = 2;
let activeBrowserCount = 0;
const waitQueue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

export class BrowserPoolExhaustedError extends Error {
  constructor() {
    super("Too many concurrent browser sessions. Try again later.");
    this.name = "BrowserPoolExhaustedError";
  }
}

export async function acquireBrowserSlot(timeoutMs = 30_000): Promise<void> {
  if (activeBrowserCount < MAX_CONCURRENT_BROWSERS) {
    activeBrowserCount++;
    return;
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waitQueue.findIndex((w) => w.resolve === resolve);
      if (idx !== -1) waitQueue.splice(idx, 1);
      reject(new BrowserPoolExhaustedError());
    }, timeoutMs);

    waitQueue.push({
      resolve: () => { clearTimeout(timer); activeBrowserCount++; resolve(); },
      reject,
    });
  });
}

export function releaseBrowserSlot(): void {
  activeBrowserCount = Math.max(0, activeBrowserCount - 1);
  const next = waitQueue.shift();
  if (next) next.resolve();
}

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  await acquireBrowserSlot();
  let browser: Browser | null = null;
  try {
    const pw = await import("playwright").catch(() => null);
    if (!pw) throw new Error("Playwright is not installed.");
    browser = await pw.chromium.launch({ headless: true });
    return await fn(browser);
  } finally {
    if (browser) await browser.close().catch(() => {});
    releaseBrowserSlot();
  }
}

export function getPoolStats() {
  return { active: activeBrowserCount, queued: waitQueue.length, max: MAX_CONCURRENT_BROWSERS };
}
