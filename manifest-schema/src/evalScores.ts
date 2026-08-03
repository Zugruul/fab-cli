import { z } from "zod";

/**
 * SPEC-APP.md §8.4's eight eval suites, verbatim (APP-022). This is the
 * single canonical list — pipeline/src/eval (the harness, #134) imports
 * `EVAL_SUITE_IDS`/`EvalSuiteId` from here rather than redeclaring them,
 * per §7.11 ("no lane invents its own manifest shape").
 */
export const EVAL_SUITE_IDS = [
  "adjudication-critical",
  "interactions",
  "lore",
  "citation-validity",
  "abstention-quality",
  "ood-rejection",
  "distractor-robustness",
  "human-authored-adjudication",
] as const;
export const EvalSuiteIdSchema = z.enum(EVAL_SUITE_IDS);
export type EvalSuiteId = z.infer<typeof EvalSuiteIdSchema>;

/** Per-item trichotomy outcome (SPEC-APP.md §8.3): every eval item lands in
 * exactly one of these three buckets. */
export const EvalCountsSchema = z.object({
  correct: z.number().int().nonnegative(),
  incorrect: z.number().int().nonnegative(),
  abstained: z.number().int().nonnegative(),
});
export type EvalCounts = z.infer<typeof EvalCountsSchema>;

const EvalSuiteScoreShape = z.object({
  suiteId: EvalSuiteIdSchema,
  counts: EvalCountsSchema,
  /** Asymmetric-penalty-weighted aggregate (SPEC-APP.md §8.3: "incorrect ≫
   * abstain") — see pipeline/src/eval/scoring.ts for the math. Penalty
   * weights themselves live in committed pipeline config, not here; this
   * field just carries the resulting number so §8.5(c) regression
   * comparison has something to compare against the previous release. */
  score: z.number().finite(),
});

/**
 * One suite's result within a model release's eval run. A suite reporting
 * zero graded items is rejected outright — SPEC-APP.md §13 invariant 8
 * requires every named suite to be "green", which presupposes it actually
 * ran against real items; a vacuous zero-item suite would let a broken
 * harness wiring silently "pass" a suite it never evaluated.
 */
export const EvalSuiteScoreSchema = EvalSuiteScoreShape.superRefine((suite, ctx) => {
  const itemCount = suite.counts.correct + suite.counts.incorrect + suite.counts.abstained;
  if (itemCount <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["counts"],
      message: `suite "${suite.suiteId}" reports zero graded items — a suite must grade at least one item to report a score (SPEC-APP.md §13 invariant 8)`,
    });
  }
});
export type EvalSuiteScore = z.infer<typeof EvalSuiteScoreShape>;

const EvalScoresShape = z.object({
  /** ISO 8601 timestamp of when this eval run completed. */
  runAt: z.string().min(1),
  suites: z.array(EvalSuiteScoreSchema).min(1),
});

/**
 * The full per-suite eval-scores record a model release manifest carries
 * (SPEC-APP.md §13 invariant 8 / §8.5). Two invariants enforced here,
 * beyond individual suite shape:
 *  - no duplicate suiteId (a suite reported twice is always a bug, never
 *    legitimate — which run would a consumer trust?);
 *  - every one of the eight canonical EVAL_SUITE_IDS must be present —
 *    invariant 8 requires ALL named suites to be green before release, so
 *    a manifest that only reports a subset is not a valid release record.
 */
export const EvalScoresSchema = EvalScoresShape.superRefine((evalScores, ctx) => {
  const seen = new Set<string>();
  evalScores.suites.forEach((suite, i) => {
    if (seen.has(suite.suiteId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["suites", i, "suiteId"],
        message: `duplicate suiteId "${suite.suiteId}" — each suite must be reported at most once per eval run`,
      });
    }
    seen.add(suite.suiteId);
  });

  const missing = EVAL_SUITE_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["suites"],
      message: `missing required suite(s): ${missing.join(", ")} — SPEC-APP.md §13 invariant 8 requires every named suite to report a score before a model ships`,
    });
  }
});
export type EvalScores = z.infer<typeof EvalScoresShape>;
