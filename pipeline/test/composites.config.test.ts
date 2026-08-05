import { describe, it, expect } from "vitest";
import { validateGeneratorConfig } from "../src/composites/config.js";
import type { GeneratorConfig } from "../src/composites/config.js";

// APP-026 AC: "generator config committed" with schema validation (not
// hardcoded constants scattered in code) — mirrors benchmark/validate.ts's
// collect-all-errors style.

function validConfig(): GeneratorConfig {
  return {
    seed: 20260803,
    outputSize: { width: 512, height: 512 },
    compositesPerRun: 4,
    cardsPerComposite: { min: 1, max: 3 },
    baseCardHeightFraction: 0.28,
    scale: { min: 0.7, max: 1.0 },
    rotationDeg: { min: -20, max: 20 },
    overlapProbability: 0.3,
    overlapOffsetFraction: { min: 0.1, max: 0.4 },
    perspectiveProbability: 0.4,
    perspectiveStrength: { min: 0, max: 0.25 },
    glareProbability: 0.2,
    sleeveProbability: 0.3,
    lighting: {
      brightnessDelta: { min: -0.15, max: 0.15 },
      contrastDelta: { min: -0.1, max: 0.1 },
    },
    backgroundTypes: ["solid", "gradient", "noise", "texture"],
    backgroundsDir: null,
    externalBackgroundProbability: 0,
    minVisibleFraction: 0.15,
  };
}

describe("validateGeneratorConfig — accepts well-formed config", () => {
  it("accepts the canonical valid config", () => {
    const result = validateGeneratorConfig(validConfig());
    expect(result.valid, !result.valid ? result.errors.join("; ") : undefined).toBe(true);
  });

  it("accepts a non-null backgroundsDir string", () => {
    const result = validateGeneratorConfig({ ...validConfig(), backgroundsDir: "/tmp/backgrounds" });
    expect(result.valid).toBe(true);
  });

  it("accepts a single background type", () => {
    const result = validateGeneratorConfig({ ...validConfig(), backgroundTypes: ["solid"] });
    expect(result.valid).toBe(true);
  });

  // #252: minVisibleFraction is schema-validated as a [0,1] value, same as
  // every other probability-shaped knob in this config.
  it("accepts minVisibleFraction at both inclusive extremes (0 and 1)", () => {
    expect(validateGeneratorConfig({ ...validConfig(), minVisibleFraction: 0 }).valid).toBe(true);
    expect(validateGeneratorConfig({ ...validConfig(), minVisibleFraction: 1 }).valid).toBe(true);
  });
});

describe("validateGeneratorConfig — rejects malformed config", () => {
  it("rejects a non-object input", () => {
    expect(validateGeneratorConfig(null).valid).toBe(false);
    expect(validateGeneratorConfig("nope").valid).toBe(false);
    expect(validateGeneratorConfig(42).valid).toBe(false);
  });

  it("rejects a non-integer seed", () => {
    const result = validateGeneratorConfig({ ...validConfig(), seed: 1.5 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /seed/.test(e))).toBe(true);
  });

  it("rejects non-positive outputSize dimensions", () => {
    const result = validateGeneratorConfig({ ...validConfig(), outputSize: { width: 0, height: 512 } });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /outputSize/.test(e))).toBe(true);
  });

  it("rejects compositesPerRun <= 0", () => {
    const result = validateGeneratorConfig({ ...validConfig(), compositesPerRun: 0 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /compositesPerRun/.test(e))).toBe(true);
  });

  it("rejects cardsPerComposite.min > max", () => {
    const result = validateGeneratorConfig({ ...validConfig(), cardsPerComposite: { min: 5, max: 2 } });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /cardsPerComposite/.test(e))).toBe(true);
  });

  it("rejects baseCardHeightFraction outside (0,1)", () => {
    for (const bad of [0, 1, -0.2, 1.5]) {
      const result = validateGeneratorConfig({ ...validConfig(), baseCardHeightFraction: bad });
      expect(result.valid, `baseCardHeightFraction=${bad}`).toBe(false);
    }
  });

  it("rejects scale.min > scale.max", () => {
    const result = validateGeneratorConfig({ ...validConfig(), scale: { min: 1.2, max: 0.5 } });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /scale/.test(e))).toBe(true);
  });

  it("rejects scale.max above a sane upper bound (PR #238 review round 1: a config typo can't request absurd scales)", () => {
    const result = validateGeneratorConfig({ ...validConfig(), scale: { min: 0.5, max: 50 } });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /scale/.test(e))).toBe(true);
  });

  it("rejects rotationDeg.min > rotationDeg.max", () => {
    const result = validateGeneratorConfig({ ...validConfig(), rotationDeg: { min: 30, max: -30 } });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /rotationDeg/.test(e))).toBe(true);
  });

  it("rejects out-of-range probabilities", () => {
    for (const field of ["overlapProbability", "perspectiveProbability", "glareProbability", "sleeveProbability", "externalBackgroundProbability", "minVisibleFraction"] as const) {
      const result = validateGeneratorConfig({ ...validConfig(), [field]: 1.5 });
      expect(result.valid, `${field}=1.5`).toBe(false);
      const result2 = validateGeneratorConfig({ ...validConfig(), [field]: -0.1 });
      expect(result2.valid, `${field}=-0.1`).toBe(false);
    }
  });

  it("rejects perspectiveStrength.max >= 1", () => {
    const result = validateGeneratorConfig({ ...validConfig(), perspectiveStrength: { min: 0, max: 1 } });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /perspectiveStrength/.test(e))).toBe(true);
  });

  it("rejects lighting.brightnessDelta outside [-1,1] or min > max", () => {
    const result = validateGeneratorConfig({ ...validConfig(), lighting: { brightnessDelta: { min: 0.2, max: -0.2 }, contrastDelta: { min: -0.1, max: 0.1 } } });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /lighting/.test(e))).toBe(true);
  });

  it("rejects an empty backgroundTypes array", () => {
    const result = validateGeneratorConfig({ ...validConfig(), backgroundTypes: [] });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /backgroundTypes/.test(e))).toBe(true);
  });

  it("rejects an unknown background type", () => {
    const result = validateGeneratorConfig({ ...validConfig(), backgroundTypes: ["photo"] });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /backgroundTypes/.test(e))).toBe(true);
  });

  it("rejects a non-string, non-null backgroundsDir", () => {
    const result = validateGeneratorConfig({ ...validConfig(), backgroundsDir: 42 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /backgroundsDir/.test(e))).toBe(true);
  });

  it("reports multiple errors at once rather than stopping at the first", () => {
    const result = validateGeneratorConfig({});
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.length).toBeGreaterThan(3);
  });
});

