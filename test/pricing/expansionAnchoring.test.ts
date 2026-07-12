import { describe, it, expect } from "vitest";
import {
  normalizeCardName,
  buildExpansionAnchorMap,
  resolveExpansionName,
  type ExpansionAnchorMap,
} from "../../src/pricing/expansionAnchoring";
import type { Group, Product } from "../../src/pricing/tcgcsv";
import type { CardmarketProduct } from "../../src/pricing/cardmarket";

const GENERATED_AT = "2026-07-12T00:00:00.000Z";

function tcgcsv(
  groups: Group[],
  productsByGroupId: Record<number, Product[]>,
): { groups: Group[]; productsByGroupId: Map<number, Product[]> } {
  return {
    groups,
    productsByGroupId: new Map(
      Object.entries(productsByGroupId).map(([k, v]) => [Number(k), v]),
    ),
  };
}

describe("normalizeCardName", () => {
  it("lowercases, strips apostrophes, and collapses whitespace", () => {
    expect(normalizeCardName("Fyendal's  Spring   Tunic")).toBe(
      "fyendals spring tunic",
    );
  });

  it("preserves parenthesized pitch suffixes", () => {
    expect(normalizeCardName("Rally the Rearguard (Red)")).toBe(
      "rally the rearguard (red)",
    );
  });

  it("strips diacritics", () => {
    expect(normalizeCardName("Émigré Wanderer")).toBe("emigre wanderer");
  });

  it("strips punctuation other than parentheses", () => {
    expect(normalizeCardName("Snatch! Or, Grab.")).toBe("snatch or grab");
  });
});

describe("buildExpansionAnchorMap — unique-name voting + majority", () => {
  it("casts one vote per name unique to a single tcgcsv set with a single CM idExpansion", () => {
    const catalog = tcgcsv([{ groupId: 1, name: "Everfest" }], {
      1: [{ productId: 10, name: "Rally the Rearguard (Red)", groupId: 1 }],
    });
    const cmProducts: CardmarketProduct[] = [
      {
        idProduct: 100,
        name: "Rally the Rearguard (Red)",
        idExpansion: 42,
      },
    ];

    const map = buildExpansionAnchorMap(
      catalog.groups,
      catalog.productsByGroupId,
      cmProducts,
      GENERATED_AT,
    );

    expect(map.generatedAt).toBe(GENERATED_AT);
    expect(map.votes["42"]).toEqual({ name: "Everfest", votes: 1 });
    expect(map.overrides).toEqual({});
  });

  it("assigns the majority-vote name and records a runnerUp when votes split", () => {
    const catalog = tcgcsv([{ groupId: 1, name: "Everfest" }], {
      1: [
        { productId: 10, name: "Card A", groupId: 1 },
        { productId: 11, name: "Card B", groupId: 1 },
        { productId: 12, name: "Card C", groupId: 1 },
      ],
    });
    // Simulate a second, wrongly-labelled tcgcsv group for one card's CM
    // counterpart by having 2 names vote "Everfest" and 1 vote a decoy name
    // via a distinct group — but keep each name unique to exactly one group
    // by using a second catalog fixture; simplest: three names, all unique
    // to group 1, but their CM idExpansion is shared as 42.
    const cmProducts: CardmarketProduct[] = [
      { idProduct: 100, name: "Card A", idExpansion: 42 },
      { idProduct: 101, name: "Card B", idExpansion: 42 },
      { idProduct: 102, name: "Card C", idExpansion: 42 },
    ];

    const map = buildExpansionAnchorMap(
      catalog.groups,
      catalog.productsByGroupId,
      cmProducts,
      GENERATED_AT,
    );

    expect(map.votes["42"]).toEqual({ name: "Everfest", votes: 3 });
  });

  it("picks the majority name across two competing groups and records the runnerUp", () => {
    const catalog = tcgcsv(
      [
        { groupId: 1, name: "Everfest" },
        { groupId: 2, name: "Tales of Aria" },
      ],
      {
        1: [
          { productId: 10, name: "Card A", groupId: 1 },
          { productId: 11, name: "Card B", groupId: 1 },
        ],
        2: [{ productId: 20, name: "Card C", groupId: 2 }],
      },
    );
    const cmProducts: CardmarketProduct[] = [
      { idProduct: 100, name: "Card A", idExpansion: 42 },
      { idProduct: 101, name: "Card B", idExpansion: 42 },
      { idProduct: 102, name: "Card C", idExpansion: 42 },
    ];

    const map = buildExpansionAnchorMap(
      catalog.groups,
      catalog.productsByGroupId,
      cmProducts,
      GENERATED_AT,
    );

    expect(map.votes["42"]).toEqual({
      name: "Everfest",
      votes: 2,
      runnerUp: { name: "Tales of Aria", votes: 1 },
    });
  });

  it("breaks a tied vote by lexicographically smallest name (deterministic)", () => {
    const catalog = tcgcsv(
      [
        { groupId: 1, name: "Zzz Set" },
        { groupId: 2, name: "Aaa Set" },
      ],
      {
        1: [{ productId: 10, name: "Card A", groupId: 1 }],
        2: [{ productId: 20, name: "Card B", groupId: 2 }],
      },
    );
    const cmProducts: CardmarketProduct[] = [
      { idProduct: 100, name: "Card A", idExpansion: 42 },
      { idProduct: 101, name: "Card B", idExpansion: 42 },
    ];

    const map = buildExpansionAnchorMap(
      catalog.groups,
      catalog.productsByGroupId,
      cmProducts,
      GENERATED_AT,
    );

    // Both names have 1 vote each — deterministic tiebreak picks the
    // lexicographically smallest group name.
    expect(map.votes["42"]).toEqual({
      name: "Aaa Set",
      votes: 1,
      runnerUp: { name: "Zzz Set", votes: 1 },
    });
  });
});

