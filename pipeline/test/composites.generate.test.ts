import { describe, it, expect, vi } from "vitest";
import { generateDataset } from "../src/composites/generate.js";
import type { GeneratorConfig } from "../src/composites/config.js";
import type { RawImage } from "../src/composites/rawImage.js";

function config(overrides: Partial<GeneratorConfig> = {}): GeneratorConfig {
  return {
    seed: 2026,
    outputSize: { width: 64, height: 64 },
    compositesPerRun: 3,
    cardsPerComposite: { min: 1, max: 2 },
    baseCardHeightFraction: 0.3,
    scale: { min: 0.8, max: 1.2 },
    rotationDeg: { min: -20, max: 20 },
    overlapProbability: 0.3,
    overlapOffsetFraction: { min: 0.1, max: 0.3 },
    perspectiveProbability: 0.3,
    perspectiveStrength: { min: 0, max: 0.2 },
    glareProbability: 0.2,
    sleeveProbability: 0.2,
    lighting: { brightnessDelta: { min: -0.1, max: 0.1 }, contrastDelta: { min: -0.05, max: 0.05 } },
    backgroundTypes: ["solid", "gradient", "noise", "texture"],
    backgroundsDir: null,
    externalBackgroundProbability: 0,
    minVisibleFraction: 0,
    ...overrides,
  };
}

function fakeLoadImage(): (path: string) => Promise<RawImage> {
  return async (path: string) => {
    const data = new Uint8ClampedArray(20 * 30 * 4).fill(128);
    void path;
    return { width: 20, height: 30, data };
  };
}

const CARDS = Array.from({ length: 5 }, (_, i) => ({ printingId: `printing-${i}`, imagePath: `/images/printing-${i}.png` }));

describe("generateDataset — end to end determinism", () => {
  it("the same seed + config + card refs produce byte-identical labels and manifest (buildDate pinned)", async () => {
    const now = () => "2026-01-01T00:00:00.000Z";
    const a = await generateDataset(config(), CARDS, fakeLoadImage(), now);
    const b = await generateDataset(config(), CARDS, fakeLoadImage(), now);

    expect(a.manifest).toEqual(b.manifest);
    expect(a.composites.map((c) => c.label)).toEqual(b.composites.map((c) => c.label));
  });

  it("produces exactly config.compositesPerRun composites", async () => {
    const result = await generateDataset(config({ compositesPerRun: 5 }), CARDS, fakeLoadImage());
    expect(result.composites).toHaveLength(5);
    expect(result.manifest.compositeCount).toBe(5);
  });

  it("loads each distinct image path at most once (caching across composites)", async () => {
    const loadImage = vi.fn(fakeLoadImage());
    await generateDataset(config({ compositesPerRun: 10, cardsPerComposite: { min: 2, max: 2 } }), CARDS, loadImage);
    const distinctPaths = new Set(loadImage.mock.calls.map((c) => c[0]));
    expect(loadImage).toHaveBeenCalledTimes(distinctPaths.size);
  });

  it("propagates planRun's error when no card images are available", async () => {
    await expect(generateDataset(config(), [], fakeLoadImage())).rejects.toThrow();
  });
});

// #244: generateDataset's optional 5th param is the sorted list of
// available EXTERNAL background file names (mirrors availableCards' role
// for cards) — cli.ts resolves this from config.backgroundsDir; this
// module stays agnostic about where the list came from.
describe("generateDataset — external backgrounds (#244)", () => {
  it("resolves external background file names against config.backgroundsDir and loads them via the same image cache as cards", async () => {
    const loadImage = vi.fn(fakeLoadImage());
    const cfg = config({ compositesPerRun: 6, externalBackgroundProbability: 1, backgroundsDir: "/bg" });
    const result = await generateDataset(cfg, CARDS, loadImage, undefined, ["bg1.png", "bg2.png"]);

    const bgCalls = loadImage.mock.calls.map((c) => c[0] as string).filter((p) => p.includes("bg1.png") || p.includes("bg2.png"));
    expect(bgCalls.length).toBeGreaterThan(0);
    expect(new Set(bgCalls).size).toBeLessThanOrEqual(2);

    for (const label of result.composites.map((c) => c.label)) {
      expect(label.backgroundType).toBe("external");
      expect(label.backgroundHash).not.toBeNull();
    }
  });

  it("is deterministic given the same seed + config + availableBackgrounds list", async () => {
    const cfg = config({ compositesPerRun: 4, externalBackgroundProbability: 1, backgroundsDir: "/bg" });
    const files = ["bg1.png", "bg2.png"];
    const a = await generateDataset(cfg, CARDS, fakeLoadImage(), () => "2026-01-01T00:00:00.000Z", files);
    const b = await generateDataset(cfg, CARDS, fakeLoadImage(), () => "2026-01-01T00:00:00.000Z", files);
    expect(a.manifest).toEqual(b.manifest);
    expect(a.composites.map((c) => c.label)).toEqual(b.composites.map((c) => c.label));
  });

  it("throws a clear error if a plan selects an external background but config.backgroundsDir is null (caller contract violation)", async () => {
    await expect(
      generateDataset(config({ externalBackgroundProbability: 1, backgroundsDir: null }), CARDS, fakeLoadImage(), undefined, ["bg1.png"]),
    ).rejects.toThrow(/backgroundsDir/);
  });

  it("never uses an external background when availableBackgrounds is omitted, regardless of externalBackgroundProbability", async () => {
    const cfg = config({ compositesPerRun: 5, externalBackgroundProbability: 1 });
    const result = await generateDataset(cfg, CARDS, fakeLoadImage());
    for (const label of result.composites.map((c) => c.label)) {
      expect(label.backgroundType).not.toBe("external");
    }
  });
});

