import { describe, it, expect } from "vitest";
import {
  buildComparisonRows,
  cardmarketSetName,
  collapseDuplicates,
} from "../../src/pricing/compare";
import type { PriceRow, ConditionPrices } from "../../src/pricing/types";
import type { ExpansionAnchorMap } from "../../src/pricing/expansionAnchoring";

function conditions(
  partial: Partial<Record<"NM" | "SP/LP" | "MP" | "HP", number>>,
): ConditionPrices {
  return {
    NM: partial.NM != null ? { price: partial.NM, source: "listing" } : null,
    "SP/LP":
      partial["SP/LP"] != null
        ? { price: partial["SP/LP"], source: "listing" }
        : null,
    MP: partial.MP != null ? { price: partial.MP, source: "listing" } : null,
    HP: partial.HP != null ? { price: partial.HP, source: "listing" } : null,
  };
}

function row(
  name: string,
  set: string,
  finish: "normal" | "foil",
  cond: ConditionPrices,
): PriceRow {
  return { name, set, finish, conditions: cond };
}

describe("buildComparisonRows — normalization", () => {
  it("matches rows across providers despite apostrophe differences in name", () => {
    const tcg = [
      row(
        "Fyendal's Spring Tunic",
        "Everfest",
        "normal",
        conditions({ NM: 10 }),
      ),
    ];
    const cm = [
      row("Fyendals Spring Tunic", "Everfest", "normal", conditions({ NM: 8 })),
    ];
    const { rows, unmatched } = buildComparisonRows({
      tcgplayer: tcg,
      cardmarket: cm,
    });
    expect(unmatched).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].conditionsByProvider.tcgplayer.NM?.price).toBe(10);
    expect(rows[0].conditionsByProvider.cardmarket.NM?.price).toBe(8);
  });

  it("treats different pitch suffixes as distinct rows (no cross-match)", () => {
    const tcg = [
      row(
        "Rally the Rearguard (Red)",
        "Everfest",
        "normal",
        conditions({ NM: 5 }),
      ),
    ];
    const cm = [
      row(
        "Rally the Rearguard (Blue)",
        "Everfest",
        "normal",
        conditions({ NM: 5 }),
      ),
    ];
    const { rows, unmatched } = buildComparisonRows({
      tcgplayer: tcg,
      cardmarket: cm,
    });
    expect(rows).toHaveLength(0);
    expect(unmatched).toHaveLength(2);
    expect(unmatched.every((u) => u.reason === "no-counterpart")).toBe(true);
  });

  it("matches despite internal whitespace differences in the set name", () => {
    const tcg = [
      row("Snatch (Red)", "Dusk  till   Dawn", "normal", conditions({ NM: 5 })),
    ];
    const cm = [
      row("Snatch (Red)", " Dusk till Dawn ", "normal", conditions({ NM: 4 })),
    ];
    const { rows, unmatched } = buildComparisonRows({
      tcgplayer: tcg,
      cardmarket: cm,
    });
    expect(unmatched).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it("matches despite diacritics and case differences", () => {
    const tcg = [
      row("Émigré Wanderer", "Everfest", "normal", conditions({ NM: 3 })),
    ];
    const cm = [
      row("emigre wanderer", "EVERFEST", "normal", conditions({ NM: 2 })),
    ];
    const { rows, unmatched } = buildComparisonRows({
      tcgplayer: tcg,
      cardmarket: cm,
    });
    expect(unmatched).toEqual([]);
    expect(rows).toHaveLength(1);
  });
});

