import { describe, it, expect, vi } from "vitest";
import {
  matchCardProducts,
  resolveCardProducts,
  assembleCardComparison,
  renderCsv,
  type CatalogEntry,
  type CardCommandDeps,
} from "../../src/pricing/cardCommand";
import type { Group, Product, TcgcsvPriceRow } from "../../src/pricing/tcgcsv";
import type { FinishConditionPriceMap } from "../../src/pricing/tcgplayerSearch";
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
// (real-data-only semantics, issue #61: no market/adjacent fill; Cardmarket
// condition columns are all 'low'; Trend is a separate reference field)
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

  const conditionMap: Map<number, FinishConditionPriceMap> = new Map([
    [
      1,
      {
        normal: { NM: 9.25, "SP/LP": 9.0, MP: null, HP: null },
        foil: { NM: null, "SP/LP": null, MP: null, HP: null },
      },
    ],
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
  it("happy path: real listings only — TCGplayer NM/SP-LP priced from listings, MP/HP empty (no adjacency copy)", async () => {
    const deps = makeDeps();
    const result = await assembleCardComparison("command and conquer", deps);

    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;

    expect(result.canonicalName).toBe("Command and Conquer");
    expect(result.comparisonRows).toHaveLength(1);
    const row = result.comparisonRows[0];
    const tcg = row.conditionsByProvider.tcgplayer;
    expect(tcg.NM).toEqual({ price: 9.25, source: "listing" });
    expect(tcg["SP/LP"]).toEqual({ price: 9.0, source: "listing" });
    expect(tcg.MP).toBeNull();
    expect(tcg.HP).toBeNull();

    // Cardmarket: all four condition columns are the 'low' cell.
    const cm = row.conditionsByProvider.cardmarket;
    expect(cm.NM).toEqual({ price: 6, source: "low" });
    expect(cm["SP/LP"]).toEqual({ price: 6, source: "low" });
    expect(cm.MP).toEqual({ price: 6, source: "low" });
    expect(cm.HP).toEqual({ price: 6, source: "low" });

    // Trend is a separate reference-only value carried on the raw Cardmarket
    // row, not part of the matched conditionsByProvider structure.
    const cmRow = result.cardmarketRows[0];
    expect(cmRow.trend).toEqual({ price: 7, source: "trend" });

    expect(result.fx).toEqual({
      rate: 1.1,
      date: "2026-07-11",
      base: "EUR",
      quote: "USD",
    });
    expect(result.ratioError).toBeUndefined();
  });

  it("real-data-only: a TCGplayer row with no listings at all is empty and reported no-price, never market-filled", async () => {
    const deps = makeDeps({
      fetchProductConditions: vi.fn().mockResolvedValue(
        new Map<number, FinishConditionPriceMap>([
          [
            1,
            {
              normal: { NM: null, "SP/LP": null, MP: null, HP: null },
              foil: { NM: null, "SP/LP": null, MP: null, HP: null },
            },
          ],
        ]),
      ),
    });
    const result = await assembleCardComparison("command and conquer", deps);
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;

    // No TCGplayer counterpart survives matching (all-null conditions), so
    // the row is reported no-price and does not appear in comparisonRows.
    expect(result.comparisonRows).toHaveLength(0);
    expect(
      result.unmatched.some(
        (u) => u.provider === "tcgplayer" && u.reason === "no-price",
      ),
    ).toBe(true);
  });

  it("per-finish listing correctness: normal and foil rows use only their own finish's listings, never cross-contaminated", async () => {
    // productId 1 has BOTH a normal and a foil tcgcsv price row (like the
    // real Haze Bending/Everfest product), and fetchProductConditions
    // returns distinct listing prices per finish — the normal row must show
    // only normal-printing prices, the foil row only foil-printing prices.
    const deps = makeDeps({
      fetchGroupPrices: vi.fn().mockResolvedValue([
        {
          productId: 1,
          lowPrice: 0.05,
          midPrice: 0.44,
          highPrice: 4.95,
          marketPrice: 0.38,
          directLowPrice: null,
          subTypeName: "1st Edition Normal",
        },
        {
          productId: 1,
          lowPrice: 0.25,
          midPrice: 1.18,
          highPrice: 4.49,
          marketPrice: 0.9,
          directLowPrice: null,
          subTypeName: "1st Edition Rainbow Foil",
        },
      ] satisfies TcgcsvPriceRow[]),
      fetchProductConditions: vi.fn().mockResolvedValue(
        new Map<number, FinishConditionPriceMap>([
          [
            1,
            {
              normal: { NM: 0.25, "SP/LP": 0.3, MP: null, HP: null },
              foil: { NM: 0.77, "SP/LP": 0.85, MP: null, HP: null },
            },
          ],
        ]),
      ),
    });
    const result = await assembleCardComparison("command and conquer", deps);
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;

    const normalRow = result.tcgplayerRows.find((r) => r.finish === "normal")!;
    const foilRow = result.tcgplayerRows.find((r) => r.finish === "foil")!;
    expect(normalRow.conditions.NM).toEqual({ price: 0.25, source: "listing" });
    expect(normalRow.conditions["SP/LP"]).toEqual({
      price: 0.3,
      source: "listing",
    });
    expect(foilRow.conditions.NM).toEqual({ price: 0.77, source: "listing" });
    expect(foilRow.conditions["SP/LP"]).toEqual({
      price: 0.85,
      source: "listing",
    });
  });

  it("subTypeName real-world values ('1st Edition Rainbow Foil') are classified as foil, not silently dropped into normal", async () => {
    // A prior bug compared subTypeName with exact equality against the
    // literal "Foil", which never matches TCGplayer's real subTypeName
    // strings — every foil row was misclassified as normal and the foil
    // finish row went missing entirely.
    const deps = makeDeps({
      fetchGroupPrices: vi.fn().mockResolvedValue([
        {
          productId: 1,
          lowPrice: 0.05,
          midPrice: 0.44,
          highPrice: 4.95,
          marketPrice: 0.38,
          directLowPrice: null,
          subTypeName: "1st Edition Normal",
        },
        {
          productId: 1,
          lowPrice: 0.25,
          midPrice: 1.18,
          highPrice: 4.49,
          marketPrice: 0.9,
          directLowPrice: null,
          subTypeName: "1st Edition Rainbow Foil",
        },
      ] satisfies TcgcsvPriceRow[]),
      fetchProductConditions: vi.fn().mockResolvedValue(
        new Map<number, FinishConditionPriceMap>([
          [
            1,
            {
              normal: { NM: 0.25, "SP/LP": null, MP: null, HP: null },
              foil: { NM: 0.77, "SP/LP": null, MP: null, HP: null },
            },
          ],
        ]),
      ),
    });
    const result = await assembleCardComparison("command and conquer", deps);
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;

    expect(result.tcgplayerRows.map((r) => r.finish).sort()).toEqual([
      "foil",
      "normal",
    ]);
  });

  it("a foil variant with real live listings but no tcgcsv Foil price row still gets a row (mirrors Cardmarket's foil-skip rule)", async () => {
    const deps = makeDeps({
      // Only a normal tcgcsv price row exists for this product...
      fetchGroupPrices: vi.fn().mockResolvedValue([
        {
          productId: 1,
          lowPrice: 8,
          midPrice: 9,
          highPrice: 12,
          marketPrice: 9.5,
          directLowPrice: 8,
          subTypeName: "Normal",
        },
      ] satisfies TcgcsvPriceRow[]),
      // ...but real foil listings do exist.
      fetchProductConditions: vi.fn().mockResolvedValue(
        new Map<number, FinishConditionPriceMap>([
          [
            1,
            {
              normal: { NM: 9.25, "SP/LP": 9.0, MP: null, HP: null },
              foil: { NM: 20, "SP/LP": null, MP: null, HP: null },
            },
          ],
        ]),
      ),
    });
    const result = await assembleCardComparison("command and conquer", deps);
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;

    const foilRow = result.tcgplayerRows.find((r) => r.finish === "foil");
    expect(foilRow).toBeDefined();
    expect(foilRow!.conditions.NM).toEqual({ price: 20, source: "listing" });
  });

  it("no tcgcsv Foil price row and no real foil listings: no foil row is manufactured", async () => {
    const deps = makeDeps(); // default: normal-only tcgcsv row, foil listings all null
    const result = await assembleCardComparison("command and conquer", deps);
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;

    expect(result.tcgplayerRows.some((r) => r.finish === "foil")).toBe(false);
  });

  it("real-data-only: a Cardmarket row with no 'low' field is empty across all four condition columns", async () => {
    const deps = makeDeps({
      fetchCardmarketData: vi.fn().mockResolvedValue({
        products: [
          { idProduct: 100, name: "Command and Conquer", idExpansion: 42 },
        ],
        priceGuideByProduct: new Map([
          [100, { idProduct: 100, trend: 7, low: null }],
        ]),
        productsById: new Map([
          [
            100,
            { idProduct: 100, name: "Command and Conquer", idExpansion: 42 },
          ],
        ]),
      }),
    });
    const result = await assembleCardComparison("command and conquer", deps);
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;

    const cmRow = result.cardmarketRows.find((r) => r.finish === "normal")!;
    expect(cmRow.conditions).toEqual({
      NM: null,
      "SP/LP": null,
      MP: null,
      HP: null,
    });
    // The row still carries the trend reference value even with no low price.
    expect(cmRow.trend).toEqual({ price: 7, source: "trend" });
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
// renderCsv — deterministic §9.3-shaped CSV, now with a Trend column on the
// Cardmarket page and no bold/fallback markers anywhere (issue #61)
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
      "Name,Set,Finish,NM,NM Source,SP/LP,SP/LP Source,MP,MP Source,HP,HP Source,Trend,Trend Source",
    );
    expect(csv1).toContain(
      "Name,Set,Finish,NM,NM Basis,SP/LP,SP/LP Basis,MP,MP Basis,HP,HP Basis",
    );
    expect(csv1).toContain("# fx: 1 EUR = 1.1 USD (ECB 2026-07-11)");

    const cmLine = csv1
      .split("\n")
      .find((l) => l.startsWith("Command and Conquer,Everfest,normal,6,low"));
    expect(cmLine).toBe(
      "Command and Conquer,Everfest,normal,6,low,6,low,6,low,6,low,7,trend",
    );

    const ratioLine = csv1
      .split("# page 3")[1]
      .split("\n")
      .find((l) => l.startsWith("Command and Conquer"));
    // NM: listing 9.25 USD / low 6 EUR (at rate 1.1 -> 6.6 USD) - 1
    expect(ratioLine).toContain("listing/low");
    // MP/HP have no TCGplayer real cell (real-data-only), so the ratio is
    // empty even though Cardmarket has a real low price — both sides must
    // be real (§8.4 amended).
    const ratioCells = ratioLine!.split(",");
    // Name,Set,Finish,NM,NM Basis,SP/LP,SP/LP Basis,MP,MP Basis,HP,HP Basis
    expect(ratioCells[7]).toBe(""); // MP ratio
    expect(ratioCells[8]).toBe(""); // MP basis
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

  it("collapses same-identity duplicate rows on the price pages (§4.2) — cheapest per condition, one line", async () => {
    // Two distinct Cardmarket idProducts that both normalize to the same
    // name and anchor to the same set ("Everfest") — e.g. two listings for
    // the same physical print. SPEC §4.2 requires the price page to show
    // ONE row for this identity with the cheapest price per condition, not
    // two duplicate lines (the ratio page already collapses via
    // buildComparisonRows; the raw price pages must apply the same rule).
    // Trend, being reference-only, also collapses to the cheaper value.
    const cmProducts: CardmarketProduct[] = [
      { idProduct: 100, name: "Command and Conquer", idExpansion: 42 },
      { idProduct: 101, name: "Command and Conquer", idExpansion: 42 },
    ];
    const guideA: CardmarketPriceGuideRow = {
      idProduct: 100,
      trend: 10,
      low: 9,
    };
    const guideB: CardmarketPriceGuideRow = {
      idProduct: 101,
      trend: 6,
      low: 12,
    };
    const deps = makeDeps({
      fetchCardmarketData: vi.fn().mockResolvedValue({
        products: cmProducts,
        priceGuideByProduct: new Map([
          [100, guideA],
          [101, guideB],
        ]),
        productsById: new Map([
          [100, cmProducts[0]],
          [101, cmProducts[1]],
        ]),
      }),
    });
    const result = await assembleCardComparison("command and conquer", deps);
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;

    const csv = renderCsv(result);
    const cmSection = csv.split("# page 2")[1].split("# page 3")[0];
    const dataLines = cmSection
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("Command and Conquer"));
    expect(dataLines).toHaveLength(1);
    // cheapest low (9 vs 12 -> 9) across all four columns; cheapest trend (10 vs 6 -> 6)
    expect(dataLines[0]).toBe(
      "Command and Conquer,Everfest,normal,9,low,9,low,9,low,9,low,6,trend",
    );
  });
});

