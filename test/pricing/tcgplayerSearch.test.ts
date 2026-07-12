import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  searchProductListings,
  fetchConditionListingsForSet,
  fetchSetConditionListings,
  fetchProductConditions,
  StorefrontBlockedError,
  StorefrontHttpError,
  CONDITION_TO_COLUMN,
  type FetchFn,
  type FetchResponse,
} from "../../src/pricing/tcgplayerSearch";

const FIXTURES_DIR = path.join(
  __dirname,
  "..",
  "fixtures",
  "pricing",
  "tcgplayer-search",
);

function loadJsonFixture(name: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, `${name}.json`), "utf8"),
  );
}

function loadTextFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function jsonResponse(body: unknown, status = 200): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function htmlResponse(body: string, status: number): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error("not json");
    },
    text: async () => body,
  };
}

/** Routes calls to fixtures by matching a substring against the request body's condition/from, in order. */
function sequenceFetchFn(responses: FetchResponse[]): {
  fetchFn: FetchFn;
  calls: { url: string; body: unknown }[];
} {
  const calls: { url: string; body: unknown }[] = [];
  let i = 0;
  const fetchFn: FetchFn = vi.fn(async (url: string, init) => {
    calls.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const res = responses[Math.min(i, responses.length - 1)];
    i++;
    return res;
  });
  return { fetchFn, calls };
}

describe("searchProductListings", () => {
  it("parses a single-card query into products with lowest-listing extraction", async () => {
    const { fetchFn, calls } = sequenceFetchFn([
      jsonResponse(loadJsonFixture("nm-page")),
    ]);

    const page = await searchProductListings(
      { q: "command and conquer", condition: "Near Mint" },
      { fetchFn },
    );

    expect(page.totalResults).toBe(2);
    expect(page.products).toHaveLength(2);

    const [red, yellow] = page.products;
    expect(red.productId).toBe(255918);
    expect(red.lowestListing).toEqual({
      condition: "Near Mint",
      price: 165.5,
      shippingPrice: 4.99,
      sellerName: "AlphaCards",
    });
    expect(yellow.lowestListing?.price).toBe(35.25);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(
      "mp-search-api.tcgplayer.com/v1/search/request",
    );
    expect(calls[0].url).toContain("isList=false");
    const body = calls[0].body as {
      filters: { term: { productLineName: string[] } };
      listingSearch: { filters: { term: { condition: string[] } } };
    };
    expect(body.filters.term.productLineName).toEqual(["flesh-and-blood-tcg"]);
    expect(body.listingSearch.filters.term.condition).toEqual(["Near Mint"]);
  });

  it("returns null lowestListing when a condition has no live listings", async () => {
    const { fetchFn } = sequenceFetchFn([
      jsonResponse(loadJsonFixture("mp-empty")),
    ]);

    const page = await searchProductListings(
      { q: "command and conquer", condition: "Moderately Played" },
      { fetchFn },
    );

    expect(page.products).toHaveLength(1);
    expect(page.products[0].lowestListing).toBeNull();
  });

  it("includes setName in the request body when provided", async () => {
    const { fetchFn, calls } = sequenceFetchFn([
      jsonResponse(loadJsonFixture("set-page-1")),
    ]);

    await searchProductListings(
      { setName: "everfest", condition: "Near Mint", from: 0, size: 50 },
      { fetchFn },
    );

    const body = calls[0].body as { filters: { term: { setName?: string[] } } };
    expect(body.filters.term.setName).toEqual(["everfest"]);
  });

  it("never calls the forbidden per-product listings endpoint", async () => {
    const { fetchFn, calls } = sequenceFetchFn([
      jsonResponse(loadJsonFixture("nm-page")),
    ]);

    await searchProductListings(
      { q: "test", condition: "Near Mint" },
      { fetchFn },
    );

    for (const call of calls) {
      expect(call.url).not.toContain("/v1/product/");
      expect(call.url).not.toContain("/listings");
    }
  });
});

