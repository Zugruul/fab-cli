/**
 * Regression comparison (SPEC-APP.md §8.5(c)): per-suite score vs the
 * previous released version's recorded score. Pure, no I/O — the caller
 * reads the previous release's ModelPackManifest.evalScores and passes
 * its suites in.
 */
import type { EvalSuiteId, SuiteResult } from "./types.js";

export interface PreviousSuiteScore {
  suiteId: EvalSuiteId;
  score: number;
}

export interface RegressionResult {
  suiteId: EvalSuiteId;
  previousScore: number;
  currentScore: number;
  regressed: boolean;
}

/**
 * A suite regresses when its current score is STRICTLY lower than the
 * previous release's recorded score for that suite — improvement or an
 * exact tie both pass (§8.5(c): "regresses vs the previous released
 * version" fails the gate; equal/better doesn't). A suite with no
 * previous record (first release to include it) is not comparable and is
 * omitted from the result — there is nothing to regress against.
 */
export function detectRegressions(
  current: readonly SuiteResult[],
  previous: readonly PreviousSuiteScore[],
): RegressionResult[] {
  const previousBySuite = new Map(previous.map((p) => [p.suiteId, p.score]));
  const results: RegressionResult[] = [];
  for (const suite of current) {
    const previousScore = previousBySuite.get(suite.suiteId);
    if (previousScore === undefined) continue;
    results.push({
      suiteId: suite.suiteId,
      previousScore,
      currentScore: suite.score,
      regressed: suite.score < previousScore,
    });
  }
  return results;
}

export function hasAnyRegression(results: readonly RegressionResult[]): boolean {
  return results.some((r) => r.regressed);
}
