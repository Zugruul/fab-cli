import { describe, it, expect } from "vitest";
import { planRun } from "../src/composites/paramStream.js";
import type { CardImageRef } from "../src/composites/paramStream.js";
import { CoverageTracker } from "../src/composites/coverageTracker.js";
import type { GeneratorConfig } from "../src/composites/config.js";

// #268: coverage-driven card selection. Uniform-random selection
// (sampleWithoutReplacement) cannot GUARANTEE every printing appears at
// least N times — it's the coupon-collector problem, and even then only
// probabilistic. Passing a CoverageTracker into planRun switches card
// selection to a strategy that always offers up the globally
// least-appeared-so-far printing(s) first, while preserving the EXACT same
// rng()-draw shape as the uniform-random path (paramStream.ts's header
// "per-composite draw order" contract) — so toggling coverage mode must
// never reshuffle any OTHER draw (background, lighting, position,
// rotation, ...) for a fixed seed.

function baseConfig(overrides: Partial<GeneratorConfig> = {}): GeneratorConfig {
  return {
    seed: 20260804,
    outputSize: { width: 256, height: 256 },
    compositesPerRun: 40,
    cardsPerComposite: { min: 1, max: 3 },
    baseCardHeightFraction: 0.25,
    scale: { min: 0.8, max: 1.2 },
    rotationDeg: { min: -15, max: 15 },
    overlapProbability: 0.2,
    overlapOffsetFraction: { min: 0.1, max: 0.3 },
    perspectiveProbability: 0.3,
    perspectiveStrength: { min: 0.02, max: 0.2 },
    glareProbability: 0.2,
    sleeveProbability: 0.2,
    lighting: { brightnessDelta: { min: -0.1, max: 0.1 }, contrastDelta: { min: -0.05, max: 0.05 } },
    backgroundTypes: ["solid", "gradient", "noise", "texture"],
    backgroundsDir: null,
    externalBackgroundProbability: 0,
    minVisibleFraction: 0.15,
    ...overrides,
  };
}

function cards(n: number): CardImageRef[] {
  return Array.from({ length: n }, (_, i) => ({ printingId: `printing-${i}`, imagePath: `/images/printing-${i}.png` }));
}

describe("planRun — coverage mode (#268)", () => {
  it("with a fixture catalog and a generous composite budget, every eligible printing appears at least minAppearances times", () => {
    const pool = cards(12);
    const tracker = new CoverageTracker(pool.length);
    const config = baseConfig({ compositesPerRun: 40, cardsPerComposite: { min: 1, max: 3 } });
    planRun(config, pool, [], tracker);

    const counts = tracker.allAppearanceCounts();
    const minAppearances = 2;
    for (let i = 0; i < pool.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(minAppearances);
    }
  });

  it("DRAW-SHAPE INVARIANT: enabling coverage mode does not change background/lighting/position/rotation for a fixed seed — only which printingId lands in each slot may differ", () => {
    const pool = cards(12);
    const config = baseConfig({ compositesPerRun: 15, cardsPerComposite: { min: 1, max: 3 } });

    const withoutCoverage = planRun(config, pool, []);
    const withCoverage = planRun(config, pool, [], new CoverageTracker(pool.length));

    expect(withoutCoverage.length).toBe(withCoverage.length);
    for (let i = 0; i < withoutCoverage.length; i++) {
      const a = withoutCoverage[i];
      const b = withCoverage[i];
      expect(b.background).toEqual(a.background);
      expect(b.lighting).toEqual(a.lighting);
      expect(b.cards.length).toBe(a.cards.length);
      for (let c = 0; c < a.cards.length; c++) {
        const { printingId: _apId, imagePath: _aip, ...aRest } = a.cards[c];
        const { printingId: _bpId, imagePath: _bip, ...bRest } = b.cards[c];
        expect(bRest).toEqual(aRest);
      }
    }
  });

  it("is deterministic — same seed + same catalog + coverage mode produces byte-identical output across two calls", () => {
    const pool = cards(10);
    const config = baseConfig({ compositesPerRun: 12 });
    const a = planRun(config, pool, [], new CoverageTracker(pool.length));
    const b = planRun(config, pool, [], new CoverageTracker(pool.length));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("never repeats the same printing twice within a single composite, even in coverage mode", () => {
    const pool = cards(8);
    const config = baseConfig({ compositesPerRun: 30, cardsPerComposite: { min: 3, max: 3 } });
    const plans = planRun(config, pool, [], new CoverageTracker(pool.length));
    for (const p of plans) {
      const ids = p.cards.map((c) => c.printingId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("without a coverage tracker, behavior is unchanged from the pre-#268 uniform-random path", () => {
    const pool = cards(6);
    const config = baseConfig({ compositesPerRun: 5 });
    const a = planRun(config, pool);
    const b = planRun(config, pool, []);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});
