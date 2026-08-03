import { describe, it, expect } from "vitest";
import { calibrate, type ScoreSample } from "../src/eval/calibration.js";

const FIXED_NOW = () => "2026-08-02T00:00:00.000Z";

/** A representative fixture distribution: correct answers cluster at high
 * retrieval scores, incorrect/should-have-abstained answers cluster low,
 * with some overlap in the middle — the realistic shape calibration has
 * to draw a floor out of. */
function fixtureSamples(): ScoreSample[] {
  const correct: ScoreSample[] = [0.9, 0.85, 0.8, 0.78, 0.75, 0.7, 0.68, 0.6, 0.55, 0.5].map((score) => ({ score, correct: true }));
  const incorrect: ScoreSample[] = [0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.1].map((score) => ({ score, correct: false }));
  return [...correct, ...incorrect];
}

describe("calibrate", () => {
  it("computes a retrievalFloor from the correct-item score distribution and an oodThreshold strictly below it", () => {
    const artifact = calibrate("text-embed-v1", fixtureSamples(), { floorPercentile: 0.1, oodMarginRatio: 0.5 }, FIXED_NOW);
    expect(artifact.embedderVersion).toBe("text-embed-v1");
    expect(artifact.oodThreshold).toBeLessThan(artifact.retrievalFloor);
    expect(artifact.computedAt).toBe(FIXED_NOW());
    expect(artifact.sampleSize).toBe(fixtureSamples().length);
  });

  it("§10.9: oodThreshold is strictly below retrievalFloor across a range of margin ratios (hermetic proof, not just one fixture)", () => {
    for (const oodMarginRatio of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const artifact = calibrate("text-embed-v1", fixtureSamples(), { floorPercentile: 0.1, oodMarginRatio }, FIXED_NOW);
      expect(artifact.oodThreshold).toBeLessThan(artifact.retrievalFloor);
    }
  });

  it("a higher floorPercentile yields a higher (less permissive) retrievalFloor", () => {
    const low = calibrate("v1", fixtureSamples(), { floorPercentile: 0.05, oodMarginRatio: 0.5 }, FIXED_NOW);
    const high = calibrate("v1", fixtureSamples(), { floorPercentile: 0.5, oodMarginRatio: 0.5 }, FIXED_NOW);
    expect(high.retrievalFloor).toBeGreaterThan(low.retrievalFloor);
  });

  it("ignores incorrect-item scores when computing the floor (only correct items set the bar)", () => {
    const onlyCorrect = calibrate("v1", fixtureSamples().filter((s) => s.correct), { floorPercentile: 0.1, oodMarginRatio: 0.5 }, FIXED_NOW);
    const withIncorrect = calibrate("v1", fixtureSamples(), { floorPercentile: 0.1, oodMarginRatio: 0.5 }, FIXED_NOW);
    expect(withIncorrect.retrievalFloor).toBeCloseTo(onlyCorrect.retrievalFloor);
  });

  // --- RUNTIME GUARDS, not just TS types ---------------------------------

  it("throws (never falls back to a hardcoded default) when there are zero correctly-answered samples", () => {
    const allIncorrect: ScoreSample[] = [{ score: 0.5, correct: false }];
    expect(() => calibrate("v1", allIncorrect, { floorPercentile: 0.1, oodMarginRatio: 0.5 }, FIXED_NOW)).toThrow();
  });

  it("throws on an empty embedderVersion", () => {
    expect(() => calibrate("", fixtureSamples(), { floorPercentile: 0.1, oodMarginRatio: 0.5 }, FIXED_NOW)).toThrow(/embedderVersion/);
  });

  it("throws on an out-of-range floorPercentile", () => {
    expect(() => calibrate("v1", fixtureSamples(), { floorPercentile: 1.5, oodMarginRatio: 0.5 }, FIXED_NOW)).toThrow(/floorPercentile/);
  });

  it("throws on oodMarginRatio >= 1 (would make oodThreshold >= retrievalFloor)", () => {
    expect(() => calibrate("v1", fixtureSamples(), { floorPercentile: 0.1, oodMarginRatio: 1 }, FIXED_NOW)).toThrow(/oodMarginRatio/);
  });

  it("throws on oodMarginRatio <= 0", () => {
    expect(() => calibrate("v1", fixtureSamples(), { floorPercentile: 0.1, oodMarginRatio: 0 }, FIXED_NOW)).toThrow(/oodMarginRatio/);
  });

  it("refuses to emit an artifact when the computed floor is exactly 0 (oodThreshold would tie, not be strictly below)", () => {
    const zeroFloorSamples: ScoreSample[] = [{ score: 0, correct: true }];
    expect(() => calibrate("v1", zeroFloorSamples, { floorPercentile: 0.1, oodMarginRatio: 0.5 }, FIXED_NOW)).toThrow(/oodThreshold/);
  });
});
