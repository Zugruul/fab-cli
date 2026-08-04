/**
 * Coverage-driven card selection (#268): a drop-in alternative to
 * paramStream.ts's `sampleWithoutReplacement` for picking which cards go
 * into a composite. Where `sampleWithoutReplacement` draws uniformly at
 * random (coupon-collector — some printings may never appear even after
 * tens of thousands of composites), this tracker always offers up the
 * GLOBALLY least-appeared-so-far printing(s) first, so a run's total
 * placement budget is spent closing the coverage gap rather than being
 * wasted on printings that have already appeared many times.
 *
 * Determinism + draw-shape contract (SPEC-APP.md APP-026, paramStream.ts's
 * header): `pickForComposite(count, rng)` consumes EXACTLY `count` calls to
 * `rng()`, one per picked card, in order — the same shape as
 * `sampleWithoutReplacement(items, count, rng)` (see rng.ts: one `rng()`
 * call per Fisher-Yates swap). This is what lets paramStream.ts swap one
 * selection strategy for the other without changing how many rng() calls a
 * composite consumes, so every OTHER draw in the stream (background,
 * lighting, position, rotation, ...) lands identically regardless of which
 * strategy is active for a given seed (#268 AC: "toggling coverage mode
 * does not change unrelated draws").
 *
 * Implementation: a bucket-by-appearance-count structure (buckets[level] =
 * indices currently at that appearance count), each with O(1) amortized
 * insert/remove via swap-and-pop, plus a monotonically-advancing
 * `minLevel` pointer (a bucket, once emptied, is never revisited — every
 * item that was in it has moved to level+1 or higher). This makes a full
 * run over a 16k-item pool cheap: total work is O(totalPicks) rather than
 * O(totalPicks * poolSize), which a naive "filter the whole pool every
 * pick" approach would cost.
 *
 * Within-composite distinctness (no card repeated twice in the same
 * composite) falls out of the bucket mechanics for free: a picked item is
 * removed from its bucket immediately, so it cannot be re-offered to a
 * later pick in the SAME composite. Its new (incremented) bucket
 * placement is deferred until after all of that composite's picks are
 * taken (see the `pending` array in `pickForComposite`) purely so
 * `appearanceCountOf` mid-composite still reflects "appearances in
 * PREVIOUS composites" consistently — it has no effect on distinctness,
 * which the removal alone already guarantees.
 */

export class CoverageTracker {
  private readonly buckets: number[][];
  private readonly location: { level: number; pos: number }[];
  private minLevel = 0;
  private readonly poolSize: number;

  /** `poolSize` indices [0, poolSize) all start at appearance count 0. */
  constructor(poolSize: number) {
    if (!Number.isInteger(poolSize) || poolSize < 0) {
      throw new Error(`CoverageTracker: poolSize must be a non-negative integer (got ${poolSize})`);
    }
    this.poolSize = poolSize;
    this.buckets = [[]];
    this.location = new Array(poolSize);
    for (let i = 0; i < poolSize; i++) {
      this.buckets[0].push(i);
      this.location[i] = { level: 0, pos: i };
    }
  }

  private removeAt(idx: number): number {
    const { level, pos } = this.location[idx];
    const bucket = this.buckets[level];
    const last = bucket[bucket.length - 1];
    bucket[pos] = last;
    this.location[last] = { level, pos };
    bucket.pop();
    return level;
  }

  private addAt(idx: number, level: number): void {
    if (!this.buckets[level]) this.buckets[level] = [];
    this.buckets[level].push(idx);
    this.location[idx] = { level, pos: this.buckets[level].length - 1 };
  }

  private advanceMinLevel(): void {
    while (this.minLevel < this.buckets.length && this.buckets[this.minLevel].length === 0) this.minLevel++;
  }

  /**
   * Picks `count` DISTINCT pool indices for one composite, favoring the
   * globally least-appeared-so-far items first (ties broken by `rng()`,
   * mirroring semanticSelection.ts's `pickDeterministic` — never
   * Math.random). Consumes exactly `count` rng() calls, one per pick, even
   * if the pool is exhausted partway through (a defensive case that should
   * never occur when `count <= poolSize`, validated by callers) — the
   * caller's own count-vs-availableCards clamp is what actually prevents
   * this, matching sampleWithoutReplacement's own contract.
   */
  pickForComposite(count: number, rng: () => number): number[] {
    const pending: { idx: number; newLevel: number }[] = [];
    for (let i = 0; i < count; i++) {
      const draw01 = rng();
      this.advanceMinLevel();
      let level = this.minLevel;
      while (level < this.buckets.length && (!this.buckets[level] || this.buckets[level].length === 0)) level++;
      if (level >= this.buckets.length) break; // pool exhausted — see doc above
      const bucket = this.buckets[level];
      const pos = Math.min(bucket.length - 1, Math.floor(draw01 * bucket.length));
      const idx = bucket[pos];
      this.removeAt(idx);
      pending.push({ idx, newLevel: level + 1 });
    }
    for (const { idx, newLevel } of pending) this.addAt(idx, newLevel);
    return pending.map((p) => p.idx);
  }

  /** Current appearance count for pool index `idx` (0 if never picked). */
  appearanceCountOf(idx: number): number {
    return this.location[idx].level;
  }

  /** Appearance counts for every pool index, in index order. */
  allAppearanceCounts(): number[] {
    const out = new Array<number>(this.poolSize);
    for (let i = 0; i < this.poolSize; i++) out[i] = this.location[i].level;
    return out;
  }

  totalPoolSize(): number {
    return this.poolSize;
  }
}
