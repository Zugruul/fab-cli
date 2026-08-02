/**
 * Deterministic seeded PRNG (mulberry32) — the same seed always produces
 * the same sequence, so every builder that samples (distractor selection,
 * abstention context selection) is reproducible given a config seed
 * (SPEC-APP.md APP-013 AC: "two seeded runs byte-identical"). Not
 * cryptographic — this is dataset-construction determinism, not security.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle, non-mutating — consumes one `rng()` call per swap. */
export function shuffle<T>(items: T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Deterministic sample of `n` items without replacement (n clamped to
 * `items.length`) — a partial Fisher-Yates over a copy of `items`. */
export function sampleWithoutReplacement<T>(items: T[], n: number, rng: () => number): T[] {
  const arr = [...items];
  const count = Math.min(n, arr.length);
  const picked: T[] = [];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
    picked.push(arr[i]);
  }
  return picked;
}
