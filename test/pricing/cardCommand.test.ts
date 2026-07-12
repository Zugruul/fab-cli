import { describe, it, expect, vi } from "vitest";
import {
  matchCardProducts,
  resolveCardProducts,
  assembleCardComparison,
  isFallbackCell,
  renderCsv,
  type CatalogEntry,
  type CardCommandDeps,
} from "../../src/pricing/cardCommand";
import type { Group, Product, TcgcsvPriceRow } from "../../src/pricing/tcgcsv";
import type { ConditionPriceMap } from "../../src/pricing/tcgplayerSearch";
import type {
  CardmarketData,
  CardmarketPriceGuideRow,
  CardmarketProduct,
} from "../../src/pricing/cardmarket";
import type { FxRate } from "../../src/pricing/fx";
import { FxHttpError } from "../../src/pricing/fx";
import type { ExpansionAnchorMap } from "../../src/pricing/expansionAnchoring";

// ---------------------------------------------------------------------------
// matchCardProducts — pure
// ---------------------------------------------------------------------------

function entry(
  productId: number,
  name: string,
  groupId: number,
  groupName: string,
): CatalogEntry {
  return { productId, name, groupId, groupName };
}

describe("matchCardProducts", () => {
  it("exact match wins outright even when other names would substring-match", () => {
    const entries = [
      entry(1, "Snatch", 10, "Everfest"),
      entry(2, "Snatch (Blue)", 10, "Everfest"),
      entry(3, "Snatch (Red)", 10, "Everfest"),
    ];
    const result = matchCardProducts(entries, "Snatch");
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.canonicalName).toBe("Snatch");
      expect(result.entries).toEqual([entries[0]]);
    }
  });

  it("single distinct name substring match across printings", () => {
    const entries = [
      entry(1, "Command and Conquer", 10, "Everfest"),
      entry(2, "Command and Conquer", 11, "Dusk till Dawn"),
    ];
    const result = matchCardProducts(entries, "command and conquer");
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.canonicalName).toBe("Command and Conquer");
      expect(result.entries).toHaveLength(2);
    }
  });

  it("multiple distinct names -> ambiguous, lists candidates", () => {
    const entries = [
      entry(1, "Snatch (Blue)", 10, "Everfest"),
      entry(2, "Snatch (Red)", 10, "Everfest"),
      entry(3, "Snatch (Yellow)", 10, "Everfest"),
    ];
    const result = matchCardProducts(entries, "snatch");
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates).toEqual([
        "Snatch (Blue)",
        "Snatch (Red)",
        "Snatch (Yellow)",
      ]);
    }
  });

  it("no matches -> none", () => {
    const entries = [entry(1, "Command and Conquer", 10, "Everfest")];
    const result = matchCardProducts(entries, "nonexistent card xyz");
    expect(result.kind).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// resolveCardProducts — fetches groups+products across the catalog
// ---------------------------------------------------------------------------

describe("resolveCardProducts", () => {
  const groups: Group[] = [
    { groupId: 10, name: "Everfest" },
    { groupId: 11, name: "Dusk till Dawn" },
  ];

  function productsFor(groupId: number): Product[] {
    if (groupId === 10) {
      return [
        { productId: 1, name: "Command and Conquer", groupId: 10 },
        { productId: 2, name: "Snatch (Blue)", groupId: 10 },
      ];
    }
    return [{ productId: 3, name: "Command and Conquer", groupId: 11 }];
  }

  it("fetches all groups' products and resolves an unambiguous match", async () => {
    const fetchGroups = vi.fn().mockResolvedValue(groups);
    const fetchGroupProducts = vi.fn(async (groupId: number) =>
      productsFor(groupId),
    );

    const result = await resolveCardProducts("command and conquer", {
      fetchGroups,
      fetchGroupProducts,
    } as unknown as CardCommandDeps);

    expect(fetchGroups).toHaveBeenCalledTimes(1);
    expect(fetchGroupProducts).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.canonicalName).toBe("Command and Conquer");
      expect(result.entries).toHaveLength(2);
    }
  });
});

// ---------------------------------------------------------------------------
// assembleCardComparison — full assembly with mocked clients
// ---------------------------------------------------------------------------

