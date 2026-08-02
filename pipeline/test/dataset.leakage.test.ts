import { describe, it, expect } from "vitest";
import { checkLeakage, type LeakageCheckable } from "../src/dataset/leakage.js";
import { assignSplits, type SplitConfig, type UnsplitDatasetExample } from "../src/dataset/split.js";

// SPEC-APP.md §7.8 headline AC: "a test proving no train/eval overlap of
// source chunks where the category requires disjointness" — this is that
// test, plus the required companion: an injected-leak fixture that MUST
// fail the check (proving checkLeakage actually detects a real leak,
// rather than being a check that always passes).

function baseConfig(overrides: Partial<SplitConfig> = {}): SplitConfig {
  return { seed: 20260802, evalFraction: 0.25, minEvalChunksPerCategory: 1, ...overrides };
}

function qaEx(id: string, chunk_id: string, category: UnsplitDatasetExample["category"]): UnsplitDatasetExample {
  return {
    id,
    category,
    exampleType: "qa",
    chunkId: chunk_id,
    payload: { id, chunk_id, question: "q?", answer: "a.", cited_chunk_ids: [chunk_id], entailmentChecked: true },
  };
}

describe("checkLeakage", () => {
  it("reports ok:true and no overlaps for a clean, real split across every disjointness-required category", () => {
    const categories: UnsplitDatasetExample["category"][] = [
      "keyword-definitions",
      "card-facts",
      "multi-card-interactions",
      "tournament-procedure",
      "lore",
    ];
    const examples: UnsplitDatasetExample[] = [];
    for (const category of categories) {
      for (let i = 0; i < 10; i++) {
        const chunkId = `${category}/chunk-${i}`;
        // Two examples per chunk (e.g. a QA pair plus a distractor example
        // grounded in the same chunk) — both must land on the same side.
        examples.push(qaEx(`qa-${category}-${i}-0`, chunkId, category));
        examples.push(qaEx(`qa-${category}-${i}-1`, chunkId, category));
      }
    }

    const assignment = assignSplits(examples, baseConfig());
    const withSplits: LeakageCheckable[] = examples.map((e) => ({
      category: e.category,
      chunkId: e.chunkId,
      split: assignment[e.id],
    }));

    const result = checkLeakage(withSplits);
    expect(result.ok).toBe(true);
    expect(result.overlaps).toEqual([]);
  });

  it("FAILS the check on an injected leak: the same chunk_id assigned to both train and eval within a disjointness-required category", () => {
    const leaky: LeakageCheckable[] = [
      { category: "keyword-definitions", chunkId: "brain/card-vault/kw-dominate", split: "train" },
      { category: "keyword-definitions", chunkId: "brain/card-vault/kw-dominate", split: "eval" },
      { category: "keyword-definitions", chunkId: "brain/card-vault/kw-block", split: "train" },
    ];

    const result = checkLeakage(leaky);
    expect(result.ok).toBe(false);
    expect(result.overlaps).toEqual([{ category: "keyword-definitions", chunkId: "brain/card-vault/kw-dominate" }]);
  });

  it("catches multiple independent leaks across categories, sorted deterministically", () => {
    const leaky: LeakageCheckable[] = [
      { category: "card-facts", chunkId: "chunk-b", split: "eval" },
      { category: "card-facts", chunkId: "chunk-b", split: "train" },
      { category: "lore", chunkId: "chunk-a", split: "train" },
      { category: "lore", chunkId: "chunk-a", split: "eval" },
    ];
    const result = checkLeakage(leaky);
    expect(result.ok).toBe(false);
    expect(result.overlaps).toEqual([
      { category: "card-facts", chunkId: "chunk-b" },
      { category: "lore", chunkId: "chunk-a" },
    ]);
  });

  it("does NOT flag abstention/ood as leaking even when the same chunkId appears on both sides — they're excluded from disjointness by design", () => {
    const notLeaky: LeakageCheckable[] = [
      { category: "abstention", chunkId: "brain/judge/shared-audit-chunk", split: "train" },
      { category: "abstention", chunkId: "brain/judge/shared-audit-chunk", split: "eval" },
      { category: "ood", chunkId: null, split: "train" },
      { category: "ood", chunkId: null, split: "eval" },
    ];
    const result = checkLeakage(notLeaky);
    expect(result.ok).toBe(true);
    expect(result.overlaps).toEqual([]);
  });

  it("ignores examples with a null chunkId in disjointness-required categories rather than crashing", () => {
    const examples: LeakageCheckable[] = [{ category: "lore", chunkId: null, split: "train" }];
    expect(() => checkLeakage(examples)).not.toThrow();
    expect(checkLeakage(examples).ok).toBe(true);
  });
});
