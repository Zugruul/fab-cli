/**
 * A tiny, dependency-free LRU cache (#272). generate.ts's per-run decoded-
 * source-image cache used to be a bare `Map` that never evicted anything —
 * fine for a hundreds-of-composites run over a handful of distinct card
 * images, catastrophic for a coverage run over the full ~16k-printing
 * catalog: coverage mode deliberately visits nearly every distinct
 * printing, so that Map grew to hold ~16k decoded RGBA buffers (some
 * multiple megabytes each — a real card scan can decode to 1488x2079x4
 * bytes, ~12MB) for the ENTIRE run, never released. That was the dominant
 * driver of the measured ~11MB/composite unbounded growth (issue #272).
 *
 * Implementation: a `Map` whose iteration order IS insertion order, reused
 * as the recency order — `get` promotes a hit by deleting + re-inserting
 * it (moves it to the end), `set` evicts the first (oldest / least-
 * recently-used) entry when at capacity before inserting the new one.
 * O(1) amortized for both operations.
 */
export class LruCache<K, V> {
  private readonly capacity: number;
  private readonly map = new Map<K, V>();

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`LruCache: capacity must be a positive integer (got ${capacity})`);
    }
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    // Promote to most-recently-used: delete + re-insert moves it to the
    // end of the Map's (insertion-order) iteration.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      // Updating an existing key is also a "use" — promote it, don't grow.
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      const oldestKey = this.map.keys().next().value as K;
      this.map.delete(oldestKey);
    }
    this.map.set(key, value);
  }

  get size(): number {
    return this.map.size;
  }
}
