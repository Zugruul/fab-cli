// Keyless client for TCGplayer's own storefront search endpoint — the only
// keyless source of per-condition live listing prices (the official API is
// closed, repo invariant I1). See SPEC-PRICE.md §6.2 (endpoint/body shape)
// and §6.4 (rate limiting: concurrency ≤4, retry/backoff, 403 degradation).
//
// Deliberately uncached (unlike tcgcsv.ts): listing prices are live data, so
// callers get a fresh page on every call.

import type { ConditionColumn } from "./types";
import { mapWithConcurrency } from "./tcgcsv";

const SEARCH_BASE_URL = "https://mp-search-api.tcgplayer.com/v1/search/request";
const PRODUCT_LINE_NAME = "flesh-and-blood-tcg";

/** Attempts on 429/5xx are retried, per SPEC-PRICE §6.4. 403 is never retried (see StorefrontBlockedError). */
const MAX_ATTEMPTS = 3;

/** Repo invariant: never exceed 4 concurrent requests against one host. */
const MAX_CONCURRENCY = 4;

const DEFAULT_PAGE_SIZE = 50;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** TCGplayer's own condition strings. "Damaged" is intentionally omitted (SPEC-PRICE §4.1 drops it). */
export type TcgplayerCondition =
  "Near Mint" | "Lightly Played" | "Moderately Played" | "Heavily Played";

/** TCGplayer condition -> domain ConditionColumn (SPEC-PRICE §4.1). */
export const CONDITION_TO_COLUMN: Record<TcgplayerCondition, ConditionColumn> =
  {
    "Near Mint": "NM",
    "Lightly Played": "SP/LP",
    "Moderately Played": "MP",
    "Heavily Played": "HP",
  };

const ALL_CONDITIONS: readonly TcgplayerCondition[] = [
  "Near Mint",
  "Lightly Played",
  "Moderately Played",
  "Heavily Played",
];

/** Raw shape of one listing embedded on a storefront search result (SPEC-PRICE §6.2). */
export interface StorefrontListing {
  condition: string;
  printing?: string;
  price: number;
  shippingPrice?: number;
  quantity?: number;
  sellerName?: string;
}

/** Raw shape of one product in a storefront search page. */
export interface StorefrontProductResult {
  productId: number;
  productUrlName?: string;
  setUrlName?: string;
  rarityName?: string;
  marketPrice?: number | null;
  printing?: string;
  /** Absent entirely for some products with zero listings, not just an empty array — never assume the key is present. */
  listings?: StorefrontListing[];
}

interface StorefrontSearchResponseBody {
  errors: string[];
  results: Array<{
    totalResults?: number;
    aggregations?: unknown;
    results: StorefrontProductResult[];
  }>;
}

/** Minimal shape a fetch implementation must satisfy — matches global fetch's Response. */
export type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

export type FetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponse>;

export class StorefrontHttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
  ) {
    super(`TCGplayer storefront search request failed: ${status} ${url}`);
    this.name = "StorefrontHttpError";
  }
}

/**
 * The storefront search host returned 403 — this is bot protection / rate
 * limiting, not a normal error, per SPEC-PRICE §6.4 / I2: never retry-storm
 * on it. Backing off (≥60s) and falling back to market-price data is the
 * CALLER's decision; this client only signals the condition.
 */
export class StorefrontBlockedError extends Error {
  constructor(public readonly url: string) {
    super(`TCGplayer storefront search blocked (403): ${url}`);
    this.name = "StorefrontBlockedError";
  }
}

export interface TcgplayerSearchOptions {
  /** Injectable fetch implementation; defaults to global fetch. Lets tests run fully offline. */
  fetchFn?: FetchFn;
  /** Base delay (ms) for exponential retry backoff. Defaults to 300ms. */
  retryBaseMs?: number;
  /** Page size used by fetchConditionListingsForSet / fetchProductConditions. Defaults to 50. */
  pageSize?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function buildRequestBody(params: {
  q?: string;
  setName?: string;
  condition: TcgplayerCondition;
  printing?: string;
  from: number;
  size: number;
}): unknown {
  const term: Record<string, unknown> = {
    productLineName: [PRODUCT_LINE_NAME],
  };
  if (params.setName) term.setName = [params.setName];

  const listingTerm: Record<string, unknown> = {
    sellerStatus: "Live",
    channelId: 0,
    condition: [params.condition],
  };
  if (params.printing) listingTerm.printing = [params.printing];

  return {
    algorithm: "sales_synonym_v2",
    from: params.from,
    size: params.size,
    filters: { term },
    listingSearch: {
      context: { cart: {} },
      filters: {
        term: listingTerm,
        range: { quantity: { gte: 1 } },
      },
    },
    context: { cart: {}, shippingCountry: "US" },
    settings: { useFuzzySearch: Boolean(params.q) },
    sort: { field: "price", order: "asc" },
  };
}

async function postSearch(
  q: string | undefined,
  body: unknown,
  opts: TcgplayerSearchOptions,
): Promise<StorefrontSearchResponseBody> {
  const fetchFn = opts.fetchFn ?? (fetch as unknown as FetchFn);
  const retryBaseMs = opts.retryBaseMs ?? 300;
  const url = `${SEARCH_BASE_URL}?q=${encodeURIComponent(q ?? "")}&isList=false`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        Origin: "https://www.tcgplayer.com",
        Referer: "https://www.tcgplayer.com/",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      return (await res.json()) as StorefrontSearchResponseBody;
    }
    if (res.status === 403) {
      throw new StorefrontBlockedError(url);
    }
    if (isRetryableStatus(res.status) && attempt < MAX_ATTEMPTS) {
      await sleep(retryBaseMs * 2 ** (attempt - 1));
      continue;
    }
    throw new StorefrontHttpError(url, res.status);
  }
  // Unreachable: the loop above always returns or throws.
  throw new StorefrontHttpError(url, 0);
}

