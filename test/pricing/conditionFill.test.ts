import { describe, it, expect } from "vitest";
import {
  applyAdjacencyFallback,
  fillTcgplayerConditions,
  computeRatioCells,
  formatRatioPct,
} from "../../src/pricing/compare";
import type {
  ConditionColumn,
  ConditionPrices,
  ConditionCell,
} from "../../src/pricing/types";
import { CONDITION_COLUMNS } from "../../src/pricing/types";
import type { FxRate } from "../../src/pricing/fx";

function cell(price: number, source: ConditionCell["source"]): ConditionCell {
  return { price, source };
}

function allNull(): ConditionPrices {
  return { NM: null, "SP/LP": null, MP: null, HP: null };
}

// ---------------------------------------------------------------------------
// applyAdjacencyFallback — full 16-pattern table (§8.2)
// ---------------------------------------------------------------------------

describe("applyAdjacencyFallback — exhaustive presence patterns", () => {
  // Distinct prices per column so a wrong source is caught by price mismatch
  // as well as by the source label.
  const REAL_PRICE: Record<ConditionColumn, number> = {
    NM: 100,
    "SP/LP": 200,
    MP: 300,
    HP: 400,
  };

  function buildInput(
    present: Record<ConditionColumn, boolean>,
  ): ConditionPrices {
    const out = {} as ConditionPrices;
    for (const col of CONDITION_COLUMNS) {
      out[col] = present[col] ? cell(REAL_PRICE[col], "listing") : null;
    }
    return out;
  }

  interface Pattern {
    present: Record<ConditionColumn, boolean>;
    // expected source suffix (column name) for each originally-null column,
    // or "real" if the column was present to begin with.
    expectedFrom: Record<ConditionColumn, ConditionColumn | "real">;
  }

  const patterns: Pattern[] = [
    {
      present: { NM: false, "SP/LP": false, MP: false, HP: false },
      expectedFrom: { NM: "real", "SP/LP": "real", MP: "real", HP: "real" }, // unused (all-null case handled separately)
    },
    {
      present: { NM: false, "SP/LP": false, MP: false, HP: true },
      expectedFrom: { NM: "HP", "SP/LP": "HP", MP: "HP", HP: "real" },
    },
    {
      present: { NM: false, "SP/LP": false, MP: true, HP: false },
      expectedFrom: { NM: "MP", "SP/LP": "MP", MP: "real", HP: "MP" },
    },
    {
      present: { NM: false, "SP/LP": false, MP: true, HP: true },
      expectedFrom: { NM: "MP", "SP/LP": "MP", MP: "real", HP: "real" },
    },
    {
      present: { NM: false, "SP/LP": true, MP: false, HP: false },
      expectedFrom: { NM: "SP/LP", "SP/LP": "real", MP: "SP/LP", HP: "SP/LP" },
    },
    {
      present: { NM: false, "SP/LP": true, MP: false, HP: true },
      expectedFrom: { NM: "SP/LP", "SP/LP": "real", MP: "SP/LP", HP: "real" },
    },
    {
      present: { NM: false, "SP/LP": true, MP: true, HP: false },
      expectedFrom: { NM: "SP/LP", "SP/LP": "real", MP: "real", HP: "MP" },
    },
    {
      present: { NM: false, "SP/LP": true, MP: true, HP: true },
      expectedFrom: { NM: "SP/LP", "SP/LP": "real", MP: "real", HP: "real" },
    },
    {
      present: { NM: true, "SP/LP": false, MP: false, HP: false },
      expectedFrom: { NM: "real", "SP/LP": "NM", MP: "NM", HP: "NM" },
    },
    {
      present: { NM: true, "SP/LP": false, MP: false, HP: true },
      expectedFrom: { NM: "real", "SP/LP": "NM", MP: "HP", HP: "real" },
    },
    {
      present: { NM: true, "SP/LP": false, MP: true, HP: false },
      // SP/LP is equidistant from NM (dist 1) and MP (dist 1) -> tie -> better (NM)
      expectedFrom: { NM: "real", "SP/LP": "NM", MP: "real", HP: "MP" },
    },
    {
      present: { NM: true, "SP/LP": false, MP: true, HP: true },
      expectedFrom: { NM: "real", "SP/LP": "NM", MP: "real", HP: "real" },
    },
    {
      present: { NM: true, "SP/LP": true, MP: false, HP: false },
      expectedFrom: { NM: "real", "SP/LP": "real", MP: "SP/LP", HP: "SP/LP" },
    },
    {
      present: { NM: true, "SP/LP": true, MP: false, HP: true },
      // MP equidistant from SP/LP (dist 1) and HP (dist 1) -> tie -> better (SP/LP)
      expectedFrom: { NM: "real", "SP/LP": "real", MP: "SP/LP", HP: "real" },
    },
    {
      present: { NM: true, "SP/LP": true, MP: true, HP: false },
      expectedFrom: { NM: "real", "SP/LP": "real", MP: "real", HP: "MP" },
    },
    {
      present: { NM: true, "SP/LP": true, MP: true, HP: true },
      expectedFrom: { NM: "real", "SP/LP": "real", MP: "real", HP: "real" },
    },
  ];

  it("covers all 16 present/absent combinations", () => {
    expect(patterns).toHaveLength(16);
  });

  for (const pattern of patterns) {
    const label = CONDITION_COLUMNS.map((c) =>
      pattern.present[c] ? c : "-",
    ).join(",");

    it(`pattern [${label}]`, () => {
      const input = buildInput(pattern.present);
      const anyPresent = CONDITION_COLUMNS.some((c) => pattern.present[c]);
      const result = applyAdjacencyFallback(input);

      if (!anyPresent) {
        expect(result).toEqual(allNull());
        return;
      }

      for (const col of CONDITION_COLUMNS) {
        const from = pattern.expectedFrom[col];
        if (from === "real") {
          expect(result[col]).toEqual(cell(REAL_PRICE[col], "listing"));
        } else {
          expect(result[col]).toEqual({
            price: REAL_PRICE[from],
            source: `adjacent:${from}`,
          });
        }
      }
    });
  }
});