describe("buildExpansionAnchorMap — ambiguity exclusions", () => {
  it("does not vote for a name that exists in 2+ tcgcsv sets", () => {
    const catalog = tcgcsv(
      [
        { groupId: 1, name: "Everfest" },
        { groupId: 2, name: "Uprising" },
      ],
      {
        1: [{ productId: 10, name: "Reprinted Card", groupId: 1 }],
        2: [{ productId: 20, name: "Reprinted Card", groupId: 2 }],
      },
    );
    const cmProducts: CardmarketProduct[] = [
      { idProduct: 100, name: "Reprinted Card", idExpansion: 42 },
    ];

    const map = buildExpansionAnchorMap(
      catalog.groups,
      catalog.productsByGroupId,
      cmProducts,
      GENERATED_AT,
    );

    expect(map.votes["42"]).toBeUndefined();
  });

  it("does not vote when a name's CM products span 2+ idExpansions", () => {
    const catalog = tcgcsv([{ groupId: 1, name: "Everfest" }], {
      1: [{ productId: 10, name: "Split Card", groupId: 1 }],
    });
    const cmProducts: CardmarketProduct[] = [
      { idProduct: 100, name: "Split Card", idExpansion: 42 },
      { idProduct: 101, name: "Split Card", idExpansion: 99 },
    ];

    const map = buildExpansionAnchorMap(
      catalog.groups,
      catalog.productsByGroupId,
      cmProducts,
      GENERATED_AT,
    );

    expect(map.votes["42"]).toBeUndefined();
    expect(map.votes["99"]).toBeUndefined();
  });

  it("does not vote when a CM product for that name is missing idExpansion", () => {
    const catalog = tcgcsv([{ groupId: 1, name: "Everfest" }], {
      1: [{ productId: 10, name: "No Expansion Card", groupId: 1 }],
    });
    const cmProducts: CardmarketProduct[] = [
      { idProduct: 100, name: "No Expansion Card" },
    ];

    const map = buildExpansionAnchorMap(
      catalog.groups,
      catalog.productsByGroupId,
      cmProducts,
      GENERATED_AT,
    );

    expect(Object.keys(map.votes)).toHaveLength(0);
  });

  it("leaves an expansion with no qualifying votes absent from the map", () => {
    const catalog = tcgcsv([{ groupId: 1, name: "Everfest" }], {
      1: [],
    });
    const cmProducts: CardmarketProduct[] = [
      { idProduct: 100, name: "Unrelated Card", idExpansion: 7 },
    ];

    const map = buildExpansionAnchorMap(
      catalog.groups,
      catalog.productsByGroupId,
      cmProducts,
      GENERATED_AT,
    );

    expect(map.votes["7"]).toBeUndefined();
    expect(Object.keys(map.votes)).toHaveLength(0);
  });
});