function anchorMap(): ExpansionAnchorMap {
  return {
    generatedAt: "2026-07-12T00:00:00.000Z",
    votes: { "42": { name: "Everfest", votes: 5 } },
    overrides: {},
  };
}

function makeDeps(overrides: Partial<CardCommandDeps> = {}): CardCommandDeps {
  const groups: Group[] = [{ groupId: 10, name: "Everfest" }];
  const products: Product[] = [
    { productId: 1, name: "Command and Conquer", groupId: 10 },
  ];

  const tcgPriceRows: TcgcsvPriceRow[] = [
    {
      productId: 1,
      lowPrice: 8,
      midPrice: 9,
      highPrice: 12,
      marketPrice: 9.5,
      directLowPrice: 8,
      subTypeName: "Normal",
    },
  ];

  const conditionMap: Map<number, ConditionPriceMap> = new Map([
    [1, { NM: null, "SP/LP": null, MP: null, HP: null }],
  ]);

  const cmProducts: CardmarketProduct[] = [
    { idProduct: 100, name: "Command and Conquer", idExpansion: 42 },
  ];
  const cmPriceGuide: CardmarketPriceGuideRow[] = [
    {
      idProduct: 100,
      trend: 7,
      low: 6,
      avg30: 6.9,
      avg7: 6.95,
      avg1: 7.05,
    },
  ];
  const cardmarketData: CardmarketData = {
    products: cmProducts,
    priceGuideByProduct: new Map([[100, cmPriceGuide[0]]]),
    productsById: new Map([[100, cmProducts[0]]]),
  };

  const fx: FxRate = {
    rate: 1.1,
    date: "2026-07-11",
    base: "EUR",
    quote: "USD",
  };

  return {
    fetchGroups: vi.fn().mockResolvedValue(groups),
    fetchGroupProducts: vi.fn().mockResolvedValue(products),
    fetchGroupPrices: vi.fn().mockResolvedValue(tcgPriceRows),
    fetchProductConditions: vi.fn().mockResolvedValue(conditionMap),
    fetchCardmarketData: vi.fn().mockResolvedValue(cardmarketData),
    fetchEurUsdRate: vi.fn().mockResolvedValue(fx),
    expansionAnchorMap: anchorMap(),
    ...overrides,
  };
}

describe("assembleCardComparison", () => {
  it("happy path: fill-before-match — a TCGplayer row with no listings but a marketPrice is priced (source market), not unmatched no-price", async () => {
    const deps = makeDeps();
    const result = await assembleCardComparison("command and conquer", deps);

    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;

    expect(result.canonicalName).toBe("Command and Conquer");
    expect(result.comparisonRows).toHaveLength(1);
    const row = result.comparisonRows[0];
    const tcg = row.conditionsByProvider.tcgplayer;
    expect(tcg.NM).toEqual({ price: 9.5, source: "market" });
    expect(tcg["SP/LP"]).toEqual({ price: 9.5, source: "adjacent:NM" });

    // No unmatched no-price entries — the market-filled row matched cleanly.
    expect(
      result.unmatched.some(
        (u) => u.provider === "tcgplayer" && u.reason === "no-price",
      ),
    ).toBe(false);

    const cm = row.conditionsByProvider.cardmarket;
    expect(cm.NM).toEqual({ price: 7, source: "trend" });
    expect(cm["SP/LP"]).toEqual({ price: 6, source: "low" });

    expect(result.fx).toEqual({
      rate: 1.1,
      date: "2026-07-11",
      base: "EUR",
      quote: "USD",
    });
    expect(result.ratioError).toBeUndefined();
  });

  it("ambiguous name resolves without hitting the assembly clients", async () => {
    const deps = makeDeps({
      fetchGroupProducts: vi.fn().mockResolvedValue([
        { productId: 1, name: "Snatch (Blue)", groupId: 10 },
        { productId: 2, name: "Snatch (Red)", groupId: 10 },
      ]),
    });
    const result = await assembleCardComparison("snatch", deps);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates).toEqual(["Snatch (Blue)", "Snatch (Red)"]);
    }
    expect(deps.fetchCardmarketData).not.toHaveBeenCalled();
  });

  it("no card found", async () => {
    const deps = makeDeps({
      fetchGroupProducts: vi.fn().mockResolvedValue([]),
    });
    const result = await assembleCardComparison("nothing here", deps);
    expect(result.kind).toBe("none");
  });

  it("FX failure: price rows still assembled, ratioError set, no throw", async () => {
    const deps = makeDeps({
      fetchEurUsdRate: vi
        .fn()
        .mockRejectedValue(new FxHttpError("https://x", 500)),
    });
    const result = await assembleCardComparison("command and conquer", deps);
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.fx).toBeUndefined();
    expect(result.ratioError).toBeTruthy();
    expect(result.comparisonRows).toHaveLength(1);
  });

  it("currency=eur is threaded through to the result", async () => {
    const deps = makeDeps();
    const result = await assembleCardComparison("command and conquer", deps, {
      currency: "eur",
    });
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.currency).toBe("eur");
    }
  });
});

