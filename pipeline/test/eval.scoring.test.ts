import { describe, it, expect } from "vitest";
import { buildSuiteResult, correctRate, countVerdicts, computeScore, incorrectRate } from "../src/eval/scoring.js";
import type { ItemResult, PenaltyWeights } from "../src/eval/types.js";

const WEIGHTS: PenaltyWeights = { correct: 1.0, abstained: -0.2, incorrect: -3.0 };

function results(...verdicts: ItemResult["verdict"][]): ItemResult[] {
  return verdicts.map((verdict, i) => ({ itemId: `item-${i}`, verdict }));
}

describe("countVerdicts", () => {
  it("counts each bucket independently", () => {
    expect(countVerdicts(results("correct", "correct", "incorrect", "abstained"))).toEqual({
      correct: 2,
      incorrect: 1,
      abstained: 1,
    });
  });

  it("returns all-zero counts for no items", () => {
    expect(countVerdicts([])).toEqual({ correct: 0, incorrect: 0, abstained: 0 });
  });
});

describe("computeScore", () => {
  it("returns 0 for zero items rather than NaN", () => {
    expect(computeScore([], WEIGHTS)).toBe(0);
  });

  it("weights an all-correct suite at the correct-penalty value", () => {
    expect(computeScore(results("correct", "correct"), WEIGHTS)).toBeCloseTo(1.0);
  });

  it("penalizes incorrect far more than abstained (asymmetry actually applied)", () => {
    const oneIncorrect = computeScore(results("correct", "correct", "correct", "incorrect"), WEIGHTS);
    const oneAbstained = computeScore(results("correct", "correct", "correct", "abstained"), WEIGHTS);
    expect(oneIncorrect).toBeLessThan(oneAbstained);
  });

  it("computes the exact weighted average", () => {
    // (1.0 + 1.0 + -3.0 + -0.2) / 4 = -0.3
    expect(computeScore(results("correct", "correct", "incorrect", "abstained"), WEIGHTS)).toBeCloseTo(-0.3);
  });
});

describe("correctRate / incorrectRate", () => {
  it("computes correctRate as correct/total", () => {
    expect(correctRate({ correct: 3, incorrect: 1, abstained: 1 })).toBeCloseTo(0.6);
  });

  it("an always-abstaining suite has correctRate 0 (§8.5(b) 'so an always-abstaining model fails')", () => {
    expect(correctRate({ correct: 0, incorrect: 0, abstained: 10 })).toBe(0);
  });

  it("computes incorrectRate as incorrect/total", () => {
    expect(incorrectRate({ correct: 8, incorrect: 2, abstained: 0 })).toBeCloseTo(0.2);
  });

  it("returns 0/0 as 0 for an empty suite rather than NaN", () => {
    expect(correctRate({ correct: 0, incorrect: 0, abstained: 0 })).toBe(0);
    expect(incorrectRate({ correct: 0, incorrect: 0, abstained: 0 })).toBe(0);
  });
});

describe("buildSuiteResult", () => {
  it("assembles counts, score, and preserves itemResults", () => {
    const itemResults = results("correct", "incorrect");
    const suite = buildSuiteResult("lore", itemResults, WEIGHTS);
    expect(suite.suiteId).toBe("lore");
    expect(suite.counts).toEqual({ correct: 1, incorrect: 1, abstained: 0 });
    expect(suite.score).toBeCloseTo((1.0 + -3.0) / 2);
    expect(suite.itemResults).toEqual(itemResults);
  });

  it("does not alias the input array (defensive copy)", () => {
    const itemResults = results("correct");
    const suite = buildSuiteResult("lore", itemResults, WEIGHTS);
    itemResults.push({ itemId: "extra", verdict: "incorrect" });
    expect(suite.itemResults).toHaveLength(1);
  });
});
