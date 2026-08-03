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