// #252: visibleFraction/excludedCards are computed post-hoc from already-
// deterministic rendering — no new rng draws — so the end-to-end
// determinism contract (APP-026 AC) must hold for them too.
describe("generateDataset — visibleFraction determinism and threshold end-to-end (#252)", () => {
  it("produces identical per-card visibleFraction across two runs with the same seed/config, with at least one real occlusion signal present", async () => {
    const cfg = config({ compositesPerRun: 8, cardsPerComposite: { min: 2, max: 2 }, overlapProbability: 1, minVisibleFraction: 0 });
    const a = await generateDataset(cfg, CARDS, fakeLoadImage());
    const b = await generateDataset(cfg, CARDS, fakeLoadImage());

    const fracsA = a.composites.flatMap((c) => c.label.cards.map((x) => x.visibleFraction));
    const fracsB = b.composites.flatMap((c) => c.label.cards.map((x) => x.visibleFraction));
    expect(fracsA).toEqual(fracsB);
    expect(fracsA.some((f) => f < 1)).toBe(true);
  });

  it("excludedCards is 0 for every composite when minVisibleFraction is 0 (nothing filtered)", async () => {
    const cfg = config({ compositesPerRun: 5, cardsPerComposite: { min: 2, max: 2 }, overlapProbability: 1, minVisibleFraction: 0 });
    const result = await generateDataset(cfg, CARDS, fakeLoadImage());
    for (const c of result.composites) expect(c.label.excludedCards).toBe(0);
  });

  it("a high minVisibleFraction threshold excludes some cards without touching the rng stream (composite count and card placements stay identical)", async () => {
    const cfgLoose = config({ compositesPerRun: 8, cardsPerComposite: { min: 2, max: 2 }, overlapProbability: 1, minVisibleFraction: 0 });
    const cfgStrict = config({ compositesPerRun: 8, cardsPerComposite: { min: 2, max: 2 }, overlapProbability: 1, minVisibleFraction: 0.95 });

    const loose = await generateDataset(cfgLoose, CARDS, fakeLoadImage());
    const strict = await generateDataset(cfgStrict, CARDS, fakeLoadImage());

    // same plan -> same corners for every composite, regardless of
    // threshold: strict's surviving cards are a subset of loose's, with
    // IDENTICAL corners (never re-rolled just because some cards were
    // filtered out of the label).
    for (let i = 0; i < loose.composites.length; i++) {
      for (const strictCard of strict.composites[i].label.cards) {
        const match = loose.composites[i].label.cards.find((c) => c.printingId === strictCard.printingId)!;
        expect(strictCard.corners).toEqual(match.corners);
      }
    }

    const totalExcludedStrict = strict.composites.reduce((sum, c) => sum + c.label.excludedCards, 0);
    expect(totalExcludedStrict).toBeGreaterThan(0);
  });
});

// #268: coverage-mode selection + JPEG output threading through the
// end-to-end generateDataset entry point (both optional, both default to
// pre-#268 behavior when omitted).
describe("generateDataset — coverage mode + image format (#268)", () => {
  it("threads a CoverageTracker through planRun end to end — every card in the pool is used at least once given a generous budget", async () => {
    const { CoverageTracker } = await import("../src/composites/coverageTracker.js");
    const cfg = config({ compositesPerRun: 30, cardsPerComposite: { min: 1, max: 2 } });
    const tracker = new CoverageTracker(CARDS.length);
    await generateDataset(cfg, CARDS, fakeLoadImage(), undefined, [], tracker);
    for (const count of tracker.allAppearanceCounts()) expect(count).toBeGreaterThan(0);
  });

  it("defaults every label's fileName to .png when imageFormat is omitted", async () => {
    const result = await generateDataset(config({ compositesPerRun: 2 }), CARDS, fakeLoadImage());
    for (const c of result.composites) expect(c.label.fileName.endsWith(".png")).toBe(true);
  });

  it("uses .jpg fileNames end to end when imageFormat is 'jpeg'", async () => {
    const result = await generateDataset(config({ compositesPerRun: 2 }), CARDS, fakeLoadImage(), undefined, [], null, "jpeg");
    for (const c of result.composites) expect(c.label.fileName.endsWith(".jpg")).toBe(true);
  });
});