// ---------------------------------------------------------------------------
// isFallbackCell — pure bold-marking decision
// ---------------------------------------------------------------------------

describe("isFallbackCell", () => {
  it("tcgplayer: listing source is not a fallback", () => {
    expect(
      isFallbackCell({ price: 5, source: "listing" }, "tcgplayer", "NM"),
    ).toBe(false);
  });

  it("tcgplayer: market/adjacent sources are fallbacks", () => {
    expect(
      isFallbackCell({ price: 5, source: "market" }, "tcgplayer", "NM"),
    ).toBe(true);
    expect(
      isFallbackCell({ price: 5, source: "adjacent:NM" }, "tcgplayer", "SP/LP"),
    ).toBe(true);
  });

  it("cardmarket: NM with trend source is not a fallback", () => {
    expect(
      isFallbackCell({ price: 5, source: "trend" }, "cardmarket", "NM"),
    ).toBe(false);
  });

  it("cardmarket: NM cascaded to avg30 is a fallback", () => {
    expect(
      isFallbackCell({ price: 5, source: "avg30" }, "cardmarket", "NM"),
    ).toBe(true);
  });

  it("cardmarket: SP/LP, MP, HP are always fallbacks (always sourced from low)", () => {
    expect(
      isFallbackCell({ price: 5, source: "low" }, "cardmarket", "SP/LP"),
    ).toBe(true);
    expect(
      isFallbackCell({ price: 5, source: "low" }, "cardmarket", "HP"),
    ).toBe(true);
  });

  it("null cells are never flagged as fallback (nothing to bold)", () => {
    expect(isFallbackCell(null, "tcgplayer", "NM")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// renderCsv — deterministic §9.3-shaped CSV
// ---------------------------------------------------------------------------

describe("renderCsv", () => {
  it("emits 4 page comment headers and is byte-identical on repeated render", async () => {
    const deps = makeDeps();
    const result = await assembleCardComparison("command and conquer", deps);
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;

    const csv1 = renderCsv(result);
    const csv2 = renderCsv(result);
    expect(csv1).toBe(csv2);

    expect(csv1).toContain("# page 1 — TCGplayer prices (USD)");
    expect(csv1).toContain("# page 2 — Cardmarket prices (EUR)");
    expect(csv1).toContain("# page 3 — Ratio: tcgplayer / cardmarket");
    expect(csv1).toContain("# page 4 — Ratio: cardmarket / tcgplayer");
    expect(csv1).toContain(
      "Name,Set,Finish,NM,NM Source,SP/LP,SP/LP Source,MP,MP Source,HP,HP Source",
    );
    expect(csv1).toContain(
      "Name,Set,Finish,NM,NM Basis,SP/LP,SP/LP Basis,MP,MP Basis,HP,HP Basis",
    );
    expect(csv1).toContain("# fx: 1 EUR = 1.1 USD (ECB 2026-07-11)");
    expect(csv1).toMatchSnapshot();
  });

  it("omits ratio pages and notes the FX failure when FX is unavailable", async () => {
    const deps = makeDeps({
      fetchEurUsdRate: vi
        .fn()
        .mockRejectedValue(new FxHttpError("https://x", 500)),
    });
    const result = await assembleCardComparison("command and conquer", deps);
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;

    const csv = renderCsv(result);
    expect(csv).toContain("# page 1 — TCGplayer prices (USD)");
    expect(csv).not.toContain("# page 3");
    expect(csv).toContain("# ratio unavailable:");
  });
});
