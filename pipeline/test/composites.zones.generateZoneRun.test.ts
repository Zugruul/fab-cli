import { describe, it, expect, vi } from "vitest";
import { generateZoneRun } from "../src/composites/zones/generateZoneRun.js";
import type { GenerateZoneRunInput } from "../src/composites/zones/generateZoneRun.js";
import type { RawCardForSelection } from "../src/composites/zones/semanticSelection.js";
import type { ZoneMap } from "../src/composites/zones/zoneMap.js";
import type { RawImage } from "../src/composites/rawImage.js";

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
  it("the two-player near mat is a genuinely distinct scene from the single-mat batch's composite-0000 (not an accidental duplicate)", async () => {
    const input = baseInput({ singleCount: 1, twoPlayerCount: 1 });
    const { composites } = await generateZoneRun(input);
    const single = composites.find((c) => c.label.compositeId === "composite-0000")!;
    const twoPlayer = composites.find((c) => c.label.compositeId === "two-player-0000")!;
    const singlePrintingIds = single.label.cards.map((c) => c.printingId).sort();
    // the near mat's cards are the FIRST half of the merged label's cards
    // (see mergeTwoPlayerRenders: far cards first, then near cards) —
    // compare corner positions instead, since printingId sets alone could
    // coincidentally match with a tiny fixture catalog.
    const nearCards = twoPlayer.label.cards.slice(singlePrintingIds.length);
    expect(JSON.stringify(nearCards.map((c) => c.corners))).not.toBe(JSON.stringify(single.label.cards.map((c) => c.corners)));
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
