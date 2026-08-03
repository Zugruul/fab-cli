import { describe, it, expect } from "vitest";
import { scoreCitationValidity } from "../src/eval/scorers/citationValidity.js";
import type { EvalItem, ModelAnswer } from "../src/eval/types.js";

function item(groundingChunkIds: string[]): EvalItem {
  return {
    id: "i1",
    suite: "citation-validity",
    question: "q",
    expected: { kind: "rubric", claims: ["irrelevant to this scorer"] },
    groundingChunkIds,
  };
}

describe("scoreCitationValidity", () => {
  it("is correct when the model cites exactly the true grounding chunk", () => {
    const answer: ModelAnswer = { text: "x", abstained: false, citedChunkIds: ["rules/cr/1.1"] };
    expect(scoreCitationValidity(item(["rules/cr/1.1"]), answer)).toBe("correct");
  });

  it("is correct when the model cites a subset of multiple valid grounding chunks", () => {
    const answer: ModelAnswer = { text: "x", abstained: false, citedChunkIds: ["rules/cr/1.1"] };
    expect(scoreCitationValidity(item(["rules/cr/1.1", "rules/cr/1.2"]), answer)).toBe("correct");
  });

  it("is incorrect when the model cites a chunk outside the grounding set (fabricated citation)", () => {
    const answer: ModelAnswer = { text: "x", abstained: false, citedChunkIds: ["rules/cr/9.9"] };
    expect(scoreCitationValidity(item(["rules/cr/1.1"]), answer)).toBe("incorrect");
  });

  it("is incorrect when only ONE of several cited chunks is invalid (all-or-nothing faithfulness)", () => {
    const answer: ModelAnswer = { text: "x", abstained: false, citedChunkIds: ["rules/cr/1.1", "rules/cr/9.9"] };
    expect(scoreCitationValidity(item(["rules/cr/1.1"]), answer)).toBe("incorrect");
  });

  it("is incorrect when the model answers but cites nothing (uncited factual claim)", () => {
    const answer: ModelAnswer = { text: "x", abstained: false, citedChunkIds: [] };
    expect(scoreCitationValidity(item(["rules/cr/1.1"]), answer)).toBe("incorrect");
  });

  it("is abstained when the model abstains, regardless of citations", () => {
    const answer: ModelAnswer = { text: "", abstained: true, citedChunkIds: [] };
    expect(scoreCitationValidity(item(["rules/cr/1.1"]), answer)).toBe("abstained");
  });
});
