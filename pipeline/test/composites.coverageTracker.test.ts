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
