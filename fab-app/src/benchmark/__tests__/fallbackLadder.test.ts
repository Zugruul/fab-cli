// APP-024 (#136), SPEC-APP.md §10.2: "IF the target is unreachable on
// measured hardware THEN THE SYSTEM SHALL apply, in order: reduced
// retrieval budget -> tier downgrade -> relaxed target ... never silent
// shipping of a missed target."
//
// recordFallbackDecision does NOT auto-execute the ladder (re-measuring at
// a reduced budget or a downgraded tier is a real re-benchmark run, not a
// pure computation) — it records a decision that was already made, and
// enforces the "never silent" half of §10.2 at this API boundary: calling
// it with unmet targets and no resolution throws, and calling it with met
// targets and a resolution anyway (nothing needed fixing) also throws.

import { recordFallbackDecision } from '../fallbackLadder';
import { checkTargets } from '../targets';
import {
  validateBenchmarkResult,
  FALLBACK_LADDER_STEPS,
} from '@fab/manifest-schema';
import { validBenchmarkResult } from '@fab/manifest-schema';
import type { BenchmarkMetrics } from '../types';

function measured(value: number) {
  return { status: 'measured' as const, value };
}

const ALL_PASS_1_7B: BenchmarkMetrics = {
  decodeTokensPerSec: measured(12),
  prefillTokensPerSec: measured(500),
  ttftWarmMs: measured(2500),
  ttftColdMs: measured(7000),
  queryEmbeddingLatencyMs: measured(250),
  retrievalP95Ms: measured(40),
  peakRamMb: measured(2000),
};

const SLOW_TTFT_1_7B: BenchmarkMetrics = {
  ...ALL_PASS_1_7B,
  ttftWarmMs: measured(3500),
};

describe('recordFallbackDecision', () => {
  it('returns targetsMet: true with no stepApplied when every gated metric passes', () => {
    const check = checkTargets(ALL_PASS_1_7B, '1.7B');
    const decision = recordFallbackDecision(check);
    expect(decision.targetsMet).toBe(true);
    expect(decision.stepApplied).toBeUndefined();
    expect(decision.unmetMetrics).toEqual([]);
    expect(decision.notes.length).toBeGreaterThan(0);
  });

  it('throws if targets are met but a resolution is supplied anyway', () => {
    const check = checkTargets(ALL_PASS_1_7B, '1.7B');
    expect(() =>
      recordFallbackDecision(check, {
        stepApplied: 'reduced-retrieval-budget',
        notes: 'unnecessary',
      }),
    ).toThrow();
  });

  it('throws if targets are unmet and no resolution is supplied — never silent shipping of a missed target', () => {
    const check = checkTargets(SLOW_TTFT_1_7B, '1.7B');
    expect(() => recordFallbackDecision(check)).toThrow(/ttftWarmMs/);
  });

  it('records the supplied ladder step and carries the unmet metrics through when targets are unmet', () => {
    const check = checkTargets(SLOW_TTFT_1_7B, '1.7B');
    const decision = recordFallbackDecision(check, {
      stepApplied: 'reduced-retrieval-budget',
      notes: 'reduced budget to 512 tokens; TTFT warm now within target',
    });
    expect(decision.targetsMet).toBe(false);
    expect(decision.stepApplied).toBe('reduced-retrieval-budget');
    expect(decision.unmetMetrics).toEqual(['ttftWarmMs']);
    expect(decision.notes).toContain('reduced budget');
  });

  it('accepts every §10.2 ladder step as a valid resolution', () => {
    const check = checkTargets(SLOW_TTFT_1_7B, '1.7B');
    for (const step of FALLBACK_LADDER_STEPS) {
      const decision = recordFallbackDecision(check, {
        stepApplied: step,
        notes: `applied ${step}`,
      });
      expect(decision.stepApplied).toBe(step);
    }
  });

  it("round-trips through @fab/manifest-schema's BenchmarkResultSchema (never invents its own shape)", () => {
    const check = checkTargets(ALL_PASS_1_7B, '1.7B');
    const decision = recordFallbackDecision(check);
    const candidate = {
      ...validBenchmarkResult,
      fallbackLadderDecision: decision,
    };
    const result = validateBenchmarkResult(candidate);
    if (!result.success) {
      throw new Error(
        `schema validation failed: ${JSON.stringify(result.errors, null, 2)}`,
      );
    }
    expect(result.success).toBe(true);
  });
});
