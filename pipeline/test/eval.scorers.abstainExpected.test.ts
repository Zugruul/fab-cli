import { describe, it, expect } from "vitest";
import { scoreAbstainExpected } from "../src/eval/scorers/abstainExpected.js";
import type { EvalItem, ModelAnswer } from "../src/eval/types.js";

const item: EvalItem = { id: "i1", suite: "ood-rejection", question: "q", expected: { kind: "abstain" }, groundingChunkIds: [] };

describe("scoreAbstainExpected", () => {
  it("is correct when the model abstains", () => {
    const answer: ModelAnswer = { text: "I can't help with that", abstained: true, citedChunkIds: [] };
    expect(scoreAbstainExpected(item, answer)).toBe("correct");
  });

  it("is incorrect when the model answers instead of abstaining, even if the answer text looks plausible", () => {
    const answer: ModelAnswer = { text: "Sure, here's an answer", abstained: false, citedChunkIds: [] };
    expect(scoreAbstainExpected(item, answer)).toBe("incorrect");
  });

  it("never produces an 'abstained' verdict bucket — only correct/incorrect", () => {
    const abstaining: ModelAnswer = { text: "", abstained: true, citedChunkIds: [] };
    const answering: ModelAnswer = { text: "x", abstained: false, citedChunkIds: [] };
    expect(["correct", "incorrect"]).toContain(scoreAbstainExpected(item, abstaining));
    expect(["correct", "incorrect"]).toContain(scoreAbstainExpected(item, answering));
  });

  it("throws when called on a non-abstain item (defensive guard against misdispatch)", () => {
    const wrongItem: EvalItem = { id: "i2", suite: "lore", question: "q", expected: { kind: "exact", value: "x" }, groundingChunkIds: [] };
    expect(() => scoreAbstainExpected(wrongItem, { text: "x", abstained: false, citedChunkIds: [] })).toThrow();
  });
});
