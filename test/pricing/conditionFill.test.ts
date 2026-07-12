import { describe, it, expect } from "vitest";
import {
  fillTcgplayerConditions,
  computeRatioCells,
  formatRatioPct,
} from "../../src/pricing/compare";
import type {
  ConditionColumn,
  ConditionPrices,
  ConditionCell,
} from "../../src/pricing/types";
import type { FxRate } from "../../src/pricing/fx";

function cell(price: number, source: ConditionCell["source"]): ConditionCell {
  return { price, source };
}

function allNull(): ConditionPrices {
  return { NM: null, "SP/LP": null, MP: null, HP: null };
}

// ---------------------------------------------------------------------------
// fillTcgplayerConditions (§8.2, real-data-only: listing or empty, no
// adjacency copy, no marketPrice/lowPrice stand-in — issue #61)
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

  it("a condition with no listing is empty (null), never copied from a neighboring column", () => {
    const result = fillTcgplayerConditions({
      listings: { NM: 10, HP: 4 },
    });
    expect(result.NM).toEqual(cell(10, "listing"));
    expect(result.HP).toEqual(cell(4, "listing"));
    expect(result["SP/LP"]).toBeNull();
    expect(result.MP).toBeNull();
  });

  it("only one condition has a listing: the other three are empty", () => {
    const result = fillTcgplayerConditions({
      listings: { "SP/LP": 8 },
    });
    expect(result["SP/LP"]).toEqual(cell(8, "listing"));
    expect(result.NM).toBeNull();
    expect(result.MP).toBeNull();
    expect(result.HP).toBeNull();
  });

  it("a listing price of exactly 0 is a genuine price, not treated as absent", () => {
    const result = fillTcgplayerConditions({
      listings: { NM: 0 },
    });
    expect(result.NM).toEqual(cell(0, "listing"));
  });

  it("no listings at all: all four cells null (no marketPrice/lowPrice fallback)", () => {
    const result = fillTcgplayerConditions({ listings: {} });
    expect(result).toEqual(allNull());
  });

  it("listings explicitly null for every column: all four cells null", () => {
    const result = fillTcgplayerConditions({
      listings: { NM: null, "SP/LP": null, MP: null, HP: null },
    });
    expect(result).toEqual(allNull());
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
    const b = prices({ NM: cell(10, "low") });
    const result = computeRatioCells(a, b, {
      fx,
      currencyA: "USD",
      currencyB: "EUR",
    });
    expect(result.NM!.pct).toBeCloseTo(0.3, 10);
    expect(result.NM!.basis).toBe("listing/low");
  });

  it("converts USD to EUR when common currency is eur", () => {
    // a = 12 USD at rate 1.2 -> 10 EUR; b = 8 EUR -> pct = 10/8 - 1 = 0.25
    const a = prices({ NM: cell(12, "listing") });
    const b = prices({ NM: cell(8, "low") });
    const result = computeRatioCells(a, b, {
      fx,
      currencyA: "USD",
      currencyB: "EUR",
      common: "eur",
    });
    expect(result.NM!.pct).toBeCloseTo(0.25, 10);
  });

  it("basis label is listing/low — the only real-data pairing now possible", () => {
    const a = prices({ MP: cell(9, "listing") });
    const b = prices({ MP: cell(3, "low") });
    const result = computeRatioCells(a, b, {
      fx,
      currencyA: "USD",
      currencyB: "USD",
    });
    expect(result.MP!.basis).toBe("listing/low");
  });

  it("propagates null when side A is missing", () => {
    const a = prices({});
    const b = prices({ NM: cell(10, "low") });
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
    const b = prices({ NM: cell(0, "low") });
    const result = computeRatioCells(a, b, {
      fx,
      currencyA: "USD",
      currencyB: "EUR",
    });
    expect(result.NM).toBeNull();
  });

  it("handles multiple columns independently in one call", () => {
    const a = prices({ NM: cell(10, "listing"), HP: cell(2, "listing") });
    const b = prices({ NM: cell(10, "low") }); // HP missing on B
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
