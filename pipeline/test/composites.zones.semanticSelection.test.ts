import { describe, it, expect } from "vitest";
import { cardMatchesZoneKind, eligiblePrintingsForZoneKind, pickDeterministic } from "../src/composites/zones/semanticSelection.js";
import type { RawCardForSelection } from "../src/composites/zones/semanticSelection.js";

// #253 lesson "read-producers-real-bytes-before-fixtures": these fixtures
// mirror REAL records read directly from fab-cli/third_party/flesh-and-
// blood-cards/json/english/card.json (via a research pass), not guessed
// shapes. Equipment slot + weapon/off-hand/hero are all encoded in the
// flat `types` array (there is no separate `subtypes`/`classes` field on
// this dataset) and Blood Debt is `card_keywords: ["Blood Debt"]`.

function card(overrides: Partial<RawCardForSelection> = {}): RawCardForSelection {
  return {
    name: "Test Card",
    types: ["Generic", "Action"],
    card_keywords: [],
    printings: [{ unique_id: "printing-1", image_url: "https://example.com/printing-1.png", id: "TST001", set_id: "TST" }],
    ...overrides,
  };
}

// Real records (trimmed to the fields semantic selection reads):
const ironhideHelm = card({ name: "Ironhide Helm", types: ["Generic", "Equipment", "Head"] });
const fyendalsSpringTunic = card({ name: "Fyendal's Spring Tunic", types: ["Generic", "Equipment", "Chest"] });
const armsItem = card({ name: "Some Arms Item", types: ["Generic", "Equipment", "Arms"] });
const legsItem = card({ name: "Some Legs Item", types: ["Generic", "Equipment", "Legs"] });
const ballBreaker = card({ name: "Ball Breaker", types: ["Brute", "Weapon", "Flail", "1H"] });
const aetherConduit = card({ name: "Aether Conduit", types: ["Wizard", "Weapon", "Staff", "2H"] });
const arcaneLantern = card({ name: "Arcane Lantern", types: ["Generic", "Equipment", "Off-Hand"] });
const arakni = card({ name: "Arakni", types: ["Assassin", "Hero", "Young"] });
const battlefieldBreaker = card({
  name: "Battlefield Breaker",
  types: ["Shadow", "Brute", "Action", "Attack"],
  card_keywords: ["Blood Debt"],
});
const plainAction = card({ name: "Plain Action", types: ["Generic", "Action"], card_keywords: [] });

describe("cardMatchesZoneKind — real dataset encodings", () => {
  it("matches Head equipment on 'head' and rejects it for every other equipment slot", () => {
    expect(cardMatchesZoneKind(ironhideHelm, "head")).toBe(true);
    expect(cardMatchesZoneKind(ironhideHelm, "chest")).toBe(false);
    expect(cardMatchesZoneKind(ironhideHelm, "arms")).toBe(false);
    expect(cardMatchesZoneKind(ironhideHelm, "legs")).toBe(false);
  });

  it("matches Chest/Arms/Legs equipment on their own slot only", () => {
    expect(cardMatchesZoneKind(fyendalsSpringTunic, "chest")).toBe(true);
    expect(cardMatchesZoneKind(armsItem, "arms")).toBe(true);
    expect(cardMatchesZoneKind(legsItem, "legs")).toBe(true);
    expect(cardMatchesZoneKind(fyendalsSpringTunic, "head")).toBe(false);
  });

  it("matches both 1H and 2H Weapon-type cards on 'weapon'", () => {
    expect(cardMatchesZoneKind(ballBreaker, "weapon")).toBe(true);
    expect(cardMatchesZoneKind(aetherConduit, "weapon")).toBe(true);
  });

  it("does not match a Weapon on 'offHand' — Off-Hand is its own distinct types token in the dataset, never co-occurring with Weapon", () => {
    expect(cardMatchesZoneKind(ballBreaker, "offHand")).toBe(false);
    expect(cardMatchesZoneKind(arcaneLantern, "offHand")).toBe(true);
    expect(cardMatchesZoneKind(arcaneLantern, "weapon")).toBe(false);
  });

  it("matches a Hero-type card on 'hero' (young or adult, since 'Young' is a co-occurring type, not a replacement for 'Hero')", () => {
    expect(cardMatchesZoneKind(arakni, "hero")).toBe(true);
    expect(cardMatchesZoneKind(ballBreaker, "hero")).toBe(false);
  });

  it("matches exactly the 'Blood Debt' keyword (title case, space) on 'banished', and rejects a card without it", () => {
    expect(cardMatchesZoneKind(battlefieldBreaker, "banished")).toBe(true);
    expect(cardMatchesZoneKind(plainAction, "banished")).toBe(false);
    expect(cardMatchesZoneKind(ironhideHelm, "banished")).toBe(false);
  });

  it("'pitch', 'graveyard', and 'arsenal' accept ANY card (brief: 'any card') including equipment and heroes", () => {
    for (const kind of ["pitch", "graveyard", "arsenal"] as const) {
      expect(cardMatchesZoneKind(plainAction, kind)).toBe(true);
      expect(cardMatchesZoneKind(ironhideHelm, kind)).toBe(true);
      expect(cardMatchesZoneKind(arakni, kind)).toBe(true);
    }
  });

  it("does not crash on a card missing types/card_keywords entirely (defensive, matches catalog.ts's typeof-guard style)", () => {
    const malformed: RawCardForSelection = { name: "Malformed" };
    expect(cardMatchesZoneKind(malformed, "head")).toBe(false);
    expect(cardMatchesZoneKind(malformed, "banished")).toBe(false);
    expect(cardMatchesZoneKind(malformed, "pitch")).toBe(true); // "any card" still matches
  });
});

