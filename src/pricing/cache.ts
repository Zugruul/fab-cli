// Generic JSON disk cache for bulk pricing downloads — see SPEC-PRICE.md §5, §11.
//
// Cache dir defaults to ~/.config/fabrary-search/cache/pricing/ (created
// recursively on demand), mirroring src/config.ts's config-dir convention.
// Safe to delete at any time.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Resolves the pricing cache directory. Precedence: explicit `override` >
 * `FAB_PRICING_CACHE_DIR` env var > default (~/.config/fabrary-search/cache/pricing).
 * Overriding lets tests avoid ever touching the real home dir.
 */
export function getPricingCacheDir(override?: string): string {
  if (override) return override;
  if (process.env.FAB_PRICING_CACHE_DIR)
    return process.env.FAB_PRICING_CACHE_DIR;
  return path.join(
    os.homedir(),
    ".config",
    "fabrary-search",
    "cache",
    "pricing",
  );
}

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, "_");
}

interface CacheRecord<T> {
  fetchedAt: number;
  value: T;
}

function isCacheRecord<T>(value: unknown): value is CacheRecord<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).fetchedAt === "number" &&
    "value" in (value as Record<string, unknown>)
  );
}

function readCacheRecord<T>(file: string): CacheRecord<T> | null {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isCacheRecord<T>(parsed) ? parsed : null;
  } catch {
    // Missing, unreadable, or unparseable — treat as no cache (self-heal).
    return null;
  }
}

export interface CachedFetchOptions {
  /** Cache lifetime in ms. Defaults to 24h. */
  ttlMs?: number;
  /** When true, always calls the fetcher and rewrites the cache. */
  refresh?: boolean;
  /** Override the cache directory (also settable via FAB_PRICING_CACHE_DIR). */
  cacheDir?: string;
}

/**
 * Fetch-through JSON disk cache. A fresh cache entry (age < ttl) is returned
 * without invoking `fetcher`. A stale or missing entry triggers `fetcher`,
 * and the result is written to disk. `refresh: true` always calls `fetcher`.
 * If `fetcher` throws, the error propagates even when a stale cache exists
 * on disk — stale values are never silently served on a fetch failure.
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: CachedFetchOptions = {},
): Promise<T> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const dir = getPricingCacheDir(opts.cacheDir);
  const file = path.join(dir, `${sanitizeKey(key)}.json`);

  if (!opts.refresh) {
    const cached = readCacheRecord<T>(file);
    if (cached && Date.now() - cached.fetchedAt < ttlMs) {
      return cached.value;
    }
  }

  const value = await fetcher();

  const record: CacheRecord<T> = { fetchedAt: Date.now(), value };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record));

  return value;
}
