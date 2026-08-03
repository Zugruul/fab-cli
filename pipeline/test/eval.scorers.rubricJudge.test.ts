import { describe, it, expect } from "vitest";
import { buildRubricPrompt, parseRubricVerdict, scoreWithRubricJudge } from "../src/eval/scorers/rubricJudge.js";
import type { EvalItem, ModelAnswer } from "../src/eval/types.js";
import { rubricVerdict, scriptedRubricJudgeClient } from "./eval.helpers.js";

const CONFIG = { model: "claude-sonnet-5", maxTokens: 256, temperature: null };

function item(claims: string[]): EvalItem {
  return { id: "i1", suite: "lore", question: "What is the Demonastery?", expected: { kind: "rubric", claims }, groundingChunkIds: ["lore/x"] };
}

describe("buildRubricPrompt", () => {
  it("embeds the question and every claim, plus the candidate answer", () => {
    const { user } = buildRubricPrompt(item(["claim one", "claim two"]), { text: "candidate text", abstained: false, citedChunkIds: [] });
    expect(user).toContain("What is the Demonastery?");
    expect(user).toContain("claim one");
    expect(user).toContain("claim two");
    expect(user).toContain("candidate text");
  });

  it("throws when called on a non-rubric item", () => {
    const exactItem: EvalItem = { id: "i2", suite: "citation-validity", question: "q", expected: { kind: "exact", value: "x" }, groundingChunkIds: [] };
    expect(() => buildRubricPrompt(exactItem, { text: "x", abstained: false, citedChunkIds: [] })).toThrow();
  });
});

describe("parseRubricVerdict", () => {
  it("parses a well-formed JSON verdict", () => {
    expect(parseRubricVerdict(JSON.stringify({ verdict: "correct", reason: "matches" }))).toEqual({ verdict: "correct", reason: "matches" });
  });

  it("fails closed to incorrect on invalid JSON (never silently upgrades to correct)", () => {
    expect(parseRubricVerdict("not json at all").verdict).toBe("incorrect");
  });

  it("fails closed to incorrect on an off-enum verdict value", () => {
    expect(parseRubricVerdict(JSON.stringify({ verdict: "maybe", reason: "unsure" })).verdict).toBe("incorrect");
  });

  it("defaults reason to empty string when absent", () => {
    expect(parseRubricVerdict(JSON.stringify({ verdict: "abstained" }))).toEqual({ verdict: "abstained", reason: "" });
  });
});

describe("scoreWithRubricJudge", () => {
  it("short-circuits to abstained without calling the judge when the model answer is abstained", async () => {
    const client = scriptedRubricJudgeClient([]); // would throw if called
    const answer: ModelAnswer = { text: "", abstained: true, citedChunkIds: [] };
    const result = await scoreWithRubricJudge(item(["claim"]), answer, client, CONFIG);
    expect(result.verdict).toBe("abstained");
  });

  it("calls the judge and returns its verdict for a non-abstained answer", async () => {
    const client = scriptedRubricJudgeClient([rubricVerdict("correct", "entailed")]);
    const answer: ModelAnswer = { text: "the demonastery is ...", abstained: false, citedChunkIds: ["lore/x"] };
    const result = await scoreWithRubricJudge(item(["claim"]), answer, client, CONFIG);
    expect(result).toEqual({ verdict: "correct", reason: "entailed" });
  });

  it("fails closed to incorrect when the judge call itself throws (infra failure is never a free pass)", async () => {
    const client = { generate: async () => { throw new Error("network down"); } };
    const answer: ModelAnswer = { text: "x", abstained: false, citedChunkIds: [] };
    const result = await scoreWithRubricJudge(item(["claim"]), answer, client, CONFIG);
    expect(result.verdict).toBe("incorrect");
    expect(result.reason).toContain("network down");
  });
});
