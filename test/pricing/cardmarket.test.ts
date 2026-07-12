import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  fetchPriceGuide,
  fetchProducts,
  fetchCardmarketData,
  resolvePrices,
  CardmarketHttpError,
  type CardmarketPriceGuideRow,
  type FetchFn,
} from "../../src/pricing/cardmarket";

const FIXTURES_DIR = path.join(
  __dirname,
  "..",
  "fixtures",
  "pricing",
  "cardmarket",
);

function loadFixture(name: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, `${name}.json`), "utf8"),
  );
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function routedFetchFn(
  routes: Record<string, unknown>,
  fallbackStatus = 404,
): FetchFn {
  return async (url: string) => {
    for (const [needle, body] of Object.entries(routes)) {
      if (url.includes(needle)) return jsonResponse(body);
    }
    return jsonResponse({}, fallbackStatus);
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "fab-cli-cardmarket-"),
  );
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function priceGuideFetchFn(): FetchFn {
  return routedFetchFn({
    priceGuide: loadFixture("price_guide_16"),
    productList: loadFixture("products_singles_16"),
  });
}

describe("fetchPriceGuide", () => {
  it("unwraps the envelope into a typed price guide row list", async () => {
    const fetchFn = vi.fn(priceGuideFetchFn());

    const rows = await fetchPriceGuide({ cacheDir: tmpDir, fetchFn });

    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ idProduct: 100, trend: 5.75 });
  });

  it("hits the cache on a second call and never re-invokes fetchFn", async () => {
    const fetchFn = vi.fn(priceGuideFetchFn());

    await fetchPriceGuide({ cacheDir: tmpDir, fetchFn });
    const callsAfterFirst = fetchFn.mock.calls.length;
    await fetchPriceGuide({ cacheDir: tmpDir, fetchFn });

    expect(fetchFn.mock.calls.length).toBe(callsAfterFirst);
  });

  it("--refresh bypasses the cache and calls fetchFn again", async () => {
    const fetchFn = vi.fn(priceGuideFetchFn());

    await fetchPriceGuide({ cacheDir: tmpDir, fetchFn });
    const callsAfterFirst = fetchFn.mock.calls.length;
    await fetchPriceGuide({ cacheDir: tmpDir, fetchFn, refresh: true });

    expect(fetchFn.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});

describe("fetchProducts", () => {
  it("unwraps the envelope into a typed product list", async () => {
    const fetchFn = vi.fn(priceGuideFetchFn());

    const products = await fetchProducts({ cacheDir: tmpDir, fetchFn });

    expect(products).toHaveLength(7);
    expect(products[0]).toMatchObject({
      idProduct: 100,
      name: "Command and Conquer",
    });
  });

  it("hits the cache on a second call and never re-invokes fetchFn", async () => {
    const fetchFn = vi.fn(priceGuideFetchFn());

    await fetchProducts({ cacheDir: tmpDir, fetchFn });
    const callsAfterFirst = fetchFn.mock.calls.length;
    await fetchProducts({ cacheDir: tmpDir, fetchFn });

    expect(fetchFn.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe("fetchCardmarketData", () => {
  it("joins products and price guide rows by idProduct", async () => {
    const fetchFn = vi.fn(priceGuideFetchFn());

    const data = await fetchCardmarketData({ cacheDir: tmpDir, fetchFn });

    expect(data.products).toHaveLength(7);
    expect(data.priceGuideByProduct.get(100)).toMatchObject({ trend: 5.75 });
    expect(data.productsById.get(100)).toMatchObject({
      name: "Command and Conquer",
    });
  });

  it("survives a product with no guide row without throwing", async () => {
    const fetchFn = vi.fn(priceGuideFetchFn());

    const data = await fetchCardmarketData({ cacheDir: tmpDir, fetchFn });

    expect(data.productsById.get(200)).toMatchObject({
      name: "No Guide Row Card",
    });
    expect(data.priceGuideByProduct.get(200)).toBeUndefined();
  });

  it("survives a guide row with no matching product without throwing", async () => {
    const fetchFn = vi.fn(priceGuideFetchFn());

    const data = await fetchCardmarketData({ cacheDir: tmpDir, fetchFn });

    expect(data.priceGuideByProduct.get(106)).toMatchObject({ trend: 1.1 });
    expect(data.productsById.get(106)).toBeUndefined();
  });
});

describe("resolvePrices", () => {
  function rowFor(idProduct: number): CardmarketPriceGuideRow {
    const fixture = loadFixture("price_guide_16") as {
      priceGuides: CardmarketPriceGuideRow[];
    };
    const row = fixture.priceGuides.find((r) => r.idProduct === idProduct);
    if (!row) throw new Error(`fixture row ${idProduct} not found`);
    return row;
  }

  it("normal: uses trend for NM when present", () => {
    const result = resolvePrices(rowFor(100), "normal");
    expect(result.nm).toEqual({ price: 5.75, source: "trend" });
  });

  it("normal: SP/LP, MP, HP all use low, source 'low'", () => {
    const result = resolvePrices(rowFor(100), "normal");
    expect(result.others).toEqual({ price: 3.0, source: "low" });
  });

  it("normal: cascades trend -> avg30 when trend is null", () => {
    const result = resolvePrices(rowFor(101), "normal");
    expect(result.nm).toEqual({ price: 1.8, source: "avg30" });
  });

  it("normal: cascades all the way to low when trend/avg30/avg7/avg1 are all null", () => {
    const result = resolvePrices(rowFor(102), "normal");
    expect(result.nm).toEqual({ price: 0.2, source: "low" });
  });

  it("normal: both nm and others are null when every field is null", () => {
    const result = resolvePrices(rowFor(103), "normal");
    expect(result.nm).toBeNull();
    expect(result.others).toBeNull();
  });

  it("foil: uses the -foil field variants", () => {
    const result = resolvePrices(rowFor(100), "foil");
    expect(result.nm).toEqual({ price: 12.75, source: "trend" });
    expect(result.others).toEqual({ price: 9.0, source: "low" });
  });

  it("foil: treats trend-foil of 0 as no-data and cascades to avg30-foil", () => {
    const result = resolvePrices(rowFor(104), "foil");
    expect(result.nm).toEqual({ price: 7.5, source: "avg30" });
  });

  it("normal trend of 0 is NOT treated as no-data (only trend-foil's 0 marker is)", () => {
    // idProduct 107 has a genuine normal trend of 0 with a nonzero avg30
    // fallback available — if 0 were wrongly treated as no-data this would
    // cascade to avg30 instead of returning the real 0 price.
    const result = resolvePrices(rowFor(107), "normal");
    expect(result.nm).toEqual({ price: 0, source: "trend" });
  });

  it("handles missing keys entirely (not just null) safely", () => {
    const result = resolvePrices(rowFor(105), "normal");
    expect(result.nm).toEqual({ price: 4.0, source: "trend" });
    expect(result.others).toBeNull();
  });

  it("foil: missing keys entirely for the row's foil fields resolve to null", () => {
    const result = resolvePrices(rowFor(105), "foil");
    expect(result.nm).toBeNull();
    expect(result.others).toBeNull();
  });
});

describe("retry / backoff (SPEC-PRICE §6.4)", () => {
  it("retries once on 429 then succeeds", async () => {
    const fixture = loadFixture("price_guide_16");
    let calls = 0;
    const fetchFn: FetchFn = vi.fn(async () => {
      calls++;
      if (calls === 1) return jsonResponse({}, 429);
      return jsonResponse(fixture);
    });

    const rows = await fetchPriceGuide({
      cacheDir: tmpDir,
      fetchFn,
      retryBaseMs: 1,
    });

    expect(rows).toHaveLength(8);
    expect(calls).toBe(2);
  });

  it("retries on 5xx up to the attempt cap then throws a typed error", async () => {
    const fetchFn: FetchFn = vi.fn(async () => jsonResponse({}, 503));

    await expect(
      fetchPriceGuide({ cacheDir: tmpDir, fetchFn, retryBaseMs: 1 }),
    ).rejects.toThrow(CardmarketHttpError);

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on a non-retryable 4xx status", async () => {
    const fetchFn: FetchFn = vi.fn(async () => jsonResponse({}, 404));

    await expect(
      fetchProducts({ cacheDir: tmpDir, fetchFn, retryBaseMs: 1 }),
    ).rejects.toThrow(CardmarketHttpError);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("a fetcher error propagates and is not cached (nothing written to disk)", async () => {
    const fetchFn: FetchFn = vi.fn(async () => jsonResponse({}, 500));

    await expect(
      fetchPriceGuide({ cacheDir: tmpDir, fetchFn, retryBaseMs: 1 }),
    ).rejects.toThrow();

    expect(
      fs.existsSync(path.join(tmpDir, "cardmarket-price-guide.json")),
    ).toBe(false);
  });
});
