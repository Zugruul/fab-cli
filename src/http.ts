// Shared HTTP layer — browser headers, retry/backoff, bounded concurrency,
// and an opt-in TTL disk cache. See docs/design/fab-E1.md (FAB-011).

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ─── concurrency ──────────────────────────────────────────────────────────

export const APPSYNC_MAX_CONCURRENCY = 4;
export const FABTCG_MAX_CONCURRENCY = 5;

/** Creates a bounded-concurrency limiter: `limit(fn)` runs `fn` once fewer
 *  than `max` calls are currently in flight. */
export function createLimiter(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  const runNext = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const next = queue.shift()!;
    next();
  };

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            runNext();
          });
      });
      runNext();
    });
  };
}

// ─── host header presets ─────────────────────────────────────────────────

export const FABTCG_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://fabtcg.com/",
};

export const FABTCG_JSON_HEADERS: Record<string, string> = {
  ...FABTCG_HEADERS,
  Accept: "application/json",
};

export const FABRARY_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Origin: "https://fabrary.net",
  Referer: "https://fabrary.net/",
  Accept: "application/json, text/html, */*",
};

export type HostPreset = "fabtcg" | "fabtcgJson" | "fabrary";

function presetHeaders(preset?: HostPreset): Record<string, string> {
  switch (preset) {
    case "fabtcg":
      return FABTCG_HEADERS;
    case "fabtcgJson":
      return FABTCG_JSON_HEADERS;
    case "fabrary":
      return FABRARY_HEADERS;
    default:
      return {};
  }
}

// ─── retry/backoff fetch ──────────────────────────────────────────────────

// WAF 403s and rate limits are transient — retry them, never treat as a
// fatal auth failure (never re-login to "fix" a 403).
const RETRYABLE_STATUSES = new Set([403, 429, 500, 502, 503, 504]);

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  preset?: HostPreset;
  method?: string;
  body?: BodyInit;
  /** Number of retries after the first attempt (default 3). */
  retries?: number;
  /** Base backoff delay in ms, doubled per attempt (default 300). */
  retryBaseMs?: number;
  /** Injectable sleep, for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** `fetch` with host-preset headers and retry/backoff on 403/429/5xx.
 *  Non-retryable statuses (e.g. 404) return immediately, same as raw fetch. */
export async function httpFetch(
  url: string,
  opts: HttpRequestOptions = {},
): Promise<Response> {
  const headers = { ...presetHeaders(opts.preset), ...opts.headers };
  const retries = opts.retries ?? 3;
  const retryBaseMs = opts.retryBaseMs ?? 300;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: opts.method,
      body: opts.body,
      headers,
    });

    if (res.ok || !RETRYABLE_STATUSES.has(res.status) || attempt >= retries) {
      return res;
    }

    await sleep(retryBaseMs * 2 ** attempt);
  }
}

// ─── opt-in TTL disk cache ─────────────────────────────────────────────────

export const DEFAULT_HTTP_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Resolves the shared HTTP cache directory. Precedence: explicit
 *  `override` > `FAB_HTTP_CACHE_DIR` env var > default (~/.cache/fab-cli). */
export function getHttpCacheDir(override?: string): string {
  if (override) return override;
  if (process.env.FAB_HTTP_CACHE_DIR) return process.env.FAB_HTTP_CACHE_DIR;
  return path.join(os.homedir(), ".cache", "fab-cli");
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
  /** Override the cache directory (also settable via FAB_HTTP_CACHE_DIR). */
  cacheDir?: string;
}

/** Fetch-through JSON disk cache. Opt-in per call — nothing is cached
 *  unless the caller invokes this explicitly. A fresh entry (age < ttl) is
 *  returned without invoking `fetcher`; a stale/missing entry calls
 *  `fetcher` and writes the result. Fetcher errors propagate even with a
 *  stale cache present — stale values are never silently served on failure. */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: CachedFetchOptions = {},
): Promise<T> {
  const ttlMs = opts.ttlMs ?? DEFAULT_HTTP_CACHE_TTL_MS;
  const dir = getHttpCacheDir(opts.cacheDir);
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