describe("buildComparisonRows — within-provider duplicate collapse", () => {
  it("collapses 1st Edition / Unlimited duplicates (same identity, two printings), cheapest per condition wins", () => {
    // Same canonical identity — e.g. one PriceRow per printing (1st Ed,
    // Unlimited) sharing (name, set, finish) but differing per-condition
    // prices. 1st Ed cheaper on NM, Unlimited cheaper on SP/LP — a naive
    // "pick one printing" implementation would get one of these wrong.
    const tcg = [
      row(
        "Rally the Rearguard (Red)",
        "Everfest",
        "normal",
        conditions({ NM: 5, "SP/LP": 9 }),
      ),
      row(
        "Rally the Rearguard (Red)",
        "Everfest",
        "normal",
        conditions({ NM: 7, "SP/LP": 4 }),
      ),
    ];
    const cm = [
      row(
        "Rally the Rearguard (Red)",
        "Everfest",
        "normal",
        conditions({ NM: 6, "SP/LP": 6 }),
      ),
    ];
    const { rows, unmatched } = buildComparisonRows({
      tcgplayer: tcg,
      cardmarket: cm,
    });
    expect(unmatched).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].conditionsByProvider.tcgplayer.NM?.price).toBe(5);
    expect(rows[0].conditionsByProvider.tcgplayer["SP/LP"]?.price).toBe(4);
  });

  it("splits foil and normal printings of the same name into separate rows", () => {
    const tcg = [
      row("Snatch (Red)", "Everfest", "normal", conditions({ NM: 1 })),
      row("Snatch (Red) - Foil", "Everfest", "foil", conditions({ NM: 20 })),
    ];
    const cm = [
      row("Snatch (Red)", "Everfest", "normal", conditions({ NM: 1 })),
      row("Snatch (Red) - Foil", "Everfest", "foil", conditions({ NM: 18 })),
    ];
    const { rows, unmatched } = buildComparisonRows({
      tcgplayer: tcg,
      cardmarket: cm,
    });
    expect(unmatched).toEqual([]);
    expect(rows).toHaveLength(2);
    const foilRow = rows.find((r) => r.finish === "foil");
    const normalRow = rows.find((r) => r.finish === "normal");
    expect(foilRow?.conditionsByProvider.tcgplayer.NM?.price).toBe(20);
    expect(normalRow?.conditionsByProvider.tcgplayer.NM?.price).toBe(1);
  });
});

describe("collapseDuplicates (exported for single-provider rendering)", () => {
  it("collapses same-identity rows into one, cheapest per condition winning", () => {
    const rows = [
      row(
        "Command and Conquer",
        "Everfest",
        "normal",
        conditions({ NM: 10, "SP/LP": 4 }),
      ),
      row(
        "Command and Conquer",
        "Everfest",
        "normal",
        conditions({ NM: 6, "SP/LP": 9 }),
      ),
    ];
    const collapsed = collapseDuplicates(rows);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].conditions.NM?.price).toBe(6);
    expect(collapsed[0].conditions["SP/LP"]?.price).toBe(4);
  });

  it("leaves distinct identities (different set/finish) as separate rows", () => {
    const rows = [
      row("Command and Conquer", "Everfest", "normal", conditions({ NM: 10 })),
      row("Command and Conquer", "Dynasty", "normal", conditions({ NM: 6 })),
    ];
    expect(collapseDuplicates(rows)).toHaveLength(2);
  });
});

describe("buildComparisonRows — one-sided rows", () => {
  it("reports a row present on only one provider as no-counterpart", () => {
    const tcg = [
      row("Only On TCG", "Everfest", "normal", conditions({ NM: 5 })),
    ];
    const { rows, unmatched } = buildComparisonRows({
      tcgplayer: tcg,
      cardmarket: [],
    });
    expect(rows).toEqual([]);
    expect(unmatched).toEqual([
      {
        provider: "tcgplayer",
        name: "Only On TCG",
        set: "Everfest",
        finish: "normal",
        reason: "no-counterpart",
      },
    ]);
  });

  it("supports more than two registered providers (row present on 2 of 3 still no-counterpart)", () => {
    const shared = row(
      "Shared Card",
      "Everfest",
      "normal",
      conditions({ NM: 5 }),
    );
    const { rows, unmatched } = buildComparisonRows({
      tcgplayer: [shared],
      cardmarket: [shared],
      thirdparty: [],
    });
    expect(rows).toEqual([]);
    expect(unmatched.every((u) => u.reason === "no-counterpart")).toBe(true);
    expect(unmatched).toHaveLength(2);
  });

  it("matches across all 3 providers when present in all", () => {
    const shared = row(
      "Shared Card",
      "Everfest",
      "normal",
      conditions({ NM: 5 }),
    );
    const { rows, unmatched } = buildComparisonRows({
      tcgplayer: [shared],
      cardmarket: [shared],
      thirdparty: [shared],
    });
    expect(unmatched).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0].conditionsByProvider).sort()).toEqual([
      "cardmarket",
      "tcgplayer",
      "thirdparty",
    ]);
  });
});

