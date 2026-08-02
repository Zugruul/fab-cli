import { describe, it, expect } from "vitest";
import { createRng } from "../src/behavior/rng.js";
import { buildDistractorExamples } from "../src/behavior/distractor.js";
import { makeChunks, makeLegalityChunk, makePairsRecord } from "./behavior.helpers.js";

describe("buildDistractorExamples (SPEC-APP.md §7.5a)", () => {
  it("bundles the source chunk plus exactly k distractor chunks per pair", () => {
    const chunks = makeChunks(10);
    const records = [makePairsRecord("chunk-1", 2)];
    const result = buildDistractorExamples(chunks, records, { k: 3, minCount: 1 }, createRng(1));

    expect(result.examples).toHaveLength(2);
    for (const ex of result.examples) {
      expect(ex.contextChunkIds).toHaveLength(4); // source + 3 distractors
      expect(ex.contextChunkIds).toContain("chunk-1");
      expect(new Set(ex.contextChunkIds).size).toBe(4); // no duplicates
      expect(ex.chunk_id).toBe("chunk-1");
    }
  });

  it("distractors are drawn from OTHER chunks, never the source chunk itself", () => {
    const chunks = makeChunks(6);
    const records = [makePairsRecord("chunk-2", 1)];
    const result = buildDistractorExamples(chunks, records, { k: 4, minCount: 1 }, createRng(2));
    const [ex] = result.examples;
    const distractorIds = ex.contextChunkIds.filter((id) => id !== ex.chunk_id);
    expect(distractorIds).toHaveLength(4);
    expect(distractorIds.every((id) => id !== "chunk-2")).toBe(true);
  });

  it("the target answer/citation come only from the relevant chunk's pair", () => {
    const chunks = makeChunks(5);
    const records = [makePairsRecord("chunk-1", 1)];
    const [ex] = buildDistractorExamples(chunks, records, { k: 2, minCount: 1 }, createRng(3)).examples;
    expect(ex.target.answer).toBe("Answer 1, grounded in chunk-1.");
    expect(ex.target.citation_ids).toEqual(["chunk-1"]);
    expect(ex.target.confidence).toBe("high");
  });

  it("is deterministic: the same seed produces byte-identical output", () => {
    const chunks = makeChunks(12);
    const records = [makePairsRecord("chunk-1", 3), makePairsRecord("chunk-5", 2)];
    const a = buildDistractorExamples(chunks, records, { k: 3, minCount: 1 }, createRng(777));
    const b = buildDistractorExamples(chunks, records, { k: 3, minCount: 1 }, createRng(777));
    expect(JSON.stringify(a.examples)).toBe(JSON.stringify(b.examples));
  });

  it("marks examples grounded in a legality chunk as timeSensitive, per §7.9", () => {
    const legality = makeLegalityChunk();
    const chunks = [legality, ...makeChunks(5)];
    const records = [makePairsRecord(legality.chunk_id, 1)];
    const [ex] = buildDistractorExamples(chunks, records, { k: 2, minCount: 1 }, createRng(4)).examples;
    expect(ex.timeSensitive).toBe(true);
  });

  it("does not mark an ordinary chunk's examples as timeSensitive", () => {
    const chunks = makeChunks(5);
    const records = [makePairsRecord("chunk-1", 1)];
    const [ex] = buildDistractorExamples(chunks, records, { k: 2, minCount: 1 }, createRng(5)).examples;
    expect(ex.timeSensitive).toBe(false);
  });

  it("skips a pair when there aren't enough other chunks to draw k distractors from", () => {
    const chunks = makeChunks(3); // only 2 "other" chunks available
    const records = [makePairsRecord("chunk-1", 1)];
    const result = buildDistractorExamples(chunks, records, { k: 5, minCount: 0 }, createRng(6));
    expect(result.examples).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/distractor/);
  });

  it("throws loudly when the built count is below the configured minimum", () => {
    const chunks = makeChunks(5);
    const records = [makePairsRecord("chunk-1", 1)];
    expect(() =>
      buildDistractorExamples(chunks, records, { k: 2, minCount: 5 }, createRng(7)),
    ).toThrow(/below configured minimum/);
  });

  it("skips a pair whose source chunk_id isn't in the exported chunk set", () => {
    const chunks = makeChunks(5);
    const records = [makePairsRecord("missing-chunk", 1)];
    const result = buildDistractorExamples(chunks, records, { k: 2, minCount: 0 }, createRng(8));
    expect(result.examples).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/not found/);
  });
});
