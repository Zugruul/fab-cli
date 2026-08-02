// Tests for src/pricing/csv.ts — PURE deterministic CSV writers (SPEC-PRICE
// §9.3, §7.3, §8.4, §11; docs/design/price-E2.md). Lifted from cardCommand.ts's
// inline writer (PRICE-020) — see cardCommand.test.ts's characterization test
// for the before/after behavior-preserving proof.

import { describe, it, expect } from "vitest";
import {
  renderPricePageCsv,
  renderRatioPageCsv,
  renderUnmatchedCsv,
} from "../../src/pricing/csv";
import type {
  ComparisonRow,
  RatioCell,
  UnmatchedRow,
} from "../../src/pricing/compare";
import type { ConditionColumn } from "../../src/pricing/types";
import type { FxRate } from "../../src/pricing/fx";

function priceRow(
  name: string,
  set: string,
  finish: "normal" | "foil",
  nm: number | null,
  trend?: number | null,
) {
  return {
    name,
    set,
    finish,
    conditions: {
      NM: nm != null ? { price: nm, source: "listing" as const } : null,
      "SP/LP": null,
      MP: null,
      HP: null,
    },
    ...(trend !== undefined
      ? {
          trend:
            trend != null ? { price: trend, source: "trend" as const } : null,
        }
      : {}),
  };
}

describe("renderPricePageCsv", () => {
  it("emits a currency comment line and the standard header (no trend column)", () => {
    const csv = renderPricePageCsv([], { currency: "USD" });
    const lines = csv.split("\n");
    expect(lines[0]).toBe("# currency: USD");
    expect(lines[1]).toBe(
      "Name,Set,Finish,Code,NM,NM Source,SP/LP,SP/LP Source,MP,MP Source,HP,HP Source",
    );
  });

  it("adds Trend,Trend Source columns when trendColumn is true", () => {
    const csv = renderPricePageCsv([], { currency: "EUR", trendColumn: true });
    const lines = csv.split("\n");
    expect(lines[0]).toBe("# currency: EUR");
    expect(lines[1]).toBe(
      "Name,Set,Finish,Code,NM,NM Source,SP/LP,SP/LP Source,MP,MP Source,HP,HP Source,Trend,Trend Source",
    );
  });

  it("renders empty cells as empty strings, never a placeholder like 0 or —", () => {
    const csv = renderPricePageCsv(
      [priceRow("Snatch", "Everfest", "normal", null, null)],
      { currency: "USD", trendColumn: true },
    );
    const dataLine = csv.split("\n").at(-1)!;
    // Snatch has no Everfest printing in the real vendored DB -> empty Code.
    expect(dataLine).toBe("Snatch,Everfest,normal,,,,,,,,,,,");
  });

  it("renders a real price cell with its source", () => {
    const csv = renderPricePageCsv(
      [priceRow("Snatch", "Everfest", "normal", 9.25)],
      { currency: "USD" },
    );
    const dataLine = csv.split("\n").at(-1)!;
    expect(dataLine).toBe("Snatch,Everfest,normal,,9.25,listing,,,,,,");
  });

  it("renders the official printing code when the vendored DB has a match", () => {
    const csv = renderPricePageCsv(
      [priceRow("Haze Bending", "Everfest", "normal", 9.25)],
      { currency: "USD" },
    );
    const dataLine = csv.split("\n").at(-1)!;
    expect(dataLine).toBe(
      "Haze Bending,Everfest,normal,EVR141,9.25,listing,,,,,,",
    );
  });

  it("escapes a name/set containing a comma or quote", () => {
    const csv = renderPricePageCsv(
      [priceRow('Command, "and" Conquer', "Dusk, till Dawn", "normal", 5)],
      { currency: "USD" },
    );
    const dataLine = csv.split("\n").at(-1)!;
    expect(dataLine).toBe(
      '"Command, ""and"" Conquer","Dusk, till Dawn",normal,,5,listing,,,,,,',
    );
  });

  it("orders rows by set A→Z, then name A→Z, then finish (normal before foil) by default", () => {
    const rows = [
      priceRow("Zeal", "Everfest", "foil", 1),
      priceRow("Zeal", "Everfest", "normal", 1),
      priceRow("Aether", "Everfest", "normal", 1),
      priceRow("Zeal", "Dusk till Dawn", "normal", 1),
    ];
    const csv = renderPricePageCsv(rows, { currency: "USD" });
    const dataLines = csv.split("\n").slice(2);
    expect(dataLines.map((l) => l.split(",").slice(0, 3).join(","))).toEqual([
      "Zeal,Dusk till Dawn,normal",
      "Aether,Everfest,normal",
      "Zeal,Everfest,normal",
      "Zeal,Everfest,foil",
    ]);
  });

  it("accepts a custom compareSets comparator overriding alphabetical set ordering", () => {
    const rows = [
      priceRow("Card", "Older Set", "normal", 1),
      priceRow("Card", "Newer Set", "normal", 1),
    ];
    // Reverse-alphabetical stand-in for a release-order comparator (PRICE-021).
    const csv = renderPricePageCsv(rows, {
      currency: "USD",
      compareSets: (a, b) => b.localeCompare(a),
    });
    const dataLines = csv.split("\n").slice(2);
    expect(dataLines[0]).toContain("Older Set");
    expect(dataLines[1]).toContain("Newer Set");
  });
});

