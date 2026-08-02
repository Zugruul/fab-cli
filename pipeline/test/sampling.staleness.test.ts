// BUG-180: sampling pairIds are positional (`chunk_id#index`), not
// content-addressed. If APP-011's qa:generate regenerates an
// already-sampled chunk's pairs, the new pairs at the same indices reuse
// the same pairIds — without a guard, resume would silently apply the OLD
// (stale) verdict to the NEW content (see types.ts's WorkItem doc and
// cli.ts's top comment for the full scenario). This suite proves the
// automatic content-hash guard: a pairId whose recorded hash no longer
// matches current content is treated as NOT done and reprocessed, while
// unchanged content still resumes without a wasted API call, and progress
// files written before this guard existed (no hash recorded at all) are
// honored once rather than treated as stale.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runSampling, loadSamplingProgress, buildWorkItems, computePairContentHash } from "../src/sampling/sampler.js";
import { appendAcceptedDurable, appendRejectedDurable, readAcceptedRecords, readRejectedRecords } from "../src/sampling/store.js";
import type { PairSamplingOutcome } from "../src/sampling/types.js";
import {
  makeChunksById,
  makePair,
  makeWorkItem,
  makeMockJudge,
  makeAlwaysEntailedJudge,
  entailedResponse,
  notEntailedResponse,
  noopSleep,
} from "./sampling.helpers.js";
import type { SamplingConfig } from "../src/sampling/types.js";

function config(overrides: Partial<SamplingConfig> = {}): SamplingConfig {
  return {
    judgeModel: "claude-sonnet-5",
    maxTokens: 1024,
    batch: { size: 10, maxConcurrent: 1, requestsPerMinute: 0 },
    cost: { inputPricePerMTok: 2, outputPricePerMTok: 10, ceilingUsd: null },
    maxRetries: 2,
    retryBaseDelayMs: 1,
    ...overrides,
  };
}

let tmpDir: string;
let progressPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-sampling-staleness-test-"));
  progressPath = path.join(tmpDir, "progress.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildWorkItems — pairContentHash", () => {
  it("computes a content hash per work item from the pair's question+answer", () => {
    const items = buildWorkItems([{ chunk_id: "chunk-1", pairs: [makePair({ question: "Q0", answer: "A0" })] }]);
    expect(items[0].pairContentHash).toBe(computePairContentHash(items[0].pair));
    expect(items[0].pairContentHash.length).toBeGreaterThan(0);
  });

  it("gives a regenerated pair at the SAME array position the same pairId but a different content hash", () => {
    const original = buildWorkItems([{ chunk_id: "chunk-1", pairs: [makePair({ question: "Q0", answer: "A0" })] }]);
    const regenerated = buildWorkItems([{ chunk_id: "chunk-1", pairs: [makePair({ question: "Q0-changed", answer: "A0-changed" })] }]);

    expect(regenerated[0].pairId).toBe(original[0].pairId); // this is exactly the collision BUG-180 guards against
    expect(regenerated[0].pairContentHash).not.toBe(original[0].pairContentHash);
  });
});

