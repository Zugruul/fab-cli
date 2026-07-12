import { describe, it, expect } from "vitest";
import { CONDITION_COLUMNS } from "../../src/pricing/types";
import type {
  ConditionColumn,
  PriceSource,
  ConditionCell,
  ConditionPrices,
  Finish,
  RowIdentity,
  PriceRow,
  PriceProvider,
} from "../../src/pricing/types";

describe("pricing/types — CONDITION_COLUMNS", () => {
  it("is the canonical column order NM, SP/LP, MP, HP", () => {
    expect(CONDITION_COLUMNS).toEqual(["NM", "SP/LP", "MP", "HP"]);
  });

  it("has exactly 4 entries matching the ConditionColumn union", () => {
    expect(CONDITION_COLUMNS).toHaveLength(4);
    const columns: ConditionColumn[] = ["NM", "SP/LP", "MP", "HP"];
    expect(CONDITION_COLUMNS).toEqual(columns);
  });
});

describe("pricing/types — type shapes (compile-time + basic runtime sanity)", () => {
  it("accepts every PriceSource variant, incl. templated adjacent:<COL>", () => {
    const sources: PriceSource[] = [
      "listing",
      "market",
      "trend",
      "low",
      "avg30",
      "avg7",
      "avg1",
      "adjacent:NM",
      "adjacent:SP/LP",
      "adjacent:MP",
      "adjacent:HP",
    ];
    expect(sources).toHaveLength(11);
  });

  it("builds a ConditionCell", () => {
    const cell: ConditionCell = { price: 4.5, source: "market" };
    expect(cell.price).toBe(4.5);
    expect(cell.source).toBe("market");
  });

  it("builds ConditionPrices with all four columns, some null", () => {
    const prices: ConditionPrices = {
      NM: { price: 10, source: "listing" },
      "SP/LP": { price: 8, source: "adjacent:NM" },
      MP: null,
      HP: null,
    };
    expect(prices.NM?.price).toBe(10);
    expect(prices.MP).toBeNull();
  });

  it("builds a RowIdentity and PriceRow", () => {
    const finish: Finish = "foil";
    const identity: RowIdentity = {
      name: "Rally the Rearguard (Red)",
      set: "Everfest",
      finish,
    };
    const row: PriceRow = {
      ...identity,
      conditions: {
        NM: { price: 1.2, source: "listing" },
        "SP/LP": null,
        MP: null,
        HP: null,
      },
    };
    expect(row.name).toBe(identity.name);
    expect(row.conditions.NM?.source).toBe("listing");
  });

  it("builds a minimal PriceProvider shape", async () => {
    const provider: PriceProvider = {
      id: "tcgplayer",
      displayName: "TCGplayer",
      currency: "USD",
      fetchRows: async () => [],
    };
    expect(provider.currency).toBe("USD");
    await expect(provider.fetchRows()).resolves.toEqual([]);
    await expect(provider.fetchRows({ sets: ["Everfest"] })).resolves.toEqual(
      [],
    );
  });
});