describe("fetchConditionListingsForSet", () => {
  it("paginates until all product pages are consumed and returns lowest price per productId", async () => {
    const { fetchFn, calls } = sequenceFetchFn([
      jsonResponse(loadJsonFixture("set-page-1")),
      jsonResponse(loadJsonFixture("set-page-2")),
    ]);

    const map = await fetchConditionListingsForSet(
      "everfest",
      "Near Mint",
      "normal",
      { fetchFn, pageSize: 2 },
    );

    expect(calls).toHaveLength(2);
    expect(map.get(1001)).toBe(9.5);
    expect(map.get(1002)).toBe(4.75);
    expect(map.get(1003)).toBe(18.25);
    expect(map.size).toBe(3);
  });

  it("filters by a printing term matching only the requested finish (issue #61 follow-up applied to per-set batching)", async () => {
    const { fetchFn, calls } = sequenceFetchFn([
      jsonResponse(loadJsonFixture("set-page-1")),
    ]);

    await fetchConditionListingsForSet("everfest", "Near Mint", "foil", {
      fetchFn,
    });

    const body = calls[0].body as {
      listingSearch: { filters: { term: { printing?: string[] } } };
    };
    expect(body.listingSearch.filters.term.printing).toBeDefined();
    expect(
      body.listingSearch.filters.term.printing!.every((p) =>
        p.includes("Foil"),
      ),
    ).toBe(true);
  });
});

describe("fetchSetConditionListings", () => {
  it("fetches all 4 conditions x 2 finishes for a set and returns per-productId, per-finish lowest prices", async () => {
    const { fetchFn } = conditionFinishRoutedFetchFn();

    const result = await fetchSetConditionListings("command-and-conquer", {
      fetchFn,
    });

    const red = result.get(255918)!;
    expect(red.normal).toEqual({
      NM: 165.5,
      "SP/LP": 150.0,
      MP: 120.0,
      HP: 95.0,
    });
    expect(red.foil).toEqual({
      NM: 200.0,
      "SP/LP": 180.0,
      MP: 160.0,
      HP: 140.0,
    });
  });

  it("never issues more than 4 concurrent requests against the search host", async () => {
    let active = 0;
    let maxActive = 0;
    const fetchFn: FetchFn = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return jsonResponse(loadJsonFixture("nm-page"));
    });

    await fetchSetConditionListings("everfest", { fetchFn });

    expect(maxActive).toBeLessThanOrEqual(4);
  });
});

/**
 * Routes each request by (condition, finish) inferred from the request
 * body's `listingSearch.filters.term.printing` array — issue #61 follow-up:
 * fetchProductConditions now queries every condition TWICE, once per finish,
 * with a printing-term filter so a product's normal and foil listings never
 * mix (real-data-only: no cross-finish contamination in a condition cell).
 */
function conditionFinishRoutedFetchFn(): {
  fetchFn: FetchFn;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  const fixtureByKey: Record<string, unknown> = {
    "Near Mint|normal": loadJsonFixture("nm-page"),
    "Near Mint|foil": loadJsonFixture("nm-foil-page"),
    "Lightly Played|normal": loadJsonFixture("lp-single"),
    "Lightly Played|foil": loadJsonFixture("lp-foil-single"),
    "Moderately Played|normal": loadJsonFixture("mp-single"),
    "Moderately Played|foil": loadJsonFixture("mp-foil-single"),
    "Heavily Played|normal": loadJsonFixture("hp-single"),
    "Heavily Played|foil": loadJsonFixture("hp-foil-single"),
  };
  const fetchFn: FetchFn = vi.fn(async (url, init) => {
    const body = JSON.parse(String(init.body)) as {
      listingSearch: {
        filters: { term: { condition: string[]; printing?: string[] } };
      };
    };
    calls.push(body);
    const condition = body.listingSearch.filters.term.condition[0];
    const printing = body.listingSearch.filters.term.printing ?? [];
    const isFoil = printing.some((p) => p.includes("Foil"));
    const key = `${condition}|${isFoil ? "foil" : "normal"}`;
    return jsonResponse(fixtureByKey[key]);
  });
  return { fetchFn, calls };
}

