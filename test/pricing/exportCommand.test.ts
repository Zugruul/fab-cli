import { describe, it, expect, vi } from "vitest";

import {
  runExport,
  type ExportCommandDeps,
} from "../../src/pricing/exportCommand";
import {
  StorefrontBlockedError,
  type FinishConditionPriceMap,
} from "../../src/pricing/tcgplayerSearch";
import type {
  Group,
  GroupData,
  Product,
  TcgcsvPriceRow,
} from "../../src/pricing/tcgcsv";
import type {
  CardmarketData,
  CardmarketPriceGuideRow,
  CardmarketProduct,
} from "../../src/pricing/cardmarket";
import type { ExpansionAnchorMap } from "../../src/pricing/expansionAnchoring";
import { FxHttpError, type FxRate } from "../../src/pricing/fx";

// ---------------------------------------------------------------------------
// Synthetic fixtures — two sets, small enough to hand-verify every cell.
// ---------------------------------------------------------------------------

const EVERFEST: Group = {
  groupId: 1,
  name: "Everfest",
  publishedOn: "2024-05-01",
};
const DUSK: Group = {
  groupId: 2,
  name: "Dusk till Dawn",
  publishedOn: "2023-01-01",
};
const GROUPS: Group[] = [EVERFEST, DUSK];

const CNC_RED: Product = {
  productId: 101,
  name: "Command and Conquer (Red)",
  groupId: 1,
};
const SNATCH_RED: Product = {
  productId: 201,
  name: "Snatch (Red)",
  groupId: 2,
};

function priceRow(productId: number, subTypeName: string): TcgcsvPriceRow {
  return {
    productId,
    lowPrice: 1,
    midPrice: 1,
    highPrice: 1,
    marketPrice: 1,
    directLowPrice: 1,
    subTypeName,
  };
}

function makeGroupData(
  products: Product[],
  prices: TcgcsvPriceRow[],
): GroupData {
  const pricesByProductId = new Map<number, TcgcsvPriceRow[]>();
  for (const p of prices) {
    const existing = pricesByProductId.get(p.productId);
    if (existing) existing.push(p);
    else pricesByProductId.set(p.productId, [p]);
  }
  return {
    products,
    prices,
    pricesByProductId,
    emptyPrices: prices.length === 0,
  };
}

const GROUP_DATA: Record<number, GroupData> = {
  1: makeGroupData([CNC_RED], [priceRow(101, "Normal")]),
  2: makeGroupData([SNATCH_RED], [priceRow(201, "Normal")]),
};

const LISTINGS: Record<number, FinishConditionPriceMap> = {
  101: {
    normal: { NM: 10, "SP/LP": 8, MP: 6, HP: 4 },
    foil: { NM: null, "SP/LP": null, MP: null, HP: null },
  },
  201: {
    normal: { NM: 5, "SP/LP": 4, MP: 3, HP: 2 },
    foil: { NM: null, "SP/LP": null, MP: null, HP: null },
  },
};

const ANCHOR_MAP: ExpansionAnchorMap = {
  generatedAt: "2024-01-01T00:00:00.000Z",
  votes: {
    "10": { name: "Everfest", votes: 5 },
    "20": { name: "Dusk till Dawn", votes: 5 },
  },
  overrides: {},
};

const CM_PRODUCTS: CardmarketProduct[] = [
  { idProduct: 9101, name: "Command and Conquer (Red)", idExpansion: 10 },
  { idProduct: 9201, name: "Snatch (Red)", idExpansion: 20 },
];

const CM_PRICE_GUIDE: CardmarketPriceGuideRow[] = [
  { idProduct: 9101, low: 9 },
  { idProduct: 9201, low: 4.5 },
];

function makeCardmarketData(
  products: CardmarketProduct[] = CM_PRODUCTS,
  guide: CardmarketPriceGuideRow[] = CM_PRICE_GUIDE,
): CardmarketData {
  const priceGuideByProduct = new Map<number, CardmarketPriceGuideRow>();
  for (const row of guide) priceGuideByProduct.set(row.idProduct, row);
  const productsById = new Map<number, CardmarketProduct>();
  for (const p of products) productsById.set(p.idProduct, p);
  return { products, priceGuideByProduct, productsById };
}

