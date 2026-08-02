import { describe, it, expect } from "vitest";
import { parseTeacherResponse } from "../src/qa/parse.js";
import { makeChunk } from "./qa.helpers.js";

describe("parseTeacherResponse", () => {
  const chunk = makeChunk({ chunk_id: "chunk-1" });

  it("accepts a strict JSON array of well-formed, correctly-cited pairs", () => {
    const raw = JSON.stringify([
      { question: "What does X do?", answer: "X does Y.", cited_chunk_ids: ["chunk-1"] },
      { question: "When does X apply?", answer: "X applies during Z.", cited_chunk_ids: ["chunk-1"] },
    ]);
    const { pairs, rejected } = parseTeacherResponse(raw, chunk);
    expect(pairs).toHaveLength(2);
    expect(rejected).toHaveLength(0);
    expect(pairs[0]).toEqual({
      question: "What does X do?",
      answer: "X does Y.",
      cited_chunk_ids: ["chunk-1"],
    });
  });

  it("repairs a response wrapped in a markdown ```json code fence", () => {
    const raw = [
      "Here is the JSON:",
      "```json",
      JSON.stringify([{ question: "Q?", answer: "A.", cited_chunk_ids: ["chunk-1"] }]),
      "```",
    ].join("\n");
    const { pairs, rejected } = parseTeacherResponse(raw, chunk);
    expect(pairs).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("rejects an entirely unparseable response without throwing", () => {
    const raw = "I'm sorry, I can't help with that request.";
    const { pairs, rejected } = parseTeacherResponse(raw, chunk);
    expect(pairs).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/pars|json/i);
  });

  it("rejects a top-level JSON value that isn't an array", () => {
    const raw = JSON.stringify({ pairs: [] });
    const { pairs, rejected } = parseTeacherResponse(raw, chunk);
    expect(pairs).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/array/i);
  });

  it("rejects only the entries whose cited_chunk_ids point outside the source chunk, keeping valid ones", () => {
    const raw = JSON.stringify([
      { question: "Q1?", answer: "A1.", cited_chunk_ids: ["chunk-1"] },
      { question: "Q2?", answer: "A2, citing the wrong source.", cited_chunk_ids: ["some-other-chunk"] },
      { question: "Q3?", answer: "A3.", cited_chunk_ids: ["chunk-1", "chunk-1"] },
    ]);
    const { pairs, rejected } = parseTeacherResponse(raw, chunk);
    expect(pairs).toHaveLength(2);
    expect(pairs.map((p) => p.question)).toEqual(["Q1?", "Q3?"]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/cite|chunk/i);
  });

  it("rejects entries missing required fields or with an empty cited_chunk_ids array", () => {
    const raw = JSON.stringify([
      { question: "Q1?", cited_chunk_ids: ["chunk-1"] }, // missing answer
      { question: "Q2?", answer: "A2.", cited_chunk_ids: [] }, // empty citations
      { question: "", answer: "A3.", cited_chunk_ids: ["chunk-1"] }, // empty question
      { question: "Q4?", answer: "A4.", cited_chunk_ids: ["chunk-1"] }, // valid
    ]);
    const { pairs, rejected } = parseTeacherResponse(raw, chunk);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe("Q4?");
    expect(rejected).toHaveLength(3);
    for (const r of rejected) {
      expect(typeof r.reason).toBe("string");
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it("rejects a response truncated mid-array (e.g. a max_tokens cutoff) without throwing", () => {
    // Realistic malformation: valid-looking JSON up to the point generation
    // was cut off, then nothing — no closing bracket/brace at all.
    const raw = '[{"question": "What does X do?", "answer": "X does Y becaus';
    expect(() => parseTeacherResponse(raw, chunk)).not.toThrow();
    const { pairs, rejected } = parseTeacherResponse(raw, chunk);
    expect(pairs).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatch(/pars|json/i);
  });

  it("does not mutate the input chunk", () => {
    const before = JSON.stringify(chunk);
    parseTeacherResponse("not json at all", chunk);
    expect(JSON.stringify(chunk)).toBe(before);
  });
});
