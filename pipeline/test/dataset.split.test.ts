import { describe, it, expect } from "vitest";
import { assignSplits, type SplitConfig, type UnsplitDatasetExample } from "../src/dataset/split.js";

function baseConfig(overrides: Partial<SplitConfig> = {}): SplitConfig {
  return { seed: 12345, evalFraction: 0.2, minEvalChunksPerCategory: 1, ...overrides };
}

function qaEx(id: string, chunk_id: string, category: UnsplitDatasetExample["category"]): UnsplitDatasetExample {
  return {
    id,
    category,
    adjudicationCritical: false,
    exampleType: "qa",
    chunkId: chunk_id,
    payload: { id, chunk_id, question: "q?", answer: "a.", cited_chunk_ids: [chunk_id], entailmentChecked: true },
  };
}

function abstentionEx(id: string, sourceChunkId: string): UnsplitDatasetExample {
  return {
    id,
    category: "abstention",
    adjudicationCritical: false,
    exampleType: "abstention",
    chunkId: sourceChunkId,
    payload: {
      id,
      category: "abstention",
      sourceChunkId,
      question: "q?",
      contextChunkIds: [],
      target: { answer: "not clearly settled", citation_ids: [], confidence: "abstain", abstained: true, escalation: "ask a judge" },
    },
  };
}

function oodEx(id: string): UnsplitDatasetExample {
  return {
    id,
    category: "ood",
    adjudicationCritical: false,
    exampleType: "ood",
    chunkId: null,
    payload: { id, category: "ood", style: "sports", question: "q?", target: { answer: "no", citation_ids: [], confidence: "high" } },
  };
}

describe("assignSplits — chunk-grouped disjointness for §7.8 categories", () => {
  it("assigns every example sharing a chunkId to the SAME split (never splits one chunk's examples across train/eval)", () => {
    const examples: UnsplitDatasetExample[] = [];
    for (let i = 0; i < 10; i++) {
      const chunkId = `brain/card-vault/kw-keyword-${i}`;
      // Two examples grounded in the same chunk (e.g. two QA pairs from one chunk).
      examples.push(qaEx(`qa-${chunkId}-0`, chunkId, "keyword-definitions"));
      examples.push(qaEx(`qa-${chunkId}-1`, chunkId, "keyword-definitions"));
    }

    const assignment = assignSplits(examples, baseConfig());
    for (let i = 0; i < 10; i++) {
      const chunkId = `brain/card-vault/kw-keyword-${i}`;
      expect(assignment[`qa-${chunkId}-0`]).toBe(assignment[`qa-${chunkId}-1`]);
    }
  });

  it("holds out roughly evalFraction of distinct chunks per category, never zero and never all when there are enough chunks", () => {
    const examples: UnsplitDatasetExample[] = Array.from({ length: 20 }, (_, i) =>
      qaEx(`qa-${i}`, `brain/card-vault/kw-keyword-${i}`, "keyword-definitions"),
    );
    const assignment = assignSplits(examples, baseConfig({ evalFraction: 0.2 }));
    const evalCount = Object.values(assignment).filter((s) => s === "eval").length;
    expect(evalCount).toBeGreaterThan(0);
    expect(evalCount).toBeLessThan(20);
    // ~20% of 20 = 4
    expect(evalCount).toBe(4);
  });

  it("keeps a single-chunk category fully in train (can't split one chunk without leaking or emptying train)", () => {
    const examples: UnsplitDatasetExample[] = [qaEx("qa-1", "brain/card-vault/kw-only-chunk", "keyword-definitions")];
    const assignment = assignSplits(examples, baseConfig());
    expect(assignment["qa-1"]).toBe("train");
  });

  it("splits categories independently — a tiny category isn't starved by a large one", () => {
    const examples: UnsplitDatasetExample[] = [
      ...Array.from({ length: 20 }, (_, i) => qaEx(`qa-kd-${i}`, `brain/card-vault/kw-${i}`, "keyword-definitions")),
      qaEx("qa-cf-0", "brain/card-vault/card-only", "card-facts"),
      qaEx("qa-cf-1", "brain/card-vault/card-second", "card-facts"),
    ];
    const assignment = assignSplits(examples, baseConfig({ minEvalChunksPerCategory: 1 }));
    const cfSplits = [assignment["qa-cf-0"], assignment["qa-cf-1"]];
    expect(cfSplits).toContain("eval");
    expect(cfSplits).toContain("train");
  });

  it("splits abstention examples PER EXAMPLE, independent of shared sourceChunkId (audit-only, no grounding leakage)", () => {
    // Multiple abstention examples all citing the SAME sourceChunkId for
    // audit — since that chunk never actually grounds the abstention
    // answer, they're allowed to land on either side independently.
    const examples: UnsplitDatasetExample[] = Array.from({ length: 10 }, (_, i) =>
      abstentionEx(`abstention-${i}`, "brain/judge/shared-audit-chunk"),
    );
    const assignment = assignSplits(examples, baseConfig({ evalFraction: 0.3 }));
    const splits = new Set(Object.values(assignment));
    // With 10 examples and a shared chunkId, a chunk-grouped algorithm would
    // put them all on one side; a per-example algorithm can put some in eval.
    expect(splits.has("eval")).toBe(true);
    expect(splits.has("train")).toBe(true);
  });

  it("splits ood examples per example (no chunkId at all)", () => {
    const examples: UnsplitDatasetExample[] = Array.from({ length: 10 }, (_, i) => oodEx(`ood-${i}`));
    const assignment = assignSplits(examples, baseConfig({ evalFraction: 0.3 }));
    const splits = new Set(Object.values(assignment));
    expect(splits.has("eval")).toBe(true);
    expect(splits.has("train")).toBe(true);
  });

  it("is deterministic: the same seed + inputs always produce the same assignment", () => {
    const examples: UnsplitDatasetExample[] = Array.from({ length: 15 }, (_, i) =>
      qaEx(`qa-${i}`, `brain/card-vault/kw-${i}`, "keyword-definitions"),
    );
    const a = assignSplits(examples, baseConfig({ seed: 999 }));
    const b = assignSplits(examples, baseConfig({ seed: 999 }));
    expect(a).toEqual(b);
  });

  it("a different seed can change the assignment", () => {
    const examples: UnsplitDatasetExample[] = Array.from({ length: 15 }, (_, i) =>
      qaEx(`qa-${i}`, `brain/card-vault/kw-${i}`, "keyword-definitions"),
    );
    const a = assignSplits(examples, baseConfig({ seed: 1 }));
    const b = assignSplits(examples, baseConfig({ seed: 2 }));
    expect(a).not.toEqual(b);
  });

  it("is independent of input array order (sorted internally before shuffling)", () => {
    const examples: UnsplitDatasetExample[] = Array.from({ length: 15 }, (_, i) =>
      qaEx(`qa-${i}`, `brain/card-vault/kw-${i}`, "keyword-definitions"),
    );
    const reversed = [...examples].reverse();
    const a = assignSplits(examples, baseConfig());
    const b = assignSplits(reversed, baseConfig());
    expect(a).toEqual(b);
  });
});