const FX: FxRate = { rate: 1.1, date: "2024-06-01", base: "EUR", quote: "USD" };

function baseDeps(
  overrides: Partial<ExportCommandDeps> = {},
): ExportCommandDeps {
  return {
    fetchGroups: vi.fn(async () => GROUPS),
    fetchGroupData: vi.fn(async (groupId: number) => GROUP_DATA[groupId]),
    fetchSetConditionListings: vi.fn(async (setName: string) => {
      const map = new Map<number, FinishConditionPriceMap>();
      if (setName === "Everfest") map.set(101, LISTINGS[101]);
      if (setName === "Dusk till Dawn") map.set(201, LISTINGS[201]);
      return map;
    }),
    fetchCardmarketData: vi.fn(async () => makeCardmarketData()),
    fetchEurUsdRate: vi.fn(async () => FX),
    expansionAnchorMap: ANCHOR_MAP,
    sleep: vi.fn(async () => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe("runExport — happy path", () => {
  it("produces all 5 outputs with correctly filled rows for every set", async () => {
    const result = await runExport(baseDeps());

    expect(result.pricesTcgplayerCsv).toContain("# currency: USD");
    expect(result.pricesTcgplayerCsv).toContain(
      "Command and Conquer (Red),Everfest,normal,10,listing,8,listing,6,listing,4,listing",
    );
    expect(result.pricesTcgplayerCsv).toContain(
      "Snatch (Red),Dusk till Dawn,normal,5,listing,4,listing,3,listing,2,listing",
    );

    expect(result.pricesCardmarketCsv).toContain("# currency: EUR");
    // #67: only NM carries the 'low' cell — SP/LP, MP, HP are always empty.
    expect(result.pricesCardmarketCsv).toContain(
      "Command and Conquer (Red),Everfest,normal,9,low,,,,,,,,",
    );

    expect(result.ratioTcgplayerCardmarketCsv).toContain(
      "# ratio: tcgplayer / cardmarket",
    );
    expect(result.ratioCardmarketTcgplayerCsv).toContain(
      "# ratio: cardmarket / tcgplayer",
    );
    expect(result.ratioError).toBeUndefined();

    expect(result.unmatchedCsv).toBe("Provider,Name,Set,Finish,Reason");

    expect(result.summary.setsProcessed).toBe(2);
    expect(result.summary.rowsPerPage).toEqual({ tcgplayer: 2, cardmarket: 2 });
    expect(result.summary.matchRate).toBe(1);
    expect(result.summary.degradedSets).toEqual([]);
    expect(result.summary.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("orders price-page rows by set release order (newest first), then name, then finish", async () => {
    const result = await runExport(baseDeps());
    const lines = result.pricesTcgplayerCsv.split("\n").slice(2); // skip comment + header
    // Everfest (2024-05-01) is newer than Dusk till Dawn (2023-01-01).
    expect(lines[0]).toContain("Everfest");
    expect(lines[1]).toContain("Dusk till Dawn");
  });

  it("reports per-set progress via onSetProgress", async () => {
    const onSetProgress = vi.fn();
    await runExport(baseDeps(), { onSetProgress });

    expect(onSetProgress).toHaveBeenCalledTimes(2);
    expect(onSetProgress).toHaveBeenNthCalledWith(1, {
      index: 1,
      total: 2,
      groupName: "Everfest",
      productCount: 1,
    });
  });
});

describe("runExport — --set filter", () => {
  it("processes only sets matching the filter (case-insensitive) and scopes Cardmarket rows to them", async () => {
    const result = await runExport(baseDeps(), { sets: ["everfest"] });

    expect(result.summary.setsProcessed).toBe(1);
    expect(result.pricesTcgplayerCsv).toContain("Command and Conquer");
    expect(result.pricesTcgplayerCsv).not.toContain("Snatch");
    expect(result.pricesCardmarketCsv).toContain("Command and Conquer");
    expect(result.pricesCardmarketCsv).not.toContain("Snatch");
  });
});

describe("runExport — 403-degraded mode", () => {
  it("degrades a blocked set to empty tcgplayer cells, records it, and backs off before continuing", async () => {
    const sleep = vi.fn(async () => {});
    const fetchSetConditionListings = vi.fn(async (setName: string) => {
      if (setName === "Everfest") {
        throw new StorefrontBlockedError(
          "https://mp-search-api.tcgplayer.com/x",
        );
      }
      const map = new Map<number, FinishConditionPriceMap>();
      map.set(201, LISTINGS[201]);
      return map;
    });

    const result = await runExport(
      baseDeps({ fetchSetConditionListings, sleep }),
      { backoffMs: 60_000 },
    );

    expect(result.summary.degradedSets).toEqual(["Everfest"]);
    expect(sleep).toHaveBeenCalledWith(60_000);

    // Everfest's row still appears (from tcgcsv catalog data) but every
    // tcgplayer condition cell is empty — never a marketPrice/lowPrice
    // stand-in (§6.4/§8.2 PRICE-021 amendment).
    expect(result.pricesTcgplayerCsv).toContain(
      "Command and Conquer (Red),Everfest,normal,,,,,,,,",
    );
    // The un-degraded set is unaffected.
    expect(result.pricesTcgplayerCsv).toContain(
      "Snatch (Red),Dusk till Dawn,normal,5,listing,4,listing,3,listing,2,listing",
    );
  });

  it("propagates a non-403 error from fetchSetConditionListings (not a degradation case)", async () => {
    const fetchSetConditionListings = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(
      runExport(baseDeps({ fetchSetConditionListings })),
    ).rejects.toThrow("boom");
  });
});

describe("runExport — FX failure", () => {
  it("aborts ratio-page generation with a typed error while price pages still complete", async () => {
    const fetchEurUsdRate = vi.fn(async () => {
      throw new FxHttpError("https://api.frankfurter.dev/v1/latest", 500);
    });

    const result = await runExport(baseDeps({ fetchEurUsdRate }));

    expect(result.ratioError).toMatch(/FX rate/);
    expect(result.ratioTcgplayerCardmarketCsv).toBe("");
    expect(result.ratioCardmarketTcgplayerCsv).toBe("");

    // Price pages and unmatched.csv are unaffected.
    expect(result.pricesTcgplayerCsv).toContain("Command and Conquer");
    expect(result.pricesCardmarketCsv).toContain("Command and Conquer");
    expect(result.unmatchedCsv).toBe("Provider,Name,Set,Finish,Reason");
  });
});

describe("runExport — determinism", () => {
  it("produces byte-identical CSV strings across two runs of identical cached data", async () => {
    const a = await runExport(baseDeps());
    const b = await runExport(baseDeps());

    expect(a.pricesTcgplayerCsv).toBe(b.pricesTcgplayerCsv);
    expect(a.pricesCardmarketCsv).toBe(b.pricesCardmarketCsv);
    expect(a.ratioTcgplayerCardmarketCsv).toBe(b.ratioTcgplayerCardmarketCsv);
    expect(a.ratioCardmarketTcgplayerCsv).toBe(b.ratioCardmarketTcgplayerCsv);
    expect(a.unmatchedCsv).toBe(b.unmatchedCsv);
  });
});

describe("runExport — unmatched reporting (I7)", () => {
  it("reports a Cardmarket row with no TCGplayer counterpart in unmatched.csv rather than dropping it", async () => {
    const cmProducts: CardmarketProduct[] = [
      ...CM_PRODUCTS,
      { idProduct: 9301, name: "Only On Cardmarket", idExpansion: 10 },
    ];
    const cmGuide: CardmarketPriceGuideRow[] = [
      ...CM_PRICE_GUIDE,
      { idProduct: 9301, low: 2 },
    ];
    const fetchCardmarketData = vi.fn(async () =>
      makeCardmarketData(cmProducts, cmGuide),
    );

    const result = await runExport(baseDeps({ fetchCardmarketData }));

    expect(result.unmatchedCsv).toContain(
      "cardmarket,Only On Cardmarket,Everfest,normal,no-counterpart",
    );
    expect(result.summary.matchRate).toBeLessThan(1);
  });
});
