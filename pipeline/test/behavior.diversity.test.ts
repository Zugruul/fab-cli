import { describe, it, expect } from "vitest";
import { computeDiversityMetric } from "../src/behavior/diversity.js";

describe("computeDiversityMetric", () => {
  it("reports 100% usage/coverage when every template in the bank was used", () => {
    const bank = {
      sports: ["a", "b"],
      cooking: ["c", "d", "e"],
    };
    const used = [
      { style: "sports", question: "a" },
      { style: "sports", question: "b" },
      { style: "cooking", question: "c" },
      { style: "cooking", question: "d" },
      { style: "cooking", question: "e" },
    ];
    const metric = computeDiversityMetric(bank, used);
    expect(metric.totalTemplates).toBe(5);
    expect(metric.distinctTemplatesUsed).toBe(5);
    expect(metric.templateUsageRatio).toBe(1);
    expect(metric.styleCount).toBe(2);
    expect(metric.stylesCovered).toBe(2);
    expect(metric.styleCoverageRatio).toBe(1);
  });

  it("reports partial usage/coverage when only some templates/styles were used", () => {
    const bank = {
      sports: ["a", "b"],
      cooking: ["c", "d"],
      math: ["e", "f"],
    };
    const used = [
      { style: "sports", question: "a" },
      { style: "cooking", question: "c" },
    ];
    const metric = computeDiversityMetric(bank, used);
    expect(metric.totalTemplates).toBe(6);
    expect(metric.distinctTemplatesUsed).toBe(2);
    expect(metric.templateUsageRatio).toBeCloseTo(2 / 6);
    expect(metric.styleCount).toBe(3);
    expect(metric.stylesCovered).toBe(2);
    expect(metric.styleCoverageRatio).toBeCloseTo(2 / 3);
  });

  it("counts a duplicate (style, question) usage only once", () => {
    const bank = { sports: ["a"] };
    const used = [
      { style: "sports", question: "a" },
      { style: "sports", question: "a" },
    ];
    const metric = computeDiversityMetric(bank, used);
    expect(metric.distinctTemplatesUsed).toBe(1);
  });

  it("handles an empty bank without dividing by zero", () => {
    const metric = computeDiversityMetric({}, []);
    expect(metric.totalTemplates).toBe(0);
    expect(metric.templateUsageRatio).toBe(0);
    expect(metric.styleCoverageRatio).toBe(0);
  });
});
