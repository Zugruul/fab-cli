import { describe, it, expect } from "vitest";
import { buildDPOPairs } from "../src/behavior/dpo.js";
import { makeChunks, makeLegalityChunk, makePairsRecord, makeSampledRecord } from "./behavior.helpers.js";

const CONFIG = {
  minCount: 1,
  degradation: {
    hedgePrefixes: ["Based on the cited source: ", "Per the source chunk: "],
    confidentWrongPrefix: "Definitely, no exceptions: ",
  },
};

describe("buildDPOPairs (SPEC-APP.md §7.6)", () => {
  it("without accepted/rejected artifacts, builds a chosen(hedged+cited)/rejected(synthetic) pair per raw pair", () => {
    const chunks = makeChunks(5);
    const records = [makePairsRecord("chunk-1", 2)];
    const { pairs } = buildDPOPairs(chunks, records, CONFIG);
    expect(pairs).toHaveLength(2);
    for (const p of pairs) {
      expect(p.chosen.citation_ids).toEqual(["chunk-1"]);
      expect(p.chosen.answer).toMatch(/^(Based on the cited source: |Per the source chunk: )/);
      expect(p.rejected.citation_ids).toEqual([]);
      expect(["synthetic-citation-stripped", "synthetic-confident-wrong"]).toContain(p.method);
    }
  });

  it("alternates between the two synthetic degradation methods", () => {
    const chunks = makeChunks(5);
    const records = [makePairsRecord("chunk-1", 4)];
    const { pairs, methodCounts } = buildDPOPairs(chunks, records, CONFIG);
    expect(methodCounts["synthetic-citation-stripped"]).toBe(2);
    expect(methodCounts["synthetic-confident-wrong"]).toBe(2);
    const confidentWrong = pairs.find((p) => p.method === "synthetic-confident-wrong")!;
    expect(confidentWrong.rejected.answer.startsWith("Definitely, no exceptions: ")).toBe(true);
  });

  it("each pair records its construction method", () => {
    const chunks = makeChunks(5);
    const records = [makePairsRecord("chunk-1", 1)];
    const { pairs } = buildDPOPairs(chunks, records, CONFIG);
    expect(pairs[0].method).toBeDefined();
  });

  it("uses a real teacher-rejected answer (same question) as `rejected` when present in the rejected file", () => {
    const chunks = makeChunks(5);
    const records = [makePairsRecord("chunk-1", 1)];
    const question = records[0].pairs[0].question;
    const rejectedRecord = makeSampledRecord("chunk-1", question, { answer: "A non-entailed, teacher-rejected answer." });
    const { pairs } = buildDPOPairs(chunks, records, CONFIG, [], [rejectedRecord]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].method).toBe("rejection-sample");
    expect(pairs[0].rejected.answer).toBe("A non-entailed, teacher-rejected answer.");
  });

  it("prefers the accepted.jsonl record's content for `chosen` when present", () => {
    const chunks = makeChunks(5);
    const records = [makePairsRecord("chunk-1", 1)];
    const question = records[0].pairs[0].question;
    const acceptedRecord = makeSampledRecord("chunk-1", question, { answer: "Verified-accepted answer text." });
    const { pairs } = buildDPOPairs(chunks, records, CONFIG, [acceptedRecord], []);
    expect(pairs[0].chosen.answer).toContain("Verified-accepted answer text.");
  });

  it("once rejection sampling has run, skips a raw pair with no accepted/rejected counterpart rather than guessing", () => {
    const chunks = makeChunks(5);
    const records = [makePairsRecord("chunk-1", 2)]; // two distinct questions
    const question0 = records[0].pairs[0].question;
    // Only the FIRST question was processed by rejection sampling (accepted).
    const acceptedRecord = makeSampledRecord("chunk-1", question0);
    const { pairs, skipped } = buildDPOPairs(chunks, records, { ...CONFIG, minCount: 0 }, [acceptedRecord], []);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].question).toBe(question0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/not yet processed/);
  });

  it("skips (does not use as chosen) a raw pair that was itself rejected with no accepted counterpart", () => {
    const chunks = makeChunks(5);
    const records = [makePairsRecord("chunk-1", 1)];
    const question = records[0].pairs[0].question;
    const rejectedRecord = makeSampledRecord("chunk-1", question);
    const { pairs, skipped } = buildDPOPairs(chunks, records, { ...CONFIG, minCount: 0 }, [], [rejectedRecord]);
    expect(pairs).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/rejected/);
  });

  it("excludes legality-sourced chunks entirely, per §7.9", () => {
    const legality = makeLegalityChunk();
    const chunks = [legality, ...makeChunks(5)];
    const records = [makePairsRecord(legality.chunk_id, 1), makePairsRecord("chunk-1", 1)];
    const { pairs, skipped } = buildDPOPairs(chunks, records, { ...CONFIG, minCount: 1 });
    expect(pairs.every((p) => p.chunk_id !== legality.chunk_id)).toBe(true);
    expect(skipped.some((s) => s.chunk_id === legality.chunk_id && /§7\.9/.test(s.reason))).toBe(true);
  });

  it("throws loudly when the built count is below the configured minimum", () => {
    const chunks = makeChunks(5);
    const records = [makePairsRecord("chunk-1", 1)];
    expect(() => buildDPOPairs(chunks, records, { ...CONFIG, minCount: 10 })).toThrow(/below configured minimum/);
  });
});
