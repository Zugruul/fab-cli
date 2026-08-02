// Keyless client for the tcgcsv.com daily TCGplayer mirror — see
// SPEC-PRICE.md §6.1 (groups/products/prices) and §6.4 (rate limiting).
//
// Flesh & Blood is TCGplayer category 62. Every endpoint returns a JSON
// envelope `{ results: [...] }` which callers see unwrapped. Every fetch
// goes through cachedFetch (src/pricing/cache.ts) with a 24h default TTL.

import { cachedFetch, type CachedFetchOptions } from "./cache";

const BASE_URL = "https://tcgcsv.com/tcgplayer/62";

/** Attempts 429/5xx responses are retried, per SPEC-PRICE §6.4. */
const MAX_ATTEMPTS = 3;

/** Repo invariant: never exceed 4 concurrent requests against one host. */
const MAX_CONCURRENCY = 4;

export interface Group {
  groupId: number;
  name: string;
  publishedOn?: string;
}

export interface Product {
  productId: number;
  name: string;
  groupId: number;
  url?: string;
}

export interface TcgcsvPriceRow {
  productId: number;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  directLowPrice: number | null;
  /**
   * NOT a plain "Normal"/"Foil" literal in production — observed real values
   * include "1st Edition Normal", "Unlimited Edition Normal", "1st Edition
   * Rainbow Foil", "Cold Foil" (issue #61 follow-up). Callers determining
   * finish MUST check `.includes("Foil")`, never an exact-match comparison.
   */
  subTypeName: string;
}

export interface GroupData {
  products: Product[];
  prices: TcgcsvPriceRow[];
  /** Prices for a productId, one entry per subTypeName (Normal/Foil). */
  pricesByProductId: Map<number, TcgcsvPriceRow[]>;
  /** True when the prices endpoint returned 0 rows (e.g. a just-released set — SPEC §6.1). */
  emptyPrices: boolean;
}

/** Minimal shape a fetch implementation must satisfy — matches global fetch's Response. */
export type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type FetchFn = (url: string) => Promise<FetchResponse>;

/**
 * tcgcsv.com 401s requests with no User-Agent header (Node's default fetch
 * sends none) — issue #45's OWNER comment. Only used when a caller doesn't
 * inject its own `fetchFn` (tests, or a caller with different needs) — an
 * override always wins, preserving test injectability.
 */
const DEFAULT_USER_AGENT = "Mozilla/5.0";

function defaultFetchFn(url: string): Promise<FetchResponse> {
  return fetch(url, {
    headers: { "User-Agent": DEFAULT_USER_AGENT },
  }) as unknown as Promise<FetchResponse>;
}

export class TcgcsvHttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
  ) {
    super(`tcgcsv request failed: ${status} ${url}`);
    this.name = "TcgcsvHttpError";
  }
}

export interface TcgcsvOptions extends CachedFetchOptions {
  /** Injectable fetch implementation; defaults to global fetch. Lets tests run fully offline. */
  fetchFn?: FetchFn;
  /** Base delay (ms) for exponential retry backoff. Defaults to 300ms. */
  retryBaseMs?: number;
}

interface Envelope<T> {
  results: T[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function fetchEnvelope<T>(
  url: string,
  opts: TcgcsvOptions,
): Promise<T[]> {
  const fetchFn = opts.fetchFn ?? defaultFetchFn;
  const retryBaseMs = opts.retryBaseMs ?? 300;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetchFn(url);
    if (res.ok) {
      const envelope = (await res.json()) as Envelope<T>;
      return envelope.results;
    }
    if (isRetryableStatus(res.status) && attempt < MAX_ATTEMPTS) {
      await sleep(retryBaseMs * 2 ** (attempt - 1));
      continue;
    }
    throw new TcgcsvHttpError(url, res.status);
  }
  // Unreachable: the loop above always returns or throws.
  throw new TcgcsvHttpError(url, 0);
}

export async function fetchGroups(opts: TcgcsvOptions = {}): Promise<Group[]> {
  return cachedFetch(
    "tcgcsv-groups",
    () => fetchEnvelope<Group>(`${BASE_URL}/groups`, opts),
    opts,
  );
}

export async function fetchGroupProducts(
  groupId: number,
  opts: TcgcsvOptions = {},
): Promise<Product[]> {
  return cachedFetch(
    `tcgcsv-products-${groupId}`,
    () => fetchEnvelope<Product>(`${BASE_URL}/${groupId}/products`, opts),
    opts,
  );
}

export async function fetchGroupPrices(
  groupId: number,
  opts: TcgcsvOptions = {},
): Promise<TcgcsvPriceRow[]> {
  return cachedFetch(
    `tcgcsv-prices-${groupId}`,
    () => fetchEnvelope<TcgcsvPriceRow>(`${BASE_URL}/${groupId}/prices`, opts),
    opts,
  );
}

/** Convenience: fetches a group's products + prices and joins them by productId. */
export async function fetchGroupData(
  groupId: number,
  opts: TcgcsvOptions = {},
): Promise<GroupData> {
  const [products, prices] = await Promise.all([
    fetchGroupProducts(groupId, opts),
    fetchGroupPrices(groupId, opts),
  ]);

  const pricesByProductId = new Map<number, TcgcsvPriceRow[]>();
  for (const price of prices) {
    const existing = pricesByProductId.get(price.productId);
    if (existing) existing.push(price);
    else pricesByProductId.set(price.productId, [price]);
  }

  return {
    products,
    prices,
    pricesByProductId,
    emptyPrices: prices.length === 0,
  };
}

/**
 * Runs `fn` over `items` with bounded concurrency, preserving result order.
 * `limit` is clamped to MAX_CONCURRENCY (4) regardless of what's requested —
 * the repo invariant of ≤4 concurrent requests per host is non-negotiable.
 */
export function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const cap = Math.max(1, Math.min(limit, MAX_CONCURRENCY));
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }

  const workerCount = Math.min(cap, items.length);
  return Promise.all(Array.from({ length: workerCount }, worker)).then(
    () => results,
  );
}
