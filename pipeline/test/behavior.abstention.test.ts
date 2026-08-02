import { describe, it, expect } from "vitest";
import { createRng } from "../src/behavior/rng.js";
import { buildAbstentionExamples } from "../src/behavior/abstention.js";
import { makeChunk, makeChunks, makePairsRecord } from "./behavior.helpers.js";

const CONFIG = {
  contextSize: 2,
  minCount: 1,
  messageTemplate: "not clearly settled by the retrieved sources",
  escalationText: "ask a judge: https://discord.com/channels/874145774135558164/1020649907314495528",
};

describe("buildAbstentionExamples (SPEC-APP.md §7.5b)", () => {
  it("bundles context chunks that never include the question's own source chunk", () => {
    const chunks = makeChunks(10);
    const records = [makePairsRecord("chunk-1", 1)];
    const [ex] = buildAbstentionExamples(chunks, records, CONFIG, createRng(1)).examples;
    expect(ex.contextChunkIds).not.toContain("chunk-1");
    expect(ex.contextChunkIds).toHaveLength(2);
  });

  it("excludes chunks that share a tag with the source chunk (best-effort unrelatedness)", () => {
    const source = makeChunk({ chunk_id: "src", tags: ["shared-topic"] });
    const related = makeChunk({ chunk_id: "related", tags: ["shared-topic"] });
    const unrelated = makeChunks(5); // distinct topic-N tags
    const chunks = [source, related, ...unrelated];
    const records = [makePairsRecord("src", 1)];
    const [ex] = buildAbstentionExamples(chunks, records, CONFIG, createRng(2)).examples;
    expect(ex.contextChunkIds).not.toContain("related");
  });

  it("excludes chunks the source chunk links to", () => {
    const source = makeChunk({ chunk_id: "src", tags: ["src-topic"], links: ["linked"] });
    const linked = makeChunk({ chunk_id: "linked", tags: ["other-topic"] });
    const unrelated = makeChunks(5);
    const chunks = [source, linked, ...unrelated];
    const records = [makePairsRecord("src", 1)];
    const [ex] = buildAbstentionExamples(chunks, records, CONFIG, createRng(3)).examples;
    expect(ex.contextChunkIds).not.toContain("linked");
  });

  it("target is the structured abstention: null-ish answer, no citations, confidence abstain, escalation text", () => {
    const chunks = makeChunks(10);
    const records = [makePairsRecord("chunk-1", 1)];
    const [ex] = buildAbstentionExamples(chunks, records, CONFIG, createRng(4)).examples;
    expect(ex.target.citation_ids).toEqual([]);
    expect(ex.target.confidence).toBe("abstain");
    expect(ex.target.abstained).toBe(true);
    expect(ex.target.answer).toBe(CONFIG.messageTemplate);
    expect(ex.target.escalation).toBe(CONFIG.escalationText);
  });

  it("every example shares the exact same target object shape (config-templated, not per-example)", () => {
    const chunks = makeChunks(10);
    const records = [makePairsRecord("chunk-1", 3)];
    const { examples } = buildAbstentionExamples(chunks, records, CONFIG, createRng(5));
    expect(examples).toHaveLength(3);
    for (const ex of examples) {
      expect(ex.target).toEqual(examples[0].target);
    }
  });

  it("is deterministic: the same seed produces byte-identical output", () => {
    const chunks = makeChunks(15);
    const records = [makePairsRecord("chunk-1", 2), makePairsRecord("chunk-7", 2)];
    const a = buildAbstentionExamples(chunks, records, CONFIG, createRng(999));
    const b = buildAbstentionExamples(chunks, records, CONFIG, createRng(999));
    expect(JSON.stringify(a.examples)).toBe(JSON.stringify(b.examples));
  });

  it("skips a question when too few topically-unrelated chunks exist", () => {
    // Every chunk shares the same tag, so nothing qualifies as "unrelated".
    const chunks = makeChunks(4, () => ({ tags: ["same-topic-everywhere"] }));
    const records = [makePairsRecord("chunk-1", 1)];
    const result = buildAbstentionExamples(chunks, records, { ...CONFIG, minCount: 0 }, createRng(6));
    expect(result.examples).toHaveLength(0);
    expect(result.skipped[0].reason).toMatch(/unrelated/);
  });

  it("throws loudly when the built count is below the configured minimum", () => {
    const chunks = makeChunks(10);
    const records = [makePairsRecord("chunk-1", 1)];
    expect(() =>
      buildAbstentionExamples(chunks, records, { ...CONFIG, minCount: 10 }, createRng(7)),
    ).toThrow(/below configured minimum/);
  });
});
