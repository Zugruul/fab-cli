import { z } from "zod";
import { ModelPackTierSchema } from "./tiers.js";

/**
 * On-device benchmark protocol results (SPEC-APP.md §8.6, §10.2, §14;
 * APP-024 issue #136). Recorded per completed device run — embedded as an
 * OPTIONAL field on ModelPackManifest (see modelPack.ts), not required the
 * way evalScores is (§13 invariant 8 explicitly gates release on the eval
 * suites; it says nothing equivalent for the benchmark protocol). The
 * "one full recorded run per tier" leg of APP-024's own AC needs the
 * TestFlight app running on the physical floor devices plus production
 * model packs, both of which land separately (tracked on #136) — a
 * ModelPackManifest assembled before that run exists must keep validating
 * (pipeline/src/publish/modelPackAssembler.ts, untouched by this task), so
 * a manifest legitimately omits this field rather than carrying a
 * fabricated device-run record.
 *
 * Every named §8.6 metric supports an honest "not-run" state — a missing
 * real client or native capability (e.g. no on-device RAM sampler; see
 * fab-app/src/benchmark/runner.ts's doc comment for exactly why RAM peak
 * has no default implementation yet) — instead of a fabricated number.
 */

const MeasuredMetricShape = z.discriminatedUnion("status", [
  z.object({ status: z.literal("measured"), value: z.number().finite() }),
  z.object({ status: z.literal("not-run"), reason: z.string().min(1) }),
]);
export type MeasuredMetric = z.infer<typeof MeasuredMetricShape>;

/**
 * The exact §8.6 metric set, plus retrieval p95 — cited by APP-033's own
 * acceptance criterion ("p95 retrieval < 50ms") and folded into APP-024's
 * protocol per BACKLOG-APP.md's APP-024 row, even though §8.6's own bullet
 * list doesn't separately name it. prefillTokensPerSec is measured "at the
 * specified retrieval token budget" per §8.6 but has no independent §14
 * target row of its own — see fab-app/src/benchmark/targets.ts.
 */
export const BenchmarkMetricsSchema = z.object({
  decodeTokensPerSec: MeasuredMetricShape,
  prefillTokensPerSec: MeasuredMetricShape,
  ttftWarmMs: MeasuredMetricShape,
  ttftColdMs: MeasuredMetricShape,
  queryEmbeddingLatencyMs: MeasuredMetricShape,
  retrievalP95Ms: MeasuredMetricShape,
  peakRamMb: MeasuredMetricShape,
});
export type BenchmarkMetrics = z.infer<typeof BenchmarkMetricsSchema>;

/**
 * SPEC-APP.md §10.2's fallback ladder, in order: reduced retrieval budget
 * -> tier downgrade -> relaxed target (recorded, never silently shipped).
 */
export const FALLBACK_LADDER_STEPS = ["reduced-retrieval-budget", "tier-downgrade", "relaxed-target"] as const;
export const FallbackLadderStepSchema = z.enum(FALLBACK_LADDER_STEPS);
export type FallbackLadderStep = z.infer<typeof FallbackLadderStepSchema>;

const FallbackLadderDecisionShape = z.object({
  targetsMet: z.boolean(),
  /** Which §10.2 ladder step was applied — REQUIRED when targetsMet is
   * false (enforced below) and FORBIDDEN when targetsMet is true (nothing
   * needed fallback). */
  stepApplied: FallbackLadderStepSchema.optional(),
  /** §14 metric ids that failed their target (or were not-run, which also
   * can't be confirmed to meet a target) — empty when targetsMet is true. */
  unmetMetrics: z.array(z.string()).default([]),
  notes: z.string().min(1),
});
export const FallbackLadderDecisionSchema = FallbackLadderDecisionShape.superRefine((decision, ctx) => {
  if (!decision.targetsMet && decision.stepApplied === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["stepApplied"],
      message:
        "stepApplied is required when targetsMet is false — SPEC-APP.md §10.2 never ships a missed target without recording which fallback-ladder step was applied",
    });
  }
  if (decision.targetsMet && decision.stepApplied !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["stepApplied"],
      message: "stepApplied must be omitted when targetsMet is true — no fallback-ladder step was needed",
    });
  }
});
export type FallbackLadderDecision = z.infer<typeof FallbackLadderDecisionShape>;

export const BenchmarkDeviceSchema = z.object({
  model: z.string().min(1),
  osVersion: z.string().min(1),
});
export type BenchmarkDevice = z.infer<typeof BenchmarkDeviceSchema>;

const BenchmarkResultShape = z.object({
  schemaVersion: z.string().min(1),
  tier: ModelPackTierSchema,
  device: BenchmarkDeviceSchema,
  appVersion: z.string().min(1),
  buildNumber: z.string().min(1),
  iterations: z.number().int().positive(),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  metrics: BenchmarkMetricsSchema,
  fallbackLadderDecision: FallbackLadderDecisionSchema,
});
export const BenchmarkResultSchema = BenchmarkResultShape.superRefine((result, ctx) => {
  const started = Date.parse(result.startedAt);
  const completed = Date.parse(result.completedAt);
  if (Number.isNaN(started)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["startedAt"], message: "startedAt must be a parseable timestamp" });
  }
  if (Number.isNaN(completed)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "completedAt must be a parseable timestamp" });
  }
  if (!Number.isNaN(started) && !Number.isNaN(completed) && completed < started) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["completedAt"],
      message: "completedAt must not be before startedAt",
    });
  }
});
export type BenchmarkResult = z.infer<typeof BenchmarkResultShape>;
