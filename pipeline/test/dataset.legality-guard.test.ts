import { describe, it, expect } from "vitest";
import { runLegalityGuard, assertLegalityGuard } from "../src/dataset/legalityGuard.js";
import { assembleDataset, type AssembleDatasetOptions } from "../src/dataset/assemble.js";
import type { DatasetExample } from "../src/dataset/types.js";
import { makeChunk, makeLegalityChunk, makeDistractorExample, makeDPOPair } from "./dataset.helpers.js";

function baseAssembleOptions(overrides: Partial<AssembleDatasetOptions> = {}): AssembleDatasetOptions {
  return {
    chunks: [],
    qaPairRecords: [],
    acceptedRecords: [],
    rejectedRecords: [],
    distractorExamples: [],
    abstentionExamples: [],
    oodExamples: [],
    dpoPairs: [],
    split: { seed: 20260802, evalFraction: 0.2, minEvalChunksPerCategory: 1 },
    ...overrides,
  };
}

function qaExample(chunkId: string, overrides: Partial<DatasetExample> = {}): DatasetExample {
  return {
    id: `qa-${chunkId}`,
    category: "card-facts",
    exampleType: "qa",
    chunkId,
    split: "train",
    adjudicationCritical: false,
    payload: {
      id: `qa-${chunkId}`,
      chunk_id: chunkId,
      question: "q?",
      answer: "a.",
      cited_chunk_ids: [chunkId],
      entailmentChecked: true,
    },
    ...overrides,
  } as DatasetExample;
}

function distractorDatasetExample(chunkId: string, timeSensitive: boolean): DatasetExample {
  const payload = makeDistractorExample(chunkId, 0, { timeSensitive });
  return {
    id: payload.id,
    category: "tournament-procedure",
    exampleType: "distractor",
    chunkId,
    split: "train",
    adjudicationCritical: false,
    payload,
  } as DatasetExample;
}

function dpoDatasetExample(chunkId: string): DatasetExample {
  const payload = makeDPOPair(chunkId, 0);
  return {
    id: payload.id,
    category: "tournament-procedure",
    exampleType: "dpo",
    chunkId,
    split: "train",
    adjudicationCritical: false,
    payload,
  } as DatasetExample;
}

function abstentionDatasetExample(chunkId: string): DatasetExample {
  return {
    id: `abstention-${chunkId}`,
    category: "abstention",
    exampleType: "abstention",
    chunkId,
    split: "train",
    adjudicationCritical: false,
    payload: {
      id: `abstention-${chunkId}`,
      category: "abstention",
      sourceChunkId: chunkId,
      question: "q?",
      contextChunkIds: [],
      target: { answer: "not clearly settled", citation_ids: [], confidence: "abstain", abstained: true, escalation: "ask a judge" },
    },
  } as DatasetExample;
}

function oodDatasetExample(): DatasetExample {
  return {
    id: "ood-1",
    category: "ood",
    exampleType: "ood",
    chunkId: null,
    split: "train",
    adjudicationCritical: false,
    payload: { id: "ood-1", category: "ood", style: "sports", question: "q?", target: { answer: "a", citation_ids: [], confidence: "high" } },
  } as DatasetExample;
}

