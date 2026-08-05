import { describe, it, expect, vi } from "vitest";
import { generateDataset } from "../src/composites/generate.js";
import type { GeneratorConfig } from "../src/composites/config.js";
import type { RawImage } from "../src/composites/rawImage.js";
import type { RenderResult } from "../src/composites/compositor.js";
import type { CompositeLabel } from "../src/composites/types.js";

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

/** Test-only sink: generateDataset streams one RenderResult at a time via
 * `onComposite` (#272) rather than accumulating them into a returned
 * array — this collects labels back into an array so existing assertions
 * can inspect the whole run's output, exactly like a caller who wants a
 * sample sheet or a DB row per composite, but WITHOUT retaining pixels: it
 * only keeps `label`, not `image`. */
function collectLabels(): { onComposite: (r: RenderResult) => void; labels: CompositeLabel[] } {
  const labels: CompositeLabel[] = [];
  return { onComposite: (r) => labels.push(r.label), labels };
}

describe("generateDataset — end to end determinism", () => {
  it("the same seed + config + card refs produce byte-identical labels and manifest (buildDate pinned)", async () => {
    const now = () => "2026-01-01T00:00:00.000Z";
    const sinkA = collectLabels();
    const sinkB = collectLabels();
    const a = await generateDataset(config(), CARDS, fakeLoadImage(), sinkA.onComposite, now);
    const b = await generateDataset(config(), CARDS, fakeLoadImage(), sinkB.onComposite, now);

    expect(a.manifest).toEqual(b.manifest);
    expect(sinkA.labels).toEqual(sinkB.labels);
  });

  it("produces exactly config.compositesPerRun composites, streamed one at a time via onComposite", async () => {
    const sink = collectLabels();
    const result = await generateDataset(config({ compositesPerRun: 5 }), CARDS, fakeLoadImage(), sink.onComposite);
    expect(sink.labels).toHaveLength(5);
    expect(result.manifest.compositeCount).toBe(5);
  });

  it("propagates planRun's error when no card images are available", async () => {
    await expect(generateDataset(config(), [], fakeLoadImage(), () => {})).rejects.toThrow();
  });

  it("never holds more than one rendered composite in memory at a time — onComposite is awaited before the next composite is rendered", async () => {
    const inFlight: number[] = [];
    let maxConcurrent = 0;
    const onComposite = async () => {
      inFlight.push(1);
      maxConcurrent = Math.max(maxConcurrent, inFlight.length);
      await Promise.resolve(); // yield, so a broken "fire and forget" caller would overlap here
      inFlight.pop();
    };
    await generateDataset(config({ compositesPerRun: 8 }), CARDS, fakeLoadImage(), onComposite);
    expect(maxConcurrent).toBe(1);
  });
});

// #272: the decoded-source-image cache used to be an unbounded Map (every
// distinct path ever loaded, held for the whole run) — the dominant driver
// of the measured unbounded RSS growth on a full-catalog coverage run.
// generateDataset now takes an explicit, bounded cache size and evicts via
// LruCache once that bound is exceeded.
describe("generateDataset — bounded image cache (#272)", () => {
  it("loads each distinct image path at most once when the cache is large enough to hold them all (unchanged pre-#272 behavior)", async () => {
    const loadImage = vi.fn(fakeLoadImage());
    await generateDataset(
      config({ compositesPerRun: 10, cardsPerComposite: { min: 2, max: 2 } }),
      CARDS,
      loadImage,
      () => {},
      undefined,
      [],
      null,
      "png",
      64, // >> the 5 distinct paths CARDS can produce
    );
    const distinctPaths = new Set(loadImage.mock.calls.map((c) => c[0]));
    expect(loadImage).toHaveBeenCalledTimes(distinctPaths.size);
  });

  it("reloads a path more than once when the cache is smaller than the number of distinct paths in flight — proves the bound is real, not decorative", async () => {
    const loadImage = vi.fn(fakeLoadImage());
    // 5 distinct printings, cache holds only 1 -> heavy churn, calls > distinct paths.
    await generateDataset(
      config({ compositesPerRun: 20, cardsPerComposite: { min: 2, max: 2 } }),
      CARDS,
      loadImage,
      () => {},
      undefined,
      [],
      null,
      "png",
      1,
    );
    const distinctPaths = new Set(loadImage.mock.calls.map((c) => c[0]));
    expect(loadImage.mock.calls.length).toBeGreaterThan(distinctPaths.size);
  });
});