describe("the committed pipeline/config/composites-generation.json", () => {
  it("validates against the schema as-is", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const base = path.join(import.meta.dirname, "..");
    const raw = JSON.parse(fs.readFileSync(path.join(base, "config", "composites-generation.json"), "utf8"));
    const result = validateGeneratorConfig(raw);
    expect(result.valid, !result.valid ? result.errors.join("; ") : undefined).toBe(true);
  });

  // #279: the pre-existing scale range (0.65-1.15) produced a synthetic
  // card long-edge of 186-330px on a 1024 canvas — real phone-photo
  // benchmark quads, letterboxed the same way, measured 245-763px (median
  // 535 vs the synthetic median 263). Only 10 of 25 real quads fell inside
  // the trained band at all. `scale` must widen enough that the synthetic
  // long-edge range covers the observed real range with headroom: roughly
  // 190-780px (card long-edge = baseCardHeightFraction * scale *
  // outputSize.height, computeDestQuad's cardH — see geometry.ts).
  it("#279: scale is widened so the synthetic card long-edge range covers the observed real-photo range (245-763px), not just the old 186-330px band", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const base = path.join(import.meta.dirname, "..");
    const raw = JSON.parse(fs.readFileSync(path.join(base, "config", "composites-generation.json"), "utf8")) as GeneratorConfig;

    const longEdgeMin = raw.baseCardHeightFraction * raw.scale.min * raw.outputSize.height;
    const longEdgeMax = raw.baseCardHeightFraction * raw.scale.max * raw.outputSize.height;

    // Real observed range was 245-763px — the widened synthetic range must
    // reach at or below the real min and at or above the real max (some
    // headroom on the low end is fine/expected; the low end was never the
    // problem — see issue #279).
    expect(longEdgeMin).toBeLessThanOrEqual(245);
    expect(longEdgeMax).toBeGreaterThanOrEqual(763);
  });

  // #279: widening `scale` increases each card's average footprint area,
  // which increases how often one card occludes another below
  // minVisibleFraction (measured: cardsPerComposite unchanged at {1,4} and
  // scale widened to {0.65,2.7} more than doubles the per-placement
  // exclusion rate — 6.34% to 15.13% on a 150-printing/191-composite small
  // run — and roughly doubles the share of printings falling short of a
  // real (post-exclusion) minAppearances=3 target, 14.7% to 30%).
  // cardsPerComposite.max is reduced alongside the scale widening to keep
  // that growth in check (measured: {1,3} brings exclusion back to 8.07%,
  // about a quarter of the way back to baseline's 6.34% versus {1,4}'s
  // 15.13% at the new scale — see PR #279's description for the full
  // measurement). This does NOT by itself guarantee real coverage — that's
  // now the coverage-report.json's job to state honestly (#279's
  // tallyAppearancesFromLabels fix) — it just keeps the run's placement
  // budget from being wasted on occlusion as badly as an unchanged
  // cardsPerComposite would.
  it("#279: cardsPerComposite.max is reduced alongside the widened scale to control occlusion growth", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const base = path.join(import.meta.dirname, "..");
    const raw = JSON.parse(fs.readFileSync(path.join(base, "config", "composites-generation.json"), "utf8")) as GeneratorConfig;

    expect(raw.cardsPerComposite.max).toBe(3);
  });
});
