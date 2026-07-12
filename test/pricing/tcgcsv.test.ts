import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  fetchGroups,
  fetchGroupProducts,
  fetchGroupPrices,
  fetchGroupData,
  mapWithConcurrency,
  TcgcsvHttpError,
  type FetchFn,
} from "../../src/pricing/tcgcsv";

const FIXTURES_DIR = path.join(
  __dirname,
  "..",
  "fixtures",
  "pricing",
  "tcgcsv",
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

/** Routes a URL to a fixture by matching a substring, so a single fetchFn can serve multiple endpoints. */
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
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "fab-cli-tcgcsv-"));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("fetchGroups", () => {
  it("unwraps the results envelope into a typed groups list", async () => {
    const fixture = loadFixture("groups");
    const fetchFn = vi.fn(routedFetchFn({ "/groups": fixture }));

    const groups = await fetchGroups({ cacheDir: tmpDir, fetchFn });

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ groupId: 2947, name: "Everfest" });
    expect(groups[1]).toMatchObject({ groupId: 3050, name: "Dusk till Dawn" });
  });
});

describe("fetchGroupProducts / fetchGroupPrices / fetchGroupData", () => {
  it("joins products and prices by productId via pricesByProductId", async () => {
    const products = loadFixture("products-2947");
    const prices = loadFixture("prices-2947");
    const fetchFn = vi.fn(
      routedFetchFn({
        "/2947/products": products,
        "/2947/prices": prices,
      }),
    );

    const data = await fetchGroupData(2947, { cacheDir: tmpDir, fetchFn });

    expect(data.products).toHaveLength(2);
    expect(data.emptyPrices).toBe(false);

    const rowsFor255918 = data.pricesByProductId.get(255918);
    expect(rowsFor255918).toBeDefined();
    expect(rowsFor255918).toHaveLength(2);
  });

  it("keeps Normal and Foil as distinct rows for the same product", async () => {
    const products = loadFixture("products-2947");
    const prices = loadFixture("prices-2947");
    const fetchFn = vi.fn(
      routedFetchFn({
        "/2947/products": products,
        "/2947/prices": prices,
      }),
    );

    const data = await fetchGroupData(2947, { cacheDir: tmpDir, fetchFn });
    const rows = data.pricesByProductId.get(255918)!;
    const subTypes = rows.map((r) => r.subTypeName).sort();

    expect(subTypes).toEqual(["Foil", "Normal"]);

    const normal = rows.find((r) => r.subTypeName === "Normal")!;
    const foil = rows.find((r) => r.subTypeName === "Foil")!;
    expect(normal.marketPrice).toBe(176.77);
    expect(normal.directLowPrice).toBeNull();
    expect(foil.marketPrice).toBe(402.15);
    expect(foil.directLowPrice).toBe(355.0);
  });

  it("flags a group whose prices endpoint returned 0 rows", async () => {
    const products = loadFixture("products-3050");
    const prices = loadFixture("prices-3050-empty");
    const fetchFn = vi.fn(
      routedFetchFn({
        "/3050/products": products,
        "/3050/prices": prices,
      }),
    );

    const data = await fetchGroupData(3050, { cacheDir: tmpDir, fetchFn });

    expect(data.emptyPrices).toBe(true);
    expect(data.prices).toHaveLength(0);
    expect(data.products).toHaveLength(1);
    expect(data.pricesByProductId.size).toBe(0);
  });
});

describe("caching behavior", () => {
  it("a cache hit avoids calling fetchFn again", async () => {
    const fixture = loadFixture("groups");
    const fetchFn = vi.fn(routedFetchFn({ "/groups": fixture }));

    await fetchGroups({ cacheDir: tmpDir, fetchFn });
    await fetchGroups({ cacheDir: tmpDir, fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refresh: true bypasses the cache and re-calls fetchFn", async () => {
    const fixture = loadFixture("groups");
    const fetchFn = vi.fn(routedFetchFn({ "/groups": fixture }));

    await fetchGroups({ cacheDir: tmpDir, fetchFn });
    await fetchGroups({ cacheDir: tmpDir, fetchFn, refresh: true });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("uses distinct cache keys per group for products and prices", async () => {
    const products2947 = loadFixture("products-2947");
    const prices2947 = loadFixture("prices-2947");
    const products3050 = loadFixture("products-3050");
    const prices3050 = loadFixture("prices-3050-empty");
    const fetchFn = vi.fn(
      routedFetchFn({
        "/2947/products": products2947,
        "/2947/prices": prices2947,
        "/3050/products": products3050,
        "/3050/prices": prices3050,
      }),
    );

    await fetchGroupData(2947, { cacheDir: tmpDir, fetchFn });
    await fetchGroupData(3050, { cacheDir: tmpDir, fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(4);

    const files = fs.readdirSync(tmpDir);
    expect(files.sort()).toEqual(
      [
        "tcgcsv-products-2947.json",
        "tcgcsv-prices-2947.json",
        "tcgcsv-products-3050.json",
        "tcgcsv-prices-3050.json",
      ].sort(),
    );
  });
});

describe("retry / backoff (SPEC-PRICE §6.4)", () => {
  it("retries once on 429 then succeeds", async () => {
    const fixture = loadFixture("groups");
    let calls = 0;
    const fetchFn: FetchFn = vi.fn(async () => {
      calls++;
      if (calls === 1) return jsonResponse({}, 429);
      return jsonResponse(fixture);
    });

    const groups = await fetchGroups({
      cacheDir: tmpDir,
      fetchFn,
      retryBaseMs: 1,
    });

    expect(groups).toHaveLength(2);
    expect(calls).toBe(2);
  });

  it("retries on 5xx up to the attempt cap then throws a typed error", async () => {
    const fetchFn: FetchFn = vi.fn(async () => jsonResponse({}, 503));

    await expect(
      fetchGroups({ cacheDir: tmpDir, fetchFn, retryBaseMs: 1 }),
    ).rejects.toThrow(TcgcsvHttpError);

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on a non-retryable 4xx status", async () => {
    const fetchFn: FetchFn = vi.fn(async () => jsonResponse({}, 404));

    await expect(
      fetchGroups({ cacheDir: tmpDir, fetchFn, retryBaseMs: 1 }),
    ).rejects.toThrow(TcgcsvHttpError);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("a fetcher error propagates and is not cached (nothing written to disk)", async () => {
    const fetchFn: FetchFn = vi.fn(async () => jsonResponse({}, 500));

    await expect(
      fetchGroups({ cacheDir: tmpDir, fetchFn, retryBaseMs: 1 }),
    ).rejects.toThrow();

    expect(fs.existsSync(path.join(tmpDir, "tcgcsv-groups.json"))).toBe(false);
  });
});

describe("mapWithConcurrency", () => {
  it("runs all items and preserves result order", async () => {
    const items = [1, 2, 3, 4, 5, 6];
    const results = await mapWithConcurrency(items, 4, async (n) => n * 2);

    expect(results).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it("never exceeds a concurrency of 4 even when a higher limit is requested", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrency(items, 20, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return n;
    });

    expect(maxActive).toBeLessThanOrEqual(4);
  });
});