// #244: generateDataset's 6th param is the sorted list of available
// EXTERNAL background file names (mirrors availableCards' role for cards)
// — cli.ts resolves this from config.backgroundsDir; this module stays
// agnostic about where the list came from.
describe("generateDataset — external backgrounds (#244)", () => {
  it("resolves external background file names against config.backgroundsDir and loads them via the same image cache as cards", async () => {
    const loadImage = vi.fn(fakeLoadImage());
    const cfg = config({ compositesPerRun: 6, externalBackgroundProbability: 1, backgroundsDir: "/bg" });
    const sink = collectLabels();
    await generateDataset(cfg, CARDS, loadImage, sink.onComposite, undefined, ["bg1.png", "bg2.png"]);

    const bgCalls = loadImage.mock.calls.map((c) => c[0] as string).filter((p) => p.includes("bg1.png") || p.includes("bg2.png"));
    expect(bgCalls.length).toBeGreaterThan(0);
    expect(new Set(bgCalls).size).toBeLessThanOrEqual(2);

    for (const label of sink.labels) {
      expect(label.backgroundType).toBe("external");
      expect(label.backgroundHash).not.toBeNull();
    }
  });

  it("is deterministic given the same seed + config + availableBackgrounds list", async () => {
    const cfg = config({ compositesPerRun: 4, externalBackgroundProbability: 1, backgroundsDir: "/bg" });
    const files = ["bg1.png", "bg2.png"];
    const sinkA = collectLabels();
    const sinkB = collectLabels();
    const a = await generateDataset(cfg, CARDS, fakeLoadImage(), sinkA.onComposite, () => "2026-01-01T00:00:00.000Z", files);
    const b = await generateDataset(cfg, CARDS, fakeLoadImage(), sinkB.onComposite, () => "2026-01-01T00:00:00.000Z", files);
    expect(a.manifest).toEqual(b.manifest);
    expect(sinkA.labels).toEqual(sinkB.labels);
  });

  it("throws a clear error if a plan selects an external background but config.backgroundsDir is null (caller contract violation)", async () => {
    await expect(
      generateDataset(config({ externalBackgroundProbability: 1, backgroundsDir: null }), CARDS, fakeLoadImage(), () => {}, undefined, ["bg1.png"]),
    ).rejects.toThrow(/backgroundsDir/);
  });

  it("never uses an external background when availableBackgrounds is omitted, regardless of externalBackgroundProbability", async () => {
    const cfg = config({ compositesPerRun: 5, externalBackgroundProbability: 1 });
    const sink = collectLabels();
    await generateDataset(cfg, CARDS, fakeLoadImage(), sink.onComposite);
    for (const label of sink.labels) {
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
    const sinkA = collectLabels();
    const sinkB = collectLabels();
    await generateDataset(cfg, CARDS, fakeLoadImage(), sinkA.onComposite);
    await generateDataset(cfg, CARDS, fakeLoadImage(), sinkB.onComposite);

    const fracsA = sinkA.labels.flatMap((l) => l.cards.map((x) => x.visibleFraction));
    const fracsB = sinkB.labels.flatMap((l) => l.cards.map((x) => x.visibleFraction));
    expect(fracsA).toEqual(fracsB);
    expect(fracsA.some((f) => f < 1)).toBe(true);
  });

  it("excludedCards is 0 for every composite when minVisibleFraction is 0 (nothing filtered)", async () => {
    const cfg = config({ compositesPerRun: 5, cardsPerComposite: { min: 2, max: 2 }, overlapProbability: 1, minVisibleFraction: 0 });
    const sink = collectLabels();
    await generateDataset(cfg, CARDS, fakeLoadImage(), sink.onComposite);
    for (const l of sink.labels) expect(l.excludedCards).toBe(0);
  });

  it("a high minVisibleFraction threshold excludes some cards without touching the rng stream (composite count and card placements stay identical)", async () => {
    const cfgLoose = config({ compositesPerRun: 8, cardsPerComposite: { min: 2, max: 2 }, overlapProbability: 1, minVisibleFraction: 0 });
    const cfgStrict = config({ compositesPerRun: 8, cardsPerComposite: { min: 2, max: 2 }, overlapProbability: 1, minVisibleFraction: 0.95 });

    const sinkLoose = collectLabels();
    const sinkStrict = collectLabels();
    await generateDataset(cfgLoose, CARDS, fakeLoadImage(), sinkLoose.onComposite);
    await generateDataset(cfgStrict, CARDS, fakeLoadImage(), sinkStrict.onComposite);

    // same plan -> same corners for every composite, regardless of
    // threshold: strict's surviving cards are a subset of loose's, with
    // IDENTICAL corners (never re-rolled just because some cards were
    // filtered out of the label).
    for (let i = 0; i < sinkLoose.labels.length; i++) {
      for (const strictCard of sinkStrict.labels[i].cards) {
        const match = sinkLoose.labels[i].cards.find((c) => c.printingId === strictCard.printingId)!;
        expect(strictCard.corners).toEqual(match.corners);
      }
    }

    const totalExcludedStrict = sinkStrict.labels.reduce((sum, l) => sum + l.excludedCards, 0);
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
    await generateDataset(cfg, CARDS, fakeLoadImage(), () => {}, undefined, [], tracker);
    for (const count of tracker.allAppearanceCounts()) expect(count).toBeGreaterThan(0);
  });

  it("defaults every label's fileName to .png when imageFormat is omitted", async () => {
    const sink = collectLabels();
    await generateDataset(config({ compositesPerRun: 2 }), CARDS, fakeLoadImage(), sink.onComposite);
    for (const l of sink.labels) expect(l.fileName.endsWith(".png")).toBe(true);
  });

  it("uses .jpg fileNames end to end when imageFormat is 'jpeg'", async () => {
    const sink = collectLabels();
    await generateDataset(config({ compositesPerRun: 2 }), CARDS, fakeLoadImage(), sink.onComposite, undefined, [], null, "jpeg");
    for (const l of sink.labels) expect(l.fileName.endsWith(".jpg")).toBe(true);
  });
});
