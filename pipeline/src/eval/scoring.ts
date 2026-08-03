/**
 * Trichotomy scoring math (SPEC-APP.md §8.3): aggregates a suite's
 * per-item verdicts into counts + an asymmetric-penalty-weighted score.
 * Pure, deterministic, no I/O — mirrors dataset/manifest.ts's
 * count-aggregation style.
 */
import type { EvalCounts, EvalSuiteId, ItemResult, PenaltyWeights, SuiteResult, Verdict } from "./types.js";

const EMPTY_COUNTS: EvalCounts = { correct: 0, incorrect: 0, abstained: 0 };

export function countVerdicts(itemResults: readonly ItemResult[]): EvalCounts {
  const counts: EvalCounts = { ...EMPTY_COUNTS };
  for (const r of itemResults) counts[r.verdict]++;
  return counts;
}

/**
 * §8.3's asymmetric penalty-weighted score: a plain weighted average over
 * every item's verdict, using `weights` from committed config
 * (pipeline/config/eval-harness.json) — never a code constant. Returns 0
 * for zero items (there's nothing to average) rather than NaN; callers
 * (suite building) are expected to never emit a zero-item suite in the
 * first place — see suites/registry.ts.
 */
export function computeScore(itemResults: readonly ItemResult[], weights: PenaltyWeights): number {
  if (itemResults.length === 0) return 0;
  const weightFor: Record<Verdict, number> = {
    correct: weights.correct,
    incorrect: weights.incorrect,
    abstained: weights.abstained,
  };
  const sum = itemResults.reduce((acc, r) => acc + weightFor[r.verdict], 0);
  return sum / itemResults.length;
}

export function buildSuiteResult(
  suiteId: EvalSuiteId,
  itemResults: readonly ItemResult[],
  weights: PenaltyWeights,
): SuiteResult {
  return {
    suiteId,
    counts: countVerdicts(itemResults),
    score: computeScore(itemResults, weights),
    itemResults: [...itemResults],
  };
}

/** correct / total, ignoring abstained/incorrect — the "coverage" figure
 * SPEC-APP.md §8.5(b)'s per-suite minimum-correct floor checks against
 * ("so an always-abstaining model fails" — an all-abstain suite has
 * correctRate 0, not something a penalty-weighted score alone guarantees
 * catches if penalties are tuned generously). */
export function correctRate(counts: EvalCounts): number {
  const total = counts.correct + counts.incorrect + counts.abstained;
  return total === 0 ? 0 : counts.correct / total;
}

/** incorrect / total — SPEC-APP.md §8.5(a)'s "near-zero incorrect on
 * adjudication-critical categories" threshold input. */
export function incorrectRate(counts: EvalCounts): number {
  const total = counts.correct + counts.incorrect + counts.abstained;
  return total === 0 ? 0 : counts.incorrect / total;
}
