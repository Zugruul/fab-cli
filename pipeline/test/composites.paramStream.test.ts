import { describe, it, expect } from "vitest";
import { planRun } from "../src/composites/paramStream.js";
import type { CardImageRef } from "../src/composites/paramStream.js";
import type { GeneratorConfig } from "../src/composites/config.js";

// APP-026 core determinism contract (AC: "deterministic given seed") and
// the seed x config-change intersection called out from APP-025's review
// (both APP-025 review bugs were intersection bugs, not isolated-knob
// bugs) — same seed + different config must diverge, and the divergence
// must be real (not just "different config object, identical output").

function baseConfig(overrides: Partial<GeneratorConfig> = {}): GeneratorConfig {
  return {
    seed: 12345,
    outputSize: { width: 512, height: 512 },
    compositesPerRun: 3,
    cardsPerComposite: { min: 2, max: 2 },
    baseCardHeightFraction: 0.25,
    scale: { min: 0.8, max: 1.2 },
    rotationDeg: { min: -15, max: 15 },
    overlapProbability: 0,
    overlapOffsetFraction: { min: 0.1, max: 0.3 },
    perspectiveProbability: 0,
    perspectiveStrength: { min: 0, max: 0.2 },
    glareProbability: 0,
    sleeveProbability: 0,
    lighting: { brightnessDelta: { min: -0.1, max: 0.1 }, contrastDelta: { min: -0.05, max: 0.05 } },
    backgroundTypes: ["solid", "gradient", "noise", "texture"],
    backgroundsDir: null,
    externalBackgroundProbability: 0,
    ...overrides,
  };
}

function cards(n: number): CardImageRef[] {
  return Array.from({ length: n }, (_, i) => ({ printingId: `printing-${i}`, imagePath: `/images/printing-${i}.png` }));
}