describe("runSampling — BUG-180 guard: regenerated content at an existing pairId", () => {
  it("reprocesses the pair, refreshes the verdict, and reports staleReprocessedCount", async () => {
    const originalItem = makeWorkItem({
      pairId: "chunk-1#0",
      chunk_id: "chunk-1",
      pair: makePair({ question: "Original Q?", answer: "Original A." }),
    });

    // First run: accepted, recorded (verdict + content hash) for the
    // ORIGINAL content.
    await runSampling({
      workItems: [originalItem],
      chunksById: makeChunksById([originalItem]),
      config: config(),
      judge: makeAlwaysEntailedJudge(),
      progressPath,
      sleep: noopSleep,
    });
    expect(loadSamplingProgress(progressPath).acceptedIds).toEqual(["chunk-1#0"]);

    // Simulate qa:generate regenerating chunk-1's pairs: same chunk_id,
    // same array index -> same pairId, but new question/answer text.
    const regeneratedItem = makeWorkItem({
      pairId: "chunk-1#0",
      chunk_id: "chunk-1",
      pair: makePair({ question: "Regenerated Q?", answer: "Regenerated A." }),
    });
    const secondJudge = makeMockJudge(() => notEntailedResponse("the regenerated answer isn't supported by the chunk"));

    const result = await runSampling({
      workItems: [regeneratedItem],
      chunksById: makeChunksById([regeneratedItem]),
      config: config(),
      judge: secondJudge,
      progressPath,
      sleep: noopSleep,
    });

    // The stale pairId collision is caught: the judge is actually called
    // again rather than the old "accepted" verdict being silently reused.
    expect(secondJudge.calls).toHaveLength(1);
    expect(result.staleReprocessedCount).toBe(1);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].status).toBe("rejected");
    expect(result.outcomes[0].reason).toBe("the regenerated answer isn't supported by the chunk");

    // progress.json reflects only the FRESH verdict — the stale accepted
    // entry was replaced, not left dangling alongside the new rejection.
    const finalProgress = loadSamplingProgress(progressPath);
    expect(finalProgress.acceptedIds).toEqual([]);
    expect(finalProgress.rejectedIds).toEqual(["chunk-1#0"]);
    expect(finalProgress.contentHashes?.["chunk-1#0"]).toBe(regeneratedItem.pairContentHash);
  });

  it("a rejected-then-regenerated-and-now-good pair also gets reprocessed and its new acceptance recorded", async () => {
    const originalItem = makeWorkItem({
      pairId: "chunk-2#0",
      chunk_id: "chunk-2",
      pair: makePair({ question: "Bad Q?", answer: "Fabricated answer." }),
    });
    await runSampling({
      workItems: [originalItem],
      chunksById: makeChunksById([originalItem]),
      config: config(),
      judge: makeMockJudge(() => notEntailedResponse()),
      progressPath,
      sleep: noopSleep,
    });
    expect(loadSamplingProgress(progressPath).rejectedIds).toEqual(["chunk-2#0"]);

    const fixedItem = makeWorkItem({
      pairId: "chunk-2#0",
      chunk_id: "chunk-2",
      pair: makePair({ question: "Fixed Q?", answer: "Fixed, grounded answer." }),
    });
    const secondJudge = makeAlwaysEntailedJudge();
    const result = await runSampling({
      workItems: [fixedItem],
      chunksById: makeChunksById([fixedItem]),
      config: config(),
      judge: secondJudge,
      progressPath,
      sleep: noopSleep,
    });

    expect(secondJudge.calls).toHaveLength(1);
    expect(result.staleReprocessedCount).toBe(1);
    const finalProgress = loadSamplingProgress(progressPath);
    expect(finalProgress.rejectedIds).toEqual([]);
    expect(finalProgress.acceptedIds).toEqual(["chunk-2#0"]);
  });
});

describe("runSampling — unchanged content resumes as done", () => {
  it("does not reprocess a pairId whose content hash is unchanged, and reports staleReprocessedCount 0", async () => {
    const item = makeWorkItem();
    const chunksById = makeChunksById([item]);
    await runSampling({ workItems: [item], chunksById, config: config(), judge: makeAlwaysEntailedJudge(), progressPath, sleep: noopSleep });

    const secondJudge = makeMockJudge(() => entailedResponse());
    const result = await runSampling({ workItems: [item], chunksById, config: config(), judge: secondJudge, progressPath, sleep: noopSleep });

    expect(secondJudge.calls).toHaveLength(0);
    expect(result.outcomes).toHaveLength(0);
    expect(result.staleReprocessedCount).toBe(0);
    expect(result.legacyUnverifiedCount).toBe(0);
  });

  it("records the pair's content hash in progress.json when a pair is freshly checked", async () => {
    const item = makeWorkItem();
    const chunksById = makeChunksById([item]);
    await runSampling({ workItems: [item], chunksById, config: config(), judge: makeAlwaysEntailedJudge(), progressPath, sleep: noopSleep });

    const progress = loadSamplingProgress(progressPath);
    expect(progress.contentHashes?.[item.pairId]).toBe(computePairContentHash(item.pair));
  });
});

