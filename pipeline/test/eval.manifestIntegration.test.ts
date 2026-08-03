import { describe, it, expect } from "vitest";
import { validateModelPackManifest, validModelPackManifest } from "@fab/manifest-schema";
import { toManifestEvalScores } from "../src/eval/manifestIntegration.js";
import { EVAL_SUITE_IDS, type EvalRunSummary } from "../src/eval/types.js";

// APP-022 (#134): proves pipeline's REAL toManifestEvalScores() output
// validates against @fab/manifest-schema — the producer side of "no lane
// invents its own manifest shape" (§7.11), mirroring
// pipeline/test/manifest-schema-alignment.test.ts's pattern for the
// corpus-snapshot manifest.

function fixtureSummary(): EvalRunSummary {
  return {
    runAt: "2026-08-02T00:00:00.000Z",
    suites: EVAL_SUITE_IDS.map((suiteId) => ({
      suiteId,
      counts: { correct: 18, incorrect: 1, abstained: 1 },
      score: 0.72,
      itemResults: [{ itemId: "x", verdict: "correct" as const }],
    })),
  };
}

describe("toManifestEvalScores", () => {
  it("maps runAt + per-suite counts/score, dropping itemResults (not part of the manifest shape)", () => {
    const mapped = toManifestEvalScores(fixtureSummary());
    expect(mapped.runAt).toBe("2026-08-02T00:00:00.000Z");
    expect(mapped.suites).toHaveLength(EVAL_SUITE_IDS.length);
    expect(mapped.suites[0]).toEqual({ suiteId: EVAL_SUITE_IDS[0], counts: { correct: 18, incorrect: 1, abstained: 1 }, score: 0.72 });
    expect((mapped.suites[0] as Record<string, unknown>).itemResults).toBeUndefined();
  });

  it("validates against @fab/manifest-schema's ModelPackManifestSchema when embedded in a full manifest", () => {
    const manifest = { ...validModelPackManifest, evalScores: toManifestEvalScores(fixtureSummary()) };
    const result = validateModelPackManifest(manifest);
    expect(result.success, !result.success ? JSON.stringify(result.errors, null, 2) : undefined).toBe(true);
  });

  it("a real EvalRunSummary missing a suite fails schema validation once mapped in (proves the alignment test isn't vacuous)", () => {
    const incomplete: EvalRunSummary = { ...fixtureSummary(), suites: fixtureSummary().suites.slice(1) };
    const manifest = { ...validModelPackManifest, evalScores: toManifestEvalScores(incomplete) };
    const result = validateModelPackManifest(manifest);
    expect(result.success).toBe(false);
  });
});
