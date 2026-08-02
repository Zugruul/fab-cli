import { RetrievalEngine } from "../engine";
import type { RetrievalConfig, RetrievalFloors } from "../types";
import { InMemoryChunkCorpus, StaticEmbedder, StaticVectorStore, chunk } from "./testDoubles";

// End-to-end §9.7 pipeline: hybrid seeding -> bounded-hop link expansion ->
// activation-ranked selection within budget -> §10.4/§10.9 signal
// computation, all wired together through RetrievalEngine.query().

const config: RetrievalConfig = {
  semanticK: 8,
  maxHops: 2,
  hopDecay: 0.5,
  tokenBudget: 1024,
  charsPerToken: 4,
};

describe("RetrievalEngine.query", () => {
  it("returns ranked chunks tagging each with the stage that seeded it (lexical/semantic/link)", async () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "lex", tags: ["dominate"], links: [{ targetId: "linked", weight: 1 }] }),
      chunk({ id: "sem", tags: ["unrelated"] }),
      chunk({ id: "linked" }),
    ]);
    const vectorStore = new StaticVectorStore([{ chunkId: "sem", score: 0.6 }]);
    const embedder = new StaticEmbedder();
    const floors: RetrievalFloors = { retrievalFloor: 0.1, oodThreshold: 0.05 };

    const engine = new RetrievalEngine(corpus, vectorStore, embedder, floors, config);
    const result = await engine.query("dominate");

    const stageById = new Map(result.chunks.map((c) => [c.chunk.id, c.stage]));
    expect(stageById.get("lex")).toBe("lexical");
    expect(stageById.get("sem")).toBe("semantic");
    expect(stageById.get("linked")).toBe("link");
  });

  it("computes belowFloor from the injected (manifest-sourced) floors, not a hardcoded constant", async () => {
    const corpus = new InMemoryChunkCorpus([chunk({ id: "only", tags: ["dominate"] })]);
    const vectorStore = new StaticVectorStore([]);
    const embedder = new StaticEmbedder();

    const strictFloors: RetrievalFloors = { retrievalFloor: 2.0, oodThreshold: 1.5 }; // above any real activation
    const strictResult = await new RetrievalEngine(corpus, vectorStore, embedder, strictFloors, config).query(
      "dominate",
    );
    expect(strictResult.belowFloor).toBe(true); // lexical activation 1.0 < retrievalFloor 2.0

    const lenientFloors: RetrievalFloors = { retrievalFloor: 0.01, oodThreshold: 0.005 };
    const lenientResult = await new RetrievalEngine(corpus, vectorStore, embedder, lenientFloors, config).query(
      "dominate",
    );
    expect(lenientResult.belowFloor).toBe(false);
  });

  it("fires oodFastRefusal only when all three §10.9 conjuncts hold: no card name, below oodThreshold, zero lexical hits", async () => {
    const corpus = new InMemoryChunkCorpus([chunk({ id: "weak-semantic", tags: [] })]);
    const vectorStore = new StaticVectorStore([{ chunkId: "weak-semantic", score: 0.01 }]);
    const embedder = new StaticEmbedder();
    const floors: RetrievalFloors = { retrievalFloor: 0.5, oodThreshold: 0.2 };

    const engine = new RetrievalEngine(corpus, vectorStore, embedder, floors, config);
    const result = await engine.query("completely unrelated non-fab question");

    expect(result.oodFastRefusal).toBe(true);
    expect(result.belowFloor).toBe(true);
  });

  it("does not fire oodFastRefusal for a card-name-matched query, even though it goes through the §10.4 path", async () => {
    const corpus = new InMemoryChunkCorpus([chunk({ id: "card-1", cardNames: ["bravo, showstopper"] })]);
    const vectorStore = new StaticVectorStore([]);
    const embedder = new StaticEmbedder();
    const floors: RetrievalFloors = { retrievalFloor: 0.5, oodThreshold: 0.2 };

    const engine = new RetrievalEngine(corpus, vectorStore, embedder, floors, config);
    const result = await engine.query("bravo, showstopper");

    // exact card-name match => activation 1.0, above both floors here
    expect(result.oodFastRefusal).toBe(false);
    expect(result.belowFloor).toBe(false);
  });

  it("sums estimatedTokens of the returned chunks into usedTokens", async () => {
    const corpus = new InMemoryChunkCorpus([chunk({ id: "a", tags: ["dominate"], text: "a".repeat(8) })]);
    const vectorStore = new StaticVectorStore([]);
    const embedder = new StaticEmbedder();
    const floors: RetrievalFloors = { retrievalFloor: 0, oodThreshold: 0 };

    const engine = new RetrievalEngine(corpus, vectorStore, embedder, floors, config);
    const result = await engine.query("dominate");

    expect(result.usedTokens).toBe(2); // ceil(8/4)
  });

  it("returns no chunks and zero usedTokens for a query that matches nothing at all", async () => {
    const corpus = new InMemoryChunkCorpus([chunk({ id: "a", tags: ["dominate"] })]);
    const vectorStore = new StaticVectorStore([]);
    const embedder = new StaticEmbedder();
    const floors: RetrievalFloors = { retrievalFloor: 0.5, oodThreshold: 0.2 };

    const engine = new RetrievalEngine(corpus, vectorStore, embedder, floors, config);
    const result = await engine.query("nothing matches this at all");

    expect(result.chunks).toEqual([]);
    expect(result.usedTokens).toBe(0);
    expect(result.belowFloor).toBe(true); // topActivation defaults to 0 when nothing is retrieved
  });
});
