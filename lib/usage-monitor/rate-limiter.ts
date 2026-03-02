import { getDb } from "@/lib/usage-monitor/db";

interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
}

const DEFAULTS: Record<string, RateLimitConfig> = {
  login: { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  api: { maxAttempts: 100, windowMs: 60 * 1000 },
};

function getWindowStart(windowMs: number): number {
  const now = Date.now();
  return now - (now % windowMs);
}

export function checkRateLimit(key: string, category: string = "api"): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const config = DEFAULTS[category] || DEFAULTS.api;
  const windowStart = getWindowStart(config.windowMs);

  const db = getDb();

  // Clean old entries
  db.prepare("DELETE FROM rate_limits WHERE window_start < ?").run(windowStart - config.windowMs);

  const row = db.prepare("SELECT count FROM rate_limits WHERE key = ? AND window_start = ?").get(key, windowStart) as { count: number } | undefined;

  const currentCount = row?.count || 0;

  if (currentCount >= config.maxAttempts) {
    const retryAfterMs = (windowStart + config.windowMs) - Date.now();
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  // Increment counter
  db.prepare(`
    INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
    ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
  `).run(key, windowStart);

  return {
    allowed: true,
    remaining: config.maxAttempts - currentCount - 1,
    retryAfterMs: 0,
  };
}

export function resetRateLimit(key: string): void {
  const db = getDb();
  db.prepare("DELETE FROM rate_limits WHERE key = ?").run(key);
}