// ---------------------------------------------------------------------------
// Characterization test (PRICE-020): locks the exact byte-for-byte renderCsv
// output captured from cardCommand.ts's original inline CSV writer BEFORE it
// was refactored to delegate into src/pricing/csv.ts. This must still pass,
// unmodified, after the refactor — that's the acceptance bar for "lift,
// don't duplicate" (docs/design/price-E2.md).
// ---------------------------------------------------------------------------

describe("renderCsv — characterization (pre/post csv.ts refactor)", () => {
  it("is byte-identical to the pre-refactor inline-writer output for the standard fixture", async () => {
    const deps = makeDeps();
    const result = await assembleCardComparison("command and conquer", deps);
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;

    const csv = renderCsv(result);
    expect(csv).toBe(
      [
        "# page 1 — TCGplayer prices (USD)",
        "# currency: USD",
        "Name,Set,Finish,NM,NM Source,SP/LP,SP/LP Source,MP,MP Source,HP,HP Source",
        "Command and Conquer,Everfest,normal,9.25,listing,9,listing,,,,",
        "",
        "# page 2 — Cardmarket prices (EUR)",
        "# currency: EUR",
        "Name,Set,Finish,NM,NM Source,SP/LP,SP/LP Source,MP,MP Source,HP,HP Source,Trend,Trend Source",
        "Command and Conquer,Everfest,normal,6,low,6,low,6,low,6,low,7,trend",
        "",
        "# page 3 — Ratio: tcgplayer / cardmarket",
        "# ratio: tcgplayer / cardmarket",
        "# fx: 1 EUR = 1.1 USD (ECB 2026-07-11)",
        "Name,Set,Finish,NM,NM Basis,SP/LP,SP/LP Basis,MP,MP Basis,HP,HP Basis",
        "Command and Conquer,Everfest,normal,+40.2%,listing/low,+36.4%,listing/low,,,,",
        "",
        "# page 4 — Ratio: cardmarket / tcgplayer",
        "# ratio: cardmarket / tcgplayer",
        "# fx: 1 EUR = 1.1 USD (ECB 2026-07-11)",
        "Name,Set,Finish,NM,NM Basis,SP/LP,SP/LP Basis,MP,MP Basis,HP,HP Basis",
        "Command and Conquer,Everfest,normal,-28.6%,low/listing,-26.7%,low/listing,,,,",
      ].join("\n"),
    );
  });
});
