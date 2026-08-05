import { describe, it, expect, vi } from "vitest";
import { generateZoneRun, buildEligibleByKind, TWO_PLAYER_NEAR_SEED_OFFSET } from "../src/composites/zones/generateZoneRun.js";
import type { GenerateZoneRunInput } from "../src/composites/zones/generateZoneRun.js";
import type { RawCardForSelection } from "../src/composites/zones/semanticSelection.js";
import type { ZoneMap } from "../src/composites/zones/zoneMap.js";
import type { RawImage } from "../src/composites/rawImage.js";
import { planZoneLayoutRun } from "../src/composites/zones/planZoneLayout.js";

// #253 end-to-end orchestration (all IO injected — mirrors generate.ts's
// LoadImageFn injection pattern so the test never touches real files/
// network): plans single-mat + two-player composites, downloads only the
// distinct printings actually picked, renders through the SAME
// renderComposite() the base random generator uses, and returns a
// manifest+composites shape that flows unchanged into write.ts.

function solidImage(width: number, height: number): RawImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}

function card(overrides: Partial<RawCardForSelection> = {}): RawCardForSelection {
  return {
    name: "Test",
    types: ["Generic", "Action"],
    card_keywords: [],
    printings: [{ unique_id: "p-1", image_url: "https://x/p-1.png" }],
    ...overrides,
  };
}

function fullCatalog(): RawCardForSelection[] {
  return [
    card({ name: "Head Item", types: ["Generic", "Equipment", "Head"], printings: [{ unique_id: "head-1", image_url: "https://x/head-1.png" }] }),
    card({ name: "Chest Item", types: ["Generic", "Equipment", "Chest"], printings: [{ unique_id: "chest-1", image_url: "https://x/chest-1.png" }] }),
    card({ name: "Arms Item", types: ["Generic", "Equipment", "Arms"], printings: [{ unique_id: "arms-1", image_url: "https://x/arms-1.png" }] }),
    card({ name: "Legs Item", types: ["Generic", "Equipment", "Legs"], printings: [{ unique_id: "legs-1", image_url: "https://x/legs-1.png" }] }),
    card({ name: "A Weapon", types: ["Brute", "Weapon", "1H"], printings: [{ unique_id: "weapon-1", image_url: "https://x/weapon-1.png" }] }),
    card({ name: "An Off-Hand", types: ["Generic", "Equipment", "Off-Hand"], printings: [{ unique_id: "offhand-1", image_url: "https://x/offhand-1.png" }] }),
    card({ name: "A Hero", types: ["Brute", "Hero"], printings: [{ unique_id: "hero-1", image_url: "https://x/hero-1.png" }] }),
    card({
      name: "Blood Debt Card",
      types: ["Shadow", "Action"],
      card_keywords: ["Blood Debt"],
      printings: [{ unique_id: "banished-1", image_url: "https://x/banished-1.png" }],
    }),
    card({ name: "Generic Any Card", types: ["Generic", "Action"], printings: [{ unique_id: "generic-1", image_url: "https://x/generic-1.png" }] }),
  ];
}

function zoneMapWithArsenal(): ZoneMap {
  const cols = ["head", "chest", "arms", "legs", "weapon", "offHand", "hero", "pitch", "graveyard", "banished", "deck", "arsenal"];
  return { name: "test", zones: cols.map((kind, i) => ({ id: kind, kind: kind as never, rect: { xFrac: (i % 6) * 0.16, yFrac: i < 6 ? 0.1 : 0.5, wFrac: 0.14, hFrac: 0.3 } })) };
}