export interface SearchProductListingsQuery {
  q?: string;
  setName?: string;
  condition: TcgplayerCondition;
  printing?: string;
  from?: number;
  size?: number;
}

export interface ProductLowestListing {
  condition: TcgplayerCondition;
  price: number;
  shippingPrice?: number;
  sellerName?: string;
}

export interface ParsedStorefrontProduct {
  productId: number;
  productUrlName?: string;
  setUrlName?: string;
  rarityName?: string;
  marketPrice?: number | null;
  printing?: string;
  /** Extracted from listings[0] — listings come back price-ascending (SPEC-PRICE §6.2). Null when the condition has no live listings. */
  lowestListing: ProductLowestListing | null;
}

export interface SearchProductListingsPage {
  totalResults: number;
  products: ParsedStorefrontProduct[];
}

/** One page of storefront search results, parsed into typed products with per-condition lowest-listing extraction. */
export async function searchProductListings(
  query: SearchProductListingsQuery,
  opts: TcgplayerSearchOptions = {},
): Promise<SearchProductListingsPage> {
  const from = query.from ?? 0;
  const size = query.size ?? DEFAULT_PAGE_SIZE;
  const body = buildRequestBody({ ...query, from, size });
  const response = await postSearch(query.q, body, opts);

  const result = response.results[0];
  const rawProducts = result?.results ?? [];

  const products: ParsedStorefrontProduct[] = rawProducts.map((p) => {
    const listings = p.listings ?? [];
    return {
      productId: p.productId,
      productUrlName: p.productUrlName,
      setUrlName: p.setUrlName,
      rarityName: p.rarityName,
      marketPrice: p.marketPrice,
      printing: p.printing,
      lowestListing:
        listings.length > 0
          ? {
              condition: query.condition,
              price: listings[0].price,
              shippingPrice: listings[0].shippingPrice,
              sellerName: listings[0].sellerName,
            }
          : null,
    };
  });

  return {
    totalResults: result?.totalResults ?? products.length,
    products,
  };
}

/**
 * Paginates a (set, condition) storefront search until all product pages are
 * consumed. Export batching per SPEC-PRICE §6.2: one such call per (set,
 * condition), size ≈50.
 */
export async function fetchConditionListingsForSet(
  setUrlValue: string,
  condition: TcgplayerCondition,
  opts: TcgplayerSearchOptions = {},
): Promise<Map<number, number>> {
  const size = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const lowestByProductId = new Map<number, number>();

  let from = 0;
  let total = Infinity;

  while (from < total) {
    const page = await searchProductListings(
      { setName: setUrlValue, condition, from, size },
      opts,
    );
    total = page.totalResults;

    for (const product of page.products) {
      if (product.lowestListing) {
        lowestByProductId.set(product.productId, product.lowestListing.price);
      }
    }

    if (page.products.length === 0) break; // safety net against a bad totalResults never being reached
    from += size;
  }

  return lowestByProductId;
}

/** Per-productId lowest listing price, one entry per domain condition column (null when that condition has no listing). */
export type ConditionPriceMap = Record<ConditionColumn, number | null>;

function emptyConditionPriceMap(): ConditionPriceMap {
  return { NM: null, "SP/LP": null, MP: null, HP: null };
}

/**
 * For a single search query, fetches all four conditions (concurrency capped
 * at 4, matching MAX_CONCURRENCY) and returns each product's lowest listing
 * price per domain condition column. Used by the single-card command
 * (PRICE-012).
 */
export async function fetchProductConditions(
  q: string,
  opts: TcgplayerSearchOptions = {},
): Promise<Map<number, ConditionPriceMap>> {
  const size = opts.pageSize ?? DEFAULT_PAGE_SIZE;

  const pages = await mapWithConcurrency(
    ALL_CONDITIONS as TcgplayerCondition[],
    MAX_CONCURRENCY,
    (condition) => searchProductListings({ q, condition, from: 0, size }, opts),
  );

  const byProductId = new Map<number, ConditionPriceMap>();
  pages.forEach((page, i) => {
    const condition = ALL_CONDITIONS[i];
    const column = CONDITION_TO_COLUMN[condition];
    for (const product of page.products) {
      const entry =
        byProductId.get(product.productId) ?? emptyConditionPriceMap();
      entry[column] = product.lowestListing
        ? product.lowestListing.price
        : null;
      byProductId.set(product.productId, entry);
    }
  });

  return byProductId;
}
