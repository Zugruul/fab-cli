/**
 * Maps an EvalRunSummary to the shape @fab/manifest-schema's
 * ModelPackManifestSchema.evalScores expects (SPEC-APP.md §7.11: "no lane
 * invents its own manifest shape" — this is the one place pipeline/
 * converts its internal EvalRunSummary into the shared package's shape).
 */
import type { EvalScores } from "@fab/manifest-schema";
import type { EvalRunSummary } from "./types.js";

export function toManifestEvalScores(summary: EvalRunSummary): EvalScores {
  return {
    runAt: summary.runAt,
    suites: summary.suites.map((suite) => ({
      suiteId: suite.suiteId,
      counts: { ...suite.counts },
      score: suite.score,
    })),
  };
}
