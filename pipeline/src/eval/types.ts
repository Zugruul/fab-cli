/**
 * Eval harness (SPEC-APP.md §8.3-§8.5, §13 invariant 8; APP-022 #134).
 * Shared types for scoring, suites, calibration and the release-manifest
 * integration. `EvalSuiteId`/`EVAL_SUITE_IDS` come from @fab/manifest-schema
 * — the shared package is the single source of truth for the eight named
 * suites (§7.11: no lane invents its own manifest shape), so this module
 * re-exports rather than redeclares them.
 */
import { EVAL_SUITE_IDS, type EvalSuiteId } from "@fab/manifest-schema";

export { EVAL_SUITE_IDS };
export type { EvalSuiteId };

/** Per-item verdict (SPEC-APP.md §8.3's trichotomy). */
export type Verdict = "correct" | "incorrect" | "abstained";

/**
 * What "correct" means for one eval item — a discriminated union mirroring
 * docs/design/app-E2.md's EvalItem data model verbatim ("expected (rubric |
 * canonical answer | abstain)"):
 *  - "exact": a canonical answer string (keyword definitions, numeric card
 *    stats — SPEC-APP.md §8.3) OR, for the citation-validity suite, the
 *    correctly-cited chunk id(s) — see scorers/citationValidity.ts, which
 *    reads `groundingChunkIds` directly rather than this field.
 *  - "rubric": an open answer graded by the LLM judge against claims
 *    derived from the source chunk (here: the reference/teacher answer —
 *    the dataset pipeline doesn't separately author per-claim rubrics, so
 *    the reference answer stands in as the claim set to check entailment
 *    against; see suites/fromDataset.ts's doc comment for why this is a
 *    faithful reading of "rubric derived from source-chunk claims").
 *  - "abstain": the ONLY correct behavior is abstaining (abstention-quality,
 *    OOD-rejection) — answering at all, right or wrong, is incorrect.
 */
export type ExpectedAnswer =
  | { kind: "exact"; value: string }
  | { kind: "rubric"; claims: string[] }
  | { kind: "abstain" };

/** One eval item (docs/design/app-E2.md's EvalItem). `sourceUrl` is
 * required for human-authored-adjudication items (transcription
 * provenance, §8.4's anti-circularity control) and absent for every other
 * suite (dataset-derived items cite `groundingChunkIds` instead). */
export interface EvalItem {
  id: string;
  suite: EvalSuiteId;
  question: string;
  expected: ExpectedAnswer;
  groundingChunkIds: string[];
  adjudicationCritical?: boolean;
  sourceUrl?: string;
}

/** What the model-under-eval returns for one item. `citedChunkIds` is
 * always present (possibly empty) — a model that doesn't support citation
 * at all should return `[]`, which the citation-validity scorer and the
 * abstain-expected scorers both treat as "no citation offered", not as an
 * error. */
export interface ModelAnswer {
  text: string;
  abstained: boolean;
  citedChunkIds: string[];
}

/** Abstraction over "ask the model under eval" — injectable so the gate
 * never touches a real model; only a deterministic stub (see
 * test/eval.helpers.ts) runs there. Real-model runs are an explicit
 * non-gate command (docs/design/app-E2.md's Gate contract). */
export interface ModelClient {
  answer(item: EvalItem): Promise<ModelAnswer>;
}

export interface EvalCounts {
  correct: number;
  incorrect: number;
  abstained: number;
}

export interface ItemResult {
  itemId: string;
  verdict: Verdict;
  /** Present only when a scorer records why (rubric-judge reason, or a
   * citation-validity mismatch explanation) — optional, never fabricated. */
  reason?: string;
}

export interface SuiteResult {
  suiteId: EvalSuiteId;
  counts: EvalCounts;
  /** Asymmetric-penalty-weighted aggregate — see scoring.ts. */
  score: number;
  itemResults: ItemResult[];
}

export interface EvalRunSummary {
  runAt: string;
  suites: SuiteResult[];
}

/** Asymmetric penalty weights (SPEC-APP.md §8.3: "incorrect ≫ abstain"),
 * committed config — never code constants (pipeline/config/eval-harness.json). */
export interface PenaltyWeights {
  correct: number;
  incorrect: number;
  abstained: number;
}

export interface EvalGateConfig {
  penalties: PenaltyWeights;
  /** Max fraction of adjudication-critical items allowed to score
   * "incorrect" before §8.5(a) fires ("near-zero threshold"). */
  adjudicationCriticalMaxIncorrectRate: number;
  /** Per-suite minimum correct-rate (coverage) floor, §8.5(b) — every one
   * of the eight suites MUST have an entry; see gate.ts's config-load
   * validation. */
  perSuiteMinCorrectRate: Record<EvalSuiteId, number>;
}
