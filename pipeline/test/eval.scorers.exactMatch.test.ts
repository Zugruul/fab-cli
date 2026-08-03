import { describe, it, expect } from "vitest";
import { scoreExactMatch } from "../src/eval/scorers/exactMatch.js";
import type { EvalItem, ModelAnswer } from "../src/eval/types.js";

function item(value: string): EvalItem {
  return { id: "i1", suite: "citation-validity", question: "q", expected: { kind: "exact", value }, groundingChunkIds: [] };
}

function answer(text: string, abstained = false): ModelAnswer {
  return { text, abstained, citedChunkIds: [] };
}

describe("scoreExactMatch", () => {
  it("scores an exact match correct", () => {
    expect(scoreExactMatch(item("Dominate"), answer("Dominate"))).toBe("correct");
  });

  it("is case/whitespace-insensitive", () => {
    expect(scoreExactMatch(item("Go again"), answer("  go   AGAIN  "))).toBe("correct");
  });

  it("scores a mismatched answer incorrect", () => {
    expect(scoreExactMatch(item("3"), answer("4"))).toBe("incorrect");
  });

  it("scores an abstained answer as abstained, not incorrect", () => {
    expect(scoreExactMatch(item("3"), answer("", true))).toBe("abstained");
  });

  it("throws when called on a non-exact item (defensive guard against misdispatch)", () => {
    const rubricItem: EvalItem = { id: "i2", suite: "lore", question: "q", expected: { kind: "rubric", claims: ["x"] }, groundingChunkIds: [] };
    expect(() => scoreExactMatch(rubricItem, answer("x"))).toThrow();
  });
});
