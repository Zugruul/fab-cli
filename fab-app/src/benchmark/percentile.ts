// APP-024 (#136): percentile convention for the on-device benchmark
// protocol — the NEAREST-RANK method: rank = ceil(p/100 * n), 1-indexed
// into values sorted ascending, clamped into [0, n-1]. This is the SAME
// formula already load-bearing in
// ../retrieval/__tests__/perf.test.ts (`Math.ceil(0.95 * n) - 1`, clamped
// via Math.min) — cross-checked against that existing, already-shipped
// pin rather than an abstract definition, so this module and the
// retrieval engine's own perf smoke test agree on what "p95" means.
//
// Chosen over linear interpolation (e.g. Excel's PERCENTILE.INC) because a
// latency percentile reported here should be an ACTUALLY-OBSERVED sample,
// not a value invented by interpolating between two real ones — the same
// reasoning k6/Gatling/JMeter use for their default percentile
// aggregation. A known, intentional property of nearest-rank at small n:
// p95 of very few samples collapses toward the max (see the outlier test
// in __tests__/percentile.test.ts) — that's expected, not a bug.

export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    throw new Error('percentile: cannot compute a percentile of zero samples');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}