describe("runSampling — BUG-180 guard: backward compat with pre-guard progress files", () => {
  it("honors a legacy progress record (no contentHashes at all) as done without reprocessing, surfacing legacyUnverifiedCount", async () => {
    const item = makeWorkItem();
    const chunksById = makeChunksById([item]);

    // Hand-write a progress.json shaped exactly like pre-BUG-180 output:
    // acceptedIds/rejectedIds only, no contentHashes field.
    fs.mkdirSync(path.dirname(progressPath), { recursive: true });
    fs.writeFileSync(
      progressPath,
      JSON.stringify({ acceptedIds: [item.pairId], rejectedIds: [], costUsd: 0.0012, requestCount: 1 }, null, 2) + "\n",
    );

    const judge = makeMockJudge(() => entailedResponse());
    const result = await runSampling({ workItems: [item], chunksById, config: config(), judge, progressPath, sleep: noopSleep });

    expect(judge.calls).toHaveLength(0); // honored as done-as-recorded, not reprocessed
    expect(result.outcomes).toHaveLength(0);
    expect(result.legacyUnverifiedCount).toBe(1);
    expect(result.staleReprocessedCount).toBe(0);
    expect(loadSamplingProgress(progressPath).acceptedIds).toEqual([item.pairId]);
  });

  it("backfills the current content hash for a legacy record, so a later resume no longer counts it as legacy ('ONCE' semantics)", async () => {
    const item = makeWorkItem();
    const chunksById = makeChunksById([item]);
    fs.mkdirSync(path.dirname(progressPath), { recursive: true });
    fs.writeFileSync(
      progressPath,
      JSON.stringify({ acceptedIds: [item.pairId], rejectedIds: [], costUsd: 0.0012, requestCount: 1 }, null, 2) + "\n",
    );

    await runSampling({
      workItems: [item],
      chunksById,
      config: config(),
      judge: makeMockJudge(() => entailedResponse()),
      progressPath,
      sleep: noopSleep,
    });

    const backfilled = loadSamplingProgress(progressPath);
    expect(backfilled.contentHashes?.[item.pairId]).toBe(computePairContentHash(item.pair));

    const secondJudge = makeMockJudge(() => entailedResponse());
    const secondResult = await runSampling({ workItems: [item], chunksById, config: config(), judge: secondJudge, progressPath, sleep: noopSleep });

    expect(secondJudge.calls).toHaveLength(0); // still honored as done — now via a real hash match
    expect(secondResult.legacyUnverifiedCount).toBe(0); // no longer "legacy" — the gap was filled last run
    expect(secondResult.staleReprocessedCount).toBe(0);
  });

  it("a legacy record whose content has ALSO changed since it predates the guard is still just honored once (no baseline to detect staleness against), but the backfilled hash catches the NEXT regeneration", async () => {
    // This is the honest limit of the guard: a legacy progress.json with no
    // recorded hash gives BUG-180's check nothing to compare against, so a
    // change that already happened before this guard shipped can't be
    // detected retroactively — only regenerations going forward are caught.
    const originalItem = makeWorkItem({ pairId: "chunk-3#0", chunk_id: "chunk-3", pair: makePair({ question: "Q-old", answer: "A-old" }) });
    fs.mkdirSync(path.dirname(progressPath), { recursive: true });
    fs.writeFileSync(
      progressPath,
      JSON.stringify({ acceptedIds: ["chunk-3#0"], rejectedIds: [], costUsd: 0, requestCount: 1 }, null, 2) + "\n",
    );

    const currentItem = makeWorkItem({ pairId: "chunk-3#0", chunk_id: "chunk-3", pair: makePair({ question: "Q-new", answer: "A-new" }) });
    const judge = makeMockJudge(() => entailedResponse());
    const result = await runSampling({ workItems: [currentItem], chunksById: makeChunksById([currentItem]), config: config(), judge, progressPath, sleep: noopSleep });

    expect(judge.calls).toHaveLength(0); // honored once, per design — no baseline existed to compare against
    expect(result.legacyUnverifiedCount).toBe(1);

    // But now the CURRENT content's hash is backfilled, so the NEXT
    // regeneration at this pairId (after this point) will be caught.
    const nextItem = makeWorkItem({ pairId: "chunk-3#0", chunk_id: "chunk-3", pair: makePair({ question: "Q-newer", answer: "A-newer" }) });
    const secondJudge = makeMockJudge(() => notEntailedResponse());
    const secondResult = await runSampling({ workItems: [nextItem], chunksById: makeChunksById([nextItem]), config: config(), judge: secondJudge, progressPath, sleep: noopSleep });

    expect(secondJudge.calls).toHaveLength(1);
    expect(secondResult.staleReprocessedCount).toBe(1);
  });
});