describe("buildComparisonRows — unmapped Cardmarket expansions", () => {
  it("reports cm-expansion-<id> rows as unmapped-expansion, not no-counterpart, and keeps them", () => {
    const cm = [
      row("Mystery Card", "cm-expansion-999", "normal", conditions({ NM: 4 })),
    ];
    const { rows, unmatched } = buildComparisonRows({
      tcgplayer: [],
      cardmarket: cm,
    });
    expect(rows).toEqual([]);
    expect(unmatched).toEqual([
      {
        provider: "cardmarket",
        name: "Mystery Card",
        set: "cm-expansion-999",
        finish: "normal",
        reason: "unmapped-expansion",
      },
    ]);
  });
});

describe("buildComparisonRows — all-null-conditions rows", () => {
  it("excludes rows with all four condition cells null and reports reason no-price", () => {
    const tcg = [
      row("No Price Card", "Everfest", "normal", conditions({})),
      row("Priced Card", "Everfest", "normal", conditions({ NM: 5 })),
    ];
    const cm = [
      row("Priced Card", "Everfest", "normal", conditions({ NM: 4 })),
    ];
    const { rows, unmatched } = buildComparisonRows({
      tcgplayer: tcg,
      cardmarket: cm,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Priced Card");
    expect(unmatched).toEqual([
      {
        provider: "tcgplayer",
        name: "No Price Card",
        set: "Everfest",
        finish: "normal",
        reason: "no-price",
      },
    ]);
  });
});

describe("buildComparisonRows — empty inputs", () => {
  it("returns empty outputs for an empty provider map without throwing", () => {
    expect(() => buildComparisonRows({})).not.toThrow();
    expect(buildComparisonRows({})).toEqual({ rows: [], unmatched: [] });
  });

  it("returns empty outputs when all providers have empty arrays", () => {
    const { rows, unmatched } = buildComparisonRows({
      tcgplayer: [],
      cardmarket: [],
    });
    expect(rows).toEqual([]);
    expect(unmatched).toEqual([]);
  });

  it("accepts a Map as well as a plain object", () => {
    const shared = row(
      "Shared Card",
      "Everfest",
      "normal",
      conditions({ NM: 5 }),
    );
    const map = new Map([
      ["tcgplayer", [shared]],
      ["cardmarket", [shared]],
    ]);
    const { rows, unmatched } = buildComparisonRows(map);
    expect(unmatched).toEqual([]);
    expect(rows).toHaveLength(1);
  });
});

describe("buildComparisonRows — deterministic ordering", () => {
  it("produces deep-equal output across repeated calls with the same input", () => {
    const tcg = [
      row("B Card", "Everfest", "normal", conditions({ NM: 2 })),
      row("A Card", "Everfest", "normal", conditions({ NM: 1 })),
    ];
    const cm = [
      row("A Card", "Everfest", "normal", conditions({ NM: 1 })),
      row("B Card", "Everfest", "normal", conditions({ NM: 2 })),
    ];
    const first = buildComparisonRows({ tcgplayer: tcg, cardmarket: cm });
    const second = buildComparisonRows({ tcgplayer: tcg, cardmarket: cm });
    expect(first).toEqual(second);
    // insertion order by provider iteration then key: rows follow the
    // order keys are first completed (both providers seen), here B then A
    // since tcgplayer's array is iterated first and B appears before A there.
    expect(first.rows.map((r) => r.name)).toEqual(["B Card", "A Card"]);
  });
});

describe("cardmarketSetName", () => {
  const map: ExpansionAnchorMap = {
    generatedAt: "2026-07-12T00:00:00.000Z",
    votes: { "42": { name: "Everfest", votes: 3 } },
    overrides: {},
  };

  it("resolves a mapped idExpansion to its canonical name", () => {
    expect(cardmarketSetName(42, map)).toBe("Everfest");
  });

  it("falls back to cm-expansion-<id> for an unmapped idExpansion", () => {
    expect(cardmarketSetName(999, map)).toBe("cm-expansion-999");
  });

  it("falls back to cm-expansion-unknown for an undefined idExpansion", () => {
    expect(cardmarketSetName(undefined, map)).toBe("cm-expansion-unknown");
  });
});
