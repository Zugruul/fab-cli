import { describe, it, expect } from "vitest";
import {
  ConfidenceSchema,
  validateConfidence,
  validConfidence,
  invalidConfidenceUnknownValue,
} from "../src/index.js";

describe("Confidence schema (§10.2)", () => {
  it("accepts all four pinned values", () => {
    for (const value of ["high", "medium", "low", "abstain"] as const) {
      const result = validateConfidence(value);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(value);
      }
    }
  });

  it("accepts the valid fixture", () => {
    const result = validateConfidence(validConfidence);
    expect(result.success).toBe(true);
  });

  it("rejects the invalid fixture (an out-of-scale string) with a precise path", () => {
    const result = validateConfidence(invalidConfidenceUnknownValue);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.path).toEqual([]);
    }
  });

  it("rejects an empty string, with a precise path", () => {
    const result = validateConfidence("");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.path).toEqual([]);
    }
  });

  it("rejects a numeric confidence (0.9) rather than the categorical scale", () => {
    const result = validateConfidence(0.9);
    expect(result.success).toBe(false);
  });

  it("rejects near-miss strings (wrong case, extra text)", () => {
    for (const bad of ["High", "very-high", "confident", "Abstain "]) {
      const result = validateConfidence(bad);
      expect(result.success).toBe(false);
    }
  });

  it("exposes ConfidenceSchema directly for callers that want raw zod safeParse", () => {
    expect(ConfidenceSchema.safeParse("medium").success).toBe(true);
    expect(ConfidenceSchema.safeParse("very-high").success).toBe(false);
  });
});