describe("runSampling + real store — cross-file consistency on a verdict flip (BUG-180 follow-up)", () => {
  // Mirrors cli.ts's PRODUCTION onPairComplete wiring exactly (real
  // appendAcceptedDurable/appendRejectedDurable, not a mock) — this is the
  // path the previous round of tests never exercised, which is how the
  // cross-file staleness bug slipped through: progress.json is corrected
  // by the reconciliation pass, but appendRecordDurable only dedupes
  // WITHIN its own target file. On a stale reprocess whose verdict flips
  // (accepted -> rejected or vice versa), the stale record must not be
  // left dangling in the file it no longer belongs to — dpo.ts reads both
  // accepted.jsonl and rejected.jsonl, and would otherwise pick up a
  // pairId present (with conflicting verdicts) in both.
  function wireStore(acceptedPath: string, rejectedPath: string) {
    return (outcome: PairSamplingOutcome) => {
      if (outcome.status === "accepted") {
        appendAcceptedDurable(acceptedPath, outcome.pairId, outcome.chunk_id, outcome.pair, outcome.reason, rejectedPath);
      } else {
        appendRejectedDurable(rejectedPath, outcome.pairId, outcome.chunk_id, outcome.pair, outcome.rejectionKind!, outcome.reason, acceptedPath);
      }
    };
  }

  it("accepted -> rejected flip: the stale accepted record is removed from accepted.jsonl, not left dangling alongside the fresh rejection", async () => {
    const acceptedPath = path.join(tmpDir, "accepted.jsonl");
    const rejectedPath = path.join(tmpDir, "rejected.jsonl");

    const originalItem = makeWorkItem({
      pairId: "chunk-1#0",
      chunk_id: "chunk-1",
      pair: makePair({ question: "Original Q?", answer: "Original A." }),
    });
    await runSampling({
      workItems: [originalItem],
      chunksById: makeChunksById([originalItem]),
      config: config(),
      judge: makeAlwaysEntailedJudge(),
      progressPath,
      sleep: noopSleep,
      onPairComplete: wireStore(acceptedPath, rejectedPath),
    });
    expect(readAcceptedRecords(acceptedPath)).toHaveLength(1);
    expect(readRejectedRecords(rejectedPath)).toHaveLength(0);

    const regeneratedItem = makeWorkItem({
      pairId: "chunk-1#0",
      chunk_id: "chunk-1",
      pair: makePair({ question: "Regenerated Q?", answer: "Regenerated A." }),
    });
    await runSampling({
      workItems: [regeneratedItem],
      chunksById: makeChunksById([regeneratedItem]),
      config: config(),
      judge: makeMockJudge(() => notEntailedResponse("the regenerated answer isn't supported")),
      progressPath,
      sleep: noopSleep,
      onPairComplete: wireStore(acceptedPath, rejectedPath),
    });

    // Exactly one record for this pairId across BOTH files — the stale
    // accepted record must be gone, not merely outnumbered.
    const acceptedRecords = readAcceptedRecords(acceptedPath);
    const rejectedRecords = readRejectedRecords(rejectedPath);
    expect(acceptedRecords).toHaveLength(0);
    expect(rejectedRecords).toHaveLength(1);
    expect(rejectedRecords[0].pairId).toBe("chunk-1#0");
    expect(rejectedRecords[0].question).toBe("Regenerated Q?");
    expect(rejectedRecords[0].answer).toBe("Regenerated A.");
  });

  it("rejected -> accepted flip: the stale rejected record is removed from rejected.jsonl, not left dangling alongside the fresh acceptance", async () => {
    const acceptedPath = path.join(tmpDir, "accepted.jsonl");
    const rejectedPath = path.join(tmpDir, "rejected.jsonl");

    const originalItem = makeWorkItem({
      pairId: "chunk-2#0",
      chunk_id: "chunk-2",
      pair: makePair({ question: "Bad Q?", answer: "Fabricated answer." }),
    });
    await runSampling({
      workItems: [originalItem],
      chunksById: makeChunksById([originalItem]),
      config: config(),
      judge: makeMockJudge(() => notEntailedResponse()),
      progressPath,
      sleep: noopSleep,
      onPairComplete: wireStore(acceptedPath, rejectedPath),
    });
    expect(readRejectedRecords(rejectedPath)).toHaveLength(1);
    expect(readAcceptedRecords(acceptedPath)).toHaveLength(0);

    const fixedItem = makeWorkItem({
      pairId: "chunk-2#0",
      chunk_id: "chunk-2",
      pair: makePair({ question: "Fixed Q?", answer: "Fixed, grounded answer." }),
    });
    await runSampling({
      workItems: [fixedItem],
      chunksById: makeChunksById([fixedItem]),
      config: config(),
      judge: makeAlwaysEntailedJudge(),
      progressPath,
      sleep: noopSleep,
      onPairComplete: wireStore(acceptedPath, rejectedPath),
    });

    const acceptedRecords = readAcceptedRecords(acceptedPath);
    const rejectedRecords = readRejectedRecords(rejectedPath);
    expect(rejectedRecords).toHaveLength(0);
    expect(acceptedRecords).toHaveLength(1);
    expect(acceptedRecords[0].pairId).toBe("chunk-2#0");
    expect(acceptedRecords[0].question).toBe("Fixed Q?");
    expect(acceptedRecords[0].answer).toBe("Fixed, grounded answer.");
  });
});
