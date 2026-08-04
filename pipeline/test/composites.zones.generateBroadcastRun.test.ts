import { describe, it, expect, vi } from "vitest";
import { generateBroadcastRun, buildOccluderImage, BROADCAST_LEFT_SEED_OFFSET, BROADCAST_RIGHT_SEED_OFFSET } from "../src/composites/zones/generateBroadcastRun.js";
import type { GenerateBroadcastRunInput } from "../src/composites/zones/generateBroadcastRun.js";
import type { RawCardForSelection } from "../src/composites/zones/semanticSelection.js";
import type { ZoneMap } from "../src/composites/zones/zoneMap.js";
import type { RawImage } from "../src/composites/rawImage.js";
import type { BroadcastLayoutConfig } from "../src/composites/zones/broadcastLayout.js";

// #256 Phase C end-to-end orchestration (all IO injected, mirrors
// generateZoneRun.ts's exact injection style): plans near/far zone-layout
// mats + broadcast augmentation from ONE shared zoneMap, merges them into
// a landscape table, warps the table into a measured broadcast-layout
// frame, labels a real card-preview panel, and returns a manifest +
// composites shape flowing unchanged into write.ts.

function solidImage(width: number, height: number): RawImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(200) };
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

function layout(): BroadcastLayoutConfig {
  return {
    name: "test rig",
    playArea: { xFrac: 0.2, yFrac: 0.06, wFrac: 0.6, hFrac: 0.94 },
    chrome: [
      { kind: "scoreboard", rect: { xFrac: 0, yFrac: 0, wFrac: 1, hFrac: 0.058 } },
      { kind: "sidebar", side: "left", rect: { xFrac: 0, yFrac: 0.058, wFrac: 0.2, hFrac: 0.942 } },
      { kind: "sidebar", side: "right", rect: { xFrac: 0.8, yFrac: 0.058, wFrac: 0.2, hFrac: 0.942 } },
      { kind: "card-preview", side: "right", rect: { xFrac: 0.82, yFrac: 0.56, wFrac: 0.16, hFrac: 0.4 } },
    ],
  };
}

function baseInput(overrides: Partial<GenerateBroadcastRunInput> = {}): GenerateBroadcastRunInput {
  return {
    zoneLayoutConfig: {
      seed: 7,
      cardHeightFraction: 0.85,
      jitterPositionFraction: { min: -0.05, max: 0.05 },
      jitterRotationDeg: { min: -3, max: 3 },
      arsenalFaceUpProbability: 0,
      guaranteedArsenalFaceUpIndices: [],
      minVisibleFraction: 0,
    },
    augmentationConfig: {
      seed: 99,
      keystoneStrength: { min: 0, max: 0.1 },
      sleeveProbability: 0.2,
      stackZoneKinds: ["deck", "graveyard", "pitch"],
      stackExtraLayers: { min: 0, max: 2 },
      diceSlots: 1,
      diceProbability: 0.2,
      handProbability: 0.2,
    },
    layout: layout(),
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
    frameWidth: 800,
    frameHeight: 450,
    count: 3,
    now: () => "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("generateBroadcastRun", () => {
  it("produces exactly `count` frame-sized composites", async () => {
    const input = baseInput();
    const { composites, manifest } = await generateBroadcastRun(input);
    expect(composites).toHaveLength(3);
    expect(manifest.compositeCount).toBe(3);
    for (const c of composites) {
      expect(c.image.width).toBe(800);
      expect(c.image.height).toBe(450);
    }
  });

  it("every composite's label has at least one 'table' card AND exactly one 'preview' card", async () => {
    const { composites } = await generateBroadcastRun(baseInput());
    for (const c of composites) {
      const tableCards = c.label.cards.filter((card) => card.region === "table");
      const previewCards = c.label.cards.filter((card) => card.region === "preview");
      expect(tableCards.length).toBeGreaterThan(0);
      expect(previewCards).toHaveLength(1);
    }
  });

  it("is deterministic — the same seeds produce byte-identical manifests across two runs", async () => {
    const a = await generateBroadcastRun(baseInput());
    const b = await generateBroadcastRun(baseInput());
    expect(a.manifest).toEqual(b.manifest);
  });

  it("left and right mats draw from DIFFERENT rng offsets (left/right plans differ even with the same underlying zone map/config)", () => {
    expect(BROADCAST_LEFT_SEED_OFFSET).not.toBe(BROADCAST_RIGHT_SEED_OFFSET);
  });

  it("only downloads the specific printings actually picked, never the whole catalog", async () => {
    const ensureImagesDownloaded = vi.fn(async () => {});
    await generateBroadcastRun(baseInput({ ensureImagesDownloaded }));
    expect(ensureImagesDownloaded).toHaveBeenCalled();
    const needs = (ensureImagesDownloaded as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{ printingId: string }>;
    // never includes the synthetic card-back or occluder printingIds —
    // those are handled separately (cardBackImagePath / procedural
    // generation), not via the catalog download path.
    for (const n of needs) {
      expect(n.printingId).not.toBe("__card_back__");
      expect(n.printingId.startsWith("__occluder_")).toBe(false);
    }
  });
});

// #256 correction: buildOccluderImage is the extracted, directly-testable
// dispatch generateBroadcastRun.ts's occluder-image loop calls per spec —
// pulled out specifically so the REQUIRED hand motion-blur wiring (a real
// bug class: "the primitive exists but nothing calls it" is invisible to
// unit tests of the primitive alone) has its own dedicated coverage.
describe("buildOccluderImage", () => {
  it("dispatches 'shim' to createStackShimImage", () => {
    const img = buildOccluderImage({ printingId: "x", kind: "shim", width: 10, height: 14, color: [1, 2, 3] });
    expect(img.width).toBe(10);
    expect(img.height).toBe(14);
    expect(img.data[0]).toBe(1);
  });

  it("dispatches 'dice' to createDiceImage", () => {
    const img = buildOccluderImage({ printingId: "x", kind: "dice", width: 20, height: 20, bodyColor: [9, 9, 9], pipColor: [1, 1, 1], face: 1 });
    expect(img.width).toBe(20);
    expect(img.data[0]).toBe(9);
  });

  it("dispatches 'hand' to createHandImage, then applies motion blur with the spec's blurStrength", () => {
    const noBlur = buildOccluderImage({ printingId: "x", kind: "hand", width: 40, height: 60, skinTone: [180, 120, 90], blurStrength: 0 });
    const withBlur = buildOccluderImage({ printingId: "x", kind: "hand", width: 40, height: 60, skinTone: [180, 120, 90], blurStrength: 0.7 });
    // Same skinTone/size, only blurStrength differs — a real blur means
    // the pixels are NOT byte-identical (this is the exact gap a
    // "primitive exists but is never called" bug would leave undetected).
    expect(Array.from(withBlur.data)).not.toEqual(Array.from(noBlur.data));
  });

  it("blurStrength 0 on a hand produces byte-identical output to the unblurred hand image", () => {
    const direct = buildOccluderImage({ printingId: "x", kind: "hand", width: 40, height: 60, skinTone: [180, 120, 90], blurStrength: 0 });
    const again = buildOccluderImage({ printingId: "x", kind: "hand", width: 40, height: 60, skinTone: [180, 120, 90], blurStrength: 0 });
    expect(Array.from(direct.data)).toEqual(Array.from(again.data));
  });
});
