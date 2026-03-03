interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes (Claude /usage has strict rate limits)

// Rate-limit backoff: tracks when an account was last rate-limited
const rateLimitBackoff = new Map<string, number>(); // key -> backoff-until timestamp
const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes after 429 (rate limit clears quickly)

// Stale cache: keeps last-known-good data even after primary cache expires
const staleCache = new Map<string, unknown>();

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function getStale<T>(key: string): T | null {
  const data = staleCache.get(key);
  return data ? (data as T) : null;
}

export function setCached<T>(key: string, data: T, ttlMs = DEFAULT_TTL_MS): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  staleCache.set(key, data); // always keep a stale copy
}

export function isRateLimited(key: string): boolean {
  const until = rateLimitBackoff.get(key);
  if (!until || Date.now() > until) {
    rateLimitBackoff.delete(key);
    return false;
  }
  return true;
}

export function markRateLimited(key: string, backoffMs = RATE_LIMIT_BACKOFF_MS): void {
  rateLimitBackoff.set(key, Date.now() + backoffMs);
}

export function invalidateCache(keyPrefix?: string): void {
  if (!keyPrefix) { cache.clear(); rateLimitBackoff.clear(); return; }
  for (const key of cache.keys()) {
    if (key.startsWith(keyPrefix)) cache.delete(key);
  }
  for (const key of rateLimitBackoff.keys()) {
    if (key.startsWith(keyPrefix)) rateLimitBackoff.delete(key);
  }
}