describe("eligiblePrintingsForZoneKind", () => {
  const catalog = [ironhideHelm, fyendalsSpringTunic, ballBreaker, arcaneLantern, arakni, battlefieldBreaker, plainAction];

  it("returns only printings matching the kind, sorted deterministically by printingId", () => {
    const helmets = [
      card({ name: "Helm B", types: ["Generic", "Equipment", "Head"], printings: [{ unique_id: "z-helm", image_url: "https://x/z.png" }] }),
      card({ name: "Helm A", types: ["Generic", "Equipment", "Head"], printings: [{ unique_id: "a-helm", image_url: "https://x/a.png" }] }),
    ];
    const result = eligiblePrintingsForZoneKind(helmets, "head", "/cache");
    expect(result.map((r) => r.printingId)).toEqual(["a-helm", "z-helm"]);
  });

  it("skips a matching card's printing when it lacks image_url or unique_id, without throwing (mirrors catalog.ts's extraction)", () => {
    const oneGood = card({
      name: "Two Printings",
      types: ["Generic", "Equipment", "Head"],
      printings: [
        { unique_id: "good-1", image_url: "https://x/good.png" },
        { unique_id: "", image_url: "https://x/bad.png" },
        { unique_id: "bad-2" },
      ],
    });
    const result = eligiblePrintingsForZoneKind([oneGood], "head", "/cache");
    expect(result).toHaveLength(1);
    expect(result[0].printingId).toBe("good-1");
  });

  it("computes imagePath via the same cachePathFor logic images/ uses (destination path, whether or not the file exists yet)", () => {
    const result = eligiblePrintingsForZoneKind([ballBreaker], "weapon", "/cache/dir");
    expect(result[0].imagePath).toBe("/cache/dir/printing-1.png");
  });

  it("throws a loud error naming the zone kind when the catalog has ZERO matching printings (never a silent empty-array skip)", () => {
    expect(() => eligiblePrintingsForZoneKind(catalog, "banished", "/cache")).not.toThrow(); // battlefieldBreaker matches
    const noBloodDebt = [plainAction, ironhideHelm];
    expect(() => eligiblePrintingsForZoneKind(noBloodDebt, "banished", "/cache")).toThrow(/banished/);
  });

  it("throws naming the kind for a completely empty catalog", () => {
    expect(() => eligiblePrintingsForZoneKind([], "hero", "/cache")).toThrow(/hero/);
  });
});

describe("pickDeterministic", () => {
  const items = ["a", "b", "c", "d"];

  it("draw01=0 picks the first item", () => {
    expect(pickDeterministic(items, 0)).toBe("a");
  });

  it("draw01 just under 1 picks the last item", () => {
    expect(pickDeterministic(items, 0.9999)).toBe("d");
  });

  it("is defensive against draw01 exactly 1 (never indexes past the array end)", () => {
    expect(pickDeterministic(items, 1)).toBe("d");
  });

  it("is a pure function of (items, draw01) — same inputs, same output", () => {
    expect(pickDeterministic(items, 0.42)).toBe(pickDeterministic(items, 0.42));
  });
});
