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

  // Amplification hardening (#196 review): the spec is silent on link
  // weight bounds, so a link.weight > 1/hopDecay could otherwise let
  // activation grow hop over hop instead of decaying. Decision: propagated
  // activation is clamped to never exceed the source's own activation
  // (effective per-hop multiplier is min(1, hopDecay * link.weight)) —
  // amplification is never sensible for spreading activation outward.

  it("does not oscillate or grow across an A<->B mutual-link cycle at weight 1 — bounded by maxHops", () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "a", links: [{ targetId: "b", weight: 1 }] }),
      chunk({ id: "b", links: [{ targetId: "a", weight: 1 }] }),
    ]);
    const cycleConfig: RetrievalConfig = { ...config, maxHops: 5 };

    const result = expandLinks(seed("a", 1.0), corpus, cycleConfig);

    // a -> b: 1.0 * 0.5 = 0.5; b -> a: 0.5 * 0.5 = 0.25, never exceeds a's
    // existing 1.0 seed activation, so nothing ever grows round-trip over
    // round-trip despite 5 hops being available.
    expect(result.get("a")?.activation).toBeCloseTo(1.0, 10);
    expect(result.get("b")?.activation).toBeCloseTo(0.5, 10);
  });

  it("clamps a link weight > 1/hopDecay so propagated activation never exceeds the source's activation", () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "a", links: [{ targetId: "b", weight: 10 }] }), // hopDecay(0.5) * 10 = 5, unclamped would amplify 5x
      chunk({ id: "b" }),
    ]);

    const result = expandLinks(seed("a", 1.0), corpus, config);

    // effective multiplier clamped to min(1, 0.5 * 10) = 1, so b's
    // activation equals (never exceeds) a's source activation.
    expect(result.get("b")?.activation).toBeCloseTo(1.0, 10);
    expect(result.get("b")!.activation).toBeLessThanOrEqual(1.0);
  });

  it("does not amplify across a mutual-link cycle even when both links have weight > 1/hopDecay", () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "a", links: [{ targetId: "b", weight: 3 }] }),
      chunk({ id: "b", links: [{ targetId: "a", weight: 3 }] }),
    ]);
    const cycleConfig: RetrievalConfig = { ...config, maxHops: 6 };

    const result = expandLinks(seed("a", 1.0), corpus, cycleConfig);

    // Every hop clamps to multiplier 1 (min(1, 0.5*3)), so activation just
    // passes through unchanged — it never exceeds the original seed value
    // no matter how many hops the cycle runs for.
    expect(result.get("a")!.activation).toBeLessThanOrEqual(1.0);
    expect(result.get("b")!.activation).toBeLessThanOrEqual(1.0);
    expect(result.get("a")?.activation).toBeCloseTo(1.0, 10);
    expect(result.get("b")?.activation).toBeCloseTo(1.0, 10);
  });

  it("weight <= 1/hopDecay is unaffected by the clamp (regression: unchanged from pre-hardening behavior)", () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "a", links: [{ targetId: "b", weight: 1 }] }),
      chunk({ id: "b" }),
      chunk({ id: "c", links: [{ targetId: "d", weight: 0.4 }] }),
      chunk({ id: "d" }),
    ]);

    const resultB = expandLinks(seed("a", 1.0), corpus, config);
    const resultD = expandLinks(seed("c", 1.0), corpus, config);

    expect(resultB.get("b")?.activation).toBeCloseTo(0.5, 10); // 1.0 * 0.5 * 1, unclamped since 0.5*1 <= 1
    expect(resultD.get("d")?.activation).toBeCloseTo(0.2, 10); // 1.0 * 0.5 * 0.4, unclamped since 0.5*0.4 <= 1
  });

  // Negative/NaN/self-loop hardening (BUG-198 review round 2): the
  // one-sided clamp above (min(1, hopDecay * link.weight)) only bounds the
  // upper end. A negative link.weight passes straight through the clamp
  // (min(1, negative) is the negative number itself) and, through double
  // negation over two hops of a mutual link, re-amplifies past the seed's
  // own activation instead of decaying — the exact "never exceeds source
  // activation" invariant the clamp exists to guarantee. NaN/Infinity
  // weights poison downstream activations the same way. Link weights are
  // untrusted pack-authored data, so the fix must ignore (skip) any
  // non-positive or non-finite effective multiplier entirely.

  it("ignores a negative link weight instead of letting double negation re-amplify around a mutual-link cycle", () => {
    const corpus = new InMemoryChunkCorpus([
      chunk({ id: "a", links: [{ targetId: "b", weight: -4 }] }),
      chunk({ id: "b", links: [{ targetId: "a", weight: -4 }] }),
    ]);
    const cycleConfig: RetrievalConfig = { ...config, hopDecay: 0.5, maxHops: 6 };

    const result = expandLinks(seed("a", 1.0, "lexical"), corpus, cycleConfig);

    // Without the fix: a->b: 1.0 * (0.5 * -4) = -2; b->a: -2 * -2 = 4 —
    // a's activation would balloon to 4.0 and its stage would flip to
    // "link". With the fix, the negative-weight link never propagates at
    // all, so a stays exactly at its seed value/stage and b gets nothing.
    expect(result.get("a")).toEqual({ chunkId: "a", activation: 1.0, stage: "lexical" });
    expect(result.has("b")).toBe(false);
  });

  it("does not self-amplify through a self-loop link with weight > 1/hopDecay", () => {
    const corpus = new InMemoryChunkCorpus([chunk({ id: "a", links: [{ targetId: "a", weight: 10 }] })]);
    const cycleConfig: RetrievalConfig = { ...config, hopDecay: 0.5, maxHops: 6 };

    const result = expandLinks(seed("a", 1.0, "lexical"), corpus, cycleConfig);

    expect(result.get("a")).toEqual({ chunkId: "a", activation: 1.0, stage: "lexical" });
  });

  it("does not let a NaN link weight poison activations", () => {
    const withNaNLink = new InMemoryChunkCorpus([
      chunk({ id: "a", links: [{ targetId: "b", weight: Number.NaN }] }),
      chunk({ id: "b" }),
    ]);
    const withoutThatLink = new InMemoryChunkCorpus([chunk({ id: "a", links: [] }), chunk({ id: "b" })]);

    const result = expandLinks(seed("a", 1.0), withNaNLink, config);
    const baseline = expandLinks(seed("a", 1.0), withoutThatLink, config);

    expect(result.get("a")?.activation).not.toBeNaN();
    expect(result.has("b")).toBe(false);
    expect([...result.entries()]).toEqual([...baseline.entries()]);
  });

  it("does not let an Infinity link weight poison activations", () => {
    const withInfLink = new InMemoryChunkCorpus([
      chunk({ id: "a", links: [{ targetId: "b", weight: Number.POSITIVE_INFINITY }] }),
      chunk({ id: "b" }),
    ]);
    const withoutThatLink = new InMemoryChunkCorpus([chunk({ id: "a", links: [] }), chunk({ id: "b" })]);

    const result = expandLinks(seed("a", 1.0), withInfLink, config);
    const baseline = expandLinks(seed("a", 1.0), withoutThatLink, config);

    expect(Number.isFinite(result.get("a")?.activation)).toBe(true);
    expect(result.has("b")).toBe(false);
    expect([...result.entries()]).toEqual([...baseline.entries()]);
  });
});
