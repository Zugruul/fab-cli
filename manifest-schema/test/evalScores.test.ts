import { describe, it, expect } from "vitest";
import {
  validateModelPackManifest,
  validModelPackManifest,
  validEvalScores,
  invalidEvalScoresDuplicateSuite,
  invalidEvalScoresMissingSuite,
  invalidEvalScoresZeroItemSuite,
  EVAL_SUITE_IDS,
} from "../src/index.js";

// APP-022 (#134): per-suite eval scores land on ModelPackManifest
// (SPEC-APP.md §8.5 / §13 invariant 8). These tests exercise the schema in
// isolation via the full manifest (evalScores has no standalone
// validate* helper — it's always validated as part of a model pack
// manifest, mirroring how retrievalFloor/oodThreshold are only validated
// via validateKnowledgePackManifest).

function withEvalScores(evalScores: unknown) {
  return { ...validModelPackManifest, evalScores };
}

describe("ModelPackManifest.evalScores schema", () => {
  it("EVAL_SUITE_IDS lists exactly the eight SPEC-APP.md §8.4 suites", () => {
    expect(EVAL_SUITE_IDS).toEqual([
      "adjudication-critical",
      "interactions",
      "lore",
      "citation-validity",
      "abstention-quality",
      "ood-rejection",
      "distractor-robustness",
      "human-authored-adjudication",
    ]);
  });

  it("accepts a manifest carrying the valid evalScores fixture", () => {
    const result = validateModelPackManifest(withEvalScores(validEvalScores));
    expect(result.success, !result.success ? JSON.stringify(result.errors, null, 2) : undefined).toBe(true);
  });

  it("rejects a manifest missing evalScores entirely, precise error path", () => {
    const { evalScores: _evalScores, ...rest } = withEvalScores(validEvalScores);
    const result = validateModelPackManifest(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "evalScores")).toBe(true);
    }
  });

  it("rejects an evalScores.suites entry with an unknown suiteId", () => {
    const result = validateModelPackManifest(
      withEvalScores({
        ...validEvalScores,
        suites: [...validEvalScores.suites.slice(1), { ...validEvalScores.suites[0], suiteId: "not-a-real-suite" }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a duplicate suiteId, precise error path (each suite reported at most once)", () => {
    const result = validateModelPackManifest(withEvalScores(invalidEvalScoresDuplicateSuite));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".").startsWith("evalScores.suites"))).toBe(true);
    }
  });

  it("rejects a manifest missing one of the eight required suites, precise error path", () => {
    const result = validateModelPackManifest(withEvalScores(invalidEvalScoresMissingSuite));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".") === "evalScores.suites")).toBe(true);
    }
  });

  it("rejects a suite reporting zero graded items (vacuous pass guard), precise error path", () => {
    const result = validateModelPackManifest(withEvalScores(invalidEvalScoresZeroItemSuite));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.path.join(".").includes("counts"))).toBe(true);
    }
  });

  it("rejects negative counts", () => {
    const bad = {
      ...validEvalScores,
      suites: [
        { ...validEvalScores.suites[0], counts: { correct: -1, incorrect: 0, abstained: 1 } },
        ...validEvalScores.suites.slice(1),
      ],
    };
    const result = validateModelPackManifest(withEvalScores(bad));
    expect(result.success).toBe(false);
  });

  it("rejects a non-finite score (NaN bypassing TS via an unsafe cast)", () => {
    const bad = {
      ...validEvalScores,
      suites: [{ ...validEvalScores.suites[0], score: NaN as unknown as number }, ...validEvalScores.suites.slice(1)],
    };
    const result = validateModelPackManifest(withEvalScores(bad));
    expect(result.success).toBe(false);
  });
});