function baseInput(overrides: Partial<GenerateZoneRunInput> = {}): GenerateZoneRunInput {
  return {
    config: {
      seed: 7,
      cardHeightFraction: 0.85,
      jitterPositionFraction: { min: -0.05, max: 0.05 },
      jitterRotationDeg: { min: -3, max: 3 },
      arsenalFaceUpProbability: 0,
      guaranteedArsenalFaceUpIndices: [0],
      minVisibleFraction: 0,
    },
    zoneMap: zoneMapWithArsenal(),
    cards: fullCatalog(),
    imagesCacheDir: "/cache/images",
    loadImage: vi.fn(async () => solidImage(30, 40)),
    ensureImagesDownloaded: vi.fn(async () => {}),
    loadedBackground: solidImage(200, 140),
    cardBackImagePath: "/cache/images/__card_back__.png",
    cardBackPrintingId: "__card_back__",
    matWidth: 200,
    matHeight: 140,
    background: { fileName: "playmat-abc123.png", contentHash: "abc123" },
    singleCount: 3,
    twoPlayerCount: 1,
    ...overrides,
  };
}

describe("generateZoneRun", () => {
  it("produces singleCount + twoPlayerCount composites, with two-player ones exactly double-height", async () => {
    const input = baseInput();
    const { composites, manifest } = await generateZoneRun(input);
    expect(composites).toHaveLength(4);
    expect(manifest.compositeCount).toBe(4);

    const doubleHeight = composites.filter((c) => c.image.height === input.matHeight * 2);
    const singleHeight = composites.filter((c) => c.image.height === input.matHeight);
    expect(doubleHeight).toHaveLength(1);
    expect(singleHeight).toHaveLength(3);
  });

  // Caught by eyeballing the real demo run: the near mat must NOT be an
  // exact duplicate of the single-mat batch's own composite-0000 (same
  // config.seed, same zone map, same pools would otherwise draw the
  // identical rng sequence) — see generateZoneRun.ts's seed-offset doc.
  //
  // PR #255 review round 1 (mutation-proven, twice): version 1 compared
  // POST-MERGE label corners — zero discriminating power, since
  // mergeTwoPlayerRenders always translates the near mat's corners by
  // +matHeight regardless of whether the underlying scene differs, so the
  // "difference" it found was really just the translation, present even
  // with the seed-offset bug reintroduced. Version 2 called
  // planZoneLayoutRun directly with the offset applied by the TEST itself
  // — that proves planZoneLayoutRun is seed-sensitive (already covered
  // elsewhere) but never actually exercises generateZoneRun's OWN wiring,
  // so it also stayed green under the same mutation.
  //
  // Fixed by comparing PRINTING IDS (untouched by any geometric
  // transform, unlike corners) pulled from generateZoneRun's REAL merged
  // output against two independently-computed hypotheses — "what the near
  // mat would pick WITH the offset" vs "WITHOUT it" — using a catalog with
  // 2 candidates for one kind so the seed actually determines WHICH card
  // is picked, not just jitter. This asserts generateZoneRun's actual
  // output matches the with-offset hypothesis and differs from the
  // without-offset one, so dropping the offset inside generateZoneRun
  // itself (the real regression) is what gets caught.
  it("generateZoneRun's near mat genuinely applies the near-seed offset internally (not just available as an unused export)", async () => {
    const catalogWithChoice = [
      ...fullCatalog(),
      card({ name: "A Hero (alt)", types: ["Brute", "Hero"], printings: [{ unique_id: "hero-2", image_url: "https://x/hero-2.png" }] }),
    ];
    const config = baseInput().config;
    const zoneMap = zoneMapWithArsenal();
    const imagesCacheDir = "/cache/images";
    const eligibleByKind = buildEligibleByKind(catalogWithChoice, zoneMap, imagesCacheDir);
    const cardBack = { printingId: "__card_back__", imagePath: "/cache/images/__card_back__.png" };
    const planCommon = { zoneMap, eligibleByKind, cardBack, matWidth: 200, matHeight: 140, background: { fileName: "playmat-abc123.png", contentHash: "abc123" } };

    const withOffsetNearPlan = planZoneLayoutRun({
      ...planCommon,
      config: { ...config, seed: config.seed + TWO_PLAYER_NEAR_SEED_OFFSET },
      compositesPerRun: 1,
      compositeIdPrefix: "two-player-near",
    })[0];
    const withoutOffsetNearPlan = planZoneLayoutRun({ ...planCommon, config, compositesPerRun: 1, compositeIdPrefix: "two-player-near" })[0];

    const withOffsetIds = withOffsetNearPlan.cards.filter((c) => !c.isCardBack).map((c) => c.printingId).sort();
    const withoutOffsetIds = withoutOffsetNearPlan.cards.filter((c) => !c.isCardBack).map((c) => c.printingId).sort();
    // Sanity: this fixture must actually distinguish the two hypotheses,
    // or the assertions below would be vacuous.
    expect(withOffsetIds).not.toEqual(withoutOffsetIds);

    const input = baseInput({ cards: catalogWithChoice, singleCount: 1, twoPlayerCount: 1 });
    const { composites } = await generateZoneRun(input);
    const twoPlayer = composites.find((c) => c.label.compositeId === "two-player-0000")!;
    // mergeTwoPlayerRenders orders cards as [...farCards, ...nearCards] —
    // near mat's card COUNT is seed-independent here (same zone map, same
    // guaranteedArsenalFaceUpIndices, minVisibleFraction 0 keeps every
    // card labeled), so slicing the last N cards unambiguously isolates
    // the near mat's cards regardless of which hypothesis is true.
    const nearCardsFromOutput = twoPlayer.label.cards.slice(-withOffsetIds.length);
    const actualIds = nearCardsFromOutput.map((c) => c.printingId).sort();

    expect(actualIds).toEqual(withOffsetIds);
    expect(actualIds).not.toEqual(withoutOffsetIds);
  });

  it("downloads exactly the distinct catalog picks actually referenced, deduplicated", async () => {
    const input = baseInput();
    await generateZoneRun(input);
    expect(input.ensureImagesDownloaded).toHaveBeenCalledTimes(1);
    const needs = (input.ensureImagesDownloaded as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{ printingId: string }>;
    const printingIds = needs.map((n) => n.printingId);
    expect(new Set(printingIds).size).toBe(printingIds.length); // deduplicated
    expect(printingIds).toContain("head-1");
    expect(printingIds).toContain("hero-1");
    expect(printingIds).not.toContain("__card_back__"); // card back has its own dedicated fetch path, not this catalog-download step
  });

  it("a guaranteed arsenal index produces a labeled arsenal-kind card in that single-mat composite", async () => {
    const input = baseInput({ singleCount: 2, twoPlayerCount: 0 });
    const { composites } = await generateZoneRun(input);
    const printingIdsInComposite0 = composites[0].label.cards.map((c) => c.printingId);
    expect(printingIdsInComposite0).toContain("generic-1"); // the only "any card" pick available, used for arsenal/pitch/graveyard
  });

  it("every composite's deck card is excluded from label.cards (card-back convention) yet its pixels render", async () => {
    const input = baseInput({ singleCount: 1, twoPlayerCount: 0 });
    const { composites } = await generateZoneRun(input);
    const printingIds = composites[0].label.cards.map((c) => c.printingId);
    expect(printingIds).not.toContain("__card_back__");
    expect(composites[0].label.cardBacksPlaced).toBeGreaterThan(0);
  });

  // Regression test: an earlier implementation collected every printing in
  // eligibleByKind's POOLS (not the plans' actual picks) into the download
  // set — harmless for a fixture catalog with exactly one candidate per
  // kind, but catastrophic for real "any card" kinds (pitch/graveyard/
  // arsenal match the ENTIRE vendored catalog), which downloaded
  // thousands of unused images during the real demo run. Pinned here with
  // a deliberately oversized "any card" pool so a future regression trips
  // this test even with a small fixture catalog.
  it("downloads ONLY the printings the plans actually picked, never every candidate in a large 'any card' pool", async () => {
    const manyGenericCards = Array.from({ length: 50 }, (_, i) =>
      card({ name: `Generic ${i}`, types: ["Generic", "Action"], printings: [{ unique_id: `generic-${i}`, image_url: `https://x/generic-${i}.png` }] }),
    );
    const input = baseInput({ cards: [...fullCatalog(), ...manyGenericCards], singleCount: 2, twoPlayerCount: 0 });
    await generateZoneRun(input);
    const needs = (input.ensureImagesDownloaded as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{ printingId: string }>;
    // Only as many distinct "any card" picks as there are pitch/graveyard/
    // arsenal zone-slots across the 2 composites could ever appear — nowhere
    // near the 51-candidate pool size.
    expect(needs.length).toBeLessThan(20);
  });

  it("is deterministic given the same input", async () => {
    const fixedNow = () => "2026-01-01T00:00:00.000Z";
    const a = await generateZoneRun(baseInput({ now: fixedNow }));
    const b = await generateZoneRun(baseInput({ now: fixedNow }));
    expect(JSON.stringify(a.manifest)).toBe(JSON.stringify(b.manifest));
  });
});

// #268 PR #269 review round 1 BLOCKER 2: `coverage: true` builds one
// CoverageTracker per zone kind from eligibleByKind (sized to each kind's
// own pool) and threads them through every planZoneLayoutRun sub-run
// (single + near + far), SHARED so appearance counts accumulate across the
// whole zone-generate run, not reset per sub-run — mirrors generate.ts's
// composites-generate wiring. `fullCatalog()`'s 9 cards are ALL eligible
// for "pitch" (the semantic-eligibility brief: pitch accepts any card),
// so that's the kind exercised below without needing a bespoke fixture.
describe("generateZoneRun — coverage mode (#268 BLOCKER 2)", () => {
  it("with coverage on and a generous singleCount, every printing eligible for a large 'any card' bucket (pitch) appears at least once across the run", async () => {
    const input = baseInput({ coverage: true, singleCount: 30, twoPlayerCount: 0 });
    const { coverageSummary } = await generateZoneRun(input);
    expect(coverageSummary).toBeDefined();
    const pitch = coverageSummary!.pitch;
    expect(pitch).toBeDefined();
    expect(pitch!.zeroAppearanceCount).toBe(0);
  });

  it("coverageSummary is undefined when coverage is not requested (default) — no behavior change otherwise", async () => {
    const withoutCoverage = baseInput({ singleCount: 5, twoPlayerCount: 0 });
    const result = await generateZoneRun(withoutCoverage);
    expect(result.coverageSummary).toBeUndefined();
  });

  it("coverage mode does not change which composites/cards are produced for a fixed seed when the eligible pools are all single-item (draw-shape preserved end to end)", async () => {
    const without = await generateZoneRun(baseInput({ singleCount: 3, twoPlayerCount: 1 }));
    const withCoverage = await generateZoneRun(baseInput({ coverage: true, singleCount: 3, twoPlayerCount: 1 }));
    // Every kind in fullCatalog() other than pitch/graveyard/arsenal has
    // exactly one eligible printing, so coverage mode can't change ANYTHING
    // about them; pitch/graveyard/arsenal draw from the same 9-card pool,
    // but comparing full labels (not just card sets) would be too strict
    // given a tracker CAN legitimately pick a different card there — so
    // this only asserts the composite COUNT and non-card fields (mirrors
    // paramStream.ts's shape-invariant test style) stay identical.
    expect(without.composites.length).toBe(withCoverage.composites.length);
    for (let i = 0; i < without.composites.length; i++) {
      expect(withCoverage.composites[i].label.backgroundType).toBe(without.composites[i].label.backgroundType);
      expect(withCoverage.composites[i].label.cards.length).toBe(without.composites[i].label.cards.length);
    }
  });
});