describe("runLegalityGuard", () => {
  it("is ok with no violations for an all-clean example set (non-legality chunks throughout)", () => {
    const other = makeChunk({ chunk_id: "rules/cr/1.1", tags: ["cr", "rules"] });
    const examples = [qaExample(other.chunk_id), dpoDatasetExample(other.chunk_id), distractorDatasetExample(other.chunk_id, false)];
    const result = runLegalityGuard(examples, [other]);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("flags a qa example grounded in a legality chunk", () => {
    const legality = makeLegalityChunk();
    const result = runLegalityGuard([qaExample(legality.chunk_id)], [legality]);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({ exampleType: "qa", chunkId: legality.chunk_id });
  });

  it("flags a dpo example grounded in a legality chunk", () => {
    const legality = makeLegalityChunk();
    const result = runLegalityGuard([dpoDatasetExample(legality.chunk_id)], [legality]);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].exampleType).toBe("dpo");
  });

  it("ALLOWS a distractor example grounded in a legality chunk when marked timeSensitive (the §7.9 carve-out)", () => {
    const legality = makeLegalityChunk();
    const result = runLegalityGuard([distractorDatasetExample(legality.chunk_id, true)], [legality]);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("flags a distractor example grounded in a legality chunk but NOT marked timeSensitive (mis-marked shape, not the allowed carve-out)", () => {
    const legality = makeLegalityChunk();
    const result = runLegalityGuard([distractorDatasetExample(legality.chunk_id, false)], [legality]);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].exampleType).toBe("distractor");
  });

  it("never flags abstention or ood examples, even when their (audit-only / absent) chunkId matches a legality chunk", () => {
    const legality = makeLegalityChunk();
    const result = runLegalityGuard([abstentionDatasetExample(legality.chunk_id), oodDatasetExample()], [legality]);
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("counts how many examples it actually checked (excludes abstention/ood, includes qa/distractor/dpo)", () => {
    const other = makeChunk({ chunk_id: "rules/cr/1.1", tags: ["cr", "rules"] });
    const legality = makeLegalityChunk();
    const examples = [
      qaExample(other.chunk_id),
      distractorDatasetExample(legality.chunk_id, true),
      abstentionDatasetExample(other.chunk_id),
      oodDatasetExample(),
    ];
    const result = runLegalityGuard(examples, [other, legality]);
    expect(result.checked).toBe(2);
  });
});

describe("assertLegalityGuard", () => {
  it("does not throw for a clean example set", () => {
    const other = makeChunk({ chunk_id: "rules/cr/1.1", tags: ["cr", "rules"] });
    expect(() => assertLegalityGuard([qaExample(other.chunk_id)], [other])).not.toThrow();
  });

  it("throws loudly, naming the offending example(s) and chunk_id(s), when a legality chunk appears in fact-SFT output", () => {
    const legality = makeLegalityChunk();
    expect(() => assertLegalityGuard([qaExample(legality.chunk_id)], [legality])).toThrow(
      new RegExp(`qa-${legality.chunk_id.replace(/\//g, "\\/")}`),
    );
    try {
      assertLegalityGuard([qaExample(legality.chunk_id)], [legality]);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toMatch(/§7\.9/);
      expect((err as Error).message).toContain(legality.chunk_id);
    }
  });
});

describe("assembleDataset — legality guard is enforced at the source, not just by callers who remember to check", () => {
  // A programmatic caller of assembleDataset() (not just the dataset:build
  // CLI) must never get unguarded output back — the guard has to live
  // INSIDE assembleDataset itself, alongside its existing checkLeakage
  // throw-don't-return-bad-output check, not bolted on one layer up by
  // every call site individually.
  it("THROWS when a distractor artifact carries a legality chunk but isn't marked timeSensitive (mis-marked shape slips past assembly's own per-field filters)", () => {
    const legality = makeLegalityChunk();
    const distractorExamples = [makeDistractorExample(legality.chunk_id, 0, { timeSensitive: false })];
    expect(() => assembleDataset(baseAssembleOptions({ chunks: [legality], distractorExamples }))).toThrow(/§7\.9/);
  });

  it("does not throw when the same legality-chunk distractor is correctly marked timeSensitive (the §7.9 carve-out)", () => {
    const legality = makeLegalityChunk();
    const distractorExamples = [makeDistractorExample(legality.chunk_id, 0, { timeSensitive: true })];
    const result = assembleDataset(baseAssembleOptions({ chunks: [legality], distractorExamples }));
    expect(result.examples.filter((e) => e.exampleType === "distractor")).toHaveLength(1);
  });
});
