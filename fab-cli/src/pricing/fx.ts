// ECB reference rate client via frankfurter.dev — SPEC-PRICE.md §5, §8.4.
//
// Ratio pages (§8.4, invariant I5) must convert Cardmarket EUR prices to USD
// using a dated ECB rate recorded in the output before dividing. When this
// fetch fails — HTTP or a malformed payload — that failure surfaces as a
// typed error (FxHttpError | FxDataError) so callers can abort ratio-page
// generation cleanly (price pages still produced) rather than emit
// unconverted ratios.

import { cachedFetch, type CachedFetchOptions } from "./cache";

const FX_URL = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD";

/** Attempts on 429/5xx are retried, mirroring cardmarket.ts (SPEC-PRICE §6.4). */
const MAX_ATTEMPTS = 3;

/**
 * Raw frankfurter.dev response shape. No field is guaranteed present —
 * upstream is a third-party JSON API and callers must guard every access.
 */
export interface FrankfurterResponse {
  amount?: number;
  base?: string;
  date?: string;
  rates?: Record<string, unknown>;
}

/** Domain-shaped EUR->USD rate. */
export interface FxRate {
  rate: number;
  date: string;
  base: "EUR";
  quote: "USD";
}

/** Minimal shape a fetch implementation must satisfy — matches global fetch's Response. */
export type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type FetchFn = (url: string) => Promise<FetchResponse>;

export class FxHttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
  ) {
    super(`Frankfurter FX request failed: ${status} ${url}`);
    this.name = "FxHttpError";
  }
}

export class FxDataError extends Error {
  constructor(reason: string) {
    super(`Frankfurter FX response malformed: ${reason}`);
    this.name = "FxDataError";
  }
}

/** Discriminates the two typed failure modes the FX client can raise. */
export type FxError = FxHttpError | FxDataError;

/** True for any error this module raises (SPEC-PRICE §8.4 typed-failure contract). */
export function isFxError(e: unknown): e is FxError {
  return e instanceof FxHttpError || e instanceof FxDataError;
}

export interface FxOptions extends CachedFetchOptions {
  /** Injectable fetch implementation; defaults to global fetch. Lets tests run fully offline. */
  fetchFn?: FetchFn;
  /** Base delay (ms) for exponential retry backoff. Defaults to 300ms. */
  retryBaseMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function fetchJson(url: string, opts: FxOptions): Promise<unknown> {
  const fetchFn = opts.fetchFn ?? (fetch as unknown as FetchFn);
  const retryBaseMs = opts.retryBaseMs ?? 300;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetchFn(url);
    if (res.ok) return res.json();
    if (isRetryableStatus(res.status) && attempt < MAX_ATTEMPTS) {
      await sleep(retryBaseMs * 2 ** (attempt - 1));
      continue;
    }
    throw new FxHttpError(url, res.status);
  }
  // Unreachable: the loop above always returns or throws.
  throw new FxHttpError(url, 0);
}

/**
 * Parses a raw frankfurter response into an `FxRate`, throwing `FxDataError`
 * (never a raw TypeError) for any missing/malformed field.
 */
function parseFxRate(raw: FrankfurterResponse): FxRate {
  if (raw == null || typeof raw !== "object") {
    throw new FxDataError("response is not an object");
  }
  if (typeof raw.date !== "string" || raw.date.length === 0) {
    throw new FxDataError("missing or non-string date");
  }
  if (raw.rates == null || typeof raw.rates !== "object") {
    throw new FxDataError("missing rates object");
  }
  const usd = raw.rates.USD;
  if (typeof usd !== "number" || !Number.isFinite(usd)) {
    throw new FxDataError("missing or non-numeric rates.USD");
  }
  return { rate: usd, date: raw.date, base: "EUR", quote: "USD" };
}

/**
 * Fetches the current ECB EUR->USD reference rate from frankfurter.dev,
 * cached 24h (ECB publishes daily). Throws `FxHttpError` on exhausted
 * HTTP retries or `FxDataError` on a malformed payload — both satisfy
 * `isFxError` so callers can catch and abort ratio-page generation.
 */
export async function fetchEurUsdRate(opts: FxOptions = {}): Promise<FxRate> {
  return cachedFetch(
    "fx-eur-usd",
    async () => {
      const raw = (await fetchJson(FX_URL, opts)) as FrankfurterResponse;
      return parseFxRate(raw);
    },
    opts,
  );
}

/** Converts a EUR amount to USD at the given rate, rounded to 2 decimals. */
export function eurToUsd(amountEur: number, fx: FxRate): number {
  return Math.round(amountEur * fx.rate * 100) / 100;
}

/** Converts a USD amount to EUR at the given rate, rounded to 2 decimals. */
export function usdToEur(amountUsd: number, fx: FxRate): number {
  return Math.round((amountUsd / fx.rate) * 100) / 100;
}
