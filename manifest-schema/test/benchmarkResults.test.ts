import { describe, it, expect } from "vitest";
import {
  validateBenchmarkResult,
  validateModelPackManifest,
  validModelPackManifest,
  validBenchmarkResult,
  validModelPackManifestWithBenchmarkResults,
  invalidBenchmarkResultMissingStepWhenUnmet,
  invalidBenchmarkResultStepPresentWhenMet,
  invalidBenchmarkResultCompletedBeforeStarted,
  FALLBACK_LADDER_STEPS,
} from "../src/index.js";

// APP-024 (issue #136), SPEC-APP.md §8.6/§10.2/§14: on-device benchmark
// protocol results. BenchmarkResult is embedded (optionally) on
// ModelPackManifest, mirroring how EvalScores/retrievalFloor land on their
// respective manifests — see modelPack.test.ts's sibling suite style.

function withBenchmarkResults(benchmarkResults: unknown) {
  return { ...validModelPackManifest, benchmarkResults };
}

describe("BenchmarkResult schema", () => {
  it("FALLBACK_LADDER_STEPS lists the §10.2 ladder in order", () => {
    expect(FALLBACK_LADDER_STEPS).toEqual(["reduced-retrieval-budget", "tier-downgrade", "relaxed-target"]);
  });

  it("accepts the valid fixture standalone", () => {
    const result = validateBenchmarkResult(validBenchmarkResult);
    expect(result.success, !result.success ? JSON.stringify(result.errors, null, 2) : undefined).toBe(true);
  });

  it("requires schemaVersion", () => {
    const { schemaVersion: _schemaVersion, ...rest } = validBenchmarkResult;
    const result = validateBenchmarkResult(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "schemaVersion")).toBe(true);
    }
  });

  it("accepts both defined tiers", () => {
    expect(validateBenchmarkResult({ ...validBenchmarkResult, tier: "1.7B" }).success).toBe(true);
    expect(validateBenchmarkResult({ ...validBenchmarkResult, tier: "0.6B" }).success).toBe(true);
  });

  it("rejects an unknown tier", () => {
    expect(validateBenchmarkResult({ ...validBenchmarkResult, tier: "3B" }).success).toBe(false);
  });

  it("rejects a missing metric (peakRamMb entirely absent), precise error path", () => {
    const { peakRamMb: _peakRamMb, ...restMetrics } = validBenchmarkResult.metrics;
    const result = validateBenchmarkResult({ ...validBenchmarkResult, metrics: restMetrics });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "metrics.peakRamMb")).toBe(true);
    }
  });

  it("accepts a metric in the honest not-run state with a reason", () => {
    const result = validateBenchmarkResult({
      ...validBenchmarkResult,
      metrics: {
        ...validBenchmarkResult.metrics,
        peakRamMb: { status: "not-run", reason: "no on-device RAM sampler wired" },
      },
    });
    expect(result.success, !result.success ? JSON.stringify(result.errors, null, 2) : undefined).toBe(true);
  });

  it("rejects a not-run metric with an empty reason", () => {
    const result = validateBenchmarkResult({
      ...validBenchmarkResult,
      metrics: { ...validBenchmarkResult.metrics, peakRamMb: { status: "not-run", reason: "" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a measured metric with a non-finite value (NaN bypassing TS via an unsafe cast)", () => {
    const result = validateBenchmarkResult({
      ...validBenchmarkResult,
      metrics: {
        ...validBenchmarkResult.metrics,
        decodeTokensPerSec: { status: "measured", value: NaN as unknown as number },
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown metric status", () => {
    const result = validateBenchmarkResult({
      ...validBenchmarkResult,
      metrics: {
        ...validBenchmarkResult.metrics,
        decodeTokensPerSec: { status: "estimated", value: 1 } as unknown,
      },
    });
    expect(result.success).toBe(false);
  });

  it("requires iterations to be a positive integer (rejects 0, negative, and fractional)", () => {
    expect(validateBenchmarkResult({ ...validBenchmarkResult, iterations: 0 }).success).toBe(false);
    expect(validateBenchmarkResult({ ...validBenchmarkResult, iterations: -1 }).success).toBe(false);
    expect(validateBenchmarkResult({ ...validBenchmarkResult, iterations: 1.5 }).success).toBe(false);
  });

  it("rejects completedAt before startedAt, precise error path", () => {
    const result = validateBenchmarkResult(invalidBenchmarkResultCompletedBeforeStarted);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "completedAt")).toBe(true);
    }
  });

  it("rejects an unparseable startedAt", () => {
    const result = validateBenchmarkResult({ ...validBenchmarkResult, startedAt: "not-a-date" });
    expect(result.success).toBe(false);
  });

  describe("fallbackLadderDecision (§10.2)", () => {
    it("accepts targetsMet: true with no stepApplied", () => {
      const result = validateBenchmarkResult({
        ...validBenchmarkResult,
        fallbackLadderDecision: { targetsMet: true, unmetMetrics: [], notes: "all §14 targets met" },
      });
      expect(result.success, !result.success ? JSON.stringify(result.errors, null, 2) : undefined).toBe(true);
    });

    it("rejects targetsMet: false with no stepApplied — §10.2 never ships a missed target silently", () => {
      const result = validateBenchmarkResult(invalidBenchmarkResultMissingStepWhenUnmet);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some((e) => e.path.join(".") === "fallbackLadderDecision.stepApplied")).toBe(true);
      }
    });

    it("rejects targetsMet: true WITH a stepApplied present — no fallback step was needed", () => {
      const result = validateBenchmarkResult(invalidBenchmarkResultStepPresentWhenMet);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some((e) => e.path.join(".") === "fallbackLadderDecision.stepApplied")).toBe(true);
      }
    });

    it("accepts each of the three ladder steps when targetsMet is false", () => {
      for (const step of FALLBACK_LADDER_STEPS) {
        const result = validateBenchmarkResult({
          ...validBenchmarkResult,
          fallbackLadderDecision: {
            targetsMet: false,
            stepApplied: step,
            unmetMetrics: ["ttftWarmMs"],
            notes: `applied ${step}`,
          },
        });
        expect(result.success, step).toBe(true);
      }
    });

    it("rejects an unknown ladder step", () => {
      const result = validateBenchmarkResult({
        ...validBenchmarkResult,
        fallbackLadderDecision: { targetsMet: false, stepApplied: "reboot-device", unmetMetrics: [], notes: "x" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects an empty notes string", () => {
      const result = validateBenchmarkResult({
        ...validBenchmarkResult,
        fallbackLadderDecision: { targetsMet: true, unmetMetrics: [], notes: "" },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("release-manifest integration (§8.6 'recorded in the release manifest')", () => {
    it("ModelPackManifest validates fine WITHOUT benchmarkResults — the device-run leg is QA-gated separately (APP-024/#136 scope)", () => {
      expect(validateModelPackManifest(validModelPackManifest).success).toBe(true);
    });

    it("ModelPackManifest validates with a populated benchmarkResults field", () => {
      const result = validateModelPackManifest(validModelPackManifestWithBenchmarkResults);
      expect(result.success, !result.success ? JSON.stringify(result.errors, null, 2) : undefined).toBe(true);
    });

    it("rejects a manifest whose benchmarkResults.tier contradicts the manifest's own tier", () => {
      const result = validateModelPackManifest(
        withBenchmarkResults({ ...validBenchmarkResult, tier: "0.6B" }), // validModelPackManifest.tier is "1.7B"
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.some((e) => e.path.join(".") === "benchmarkResults.tier")).toBe(true);
      }
    });

    it("accepts a manifest whose benchmarkResults.tier matches its own tier", () => {
      const result = validateModelPackManifest(withBenchmarkResults(validBenchmarkResult));
      expect(result.success, !result.success ? JSON.stringify(result.errors, null, 2) : undefined).toBe(true);
    });
  });
});
