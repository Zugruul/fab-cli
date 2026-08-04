// APP-024 (#136): pinned percentile convention for the on-device benchmark
// protocol. Nearest-rank method (rank = ceil(p/100 * n), 1-indexed into
// values sorted ascending) — the SAME formula already load-bearing in
// ../../retrieval/__tests__/perf.test.ts (`Math.ceil(0.95 * n) - 1`,
// clamped), chosen there for the identical reason: a latency percentile
// should be an actually-observed sample, not an interpolated value between
// two samples. See ../percentile.ts's doc comment for the full rationale.
//
// Domain-boundary cases pinned here per the dev-brain lesson on percentile/
// aggregation math: n=1, n=2, all-identical (ties), an outlier, and both
// ends (p=0, p=100).

import { percentile } from "../percentile";

describe("percentile (nearest-rank method)", () => {
  it("returns the only value for n=1, regardless of p", () => {
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 100)).toBe(42);
  });

  it("n=2: p50 picks the lower sample, p95 picks the upper sample (nearest-rank, not interpolated)", () => {
    expect(percentile([10, 20], 50)).toBe(10); // rank = ceil(0.5*2) = 1 -> sorted[0]
    expect(percentile([10, 20], 95)).toBe(20); // rank = ceil(0.95*2) = 2 -> sorted[1]
  });

  it("all-identical values (ties) return that value at any percentile", () => {
    expect(percentile([5, 5, 5, 5], 95)).toBe(5);
    expect(percentile([5, 5, 5, 5], 50)).toBe(5);
  });

  it("a single high outlier dominates p95 at small n (known nearest-rank property, not a bug)", () => {
    // rank = ceil(0.95*5) = 5 -> sorted[4] = 100
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
  });

  it("sorts unsorted input internally without mutating the caller's array", () => {
    const input = [100, 1, 50];
    const copy = [...input];
    expect(percentile(input, 50)).toBe(50); // sorted: [1,50,100], rank=ceil(1.5)=2 -> sorted[1]
    expect(input).toEqual(copy);
  });

  it("p=0 returns the minimum sample", () => {
    expect(percentile([3, 1, 2], 0)).toBe(1);
  });

  it("p=100 returns the maximum sample", () => {
    expect(percentile([3, 1, 2], 100)).toBe(3);
  });

  it("throws on an empty array — a percentile of zero samples is undefined, never fabricated", () => {
    expect(() => percentile([], 95)).toThrow();
  });

  it("matches the exact formula pinned in retrieval/__tests__/perf.test.ts for a larger sample", () => {
    const values = Array.from({ length: 30 }, (_, i) => i + 1); // 1..30
    const sorted = [...values].sort((a, b) => a - b);
    const expectedIndex = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
    expect(percentile(values, 95)).toBe(sorted[expectedIndex]);
  });
});
