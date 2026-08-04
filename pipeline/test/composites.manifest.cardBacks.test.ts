import { describe, it, expect } from "vitest";
import { buildCompositeManifest, COMPOSITE_MANIFEST_SCHEMA_VERSION } from "../src/composites/manifest.js";
import type { CompositeLabel } from "../src/composites/types.js";
import { validateGeneratorConfig } from "../src/composites/config.js";

// #253: cardBacksPlaced mirrors excludedCards's existing manifest-entry
// pattern — separate provenance for a separate reason a card isn't
// labeled.

function label(id: string, cardBacksPlaced = 0): CompositeLabel {
  return {
    compositeId: id,
    fileName: `${id}.png`,
    width: 10,
    height: 10,
    backgroundType: "procedural:solid",
    backgroundHash: null,
    cards: [],
    excludedCards: 0,
    cardBacksPlaced,
  };
}

const baseConfig = {
  seed: 1,
  outputSize: { width: 10, height: 10 },
  compositesPerRun: 1,
  cardsPerComposite: { min: 1, max: 1 },
  baseCardHeightFraction: 0.2,
  scale: { min: 1, max: 1 },
  rotationDeg: { min: 0, max: 0 },
  overlapProbability: 0,
  overlapOffsetFraction: { min: 0, max: 0 },
  perspectiveProbability: 0,
  perspectiveStrength: { min: 0, max: 0.5 },
  glareProbability: 0,
  sleeveProbability: 0,
  lighting: { brightnessDelta: { min: 0, max: 0 }, contrastDelta: { min: 0, max: 0 } },
  backgroundTypes: ["solid"],
  backgroundsDir: null,
  externalBackgroundProbability: 0,
  minVisibleFraction: 0,
};

describe("buildCompositeManifest — cardBacksPlaced (#253)", () => {
  it("bumped COMPOSITE_MANIFEST_SCHEMA_VERSION to 0.3.0 for the cardBacksPlaced field addition — since bumped again to 0.4.0 for #256's rigName field", () => {
    expect(COMPOSITE_MANIFEST_SCHEMA_VERSION).toBe("0.4.0");
  });

  it("carries each composite's cardBacksPlaced count through to the manifest entry", () => {
    const validated = validateGeneratorConfig(baseConfig);
    if (!validated.valid) throw new Error(validated.errors.join("; "));
    const manifest = buildCompositeManifest({ config: validated.config, labels: [label("a", 2), label("b", 0)] });
    expect(manifest.composites[0].cardBacksPlaced).toBe(2);
    expect(manifest.composites[1].cardBacksPlaced).toBe(0);
  });
});
