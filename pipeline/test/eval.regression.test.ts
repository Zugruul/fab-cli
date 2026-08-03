import { describe, it, expect } from "vitest";
import { detectRegressions, hasAnyRegression } from "../src/eval/regression.js";
import type { SuiteResult } from "../src/eval/types.js";

function suite(suiteId: SuiteResult["suiteId"], score: number): SuiteResult {
  return { suiteId, counts: { correct: 1, incorrect: 0, abstained: 0 }, score, itemResults: [] };
}

describe("detectRegressions", () => {
  it("flags a suite whose score dropped vs the previous release", () => {
    const results = detectRegressions([suite("lore", 0.5)], [{ suiteId: "lore", score: 0.7 }]);
    expect(results).toEqual([{ suiteId: "lore", previousScore: 0.7, currentScore: 0.5, regressed: true }]);
  });

  it("does not flag an improved score", () => {
    const results = detectRegressions([suite("lore", 0.9)], [{ suiteId: "lore", score: 0.7 }]);
    expect(results[0].regressed).toBe(false);
  });

  it("does not flag an exactly-equal score (§8.5(c): 'improvement/equal -> passes')", () => {
    const results = detectRegressions([suite("lore", 0.7)], [{ suiteId: "lore", score: 0.7 }]);
    expect(results[0].regressed).toBe(false);
  });

  it("omits a suite with no previous record — nothing to compare, not a regression", () => {
    const results = detectRegressions([suite("lore", 0.5)], []);
    expect(results).toEqual([]);
  });

  it("compares each suite independently", () => {
    const results = detectRegressions(
      [suite("lore", 0.5), suite("interactions", 0.9)],
      [{ suiteId: "lore", score: 0.7 }, { suiteId: "interactions", score: 0.8 }],
    );
    expect(results.find((r) => r.suiteId === "lore")!.regressed).toBe(true);
    expect(results.find((r) => r.suiteId === "interactions")!.regressed).toBe(false);
  });
});

describe("hasAnyRegression", () => {
  it("is true when at least one suite regressed", () => {
    expect(hasAnyRegression([{ suiteId: "lore", previousScore: 0.7, currentScore: 0.5, regressed: true }])).toBe(true);
  });

  it("is false when no suite regressed", () => {
    expect(hasAnyRegression([{ suiteId: "lore", previousScore: 0.5, currentScore: 0.7, regressed: false }])).toBe(false);
  });

  it("is false for an empty result set", () => {
    expect(hasAnyRegression([])).toBe(false);
  });
});