describe("buildExpansionAnchorMap — normalization matches names across marketplaces", () => {
  it("joins names differing only by apostrophe/diacritic/case/whitespace", () => {
    const catalog = tcgcsv([{ groupId: 1, name: "Everfest" }], {
      1: [{ productId: 10, name: "Fyendal's Spring Tunic", groupId: 1 }],
    });
    const cmProducts: CardmarketProduct[] = [
      { idProduct: 100, name: "fyendals  spring tunic", idExpansion: 42 },
    ];

    const map = buildExpansionAnchorMap(
      catalog.groups,
      catalog.productsByGroupId,
      cmProducts,
      GENERATED_AT,
    );

    expect(map.votes["42"]).toEqual({ name: "Everfest", votes: 1 });
  });

  it("treats pitch-suffixed variants as distinct names (each can vote independently)", () => {
    const catalog = tcgcsv([{ groupId: 1, name: "Everfest" }], {
      1: [
        { productId: 10, name: "Rally the Rearguard (Red)", groupId: 1 },
        { productId: 11, name: "Rally the Rearguard (Yellow)", groupId: 1 },
      ],
    });
    const cmProducts: CardmarketProduct[] = [
      { idProduct: 100, name: "Rally the Rearguard (Red)", idExpansion: 42 },
      {
        idProduct: 101,
        name: "Rally the Rearguard (Yellow)",
        idExpansion: 42,
      },
    ];

    const map = buildExpansionAnchorMap(
      catalog.groups,
      catalog.productsByGroupId,
      cmProducts,
      GENERATED_AT,
    );

    expect(map.votes["42"]).toEqual({ name: "Everfest", votes: 2 });
  });
});

describe("buildExpansionAnchorMap — overrides pass-through", () => {
  it("carries the overrides argument verbatim into the output map", () => {
    const catalog = tcgcsv([{ groupId: 1, name: "Everfest" }], {
      1: [{ productId: 10, name: "Card A", groupId: 1 }],
    });
    const cmProducts: CardmarketProduct[] = [
      { idProduct: 100, name: "Card A", idExpansion: 42 },
    ];
    const overrides = { "42": "Manually Corrected Name", "999": "Ghost Set" };

    const map = buildExpansionAnchorMap(
      catalog.groups,
      catalog.productsByGroupId,
      cmProducts,
      GENERATED_AT,
      overrides,
    );

    expect(map.overrides).toEqual(overrides);
    // votes are still computed independently of overrides
    expect(map.votes["42"]).toEqual({ name: "Everfest", votes: 1 });
  });
});

describe("resolveExpansionName", () => {
  const baseMap: ExpansionAnchorMap = {
    generatedAt: GENERATED_AT,
    votes: {
      "42": { name: "Everfest", votes: 3 },
      "43": {
        name: "Majority Name",
        votes: 2,
        runnerUp: { name: "Other", votes: 1 },
      },
    },
    overrides: {
      "43": "Overridden Name",
    },
  };

  it("prefers the override over the majority vote", () => {
    expect(resolveExpansionName(baseMap, 43)).toBe("Overridden Name");
  });

  it("falls back to the majority vote name when there is no override", () => {
    expect(resolveExpansionName(baseMap, 42)).toBe("Everfest");
  });

  it("returns null when the expansion has neither an override nor votes", () => {
    expect(resolveExpansionName(baseMap, 12345)).toBeNull();
  });
});