describe("fetchProductConditions", () => {
  it("fetches all four conditions x both finishes and returns per-productId, per-finish lowest prices", async () => {
    const { fetchFn } = conditionFinishRoutedFetchFn();

    const result = await fetchProductConditions("command and conquer", {
      fetchFn,
    });

    const red = result.get(255918)!;
    expect(red.normal).toEqual({
      NM: 165.5,
      "SP/LP": 150.0,
      MP: 120.0,
      HP: 95.0,
    });
    expect(red.foil).toEqual({
      NM: 200.0,
      "SP/LP": 180.0,
      MP: 160.0,
      HP: 140.0,
    });
  });

  it("filters each query by a printing term matching only that finish's real printing strings", async () => {
    const { fetchFn, calls } = conditionFinishRoutedFetchFn();

    await fetchProductConditions("command and conquer", { fetchFn });

    const bodies = calls as {
      listingSearch: {
        filters: { term: { condition: string[]; printing?: string[] } };
      };
    }[];
    expect(bodies).toHaveLength(8);
    for (const body of bodies) {
      const printing = body.listingSearch.filters.term.printing;
      expect(printing).toBeDefined();
      expect(printing!.length).toBeGreaterThan(0);
    }
    const normalPrintings = bodies.find(
      (b) =>
        !b.listingSearch.filters.term.printing!.some((p) => p.includes("Foil")),
    )!.listingSearch.filters.term.printing!;
    const foilPrintings = bodies.find((b) =>
      b.listingSearch.filters.term.printing!.some((p) => p.includes("Foil")),
    )!.listingSearch.filters.term.printing!;
    expect(normalPrintings.every((p) => !p.includes("Foil"))).toBe(true);
    expect(foilPrintings.every((p) => p.includes("Foil"))).toBe(true);
  });

  it("respects the CONDITION_TO_COLUMN mapping (TCG condition -> domain column)", () => {
    expect(CONDITION_TO_COLUMN["Near Mint"]).toBe("NM");
    expect(CONDITION_TO_COLUMN["Lightly Played"]).toBe("SP/LP");
    expect(CONDITION_TO_COLUMN["Moderately Played"]).toBe("MP");
    expect(CONDITION_TO_COLUMN["Heavily Played"]).toBe("HP");
  });

  it("never issues more than 4 concurrent requests against the search host", async () => {
    let active = 0;
    let maxActive = 0;
    const fetchFn: FetchFn = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return jsonResponse(loadJsonFixture("nm-page"));
    });

    await fetchProductConditions("command and conquer", { fetchFn });

    expect(maxActive).toBeLessThanOrEqual(4);
  });
});

describe("retry / backoff (SPEC-PRICE §6.4, I2)", () => {
  it("retries once on 429 then succeeds", async () => {
    let calls = 0;
    const fetchFn: FetchFn = vi.fn(async () => {
      calls++;
      if (calls === 1) return jsonResponse({}, 429);
      return jsonResponse(loadJsonFixture("nm-page"));
    });

    const page = await searchProductListings(
      { q: "test", condition: "Near Mint" },
      { fetchFn, retryBaseMs: 1 },
    );

    expect(page.products).toHaveLength(2);
    expect(calls).toBe(2);
  });

  it("retries on 5xx up to the attempt cap then throws a typed error", async () => {
    const fetchFn: FetchFn = vi.fn(async () => jsonResponse({}, 503));

    await expect(
      searchProductListings(
        { q: "test", condition: "Near Mint" },
        { fetchFn, retryBaseMs: 1 },
      ),
    ).rejects.toThrow(StorefrontHttpError);

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("403 throws a typed StorefrontBlockedError without retrying", async () => {
    const html = loadTextFixture("forbidden-403.html");
    const fetchFn: FetchFn = vi.fn(async () => htmlResponse(html, 403));

    await expect(
      searchProductListings(
        { q: "test", condition: "Near Mint" },
        { fetchFn, retryBaseMs: 1 },
      ),
    ).rejects.toThrow(StorefrontBlockedError);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
