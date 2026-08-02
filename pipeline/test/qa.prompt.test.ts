import { describe, it, expect } from "vitest";
import { buildPrompt } from "../src/qa/prompt.js";
import { makeChunk } from "./qa.helpers.js";
import type { PromptConfig } from "../src/qa/types.js";

function config(overrides: Partial<PromptConfig> = {}): PromptConfig {
  return {
    pairsPerChunk: 4,
    diversityInstructions: [
      "Vary phrasing across direct, scenario-based, and terse keyword-style questions.",
      "Do not repeat the same sentence structure for every pair on this chunk.",
    ],
    ...overrides,
  };
}

describe("buildPrompt", () => {
  it("embeds the chunk's id, title, and full text in the user prompt", () => {
    const chunk = makeChunk({ chunk_id: "judge/notes/kw-dominate", title: "Dominate", text: "The Dominate keyword text." });
    const { user } = buildPrompt(chunk, config());
    expect(user).toContain("chunk_id: judge/notes/kw-dominate");
    expect(user).toContain("Dominate");
    expect(user).toContain("The Dominate keyword text.");
  });

  it("instructs the model to produce exactly pairsPerChunk pairs", () => {
    const chunk = makeChunk();
    const { user } = buildPrompt(chunk, config({ pairsPerChunk: 6 }));
    expect(user).toMatch(/6/);
  });

  it("includes every configured diversity instruction verbatim", () => {
    const chunk = makeChunk();
    const cfg = config({
      diversityInstructions: ["Instruction A about phrasing.", "Instruction B about tone."],
    });
    const { system, user } = buildPrompt(chunk, cfg);
    const combined = system + "\n" + user;
    expect(combined).toContain("Instruction A about phrasing.");
    expect(combined).toContain("Instruction B about tone.");
  });

  it("system prompt requires strict JSON array output with question/answer/cited_chunk_ids, grounded in the chunk, citing the chunk_id", () => {
    const chunk = makeChunk({ chunk_id: "chunk-x" });
    const { system } = buildPrompt(chunk, config());
    expect(system).toMatch(/json/i);
    expect(system).toContain("question");
    expect(system).toContain("answer");
    expect(system).toContain("cited_chunk_ids");
    // grounding / no-fabrication + citation instructions
    expect(system).toMatch(/stay within|only use|do not (invent|fabricate)/i);
    expect(system).toMatch(/cite/i);
  });

  it("produces distinct prompts for distinct chunks", () => {
    const a = buildPrompt(makeChunk({ chunk_id: "chunk-a", text: "Text A" }), config());
    const b = buildPrompt(makeChunk({ chunk_id: "chunk-b", text: "Text B" }), config());
    expect(a.user).not.toBe(b.user);
    expect(a.user).toContain("chunk_id: chunk-a");
    expect(b.user).toContain("chunk_id: chunk-b");
  });
});
