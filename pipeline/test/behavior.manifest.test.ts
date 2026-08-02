import { describe, it, expect } from "vitest";
import { configHash, buildManifest } from "../src/behavior/manifest.js";

describe("configHash (behavior)", () => {
  it("is deterministic regardless of key insertion order", () => {
    const a = { seed: 1, nested: { b: 1, a: 2 } };
    const b = { nested: { a: 2, b: 1 }, seed: 1 };
    expect(configHash(a)).toBe(configHash(b));
  });

  it("changes when a value changes", () => {
    expect(configHash({ seed: 1 })).not.toBe(configHash({ seed: 2 }));
  });

  it("produces a hex digest", () => {
    expect(configHash({ a: 1 })).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("buildManifest (behavior)", () => {
  it("aggregates per-category counts, minimums, config hash, and diversity metric", () => {
    const config = { seed: 42 };
    const manifest = buildManifest({
      config,
      seed: 42,
      minimums: { distractor: 5, abstention: 5, ood: 5, dpo: 5 },
      distractorCount: 10,
      abstentionCount: 8,
      oodCount: 40,
      dpoCount: 6,
      distractorSkipped: 1,
      abstentionSkipped: 2,
      dpoSkipped: 0,
      timeSensitiveDistractorCount: 1,
      dpoMethodCounts: { "rejection-sample": 1, "synthetic-citation-stripped": 3, "synthetic-confident-wrong": 2 },
      oodDiversity: {
        totalTemplates: 40,
        distinctTemplatesUsed: 40,
        templateUsageRatio: 1,
        styleCount: 8,
        stylesCovered: 8,
        styleCoverageRatio: 1,
      },
      now: () => "2026-08-02T00:00:00.000Z",
    });

    expect(manifest.seed).toBe(42);
    expect(manifest.configHash).toBe(configHash(config));
    expect(manifest.counts).toEqual({ distractor: 10, abstention: 8, ood: 40, dpo: 6 });
    expect(manifest.minimums).toEqual({ distractor: 5, abstention: 5, ood: 5, dpo: 5 });
    expect(manifest.skippedCounts).toEqual({ distractor: 1, abstention: 2, dpo: 0 });
    expect(manifest.timeSensitiveDistractorCount).toBe(1);
    expect(manifest.dpoMethodCounts["synthetic-citation-stripped"]).toBe(3);
    expect(manifest.oodDiversity.templateUsageRatio).toBe(1);
    expect(manifest.buildDate).toBe("2026-08-02T00:00:00.000Z");
  });

  it("reports a real buildDate by default (no fixed clock injected)", () => {
    const manifest = buildManifest({
      config: {},
      seed: 1,
      minimums: { distractor: 0, abstention: 0, ood: 0, dpo: 0 },
      distractorCount: 0,
      abstentionCount: 0,
      oodCount: 0,
      dpoCount: 0,
      distractorSkipped: 0,
      abstentionSkipped: 0,
      dpoSkipped: 0,
      timeSensitiveDistractorCount: 0,
      dpoMethodCounts: { "rejection-sample": 0, "synthetic-citation-stripped": 0, "synthetic-confident-wrong": 0 },
      oodDiversity: {
        totalTemplates: 0,
        distinctTemplatesUsed: 0,
        templateUsageRatio: 0,
        styleCount: 0,
        stylesCovered: 0,
        styleCoverageRatio: 0,
      },
    });
    expect(() => new Date(manifest.buildDate).toISOString()).not.toThrow();
  });
});
