import { expandLinks } from "../linkExpansion";
import type { ActivatedChunk, RetrievalConfig } from "../types";
import { InMemoryChunkCorpus, chunk } from "./testDoubles";

// §9.7: "bounded-hop link expansion" — seeds propagate along chunk links[],
// max-hops config, activation decay per hop, max per-note activation kept.

const config: RetrievalConfig = {
  semanticK: 8,
  maxHops: 2,
  hopDecay: 0.5,
  tokenBudget: 1024,
  charsPerToken: 4,
};

function seed(chunkId: string, activation: number, stage: ActivatedChunk["stage"] = "lexical"): Map<string, ActivatedChunk> {
  return new Map([[chunkId, { chunkId, activation, stage }]]);
}

describe("expandLinks", () => {
  it("propagates activation to a 1-hop neighbor, decayed by hopDecay * link weight", () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "a", links: [{ targetId: "b", weight: 1 }] }),
      chunk({ id: "b" }),
    ]);

    const result = expandLinks(seed("a", 1.0), corpus, config);

    expect(result.get("b")).toEqual({ chunkId: "b", activation: 0.5, stage: "link" }); // 1.0 * 0.5 * 1
  });

  it("multiplies hopDecay by the link's own weight", () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "a", links: [{ targetId: "b", weight: 0.4 }] }),
      chunk({ id: "b" }),
    ]);

    const result = expandLinks(seed("a", 1.0), corpus, config);

    expect(result.get("b")?.activation).toBeCloseTo(0.2, 10); // 1.0 * 0.5 * 0.4
  });

  it("respects config.maxHops — a note 3 hops away is never reached with maxHops=2", () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "a", links: [{ targetId: "b", weight: 1 }] }),
      chunk({ id: "b", links: [{ targetId: "c", weight: 1 }] }),
      chunk({ id: "c", links: [{ targetId: "d", weight: 1 }] }),
      chunk({ id: "d" }),
    ]);

    const result = expandLinks(seed("a", 1.0), corpus, config);

    expect(result.has("b")).toBe(true); // 1 hop
    expect(result.has("c")).toBe(true); // 2 hops
    expect(result.has("d")).toBe(false); // 3 hops — beyond maxHops
  });

  it("keeps the maximum activation when a note is reached via two different paths", () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "a", links: [{ targetId: "target", weight: 1 }] }), // weak seed
      chunk({ id: "b", links: [{ targetId: "target", weight: 1 }] }), // strong seed
      chunk({ id: "target" }),
    ]);
    const seeds = new Map<string, ActivatedChunk>([
      ["a", { chunkId: "a", activation: 0.2, stage: "lexical" }],
      ["b", { chunkId: "b", activation: 1.0, stage: "semantic" }],
    ]);

    const result = expandLinks(seeds, corpus, config);

    // via a: 0.2 * 0.5 = 0.1; via b: 1.0 * 0.5 = 0.5 — the max wins
    expect(result.get("target")?.activation).toBeCloseTo(0.5, 10);
  });

  it("skips a link pointing at a chunk id absent from the corpus (dangling link) without throwing", () => {
    const corpus = new InMemoryChunkCorpus([chunk({ id: "a", links: [{ targetId: "missing", weight: 1 }] })]);

    expect(() => expandLinks(seed("a", 1.0), corpus, config)).not.toThrow();
    const result = expandLinks(seed("a", 1.0), corpus, config);
    expect(result.has("missing")).toBe(false);
  });

  it("is deterministic across repeated runs on the same input, independent of link declaration order", () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({
        id: "z",
        links: [
          { targetId: "m", weight: 1 },
          { targetId: "a", weight: 1 },
        ],
      }),
      chunk({ id: "m" }),
      chunk({ id: "a" }),
    ]);

    const runA = expandLinks(seed("z", 1.0), corpus, config);
    const runB = expandLinks(seed("z", 1.0), corpus, config);

    expect([...runA.entries()]).toEqual([...runB.entries()]);
    expect(runA.get("m")?.activation).toBeCloseTo(0.5, 10);
    expect(runA.get("a")?.activation).toBeCloseTo(0.5, 10);
  });

  it("a seed's own activation/stage is preserved when no link ever produces a higher value for it", () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "a", links: [{ targetId: "b", weight: 1 }] }),
      chunk({ id: "b" }),
    ]);

    const result = expandLinks(seed("a", 1.0, "semantic"), corpus, config);

    expect(result.get("a")).toEqual({ chunkId: "a", activation: 1.0, stage: "semantic" });
  });
});
