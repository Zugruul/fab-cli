// APP-024 (#136): SPEC-APP.md §14's per-tier numeric targets, pinned
// exactly against the spec table (the reference this cross-checks
// against), preserving each row's stated inclusivity:
//   "< N s/ms"  -> strict less-than  (TTFT warm/cold, peak RAM, query
//                  embedding, and APP-033's own "p95 retrieval < 50ms" AC)
//   "≥ N tok/s" -> inclusive gte     (decode speed)
//
// prefillTokensPerSec is measured (§8.6: "prefill tokens/sec at the
// specified retrieval token budget") but has NO independent §14 target
// row — it's a diagnostic input that determines whether the TTFT targets
// are reachable, not itself individually gated. checkTargets below
// deliberately excludes it from the pass/fail set for that reason.

import type { ModelPackTier } from '@fab/manifest-schema';
import type { BenchmarkMetrics } from './types';

export interface MetricTarget {
  compare: 'lt' | 'gte';
  threshold: number;
}

export interface TierTargets {
  ttftWarmMs: MetricTarget;
  ttftColdMs: MetricTarget;
  decodeTokensPerSec: MetricTarget;
  peakRamMb: MetricTarget;
  queryEmbeddingLatencyMs: MetricTarget;
}

export const TARGETS_BY_TIER: Record<ModelPackTier, TierTargets> = {
  '1.7B': {
    ttftWarmMs: { compare: 'lt', threshold: 3000 },
    ttftColdMs: { compare: 'lt', threshold: 8000 },
    decodeTokensPerSec: { compare: 'gte', threshold: 10 },
    peakRamMb: { compare: 'lt', threshold: 2500 },
    queryEmbeddingLatencyMs: { compare: 'lt', threshold: 300 },
  },
  '0.6B': {
    ttftWarmMs: { compare: 'lt', threshold: 2000 },
    ttftColdMs: { compare: 'lt', threshold: 5000 },
    decodeTokensPerSec: { compare: 'gte', threshold: 18 },
    peakRamMb: { compare: 'lt', threshold: 1400 },
    queryEmbeddingLatencyMs: { compare: 'lt', threshold: 300 },
  },
};

/** APP-033's own AC ("p95 retrieval < 50ms") — tier-independent (a
 * device/algorithm bound, not one of §14's per-tier rows). */
export const RETRIEVAL_P95_TARGET_MS: MetricTarget = {
  compare: 'lt',
  threshold: 50,
};

export function metricMeetsTarget(
  value: number,
  target: MetricTarget,
): boolean {
  return target.compare === 'lt'
    ? value < target.threshold
    : value >= target.threshold;
}

export type GatedMetric =
  | 'ttftWarmMs'
  | 'ttftColdMs'
  | 'decodeTokensPerSec'
  | 'peakRamMb'
  | 'queryEmbeddingLatencyMs'
  | 'retrievalP95Ms';

export interface MetricCheck {
  metric: GatedMetric;
  status: 'met' | 'unmet' | 'not-run';
}

export interface TargetCheckResult {
  allMet: boolean;
  checks: MetricCheck[];
  /** Metric ids that failed their target OR were not-run — an unmeasured
   * metric can never be confirmed to meet its target, so it counts as
   * unmet too (never silently treated as a pass). */
  unmetMetrics: GatedMetric[];
}

export function checkTargets(
  metrics: BenchmarkMetrics,
  tier: ModelPackTier,
): TargetCheckResult {
  const tierTargets = TARGETS_BY_TIER[tier];
  const specs: { key: GatedMetric; target: MetricTarget }[] = [
    { key: 'ttftWarmMs', target: tierTargets.ttftWarmMs },
    { key: 'ttftColdMs', target: tierTargets.ttftColdMs },
    { key: 'decodeTokensPerSec', target: tierTargets.decodeTokensPerSec },
    { key: 'peakRamMb', target: tierTargets.peakRamMb },
    {
      key: 'queryEmbeddingLatencyMs',
      target: tierTargets.queryEmbeddingLatencyMs,
    },
    { key: 'retrievalP95Ms', target: RETRIEVAL_P95_TARGET_MS },
  ];

  const checks: MetricCheck[] = specs.map(({ key, target }) => {
    const metric = metrics[key];
    if (metric.status === 'not-run') {
      return { metric: key, status: 'not-run' };
    }
    return {
      metric: key,
      status: metricMeetsTarget(metric.value, target) ? 'met' : 'unmet',
    };
  });

  const unmetMetrics = checks
    .filter(c => c.status !== 'met')
    .map(c => c.metric);
  return { allMet: unmetMetrics.length === 0, checks, unmetMetrics };
}