describe("applyAdjacencyFallback — chain-copy guard", () => {
  it("fills MP from the real HP column, not from SP/LP's own adjacency-filled value", () => {
    // Only NM and HP are real. SP/LP (dist 1 to NM, 2 to HP) must copy from
    // NM. MP (dist 2 to NM, 1 to HP) must copy from the REAL HP column, not
    // from SP/LP's freshly-adjacency-filled cell (which would also be dist 1
    // away under a naive left-to-right chaining implementation).
    const input: ConditionPrices = {
      NM: cell(100, "listing"),
      "SP/LP": null,
      MP: null,
      HP: cell(10, "listing"),
    };
    const result = applyAdjacencyFallback(input);
    expect(result["SP/LP"]).toEqual({ price: 100, source: "adjacent:NM" });
    expect(result.MP).toEqual({ price: 10, source: "adjacent:HP" });
  });
});

// ---------------------------------------------------------------------------
// fillTcgplayerConditions (§8.2)
// ---------------------------------------------------------------------------

describe("fillTcgplayerConditions", () => {
  it("uses the listing price with source listing when every condition has a listing", () => {
    const result = fillTcgplayerConditions({
      listings: { NM: 10, "SP/LP": 8, MP: 6, HP: 4 },
    });
    expect(result).toEqual({
      NM: cell(10, "listing"),
      "SP/LP": cell(8, "listing"),
      MP: cell(6, "listing"),
      HP: cell(4, "listing"),
    });
  });

  it("fills a missing condition from the nearest listed column (adjacent:<COL>)", () => {
    const result = fillTcgplayerConditions({
      listings: { NM: 10, HP: 4 },
    });
    expect(result["SP/LP"]).toEqual({ price: 10, source: "adjacent:NM" });
    expect(result.MP).toEqual({ price: 4, source: "adjacent:HP" });
  });

  it("tie-break: MP null between SP/LP and HP listings takes the better (SP/LP)", () => {
    const result = fillTcgplayerConditions({
      listings: { "SP/LP": 8, HP: 4 },
    });
    expect(result.MP).toEqual({ price: 8, source: "adjacent:SP/LP" });
    expect(result.NM).toEqual({ price: 8, source: "adjacent:SP/LP" });
  });

  it("no listings at all: NM = marketPrice with source market, rest adjacent:NM", () => {
    const result = fillTcgplayerConditions({
      listings: {},
      marketPrice: 25,
      lowPrice: 20,
    });
    expect(result.NM).toEqual({ price: 25, source: "market" });
    expect(result["SP/LP"]).toEqual({ price: 25, source: "adjacent:NM" });
    expect(result.MP).toEqual({ price: 25, source: "adjacent:NM" });
    expect(result.HP).toEqual({ price: 25, source: "adjacent:NM" });
  });

  it("no listings, marketPrice null: falls back to lowPrice with source market", () => {
    const result = fillTcgplayerConditions({
      listings: {},
      marketPrice: null,
      lowPrice: 20,
    });
    expect(result.NM).toEqual({ price: 20, source: "market" });
    expect(result.HP).toEqual({ price: 20, source: "adjacent:NM" });
  });

  it("marketPrice of exactly 0 is a genuine price, not treated as absent", () => {
    const result = fillTcgplayerConditions({
      listings: {},
      marketPrice: 0,
      lowPrice: 50,
    });
    expect(result.NM).toEqual({ price: 0, source: "market" });
  });

  it("no listings and no market/low price: all four cells null", () => {
    const result = fillTcgplayerConditions({
      listings: {},
      marketPrice: null,
      lowPrice: null,
    });
    expect(result).toEqual(allNull());
  });

  it("no listings and market/low fields entirely absent: all four cells null", () => {
    const result = fillTcgplayerConditions({ listings: {} });
    expect(result).toEqual(allNull());
  });

  it("does not use market price when at least one real listing exists elsewhere", () => {
    // Only SP/LP has a listing; NM has none. Even with a marketPrice given,
    // NM must be filled via adjacency from SP/LP, not from market, because
    // §8.2's market-fill rule only applies when NO condition has any listing.
    const result = fillTcgplayerConditions({
      listings: { "SP/LP": 8 },
      marketPrice: 999,
    });
    expect(result.NM).toEqual({ price: 8, source: "adjacent:SP/LP" });
  });
});

