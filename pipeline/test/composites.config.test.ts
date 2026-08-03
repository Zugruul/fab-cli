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

  it("rejects rotationDeg.min > rotationDeg.max", () => {
    const result = validateGeneratorConfig({ ...validConfig(), rotationDeg: { min: 30, max: -30 } });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => /rotationDeg/.test(e))).toBe(true);
  });

  it("rejects out-of-range probabilities", () => {
    for (const field of ["overlapProbability", "perspectiveProbability", "glareProbability", "sleeveProbability", "externalBackgroundProbability"] as const) {
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
});
