// APP-024 (#136): SPEC-APP.md §14's per-tier numeric targets, pinned
// exactly against the spec table (the "reference" this cross-checks
// against), including each row's stated inclusivity:
//   - "< N s/ms"  -> strict less-than (TTFT warm/cold, peak RAM, query
//     embedding, and APP-033's own "p95 retrieval < 50ms" AC)
//   - "≥ N tok/s" -> inclusive greater-or-equal (decode speed)
// Boundary tests below assert exactly-at-threshold behavior for BOTH
// comparison directions — the kind of off-by-one that's easy to get wrong
// silently.

import {
  metricMeetsTarget,
  checkTargets,
  TARGETS_BY_TIER,
  RETRIEVAL_P95_TARGET_MS,
} from '../targets';
import type { BenchmarkMetrics } from '../types';

function measured(value: number) {
  return { status: 'measured' as const, value };
}
function notRun(reason = 'no client injected') {
  return { status: 'not-run' as const, reason };
}

const ALL_PASS_1_7B: BenchmarkMetrics = {
  decodeTokensPerSec: measured(12),
  prefillTokensPerSec: measured(500), // diagnostic only, never gated
  ttftWarmMs: measured(2500),
  ttftColdMs: measured(7000),
  queryEmbeddingLatencyMs: measured(250),
  retrievalP95Ms: measured(40),
  peakRamMb: measured(2000),
};

describe('TARGETS_BY_TIER (SPEC-APP.md §14)', () => {
  it('pins the exact 1.7B tier targets', () => {
    expect(TARGETS_BY_TIER['1.7B']).toEqual({
      ttftWarmMs: { compare: 'lt', threshold: 3000 },
      ttftColdMs: { compare: 'lt', threshold: 8000 },
      decodeTokensPerSec: { compare: 'gte', threshold: 10 },
      peakRamMb: { compare: 'lt', threshold: 2500 },
      queryEmbeddingLatencyMs: { compare: 'lt', threshold: 300 },
    });
  });

  it('pins the exact 0.6B tier targets', () => {
    expect(TARGETS_BY_TIER['0.6B']).toEqual({
      ttftWarmMs: { compare: 'lt', threshold: 2000 },
      ttftColdMs: { compare: 'lt', threshold: 5000 },
      decodeTokensPerSec: { compare: 'gte', threshold: 18 },
      peakRamMb: { compare: 'lt', threshold: 1400 },
      queryEmbeddingLatencyMs: { compare: 'lt', threshold: 300 },
    });
  });

  it('pins the APP-033 retrieval p95 target (tier-independent)', () => {
    expect(RETRIEVAL_P95_TARGET_MS).toEqual({ compare: 'lt', threshold: 50 });
  });
});

describe('metricMeetsTarget boundary behavior', () => {
  it("'lt' target: exactly at threshold FAILS (strict less-than)", () => {
    expect(metricMeetsTarget(3000, { compare: 'lt', threshold: 3000 })).toBe(
      false,
    );
  });

  it("'lt' target: just under threshold PASSES", () => {
    expect(metricMeetsTarget(2999.99, { compare: 'lt', threshold: 3000 })).toBe(
      true,
    );
  });

  it("'lt' target: just over threshold FAILS", () => {
    expect(metricMeetsTarget(3000.01, { compare: 'lt', threshold: 3000 })).toBe(
      false,
    );
  });

  it("'gte' target: exactly at threshold PASSES (inclusive)", () => {
    expect(metricMeetsTarget(10, { compare: 'gte', threshold: 10 })).toBe(true);
  });

  it("'gte' target: just under threshold FAILS", () => {
    expect(metricMeetsTarget(9.99, { compare: 'gte', threshold: 10 })).toBe(
      false,
    );
  });

  it("'gte' target: just over threshold PASSES", () => {
    expect(metricMeetsTarget(10.01, { compare: 'gte', threshold: 10 })).toBe(
      true,
    );
  });
});

describe('checkTargets', () => {
  it("reports allMet: true when every gated metric passes its tier's target", () => {
    const result = checkTargets(ALL_PASS_1_7B, '1.7B');
    expect(result.allMet).toBe(true);
    expect(result.unmetMetrics).toEqual([]);
  });

  it('excludes prefillTokensPerSec from gating (§14 has no independent target row for it)', () => {
    const withAbsurdPrefill: BenchmarkMetrics = {
      ...ALL_PASS_1_7B,
      prefillTokensPerSec: measured(0.001),
    };
    const result = checkTargets(withAbsurdPrefill, '1.7B');
    expect(result.allMet).toBe(true);
    // Exactly the six gated metrics (everything except prefillTokensPerSec)
    // are checked — an absurdly slow prefill number never even appears.
    expect(result.checks).toHaveLength(6);
    const checkedMetricNames: string[] = result.checks.map(c => c.metric);
    expect(checkedMetricNames).not.toContain('prefillTokensPerSec');
  });

  it('a not-run metric counts as unmet — an unmeasured metric can never be confirmed to meet its target', () => {
    const withNotRunRam: BenchmarkMetrics = {
      ...ALL_PASS_1_7B,
      peakRamMb: notRun('no RAM sampler wired'),
    };
    const result = checkTargets(withNotRunRam, '1.7B');
    expect(result.allMet).toBe(false);
    expect(result.unmetMetrics).toContain('peakRamMb');
    expect(result.checks.find(c => c.metric === 'peakRamMb')?.status).toBe(
      'not-run',
    );
  });

  it('a measured metric that fails its target is reported unmet', () => {
    const withSlowTtft: BenchmarkMetrics = {
      ...ALL_PASS_1_7B,
      ttftWarmMs: measured(3000),
    }; // exactly at bound, strict lt fails
    const result = checkTargets(withSlowTtft, '1.7B');
    expect(result.allMet).toBe(false);
    expect(result.unmetMetrics).toEqual(['ttftWarmMs']);
  });

  it('the same metrics can pass the 1.7B tier but fail the stricter 0.6B decode floor', () => {
    const decode12: BenchmarkMetrics = {
      ...ALL_PASS_1_7B,
      decodeTokensPerSec: measured(12),
    };
    expect(checkTargets(decode12, '1.7B').allMet).toBe(true);
    const result06 = checkTargets(decode12, '0.6B');
    expect(result06.allMet).toBe(false);
    expect(result06.unmetMetrics).toContain('decodeTokensPerSec');
  });

  it('gates retrievalP95Ms against the fixed APP-033 50ms bound regardless of tier', () => {
    const slowRetrieval: BenchmarkMetrics = {
      ...ALL_PASS_1_7B,
      retrievalP95Ms: measured(50),
    }; // strict lt fails at exactly 50
    expect(checkTargets(slowRetrieval, '1.7B').unmetMetrics).toContain(
      'retrievalP95Ms',
    );
    expect(checkTargets(slowRetrieval, '0.6B').unmetMetrics).toContain(
      'retrievalP95Ms',
    );
  });
});
