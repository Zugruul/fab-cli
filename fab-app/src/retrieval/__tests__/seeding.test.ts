import { hybridSeed } from "../seeding";
import { LexicalIndex } from "../lexicalIndex";
import { DEFAULT_RETRIEVAL_CONFIG } from "../types";
import { InMemoryChunkCorpus, StaticEmbedder, StaticVectorStore, chunk } from "./testDoubles";

// §9.7: "hybrid seeding (lexical exact/tag match ∪ top-K sqlite-vec
// neighbors)". These tests cover the union directly: a lexical-only hit, a
// semantic-only hit, and the dedupe rule when a chunk is hit by both.

describe("hybridSeed", () => {
  it("seeds a lexical-only hit (tag match) with activation 1.0 and stage lexical", async () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "cr-1", tags: ["dominate"] }),
      chunk({ id: "cr-2", tags: ["go-again"] }),
    ]);
    const lexicalIndex = new LexicalIndex(corpus);
    const vectorStore = new StaticVectorStore([]); // no semantic neighbors at all
    const embedder = new StaticEmbedder();

    const result = await hybridSeed(
      "dominate",
      lexicalIndex,
      vectorStore,
      embedder,
      corpus,
      DEFAULT_RETRIEVAL_CONFIG,
    );

    expect([...result.activation.keys()]).toEqual(["cr-1"]);
    expect(result.activation.get("cr-1")).toEqual({ chunkId: "cr-1", activation: 1.0, stage: "lexical" });
    expect(result.lexicalHitCount).toBe(1);
  });

  it("seeds a semantic-only hit (embedding neighbor, no lexical match) with its similarity score and stage semantic", async () => {
    const corpus = new InMemoryChunkCorpus([chunk({ id: "lore-9", tags: ["unrelated-tag"] })]);
    const lexicalIndex = new LexicalIndex(corpus);
    const vectorStore = new StaticVectorStore([{ chunkId: "lore-9", score: 0.63 }]);
    const embedder = new StaticEmbedder();

    const result = await hybridSeed(
      "who is arakni",
      lexicalIndex,
      vectorStore,
      embedder,
      corpus,
      DEFAULT_RETRIEVAL_CONFIG,
    );

    expect(result.activation.get("lore-9")).toEqual({ chunkId: "lore-9", activation: 0.63, stage: "semantic" });
    expect(result.lexicalHitCount).toBe(0);
  });

  it("dedupes a chunk hit by both stages, keeping the higher activation and its stage — lexical (1.0) beats a sub-1.0 semantic score", async () => {
    const corpus = new InMemoryChunkCorpus([chunk({ id: "cr-1", tags: ["dominate"] })]);
    const lexicalIndex = new LexicalIndex(corpus);
    const vectorStore = new StaticVectorStore([{ chunkId: "cr-1", score: 0.4 }]);
    const embedder = new StaticEmbedder();

    const result = await hybridSeed(
      "dominate",
      lexicalIndex,
      vectorStore,
      embedder,
      corpus,
      DEFAULT_RETRIEVAL_CONFIG,
    );

    expect(result.activation.size).toBe(1);
    expect(result.activation.get("cr-1")).toEqual({ chunkId: "cr-1", activation: 1.0, stage: "lexical" });
  });

  it("ignores neighbors/lexical hits that reference a chunk id not present in the corpus", async () => {
    const corpus = new InMemoryChunkCorpus([chunk({ id: "cr-1", tags: ["dominate"] })]);
    const lexicalIndex = new LexicalIndex(corpus);
    const vectorStore = new StaticVectorStore([{ chunkId: "ghost-chunk", score: 0.9 }]);
    const embedder = new StaticEmbedder();

    const result = await hybridSeed(
      "dominate",
      lexicalIndex,
      vectorStore,
      embedder,
      corpus,
      DEFAULT_RETRIEVAL_CONFIG,
    );

    expect([...result.activation.keys()]).toEqual(["cr-1"]);
  });

  it("reports cardNameMatched true only when a hit came from an exact card-name match, not a tag match (§10.9 conjunct input)", async () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "card-1", cardNames: ["bravo, showstopper"] }),
      chunk({ id: "tag-1", tags: ["dominate"] }),
    ]);
    const lexicalIndex = new LexicalIndex(corpus);
    const vectorStore = new StaticVectorStore([]);
    const embedder = new StaticEmbedder();

    const byName = await hybridSeed(
      "bravo, showstopper",
      lexicalIndex,
      vectorStore,
      embedder,
      corpus,
      DEFAULT_RETRIEVAL_CONFIG,
    );
    expect(byName.cardNameMatched).toBe(true);

    const byTag = await hybridSeed("dominate", lexicalIndex, vectorStore, embedder, corpus, DEFAULT_RETRIEVAL_CONFIG);
    expect(byTag.cardNameMatched).toBe(false);
  });

  it("respects config.semanticK, taking only the top-K embedding neighbors offered by the vector store", async () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "n1" }),
      chunk({ id: "n2" }),
      chunk({ id: "n3" }),
    ]);
    const lexicalIndex = new LexicalIndex(corpus);
    const vectorStore = new StaticVectorStore([
      { chunkId: "n1", score: 0.9 },
      { chunkId: "n2", score: 0.8 },
      { chunkId: "n3", score: 0.7 },
    ]);
    const embedder = new StaticEmbedder();

    const result = await hybridSeed(
      "query",
      lexicalIndex,
      vectorStore,
      embedder,
      corpus,
      { ...DEFAULT_RETRIEVAL_CONFIG, semanticK: 2 },
    );

    expect([...result.activation.keys()].sort()).toEqual(["n1", "n2"]);
  });
});
