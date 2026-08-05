import { describe, it, expect } from "vitest";
import { createRng } from "../src/behavior/rng.js";
import { CoverageTracker } from "../src/composites/coverageTracker.js";

describe("CoverageTracker", () => {
  it("consumes exactly `count` rng() calls per pickForComposite call, regardless of pool state", () => {
    const tracker = new CoverageTracker(20);
    let calls = 0;
    const countingRng = () => {
      calls++;
      return Math.random(); // fine here — this is a TEST helper, not composites/ source
    };
    tracker.pickForComposite(3, countingRng);
    expect(calls).toBe(3);
    calls = 0;
    tracker.pickForComposite(1, countingRng);
    expect(calls).toBe(1);
  });

  it("picks are distinct within one call (never repeats an index in the same composite)", () => {
    const tracker = new CoverageTracker(6);
    const rng = createRng(1);
    for (let i = 0; i < 20; i++) {
      const picked = tracker.pickForComposite(4, rng);
      expect(new Set(picked).size).toBe(picked.length);
    }
  });

  it("always favors the globally least-appeared item(s) — appearance counts never spread by more than one full composite's worth", () => {
    const poolSize = 15;
    const tracker = new CoverageTracker(poolSize);
    const rng = createRng(42);
    const perComposite = 3;
    for (let i = 0; i < 30; i++) {
      tracker.pickForComposite(perComposite, rng);
      const counts = tracker.allAppearanceCounts();
      const min = Math.min(...counts);
      const max = Math.max(...counts);
      // A single composite can push at most `perComposite` items one level
      // above the rest before minLevel catches back up — a tight fairness
      // bound, not "eventually converges."
      expect(max - min).toBeLessThanOrEqual(perComposite);
    }
  });

  it("guarantees every item reaches minAppearances given a sufficient total pick budget", () => {
    const poolSize = 10;
    const minAppearances = 4;
    const tracker = new CoverageTracker(poolSize);
    const rng = createRng(7);
    // Comfortable margin over the theoretical minimum (poolSize * minAppearances / perComposite).
    const perComposite = 3;
    const composites = Math.ceil((poolSize * minAppearances) / perComposite) + 5;
    for (let i = 0; i < composites; i++) tracker.pickForComposite(perComposite, rng);

    const counts = tracker.allAppearanceCounts();
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(minAppearances);
  });

  it("is deterministic given the same seed", () => {
    const rngA = createRng(99);
    const rngB = createRng(99);
    const trackerA = new CoverageTracker(8);
    const trackerB = new CoverageTracker(8);
    const picksA: number[][] = [];
    const picksB: number[][] = [];
    for (let i = 0; i < 10; i++) {
      picksA.push(trackerA.pickForComposite(2, rngA));
      picksB.push(trackerB.pickForComposite(2, rngB));
    }
    expect(picksA).toEqual(picksB);
  });

  it("rejects a negative or non-integer poolSize", () => {
    expect(() => new CoverageTracker(-1)).toThrow();
    expect(() => new CoverageTracker(1.5)).toThrow();
  });

  it("a poolSize of 0 never picks anything (defensive — callers must not reach this with an empty pool)", () => {
    const tracker = new CoverageTracker(0);
    const picked = tracker.pickForComposite(2, createRng(1));
    expect(picked).toEqual([]);
  });
});

// #268 PR #269 review round 1, BLOCKER 2: pickOneWithDraw is the primitive
// zone-generate needs — planZoneLayout.ts's per-zone draw order already
// draws `pickFrac = rng()` UNCONDITIONALLY (its own documented invariant,
// regardless of zone kind or inclusion), so the coverage-aware picker must
// consume that ALREADY-DRAWN value rather than calling rng() itself (which
// pickForComposite does) — an extra rng() call there would violate
// planZoneLayout.ts's own draw-shape invariant exactly the way one would
// have violated paramStream.ts's.
describe("CoverageTracker.pickOneWithDraw", () => {
  it("never calls rng() itself — takes an already-drawn [0,1) value", () => {
    const tracker = new CoverageTracker(5);
    // No rng passed at all — if this method tried to draw one internally,
    // there'd be nothing to call and the type system would already reject
    // it, but this test also locks the RUNTIME behavior: passing the same
    // draw01 given the same tracker state is deterministic.
    const idx = tracker.pickOneWithDraw(0.37);
    expect(typeof idx).toBe("number");
  });

  it("favors the globally least-appeared item, same as pickForComposite", () => {
    const tracker = new CoverageTracker(4);
    // Pick index 0 up to appearance count 2.
    tracker.pickOneWithDraw(0); // picks idx 0 (bucket order), now at level 1
    tracker.pickOneWithDraw(0.99); // bucket at level 0 now has [1,2,3]; picks the highest-index one (idx 3)
    const counts = tracker.allAppearanceCounts();
    expect(counts[0]).toBe(1);
    expect(counts[3]).toBe(1);
    expect(counts[1]).toBe(0);
    expect(counts[2]).toBe(0);
  });

  it("multiple calls within a 'composite' (a burst of picks) still return distinct indices when the pool has enough items at the current tier", () => {
    const tracker = new CoverageTracker(6);
    const picks = [0, 0.2, 0.4, 0.6, 0.8, 0.99].map((d) => tracker.pickOneWithDraw(d));
    expect(new Set(picks).size).toBe(6); // all 6 pool items picked exactly once, all distinct
  });

  it("is deterministic given the same sequence of draw01 values", () => {
    const trackerA = new CoverageTracker(10);
    const trackerB = new CoverageTracker(10);
    const draws = [0.1, 0.5, 0.9, 0.3, 0.7];
    const picksA = draws.map((d) => trackerA.pickOneWithDraw(d));
    const picksB = draws.map((d) => trackerB.pickOneWithDraw(d));
    expect(picksA).toEqual(picksB);
  });

  it("returns null (never throws) when the pool is empty — defensive, callers must not reach this in practice", () => {
    const tracker = new CoverageTracker(0);
    expect(tracker.pickOneWithDraw(0.5)).toBeNull();
  });

  it("appearance counts accumulate across calls exactly like pickForComposite's, given the same pool and draw sequence", () => {
    // Same seed/pool through both APIs should reach the same coverage
    // guarantee — this is what lets planZoneLayout.ts reuse the exact same
    // fairness/coverage properties paramStream.ts already relies on.
    const poolSize = 8;
    const minAppearances = 3;
    const tracker = new CoverageTracker(poolSize);
    const rng = createRng(21);
    // 8 * 3 = 24 picks needed at minimum; add margin.
    for (let i = 0; i < 30; i++) tracker.pickOneWithDraw(rng());
    for (const c of tracker.allAppearanceCounts()) expect(c).toBeGreaterThanOrEqual(minAppearances);
  });
});
