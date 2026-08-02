import { describe, it, expect } from "vitest";
import { buildJudgePrompt } from "../src/sampling/prompt.js";
import { makeChunk, makePair } from "./sampling.helpers.js";

describe("buildJudgePrompt", () => {
  it("embeds the chunk's id, title, and full text in the user prompt", () => {
    const chunk = makeChunk({ chunk_id: "rules/cr/1.1", title: "1.1 Overview", text: "The rules text for section 1.1." });
    const { user } = buildJudgePrompt(chunk, makePair());
    expect(user).toContain("chunk_id: rules/cr/1.1");
    expect(user).toContain("1.1 Overview");
    expect(user).toContain("The rules text for section 1.1.");
  });

  it("embeds the candidate question and answer", () => {
    const chunk = makeChunk();
    const pair = makePair({ question: "Does Dominate force a block?", answer: "Yes, if able." });
    const { user } = buildJudgePrompt(chunk, pair);
    expect(user).toContain("Does Dominate force a block?");
    expect(user).toContain("Yes, if able.");
  });

  it("system prompt requires strict JSON output with entailed/reason keys and full-support semantics", () => {
    const { system } = buildJudgePrompt(makeChunk(), makePair());
    expect(system).toMatch(/json/i);
    expect(system).toContain("entailed");
    expect(system).toContain("reason");
    expect(system).toMatch(/fully entailed|fully supported/i);
  });

  it("produces distinct prompts for distinct (chunk, pair) inputs", () => {
    const a = buildJudgePrompt(makeChunk({ chunk_id: "chunk-a", text: "Text A" }), makePair({ question: "Q-A?" }));
    const b = buildJudgePrompt(makeChunk({ chunk_id: "chunk-b", text: "Text B" }), makePair({ question: "Q-B?" }));
    expect(a.user).not.toBe(b.user);
    expect(a.user).toContain("chunk_id: chunk-a");
    expect(b.user).toContain("chunk_id: chunk-b");
  });
});