// ---------------------------------------------------------------------------
// Ratio math (§8.4)
// ---------------------------------------------------------------------------

describe("computeRatioCells", () => {
  const fx: FxRate = {
    rate: 1.2,
    date: "2026-07-11",
    base: "EUR",
    quote: "USD",
  };

  function prices(
    p: Partial<Record<ConditionColumn, ConditionCell | null>>,
  ): ConditionPrices {
    return {
      NM: p.NM ?? null,
      "SP/LP": p["SP/LP"] ?? null,
      MP: p.MP ?? null,
      HP: p.HP ?? null,
    };
  }

  it("computes pct in common USD when both sides are already USD", () => {
    const a = prices({ NM: cell(13, "listing") });
    const b = prices({ NM: cell(10, "listing") });
    const result = computeRatioCells(a, b, {
      fx,
      currencyA: "USD",
      currencyB: "USD",
    });
    expect(result.NM!.pct).toBeCloseTo(0.3, 10);
    expect(result.NM!.basis).toBe("listing/listing");
  });

  it("converts EUR to USD (default common currency) before computing the ratio", () => {
    // b = 10 EUR at rate 1.2 -> 12 USD; a = 15.6 USD -> pct = 15.6/12 - 1 = 0.3
    const a = prices({ NM: cell(15.6, "listing") });
    const b = prices({ NM: cell(10, "trend") });
    const result = computeRatioCells(a, b, {
      fx,
      currencyA: "USD",
      currencyB: "EUR",
    });
    expect(result.NM!.pct).toBeCloseTo(0.3, 10);
    expect(result.NM!.basis).toBe("listing/trend");
  });

  it("converts USD to EUR when common currency is eur", () => {
    // a = 12 USD at rate 1.2 -> 10 EUR; b = 8 EUR -> pct = 10/8 - 1 = 0.25
    const a = prices({ NM: cell(12, "listing") });
    const b = prices({ NM: cell(8, "trend") });
    const result = computeRatioCells(a, b, {
      fx,
      currencyA: "USD",
      currencyB: "EUR",
      common: "eur",
    });
    expect(result.NM!.pct).toBeCloseTo(0.25, 10);
  });

  it("carries the adjacency source into the basis label", () => {
    const a = prices({ MP: cell(9, "adjacent:SP/LP") });
    const b = prices({ MP: cell(3, "low") });
    const result = computeRatioCells(a, b, {
      fx,
      currencyA: "USD",
      currencyB: "USD",
    });
    expect(result.MP!.basis).toBe("adjacent:SP/LP/low");
  });

  it("propagates null when side A is missing", () => {
    const a = prices({});
    const b = prices({ NM: cell(10, "trend") });
    const result = computeRatioCells(a, b, {
      fx,
      currencyA: "USD",
      currencyB: "EUR",
    });
    expect(result.NM).toBeNull();
  });

  it("propagates null when side B is missing", () => {
    const a = prices({ NM: cell(10, "listing") });
    const b = prices({});
    const result = computeRatioCells(a, b, {
      fx,
      currencyA: "USD",
      currencyB: "EUR",
    });
    expect(result.NM).toBeNull();
  });

  it("propagates null on both sides missing", () => {
    const result = computeRatioCells(prices({}), prices({}), {
      fx,
      currencyA: "USD",
      currencyB: "EUR",
    });
    expect(result).toEqual({ NM: null, "SP/LP": null, MP: null, HP: null });
  });

  it("guards against division by zero when side B converts to 0", () => {
    // A genuine trend price of 0 (allowed per §8.3 for normal finish) must
    // not blow up the ratio — the cell is null, never Infinity/NaN.
    const a = prices({ NM: cell(10, "listing") });
    const b = prices({ NM: cell(0, "trend") });
    const result = computeRatioCells(a, b, {
      fx,
      currencyA: "USD",
      currencyB: "EUR",
    });
    expect(result.NM).toBeNull();
  });

  it("handles multiple columns independently in one call", () => {
    const a = prices({ NM: cell(10, "listing"), HP: cell(2, "listing") });
    const b = prices({ NM: cell(10, "trend") }); // HP missing on B
    const result = computeRatioCells(a, b, {
      fx,
      currencyA: "USD",
      currencyB: "USD",
    });
    expect(result.NM!.pct).toBeCloseTo(0, 10);
    expect(result.HP).toBeNull();
  });
});

describe("formatRatioPct", () => {
  it("formats a positive ratio with a leading plus and one decimal", () => {
    expect(formatRatioPct(0.3)).toBe("+30.0%");
  });

  it("formats a negative ratio with a leading minus and one decimal", () => {
    expect(formatRatioPct(-0.125)).toBe("-12.5%");
  });

  it("formats exactly zero as +0.0%, never -0.0%", () => {
    expect(formatRatioPct(0)).toBe("+0.0%");
  });

  it("formats a tiny negative value that rounds to zero as +0.0%, not -0.0%", () => {
    expect(formatRatioPct(-0.0004)).toBe("+0.0%");
  });

  it("rounds to one decimal place", () => {
    expect(formatRatioPct(0.18181818)).toBe("+18.2%");
  });
});
