import { describe, it, expect } from "vitest";
import { assembleDataset, type AssembleDatasetOptions } from "../src/dataset/assemble.js";
import { checkLeakage } from "../src/dataset/leakage.js";
import {
  makeChunks,
  makeLegalityChunk,
  makePairsRecord,
  makeSampledRecord,
  makeDistractorExample,
  makeAbstentionExample,
  makeOODExample,
  makeDPOPair,
} from "./dataset.helpers.js";

function baseOptions(overrides: Partial<AssembleDatasetOptions> = {}): AssembleDatasetOptions {
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

describe("assembleDataset", () => {
  it("builds QA examples from qa-pairs.jsonl when sampling hasn't run, marking entailmentChecked false and noting the fallback honestly", () => {
    const chunks = makeChunks(3);
    const qaPairRecords = chunks.map((c) => makePairsRecord(c.chunk_id, 2));
    const result = assembleDataset(baseOptions({ chunks, qaPairRecords }));

    expect(result.qaSource).toBe("qa-pairs-fallback");
    const qaExamples = result.examples.filter((e) => e.exampleType === "qa");
    expect(qaExamples.length).toBe(6);
    for (const ex of qaExamples) {
      expect((ex.payload as { entailmentChecked: boolean }).entailmentChecked).toBe(false);
    }
    expect(result.notes.some((n) => /sampling has not run/i.test(n))).toBe(true);
  });

  it("prefers sampling's entailment-checked accepted.jsonl over qa-pairs.jsonl when sampling HAS run", () => {
    const chunks = makeChunks(2);
    const qaPairRecords = chunks.map((c) => makePairsRecord(c.chunk_id, 3)); // would be 6 if used
    const acceptedRecords = chunks.map((c, i) => makeSampledRecord(c.chunk_id, i));
    const result = assembleDataset(
      baseOptions({ chunks, qaPairRecords, acceptedRecords, rejectedRecords: [] }),
    );

    expect(result.qaSource).toBe("sampling-accepted");
    const qaExamples = result.examples.filter((e) => e.exampleType === "qa");
    expect(qaExamples.length).toBe(2); // one per accepted record, NOT the raw qa-pairs count
    for (const ex of qaExamples) {
      expect((ex.payload as { entailmentChecked: boolean }).entailmentChecked).toBe(true);
    }
    expect(result.notes.some((n) => /sampling has not run/i.test(n))).toBe(false);
  });

  it("treats sampling as having run even with zero accepted records, as long as rejected.jsonl has entries (no silent fallback to unverified pairs)", () => {
    const chunks = makeChunks(1);
    const qaPairRecords = chunks.map((c) => makePairsRecord(c.chunk_id, 2));
    const rejectedRecords = [makeSampledRecord(chunks[0].chunk_id, 0, { rejectionKind: "not-entailed" })];
    const result = assembleDataset(
      baseOptions({ chunks, qaPairRecords, acceptedRecords: [], rejectedRecords }),
    );
    expect(result.qaSource).toBe("sampling-accepted");
    expect(result.examples.filter((e) => e.exampleType === "qa")).toHaveLength(0);
  });

  it("excludes legality-sourced QA examples entirely per §7.9, from both the accepted and fallback paths", () => {
    const legality = makeLegalityChunk();
    const other = makeChunks(1)[0];
    const chunks = [legality, other];

    const viaFallback = assembleDataset(
      baseOptions({ chunks, qaPairRecords: [makePairsRecord(legality.chunk_id, 2), makePairsRecord(other.chunk_id, 1)] }),
    );
    expect(viaFallback.examples.filter((e) => e.exampleType === "qa")).toHaveLength(1);
    expect(viaFallback.examples.some((e) => e.chunkId === legality.chunk_id)).toBe(false);

    const viaAccepted = assembleDataset(
      baseOptions({
        chunks,
        acceptedRecords: [makeSampledRecord(legality.chunk_id, 0), makeSampledRecord(other.chunk_id, 0)],
      }),
    );
    expect(viaAccepted.examples.filter((e) => e.exampleType === "qa")).toHaveLength(1);
    expect(viaAccepted.examples.some((e) => e.chunkId === legality.chunk_id)).toBe(false);
  });

  it("KEEPS legality-sourced distractor examples (the one §7.9 carve-out for time-sensitive retrieval-robustness)", () => {
    const legality = makeLegalityChunk();
    const chunks = [legality];
    const distractorExamples = [makeDistractorExample(legality.chunk_id, 0, { timeSensitive: true })];
    const result = assembleDataset(baseOptions({ chunks, distractorExamples }));
    const distractors = result.examples.filter((e) => e.exampleType === "distractor");
    expect(distractors).toHaveLength(1);
    expect(distractors[0].chunkId).toBe(legality.chunk_id);
  });

  it("categorizes distractor/dpo examples from their source chunk, and abstention/ood with fixed categories", () => {
    const chunks = makeChunks(5); // includes a kw- chunk at index 0
    const kwChunk = chunks[0];
    const distractorExamples = [makeDistractorExample(kwChunk.chunk_id, 0)];
    const dpoPairs = [makeDPOPair(kwChunk.chunk_id, 0)];
    const abstentionExamples = [makeAbstentionExample(kwChunk.chunk_id, 0)];
    const oodExamples = [makeOODExample("sports", 0)];

    const result = assembleDataset(
      baseOptions({ chunks, distractorExamples, dpoPairs, abstentionExamples, oodExamples }),
    );

    const distractor = result.examples.find((e) => e.exampleType === "distractor")!;
    expect(distractor.category).toBe("keyword-definitions");
    const dpo = result.examples.find((e) => e.exampleType === "dpo")!;
    expect(dpo.category).toBe("keyword-definitions");
    const abstention = result.examples.find((e) => e.exampleType === "abstention")!;
    expect(abstention.category).toBe("abstention");
    const ood = result.examples.find((e) => e.exampleType === "ood")!;
    expect(ood.category).toBe("ood");
    expect(ood.chunkId).toBeNull();
  });

  it("builds a QA-only dataset gracefully when every behavior artifact is absent, with a note explaining why", () => {
    const chunks = makeChunks(2);
    const qaPairRecords = chunks.map((c) => makePairsRecord(c.chunk_id, 1));
    const result = assembleDataset(baseOptions({ chunks, qaPairRecords }));
    expect(result.examples.filter((e) => e.exampleType === "qa").length).toBe(2);
    expect(result.examples.filter((e) => e.exampleType !== "qa")).toHaveLength(0);
    expect(result.notes.some((n) => /no behavior-training artifacts/i.test(n))).toBe(true);
  });

  it("never produces a leaked split (assembleDataset's own output always passes checkLeakage)", () => {
    const chunks = makeChunks(30);
    const qaPairRecords = chunks.map((c) => makePairsRecord(c.chunk_id, 2));
    const distractorExamples = chunks.slice(0, 10).map((c, i) => makeDistractorExample(c.chunk_id, i));
    const dpoPairs = chunks.slice(0, 10).map((c, i) => makeDPOPair(c.chunk_id, i));
    const abstentionExamples = chunks.slice(0, 5).map((c, i) => makeAbstentionExample(c.chunk_id, i));
    const oodExamples = [makeOODExample("sports", 0), makeOODExample("cooking", 1)];

    const result = assembleDataset(
      baseOptions({ chunks, qaPairRecords, distractorExamples, dpoPairs, abstentionExamples, oodExamples }),
    );

    const leakage = checkLeakage(result.examples);
    expect(leakage.ok).toBe(true);
  });

  it("is deterministic end to end: two runs with identical inputs and seed produce byte-identical output", () => {
    const chunks = makeChunks(12);
    const opts = baseOptions({
      chunks,
      qaPairRecords: chunks.map((c) => makePairsRecord(c.chunk_id, 2)),
      distractorExamples: chunks.slice(0, 4).map((c, i) => makeDistractorExample(c.chunk_id, i)),
      abstentionExamples: chunks.slice(0, 3).map((c, i) => makeAbstentionExample(c.chunk_id, i)),
      oodExamples: [makeOODExample("sports", 0)],
      dpoPairs: chunks.slice(0, 4).map((c, i) => makeDPOPair(c.chunk_id, i)),
    });

    const a = assembleDataset(opts);
    const b = assembleDataset(opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("skips (does not crash on) a distractor/dpo example whose source chunk is missing from the exported chunk set", () => {
    const result = assembleDataset(
      baseOptions({
        chunks: [],
        distractorExamples: [makeDistractorExample("brain/judge/missing-chunk", 0)],
        dpoPairs: [makeDPOPair("brain/judge/missing-chunk", 0)],
      }),
    );
    expect(result.examples).toHaveLength(0);
    expect(result.notes.some((n) => /not found/i.test(n))).toBe(true);
  });
});
