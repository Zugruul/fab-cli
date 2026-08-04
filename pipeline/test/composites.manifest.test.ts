import { describe, it, expect } from "vitest";
import { buildCompositeManifest, COMPOSITE_MANIFEST_SCHEMA_VERSION } from "../src/composites/manifest.js";
import { sha256 } from "../src/benchmark/manifest.js";
import { COMPOSITE_LABEL_SCHEMA_VERSION } from "../src/composites/types.js";
import type { GeneratorConfig } from "../src/composites/config.js";
import type { CompositeLabel } from "../src/composites/types.js";

function config(overrides: Partial<GeneratorConfig> = {}): GeneratorConfig {
  return {
    seed: 555,
    outputSize: { width: 256, height: 256 },
    compositesPerRun: 2,
    cardsPerComposite: { min: 1, max: 1 },
    baseCardHeightFraction: 0.25,
    scale: { min: 1, max: 1 },
    rotationDeg: { min: 0, max: 0 },
    overlapProbability: 0,
    overlapOffsetFraction: { min: 0.1, max: 0.2 },
    perspectiveProbability: 0,
    perspectiveStrength: { min: 0, max: 0.1 },
    glareProbability: 0,
    sleeveProbability: 0,
    lighting: { brightnessDelta: { min: 0, max: 0 }, contrastDelta: { min: 0, max: 0 } },
    backgroundTypes: ["solid"],
    backgroundsDir: null,
    externalBackgroundProbability: 0,
    minVisibleFraction: 0.15,
    ...overrides,
  };
}

function label(id: string, cardCount = 1, excludedCards = 0): CompositeLabel {
  return {
    compositeId: id,
    fileName: `${id}.png`,
    width: 256,
    height: 256,
    backgroundType: "procedural:solid",
    backgroundHash: null,
    cards: Array.from({ length: cardCount }, (_, i) => ({
      printingId: `printing-${i}`,
      corners: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ] as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
      tags: [],
      visibleFraction: 1,
    })),
    excludedCards,
    cardBacksPlaced: 0,
  };
}

describe("buildCompositeManifest", () => {
  it("records seed, compositeCount, and per-composite fileName/cardCount", () => {
    const labels = [label("composite-0000", 2), label("composite-0001", 1)];
    const manifest = buildCompositeManifest({ config: config(), labels });
    expect(manifest.seed).toBe(555);
    expect(manifest.compositeCount).toBe(2);
    expect(manifest.composites.map((c) => c.compositeId)).toEqual(["composite-0000", "composite-0001"]);
    expect(manifest.composites[0].cardCount).toBe(2);
    expect(manifest.composites[1].cardCount).toBe(1);
  });

  it("hashes each label file as it would actually be written to disk (JSON.stringify(label, null, 2) + newline)", () => {
    const labels = [label("composite-0000")];
    const manifest = buildCompositeManifest({ config: config(), labels });
    const expectedHash = sha256(Buffer.from(JSON.stringify(labels[0], null, 2) + "\n"));
    expect(manifest.composites[0].labelFileHash).toBe(expectedHash);
  });

  it("hashes/round-trips a label with out-of-canvas (negative) corner coordinates with no special-casing or NaN (PR #238 review round 1: amodal labeling)", () => {
    const lbl = label("composite-0000");
    lbl.cards[0].corners = [
      { x: -15, y: -15 },
      { x: 25, y: -15 },
      { x: 25, y: 25 },
      { x: -15, y: 25 },
    ];
    const manifest = buildCompositeManifest({ config: config(), labels: [lbl] });
    const expectedHash = sha256(Buffer.from(JSON.stringify(lbl, null, 2) + "\n"));
    expect(manifest.composites[0].labelFileHash).toBe(expectedHash);
    expect(manifest.composites[0].cardCount).toBe(1);
  });

  it("generatorConfigHash changes when the config changes, even with identical labels", () => {
    const labels = [label("composite-0000")];
    const a = buildCompositeManifest({ config: config(), labels });
    const b = buildCompositeManifest({ config: config({ rotationDeg: { min: -5, max: 5 } }), labels });
    expect(a.generatorConfigHash).not.toBe(b.generatorConfigHash);
  });

  it("generatorConfigHash is identical for identical config, regardless of label content", () => {
    const a = buildCompositeManifest({ config: config(), labels: [label("composite-0000")] });
    const b = buildCompositeManifest({ config: config(), labels: [label("composite-0000", 3), label("composite-0001", 2)] });
    expect(a.generatorConfigHash).toBe(b.generatorConfigHash);
  });

  // PR #246 review round 1: mirrors benchmark/manifest.ts's pattern (see
  // test/benchmark.manifest.test.ts's "stamps the manifest with schema +
  // label-schema versions" test) — the label schema version must be
  // OBSERVABLE in the artifact itself, even for an empty run, so a future
  // reader can branch on it without recomputing it from label content.
  it("stamps the manifest with the label schema version, even for an empty run", () => {
    const manifest = buildCompositeManifest({ config: config(), labels: [] });
    expect(manifest.labelSchemaVersion).toBe(COMPOSITE_LABEL_SCHEMA_VERSION);
    expect(manifest.compositeCount).toBe(0);
  });

  it("bumps COMPOSITE_LABEL_SCHEMA_VERSION to 0.4.0 for the cardBacksPlaced addition (#253, on top of #252's visibleFraction + excludedCards)", () => {
    expect(COMPOSITE_LABEL_SCHEMA_VERSION).toBe("0.4.0");
  });

  it("is deterministic given the same config + labels (buildDate aside)", () => {
    const labels = [label("composite-0000", 2)];
    const a = buildCompositeManifest({ config: config(), labels, now: () => "2026-01-01T00:00:00.000Z" });
    const b = buildCompositeManifest({ config: config(), labels, now: () => "2026-01-01T00:00:00.000Z" });
    expect(a).toEqual(b);
  });

  // #252: cardCount reflects LABELED (post-visibleFraction-filter) cards
  // only — excludedCards is the separate provenance count of cards that
  // were pasted (pixels rendered) but dropped from the label set.
  it("carries each composite's excludedCards count through to the manifest entry", () => {
    const labels = [label("composite-0000", 2, 1), label("composite-0001", 3, 0)];
    const manifest = buildCompositeManifest({ config: config(), labels });
    expect(manifest.composites[0].cardCount).toBe(2);
    expect(manifest.composites[0].excludedCards).toBe(1);
    expect(manifest.composites[1].cardCount).toBe(3);
    expect(manifest.composites[1].excludedCards).toBe(0);
  });

  it("bumps COMPOSITE_MANIFEST_SCHEMA_VERSION to 0.3.0 for the cardBacksPlaced field addition (#253, on top of #252's excludedCards)", () => {
    expect(COMPOSITE_MANIFEST_SCHEMA_VERSION).toBe("0.3.0");
    const manifest = buildCompositeManifest({ config: config(), labels: [] });
    expect(manifest.schemaVersion).toBe("0.3.0");
  });
});
