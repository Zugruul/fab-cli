// APP-024 (#136): the release-manifest integration point. Maps a completed
// BenchmarkRunResult (this module's domain type) + its FallbackLadderDecision
// into exactly what @fab/manifest-schema's BenchmarkResultSchema expects —
// proving field names carry through unchanged (E4's latency ACs will cite
// them by name) and that an invalid combination is rejected, never
// silently written.

import { toManifestBenchmarkResult } from '../manifestMapping';
import type { BenchmarkRunResult } from '../types';
import type { FallbackLadderDecision } from '@fab/manifest-schema';

const VALID_RUN_RESULT: BenchmarkRunResult = {
  tier: '1.7B',
  device: { model: 'iPhone 13 Pro', osVersion: 'iOS 17.5.1' },
  appVersion: '1.0.0',
  buildNumber: '42',
  iterations: 30,
  startedAt: '2026-08-01T10:00:00.000Z',
  completedAt: '2026-08-01T10:04:12.000Z',
  metrics: {
    decodeTokensPerSec: { status: 'measured', value: 12.4 },
    prefillTokensPerSec: { status: 'measured', value: 340.2 },
    ttftWarmMs: { status: 'measured', value: 2100 },
    ttftColdMs: { status: 'measured', value: 6800 },
    queryEmbeddingLatencyMs: { status: 'measured', value: 180 },
    retrievalP95Ms: { status: 'measured', value: 38 },
    peakRamMb: {
      status: 'not-run',
      reason: 'no on-device RAM sampler wired yet',
    },
  },
};

describe('toManifestBenchmarkResult', () => {
  it('maps a valid run result + decision into a schema-valid manifest record, fields carried through verbatim', () => {
    const decision: FallbackLadderDecision = {
      targetsMet: true,
      unmetMetrics: [],
      notes: 'all measured §14 targets met',
    };
    const outcome = toManifestBenchmarkResult(VALID_RUN_RESULT, decision);
    if (!outcome.success) {
      throw new Error(
        `schema validation failed: ${JSON.stringify(outcome.errors, null, 2)}`,
      );
    }
    expect(outcome.success).toBe(true);
    if (outcome.success) {
      expect(outcome.manifestRecord.tier).toBe(VALID_RUN_RESULT.tier);
      expect(outcome.manifestRecord.device).toEqual(VALID_RUN_RESULT.device);
      expect(outcome.manifestRecord.appVersion).toBe(
        VALID_RUN_RESULT.appVersion,
      );
      expect(outcome.manifestRecord.buildNumber).toBe(
        VALID_RUN_RESULT.buildNumber,
      );
      expect(outcome.manifestRecord.iterations).toBe(
        VALID_RUN_RESULT.iterations,
      );
      expect(outcome.manifestRecord.startedAt).toBe(VALID_RUN_RESULT.startedAt);
      expect(outcome.manifestRecord.completedAt).toBe(
        VALID_RUN_RESULT.completedAt,
      );
      expect(outcome.manifestRecord.metrics).toEqual(VALID_RUN_RESULT.metrics);
      expect(outcome.manifestRecord.fallbackLadderDecision).toEqual(decision);
    }
  });

  it('returns success: false with schema errors for an invalid combination (completedAt before startedAt), never throwing', () => {
    const badRunResult: BenchmarkRunResult = {
      ...VALID_RUN_RESULT,
      startedAt: '2026-08-01T10:04:12.000Z',
      completedAt: '2026-08-01T10:00:00.000Z',
    };
    const decision: FallbackLadderDecision = {
      targetsMet: true,
      unmetMetrics: [],
      notes: 'x',
    };
    const outcome = toManifestBenchmarkResult(badRunResult, decision);
    expect(outcome.success).toBe(false);
    if (!outcome.success) {
      expect(outcome.errors.length).toBeGreaterThan(0);
      expect(outcome.errors.some(e => e.path.join('.') === 'completedAt')).toBe(
        true,
      );
    }
  });

  it('propagates an unmet-targets decision through to the mapped record', () => {
    const decision: FallbackLadderDecision = {
      targetsMet: false,
      stepApplied: 'reduced-retrieval-budget',
      unmetMetrics: ['ttftWarmMs'],
      notes: 'reduced budget to hit warm TTFT target',
    };
    const outcome = toManifestBenchmarkResult(VALID_RUN_RESULT, decision);
    if (!outcome.success) {
      throw new Error(
        `schema validation failed: ${JSON.stringify(outcome.errors, null, 2)}`,
      );
    }
    expect(outcome.success).toBe(true);
    if (outcome.success) {
      expect(outcome.manifestRecord.fallbackLadderDecision).toEqual(decision);
    }
  });
});
