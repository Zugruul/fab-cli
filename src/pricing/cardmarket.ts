// Keyless client for Cardmarket's public S3 catalog downloads — the only
// non-Cloudflare-protected Cardmarket source (repo invariant I6; never scrape
// the product pages themselves). See SPEC-PRICE.md §6.3 (price guide/product
// catalog endpoints) and §8.3 (condition price engine — no per-condition
// data, so NM/rest is derived deterministically from the price guide).
//
// Flesh & Blood is Cardmarket game id 16. Both endpoints return a small JSON
// envelope; callers see the unwrapped array. Every fetch goes through
// cachedFetch (src/pricing/cache.ts) with a 24h default TTL.

import { cachedFetch, type CachedFetchOptions } from "./cache";
import type { ConditionCell, Finish, PriceSource } from "./types";

const PRICE_GUIDE_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_16.json";
const PRODUCTS_URL =
  "https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_16.json";

/**
 * One row of Cardmarket's price guide. No field is guaranteed present — the
 * upstream JSON omits keys rather than sending null (SPEC-PRICE §6.3), so
 * every field is optional here and every access downstream must guard for
 * both "missing key" and "present but null".
 *
 * NOTE: the foil fields contain hyphens (`avg-foil`, not `avgFoil`) and must
 * be accessed via bracket notation. `trend-foil` has an additional quirk:
 * upstream sends `0` (not null/absent) to mean "no data" for that field
 * specifically — this is a Cardmarket data quirk observed only on
 * `trend-foil`, not on any other field (including normal `trend`).
 */
export interface CardmarketPriceGuideRow {
  idProduct: number;
  idCategory?: number;
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
  avg1?: number | null;
  avg7?: number | null;
  avg30?: number | null;
  "avg-foil"?: number | null;
  "low-foil"?: number | null;
  "trend-foil"?: number | null;
  "avg1-foil"?: number | null;
  "avg7-foil"?: number | null;
  "avg30-foil"?: number | null;
}

export interface CardmarketProduct {
  idProduct: number;
  name: string;
  idCategory?: number;
  categoryName?: string;
  idExpansion?: number;
  idMetacard?: number;
  dateAdded?: string;
}

interface PriceGuideEnvelope {
  version?: number;
  createdAt?: string;
  priceGuides: CardmarketPriceGuideRow[];
}

interface ProductsEnvelope {
  version?: number;
  createdAt?: string;
  products: CardmarketProduct[];
}

/** Minimal shape a fetch implementation must satisfy — matches global fetch's Response. */
export type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type FetchFn = (url: string) => Promise<FetchResponse>;

export class CardmarketHttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
  ) {
    super(`Cardmarket S3 request failed: ${status} ${url}`);
    this.name = "CardmarketHttpError";
  }
}

export interface CardmarketOptions extends CachedFetchOptions {
  /** Injectable fetch implementation; defaults to global fetch. Lets tests run fully offline. */
  fetchFn?: FetchFn;
}

async function fetchJson(
  url: string,
  opts: CardmarketOptions,
): Promise<unknown> {
  const fetchFn = opts.fetchFn ?? (fetch as unknown as FetchFn);
  const res = await fetchFn(url);
  if (!res.ok) throw new CardmarketHttpError(url, res.status);
  return res.json();
}

export async function fetchPriceGuide(
  opts: CardmarketOptions = {},
): Promise<CardmarketPriceGuideRow[]> {
  return cachedFetch(
    "cardmarket-price-guide",
    async () => {
      const envelope = (await fetchJson(
        PRICE_GUIDE_URL,
        opts,
      )) as PriceGuideEnvelope;
      return envelope.priceGuides ?? [];
    },
    opts,
  );
}

export async function fetchProducts(
  opts: CardmarketOptions = {},
): Promise<CardmarketProduct[]> {
  return cachedFetch(
    "cardmarket-products",
    async () => {
      const envelope = (await fetchJson(
        PRODUCTS_URL,
        opts,
      )) as ProductsEnvelope;
      return envelope.products ?? [];
    },
    opts,
  );
}

export interface CardmarketData {
  products: CardmarketProduct[];
  priceGuideByProduct: Map<number, CardmarketPriceGuideRow>;
  productsById: Map<number, CardmarketProduct>;
}

/**
 * Fetches both S3 downloads and joins them by idProduct. Products with no
 * guide row and guide rows with no product both survive without throwing —
 * callers (compare.ts) decide how to report the gap (SPEC-PRICE §7.3).
 */
export async function fetchCardmarketData(
  opts: CardmarketOptions = {},
): Promise<CardmarketData> {
  const [products, priceGuide] = await Promise.all([
    fetchProducts(opts),
    fetchPriceGuide(opts),
  ]);

  const priceGuideByProduct = new Map<number, CardmarketPriceGuideRow>();
  for (const row of priceGuide) priceGuideByProduct.set(row.idProduct, row);

  const productsById = new Map<number, CardmarketProduct>();
  for (const product of products) productsById.set(product.idProduct, product);

  return { products, priceGuideByProduct, productsById };
}

export interface ResolvedCardmarketPrices {
  /** NM column: trend, cascading trend -> avg30 -> avg7 -> avg1 -> low. */
  nm: ConditionCell | null;
  /** SP/LP, MP, HP columns: always `low` (or null if low is unavailable). */
  others: ConditionCell | null;
}

/** Field name (sans `-foil` suffix) tried in cascade order for the NM column. */
const NM_CASCADE_FIELDS: readonly ("trend" | "avg30" | "avg7" | "avg1")[] = [
  "trend",
  "avg30",
  "avg7",
  "avg1",
];

function foilKey(field: string): keyof CardmarketPriceGuideRow {
  return `${field}-foil` as keyof CardmarketPriceGuideRow;
}

function fieldValue(
  row: CardmarketPriceGuideRow,
  field: string,
  finish: Finish,
): number | null | undefined {
  return finish === "foil"
    ? (row[foilKey(field)] as number | null | undefined)
    : (row[field as keyof CardmarketPriceGuideRow] as
        number | null | undefined);
}

/**
 * Resolves Cardmarket's non-per-condition price guide row into the domain's
 * NM / SP-LP-MP-HP columns per SPEC-PRICE §8.3:
 *
 * - NM = trend (or trend-foil), source 'trend'; if null/missing (or, for
 *   foil only, exactly 0 — Cardmarket's observed no-data marker for
 *   `trend-foil`) cascade avg30 -> avg7 -> avg1 -> low, keeping the field
 *   name actually used as the source label.
 * - SP/LP, MP, HP = low (or low-foil), source 'low' — always a fallback
 *   since `low` is the cheapest listing of *any* condition, not per-column.
 * - If every field is null/missing, both `nm` and `others` are null.
 */
export function resolvePrices(
  row: CardmarketPriceGuideRow,
  finish: Finish,
): ResolvedCardmarketPrices {
  let nm: ConditionCell | null = null;
  for (const field of NM_CASCADE_FIELDS) {
    const value = fieldValue(row, field, finish);
    const isNoData =
      value == null || (finish === "foil" && field === "trend" && value === 0);
    if (!isNoData) {
      nm = { price: value as number, source: field as PriceSource };
      break;
    }
  }

  const lowValue = fieldValue(row, "low", finish);
  const others: ConditionCell | null =
    lowValue != null ? { price: lowValue, source: "low" } : null;

  if (nm === null && lowValue != null) {
    nm = { price: lowValue, source: "low" };
  }

  return { nm, others };
}