describe("renderRatioPageCsv", () => {
  function row(name: string, set: string): ComparisonRow {
    return {
      name,
      set,
      finish: "normal",
      conditionsByProvider: { tcgplayer: {} as never, cardmarket: {} as never },
    };
  }

  function ratios(
    values: Partial<Record<ConditionColumn, RatioCell | null>>,
  ): Record<ConditionColumn, RatioCell | null> {
    return {
      NM: values.NM ?? null,
      "SP/LP": values["SP/LP"] ?? null,
      MP: values.MP ?? null,
      HP: values.HP ?? null,
    };
  }

  const fx: FxRate = {
    rate: 1.1,
    date: "2026-07-11",
    base: "EUR",
    quote: "USD",
  };

  it("emits pairLabel and fx comment lines above the header", () => {
    const csv = renderRatioPageCsv([], new Map(), {
      pairLabel: "tcgplayer / cardmarket",
      fx,
    });
    const lines = csv.split("\n");
    expect(lines[0]).toBe("# ratio: tcgplayer / cardmarket");
    expect(lines[1]).toBe("# fx: 1 EUR = 1.1 USD (ECB 2026-07-11)");
    expect(lines[2]).toBe(
      "Name,Set,Finish,Code,NM,NM Basis,SP/LP,SP/LP Basis,MP,MP Basis,HP,HP Basis",
    );
  });

  it("renders a signed one-decimal percentage and listing/low basis for a present cell", () => {
    const r = row("Snatch", "Everfest");
    const map = new Map([
      [r, ratios({ NM: { pct: 0.402, basis: "listing/low" } })],
    ]);
    const csv = renderRatioPageCsv([r], map, {
      pairLabel: "tcgplayer / cardmarket",
      fx,
    });
    const dataLine = csv.split("\n").at(-1)!;
    // Snatch has no Everfest printing in the real vendored DB -> empty Code.
    expect(dataLine).toBe("Snatch,Everfest,normal,,+40.2%,listing/low,,,,,,");
  });

  it("renders the official printing code when the vendored DB has a match", () => {
    const r = row("Haze Bending", "Everfest");
    const map = new Map([[r, ratios({})]]);
    const csv = renderRatioPageCsv([r], map, {
      pairLabel: "tcgplayer / cardmarket",
      fx,
    });
    const dataLine = csv.split("\n").at(-1)!;
    expect(dataLine).toBe("Haze Bending,Everfest,normal,EVR141,,,,,,,,");
  });

  it("propagates empty cells when a ratio is absent for a condition", () => {
    const r = row("Snatch", "Everfest");
    const map = new Map([[r, ratios({})]]);
    const csv = renderRatioPageCsv([r], map, {
      pairLabel: "tcgplayer / cardmarket",
      fx,
    });
    const dataLine = csv.split("\n").at(-1)!;
    expect(dataLine).toBe("Snatch,Everfest,normal,,,,,,,,,");
  });

  it("orders rows by set then name then finish, same as price pages", () => {
    const a = row("Zeal", "Everfest");
    const b = row("Aether", "Everfest");
    const map = new Map([
      [a, ratios({})],
      [b, ratios({})],
    ]);
    const csv = renderRatioPageCsv([a, b], map, {
      pairLabel: "tcgplayer / cardmarket",
      fx,
    });
    const dataLines = csv.split("\n").slice(3);
    expect(dataLines[0].startsWith("Aether")).toBe(true);
    expect(dataLines[1].startsWith("Zeal")).toBe(true);
  });
});

describe("renderUnmatchedCsv", () => {
  it("emits the header and Provider,Name,Set,Finish,Reason rows", () => {
    const unmatched: UnmatchedRow[] = [
      {
        provider: "tcgplayer",
        name: "Snatch",
        set: "Everfest",
        finish: "normal",
        reason: "no-counterpart",
      },
      {
        provider: "cardmarket",
        name: "Zeal",
        set: "cm-expansion-99",
        finish: "foil",
        reason: "unmapped-expansion",
      },
    ];
    const csv = renderUnmatchedCsv(unmatched);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Provider,Name,Set,Finish,Code,Reason");
    // Snatch has no Everfest printing, and cm-expansion-99 never matches a
    // real set name -> both rows get an empty Code.
    expect(lines[1]).toBe("tcgplayer,Snatch,Everfest,normal,,no-counterpart");
    expect(lines[2]).toBe(
      "cardmarket,Zeal,cm-expansion-99,foil,,unmapped-expansion",
    );
  });

  it("renders the official printing code when the vendored DB has a match", () => {
    const csv = renderUnmatchedCsv([
      {
        provider: "tcgplayer",
        name: "Haze Bending",
        set: "Everfest",
        finish: "normal",
        reason: "no-counterpart",
      },
    ]);
    expect(csv.split("\n")[1]).toBe(
      "tcgplayer,Haze Bending,Everfest,normal,EVR141,no-counterpart",
    );
  });

  it("escapes a comma in the name field", () => {
    const csv = renderUnmatchedCsv([
      {
        provider: "tcgplayer",
        name: "Command, and Conquer",
        set: "Everfest",
        finish: "normal",
        reason: "no-price",
      },
    ]);
    expect(csv.split("\n")[1]).toBe(
      'tcgplayer,"Command, and Conquer",Everfest,normal,,no-price',
    );
  });
});
