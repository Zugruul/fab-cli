// APP-024 (#136): maps a completed BenchmarkRunResult (this module's own
// domain type, ./types.ts) plus its already-computed FallbackLadderDecision
// (./fallbackLadder.ts, SPEC-APP.md §10.2) into exactly the shape
// @fab/manifest-schema's BenchmarkResultSchema expects for the release
// manifest — the "release-manifest integration" point APP-024's brief
// calls for. Field names are carried through verbatim (no renaming) since
// E4's latency ACs will cite these names directly; this function's only
// job is schema validation, never reshaping.

import { validateBenchmarkResult } from '@fab/manifest-schema';
import type {
  BenchmarkResult,
  FallbackLadderDecision,
  ValidationIssue,
} from '@fab/manifest-schema';
import type { BenchmarkRunResult } from './types';

const SCHEMA_VERSION = '0.1.0';

export type MapBenchmarkResultOutcome =
  | { success: true; manifestRecord: BenchmarkResult }
  | { success: false; errors: ValidationIssue[] };

export function toManifestBenchmarkResult(
  runResult: BenchmarkRunResult,
  fallbackLadderDecision: FallbackLadderDecision,
): MapBenchmarkResultOutcome {
  const candidate = {
    schemaVersion: SCHEMA_VERSION,
    tier: runResult.tier,
    device: runResult.device,
    appVersion: runResult.appVersion,
    buildNumber: runResult.buildNumber,
    iterations: runResult.iterations,
    startedAt: runResult.startedAt,
    completedAt: runResult.completedAt,
    metrics: runResult.metrics,
    fallbackLadderDecision,
  };

  const result = validateBenchmarkResult(candidate);
  if (!result.success) {
    return { success: false, errors: result.errors };
  }
  return { success: true, manifestRecord: result.data };
}