describe("planRun — determinism", () => {
  it("the same seed + same config + same card refs produce byte-identical output across two calls", () => {
    const config = baseConfig();
    const a = planRun(config, cards(6));
    const b = planRun(config, cards(6));
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("a different seed produces a different plan", () => {
    const a = planRun(baseConfig({ seed: 1 }), cards(6));
    const b = planRun(baseConfig({ seed: 2 }), cards(6));
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });

  it("SEED x CONFIG intersection: same seed, a changed knob (rotation range) produces a different plan", () => {
    const a = planRun(baseConfig({ seed: 777 }), cards(6));
    const b = planRun(baseConfig({ seed: 777, rotationDeg: { min: -60, max: 60 } }), cards(6));
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });

  it("SEED x CONFIG intersection: same seed, a changed cardsPerComposite range changes the plan's shape", () => {
    const a = planRun(baseConfig({ seed: 42, cardsPerComposite: { min: 1, max: 1 } }), cards(6));
    const b = planRun(baseConfig({ seed: 42, cardsPerComposite: { min: 3, max: 3 } }), cards(6));
    expect(a[0].cards).toHaveLength(1);
    expect(b[0].cards).toHaveLength(3);
  });
});

describe("planRun — respects config ranges", () => {
  it("every card count is within [min, max] and does not exceed available cards", () => {
    const config = baseConfig({ compositesPerRun: 10, cardsPerComposite: { min: 1, max: 4 } });
    const plans = planRun(config, cards(4));
    for (const p of plans) {
      expect(p.cards.length).toBeGreaterThanOrEqual(1);
      expect(p.cards.length).toBeLessThanOrEqual(4);
    }
  });

  it("every rotationDeg is within the configured range", () => {
    const config = baseConfig({ compositesPerRun: 20, rotationDeg: { min: -10, max: 10 } });
    const plans = planRun(config, cards(6));
    for (const p of plans) {
      for (const c of p.cards) {
        expect(c.rotationDeg).toBeGreaterThanOrEqual(-10);
        expect(c.rotationDeg).toBeLessThanOrEqual(10);
      }
    }
  });

  it("cardHeightFrac derives from baseCardHeightFraction * scale, within bounds", () => {
    const config = baseConfig({ compositesPerRun: 20, baseCardHeightFraction: 0.3, scale: { min: 0.5, max: 1.5 } });
    const plans = planRun(config, cards(6));
    for (const p of plans) {
      for (const c of p.cards) {
        expect(c.cardHeightFrac).toBeGreaterThanOrEqual(0.3 * 0.5);
        expect(c.cardHeightFrac).toBeLessThanOrEqual(0.3 * 1.5);
      }
    }
  });

  it("perspectiveProbability=0 always yields zero perspective insets", () => {
    const config = baseConfig({ compositesPerRun: 10, perspectiveProbability: 0 });
    const plans = planRun(config, cards(6));
    for (const p of plans) for (const c of p.cards) {
      expect(c.perspectiveLeftFrac).toBe(0);
      expect(c.perspectiveRightFrac).toBe(0);
    }
  });

  it("perspectiveProbability=1 always yields insets within [perspectiveStrength.min, max]", () => {
    const config = baseConfig({ compositesPerRun: 10, perspectiveProbability: 1, perspectiveStrength: { min: 0.05, max: 0.3 } });
    const plans = planRun(config, cards(6));
    let sawNonZero = false;
    for (const p of plans) for (const c of p.cards) {
      expect(c.perspectiveLeftFrac).toBeGreaterThanOrEqual(0.05);
      expect(c.perspectiveLeftFrac).toBeLessThanOrEqual(0.3);
      expect(c.perspectiveRightFrac).toBeGreaterThanOrEqual(0.05);
      expect(c.perspectiveRightFrac).toBeLessThanOrEqual(0.3);
      if (c.perspectiveLeftFrac > 0) sawNonZero = true;
    }
    expect(sawNonZero).toBe(true);
  });

  it("glareProbability=1 tags every card with 'glare'; sleeveProbability=1 tags every card with 'sleeved'", () => {
    const config = baseConfig({ compositesPerRun: 5, glareProbability: 1, sleeveProbability: 1 });
    const plans = planRun(config, cards(6));
    for (const p of plans) for (const c of p.cards) {
      expect(c.tags).toContain("glare");
      expect(c.tags).toContain("sleeved");
    }
  });

  it("glareProbability=0 and sleeveProbability=0 never tag any card", () => {
    const config = baseConfig({ compositesPerRun: 5, glareProbability: 0, sleeveProbability: 0 });
    const plans = planRun(config, cards(6));
    for (const p of plans) for (const c of p.cards) {
      expect(c.tags).toEqual([]);
    }
  });

  it("produces exactly compositesPerRun plans, each with a unique compositeId", () => {
    const plans = planRun(baseConfig({ compositesPerRun: 7 }), cards(6));
    expect(plans).toHaveLength(7);
    expect(new Set(plans.map((p) => p.compositeId)).size).toBe(7);
  });

  it("throws when there are no available card images to compose", () => {
    expect(() => planRun(baseConfig(), [])).toThrow();
  });

  it("chooses a backgroundType from the configured list", () => {
    const plans = planRun(baseConfig({ backgroundTypes: ["solid"] }), cards(6));
    for (const p of plans) expect(p.background.type).toBe("solid");
  });
});

// #244: external (real photo) backgrounds. planRun's 3rd param is the
// SORTED list of available background file names (paramStream.ts stays
// pure — it never touches fs; resolving that list from a real directory
// is cli.ts's job). Selection must be deterministic given seed + that
// list, and — same discipline as the overlap/position draws above — the
// draw COUNT per composite must not depend on whether external
// backgrounds are configured at all, so a backgroundsDir/probability
// change never reshuffles any OTHER knob's draws.
describe("planRun — external backgrounds (#244)", () => {
  it("never selects an external background when availableBackgrounds is empty, even with externalBackgroundProbability=1", () => {
    const config = baseConfig({ compositesPerRun: 10, externalBackgroundProbability: 1 });
    const plans = planRun(config, cards(6), []);
    for (const p of plans) expect(p.background.type).not.toBe("external");
  });

  it("never selects an external background when externalBackgroundProbability=0, even with backgrounds available", () => {
    const config = baseConfig({ compositesPerRun: 10, externalBackgroundProbability: 0 });
    const plans = planRun(config, cards(6), ["a.png", "b.png"]);
    for (const p of plans) expect(p.background.type).not.toBe("external");
  });

  it("always selects an external background when externalBackgroundProbability=1 and backgrounds are available, from the given list", () => {
    const config = baseConfig({ compositesPerRun: 10, externalBackgroundProbability: 1 });
    const files = ["aaa.png", "bbb.jpg", "ccc.webp"];
    const plans = planRun(config, cards(6), files);
    for (const p of plans) {
      expect(p.background.type).toBe("external");
      if (p.background.type === "external") {
        expect(files).toContain(p.background.fileName);
        expect(p.background.contentHash).toBe(p.background.fileName.replace(/\.[^.]+$/, ""));
      }
    }
  });

  it("is deterministic given the same seed + same availableBackgrounds list", () => {
    const config = baseConfig({ externalBackgroundProbability: 0.5 });
    const files = ["x.png", "y.png"];
    const a = planRun(config, cards(6), files);
    const b = planRun(config, cards(6), files);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("SEED x EXTERNAL-PROBABILITY intersection: same seed, probability 0 vs 1 produce different plans, each internally deterministic", () => {
    const files = ["a.png", "b.png", "c.png"];
    const configZero = baseConfig({ seed: 88, externalBackgroundProbability: 0 });
    const configOne = baseConfig({ seed: 88, externalBackgroundProbability: 1 });
    const zeroA = planRun(configZero, cards(6), files);
    const zeroB = planRun(configZero, cards(6), files);
    const oneA = planRun(configOne, cards(6), files);
    const oneB = planRun(configOne, cards(6), files);
    expect(JSON.stringify(zeroA)).toEqual(JSON.stringify(zeroB));
    expect(JSON.stringify(oneA)).toEqual(JSON.stringify(oneB));
    expect(JSON.stringify(zeroA)).not.toEqual(JSON.stringify(oneA));
  });

  it("SHAPE INVARIANT: with externalBackgroundProbability=0, per-card placement and lighting are unaffected by the availableBackgrounds list contents", () => {
    const config = baseConfig({ seed: 321, externalBackgroundProbability: 0 });
    const withNone = planRun(config, cards(6), []);
    const withSome = planRun(config, cards(6), ["a.png", "b.png", "c.png"]);
    expect(JSON.stringify(withNone.map((p) => p.cards))).toEqual(JSON.stringify(withSome.map((p) => p.cards)));
    expect(JSON.stringify(withNone.map((p) => p.lighting))).toEqual(JSON.stringify(withSome.map((p) => p.lighting)));
  });

  it("defaults availableBackgrounds to empty when the 3rd arg is omitted (backward compatible, procedural-only)", () => {
    const config = baseConfig({ externalBackgroundProbability: 1 });
    const plans = planRun(config, cards(6));
    for (const p of plans) expect(p.background.type).not.toBe("external");
  });
});

describe("planRun — OVERLAP x ROTATION intersection", () => {
  it("with overlapProbability=1, a later card's center is drawn near the previous card's center", () => {
    const config = baseConfig({
      seed: 999,
      compositesPerRun: 5,
      cardsPerComposite: { min: 3, max: 3 },
      overlapProbability: 1,
      overlapOffsetFraction: { min: 0.1, max: 0.2 },
      rotationDeg: { min: -45, max: 45 },
    });
    const plans = planRun(config, cards(6));
    for (const p of plans) {
      for (let i = 1; i < p.cards.length; i++) {
        const prev = p.cards[i - 1];
        const cur = p.cards[i];
        const dist = Math.hypot(cur.centerXFrac - prev.centerXFrac, cur.centerYFrac - prev.centerYFrac);
        // overlap offset is bounded by overlapOffsetFraction * cardHeightFrac (generous bound)
        expect(dist).toBeLessThan(prev.cardHeightFrac * 0.6);
      }
    }
  });

  it("each card's OWN rotation/placement is independent of whether it is overlapping — rotation range is respected regardless of overlap", () => {
    const config = baseConfig({
      seed: 55,
      compositesPerRun: 5,
      cardsPerComposite: { min: 3, max: 3 },
      overlapProbability: 1,
      rotationDeg: { min: -30, max: 30 },
    });
    const plans = planRun(config, cards(6));
    for (const p of plans) for (const c of p.cards) {
      expect(c.rotationDeg).toBeGreaterThanOrEqual(-30);
      expect(c.rotationDeg).toBeLessThanOrEqual(30);
    }
  });
});
