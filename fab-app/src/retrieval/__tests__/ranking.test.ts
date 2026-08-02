import { rankAndClipToBudget } from "../ranking";
import type { ActivatedChunk, RetrievalConfig } from "../types";
import { InMemoryChunkCorpus, chunk } from "./testDoubles";

// §9.7/§14: "activation-ranked selection within the configured retrieval
// token budget ... rank by activation desc, greedily fill the configured
// retrieval token budget". Decision (documented in ../ranking.ts): a chunk
// that doesn't fit in the remaining budget is SKIPPED, not truncated, and
// the walk continues to lower-ranked chunks.

const baseConfig: RetrievalConfig = {
  semanticK: 8,
  maxHops: 2,
  hopDecay: 0.5,
  tokenBudget: 1024,
  charsPerToken: 4,
};

function activationMap(entries: ActivatedChunk[]): Map<string, ActivatedChunk> {
  return new Map(entries.map((e) => [e.chunkId, e]));
}

describe("rankAndClipToBudget", () => {
  it("ranks by activation descending, ties broken by chunk id ascending", () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "b", text: "bb" }),
      chunk({ id: "a", text: "aa" }),
      chunk({ id: "c", text: "cc" }),
    ]);
    const activation = activationMap([
      { chunkId: "b", activation: 0.5, stage: "lexical" },
      { chunkId: "a", activation: 0.5, stage: "lexical" },
      { chunkId: "c", activation: 0.9, stage: "semantic" },
    ]);

    const ranked = rankAndClipToBudget(activation, corpus, baseConfig);

    expect(ranked.map((r) => r.chunk.id)).toEqual(["c", "a", "b"]);
  });

  it("is deterministic across repeated calls on the same input", () => {
    const corpus = new InMemoryChunkCorpus([chunk({ id: "a" }), chunk({ id: "b" })]);
    const activation = activationMap([
      { chunkId: "a", activation: 0.3, stage: "lexical" },
      { chunkId: "b", activation: 0.3, stage: "semantic" },
    ]);

    const first = rankAndClipToBudget(activation, corpus, baseConfig);
    const second = rankAndClipToBudget(activation, corpus, baseConfig);

    expect(first.map((r) => r.chunk.id)).toEqual(second.map((r) => r.chunk.id));
    expect(first.map((r) => r.chunk.id)).toEqual(["a", "b"]);
  });

  it("skips (does not truncate) a chunk that doesn't fit in the remaining budget, then keeps trying lower-ranked chunks", () => {
    // budget = 4 tokens * 4 chars/token = 16 chars
    const config: RetrievalConfig = { ...baseConfig, tokenBudget: 4, charsPerToken: 4 };
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "big", text: "x".repeat(10) }), // highest activation, 10 chars
      chunk({ id: "toobig", text: "y".repeat(10) }), // next, 10 chars — 10+10=20 > 16, must be skipped
      chunk({ id: "small", text: "z".repeat(4) }), // lowest activation, 4 chars — 10+4=14 <= 16, fits after skip
    ]);
    const activation = activationMap([
      { chunkId: "big", activation: 0.9, stage: "lexical" },
      { chunkId: "toobig", activation: 0.8, stage: "lexical" },
      { chunkId: "small", activation: 0.1, stage: "semantic" },
    ]);

    const ranked = rankAndClipToBudget(activation, corpus, config);

    expect(ranked.map((r) => r.chunk.id)).toEqual(["big", "small"]);
    expect(ranked.find((r) => r.chunk.id === "toobig")).toBeUndefined();
    // no chunk's text was truncated — each included chunk's full text made it through
    expect(ranked[0].chunk.text).toBe("x".repeat(10));
    expect(ranked[1].chunk.text).toBe("z".repeat(4));
  });

  it("never exceeds the configured token budget in chars across all included chunks", () => {
    const config: RetrievalConfig = { ...baseConfig, tokenBudget: 4, charsPerToken: 4 }; // 16 chars
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "a", text: "a".repeat(9) }),
      chunk({ id: "b", text: "b".repeat(9) }),
    ]);
    const activation = activationMap([
      { chunkId: "a", activation: 0.9, stage: "lexical" },
      { chunkId: "b", activation: 0.8, stage: "lexical" },
    ]);

    const ranked = rankAndClipToBudget(activation, corpus, config);
    const totalChars = ranked.reduce((sum, r) => sum + r.chunk.text.length, 0);

    expect(totalChars).toBeLessThanOrEqual(16);
  });

  it("computes estimatedTokens per included chunk via the configured chars-per-token heuristic", () => {
    const corpus = new InMemoryChunkCorpus([chunk({ id: "a", text: "a".repeat(9) })]);
    const activation = activationMap([{ chunkId: "a", activation: 1, stage: "lexical" }]);

    const ranked = rankAndClipToBudget(activation, corpus, baseConfig);

    expect(ranked[0].estimatedTokens).toBe(3); // ceil(9/4)
  });

  it("carries the activation and stage through unchanged onto each ranked entry", () => {
    const corpus = new InMemoryChunkCorpus([chunk({ id: "a" })]);
    const activation = activationMap([{ chunkId: "a", activation: 0.42, stage: "link" }]);

    const ranked = rankAndClipToBudget(activation, corpus, baseConfig);

    expect(ranked[0].activation).toBe(0.42);
    expect(ranked[0].stage).toBe("link");
  });
});
