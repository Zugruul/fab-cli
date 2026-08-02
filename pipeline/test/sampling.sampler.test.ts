import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runSampling, loadSamplingProgress, buildWorkItems } from "../src/sampling/sampler.js";
import { appendAcceptedDurable, readAcceptedRecords } from "../src/sampling/store.js";
import {
  makeChunk,
  makeChunksById,
  makePair,
  makeWorkItem,
  makeWorkItems,
  makeMockJudge,
  makeAlwaysEntailedJudge,
  entailedResponse,
  notEntailedResponse,
  malformedJsonResponse,
  refusalResponse,
  truncatedResponse,
  FakeApiError,
  noopSleep,
} from "./sampling.helpers.js";
import type { SamplingConfig } from "../src/sampling/types.js";

function config(overrides: Partial<SamplingConfig> = {}): SamplingConfig {
  return {
    judgeModel: "claude-sonnet-5",
    maxTokens: 1024,
    batch: { size: 10, maxConcurrent: 1, requestsPerMinute: 0 }, // 0 = no rate limit
    cost: { inputPricePerMTok: 2, outputPricePerMTok: 10, ceilingUsd: null },
    maxRetries: 2,
    retryBaseDelayMs: 1,
    ...overrides,
  };
}

let tmpDir: string;
let progressPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-sampling-runner-test-"));
  progressPath = path.join(tmpDir, "progress.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("buildWorkItems", () => {
  it("flattens per-chunk pairs records into individually-addressed work items", () => {
    const items = buildWorkItems([
      { chunk_id: "chunk-1", pairs: [makePair({ question: "Q0" }), makePair({ question: "Q1" })] },
      { chunk_id: "chunk-2", pairs: [makePair({ question: "Q2" })] },
    ]);
    expect(items.map((i) => i.pairId)).toEqual(["chunk-1#0", "chunk-1#1", "chunk-2#0"]);
    expect(items[0].pair.question).toBe("Q0");
    expect(items[2].chunk_id).toBe("chunk-2");
  });
});

describe("runSampling — dry run", () => {
  it("makes no judge calls, emits the exact request that would be sent per pair, and never touches progress", async () => {
    const workItems = makeWorkItems(3);
    const chunksById = makeChunksById(workItems);
    const judge = makeMockJudge(() => {
      throw new Error("dry-run must never call the judge");
    });

    const result = await runSampling({
      workItems,
      chunksById,
      config: config(),
      judge,
      progressPath,
      dryRun: true,
      sleep: noopSleep,
    });

    expect(judge.calls).toHaveLength(0);
    expect(result.outcomes).toHaveLength(0);
    expect(result.dryRunPlan).toHaveLength(3);
    for (const entry of result.dryRunPlan!) {
      expect(entry.request.model).toBe("claude-sonnet-5");
      expect(entry.request.user).toContain(`chunk_id: ${entry.chunk_id}`);
    }
    expect(fs.existsSync(progressPath)).toBe(false);
  });
});

describe("runSampling — happy path acceptance", () => {
  it("accepts a pair whose judge verdict is entailed and records the reason", async () => {
    const workItems = makeWorkItems(2);
    const chunksById = makeChunksById(workItems);
    const judge = makeAlwaysEntailedJudge();

    const result = await runSampling({ workItems, chunksById, config: config(), judge, progressPath, sleep: noopSleep });

    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes.every((o) => o.status === "accepted")).toBe(true);
    expect(result.outcomes.every((o) => o.reason.length > 0)).toBe(true);
    expect(result.stoppedEarly).toBeNull();

    const persisted = loadSamplingProgress(progressPath);
    expect(persisted.acceptedIds.sort()).toEqual(workItems.map((w) => w.pairId).sort());
    expect(persisted.requestCount).toBe(2);
    expect(persisted.costUsd).toBeGreaterThan(0);
  });
});

describe("runSampling — known-bad sample rejection", () => {
  it("discards a not-entailed answer, recording the judge's reason, without touching acceptedIds", async () => {
    const item = makeWorkItem({
      pairId: "chunk-1#0",
      chunk_id: "chunk-1",
      pair: makePair({
        question: "What color is Dominate's icon?",
        answer: "Dominate's icon is blue and it also grants +1 power.", // fabricated fact
        cited_chunk_ids: ["chunk-1"],
      }),
    });
    const chunksById = makeChunksById([item]);
    const judge = makeMockJudge(() => notEntailedResponse("the chunk never mentions icon color or a power bonus"));

    const result = await runSampling({ workItems: [item], chunksById, config: config(), judge, progressPath, sleep: noopSleep });

    expect(result.outcomes).toHaveLength(1);
    const [outcome] = result.outcomes;
    expect(outcome.status).toBe("rejected");
    expect(outcome.reason).toBe("the chunk never mentions icon color or a power bonus");

    const persisted = loadSamplingProgress(progressPath);
    expect(persisted.acceptedIds).toEqual([]);
    expect(persisted.rejectedIds).toEqual(["chunk-1#0"]);
  });
});

describe("runSampling — fail-closed judge response handling", () => {
  it("rejects on malformed JSON, refusal, and truncated responses — never treats them as acceptance", async () => {
    const fixtures = [
      { name: "malformed", response: malformedJsonResponse() },
      { name: "refusal", response: refusalResponse() },
      { name: "truncated", response: truncatedResponse() },
    ];

    for (const fixture of fixtures) {
      const localProgressPath = path.join(tmpDir, `progress-${fixture.name}.json`);
      const item = makeWorkItem({ pairId: `${fixture.name}#0`, chunk_id: fixture.name });
      const chunksById = makeChunksById([item]);
      const judge = makeMockJudge(() => fixture.response);

      const result = await runSampling({
        workItems: [item],
        chunksById,
        config: config(),
        judge,
        progressPath: localProgressPath,
        sleep: noopSleep,
      });

      expect(result.outcomes[0].status).toBe("rejected");
      expect(result.outcomes[0].reason.length).toBeGreaterThan(0);
    }
  });

  it("rejects when the judge call fails after retries are exhausted, never silently accepting", async () => {
    const item = makeWorkItem();
    const chunksById = makeChunksById([item]);
    const judge = makeMockJudge(() => {
      throw new FakeApiError(500, "judge unavailable");
    });

    const result = await runSampling({ workItems: [item], chunksById, config: config(), judge, progressPath, sleep: noopSleep });

    expect(result.outcomes[0].status).toBe("rejected");
    expect(result.outcomes[0].reason).toMatch(/judge unavailable|500/);
    expect(loadSamplingProgress(progressPath).rejectedIds).toEqual([item.pairId]);
  });

  it("rejects a work item whose source chunk isn't in chunksById, without calling the judge", async () => {
    const item = makeWorkItem({ pairId: "missing-chunk#0", chunk_id: "missing-chunk" });
    const judge = makeMockJudge(() => entailedResponse());

    const result = await runSampling({ workItems: [item], chunksById: new Map(), config: config(), judge, progressPath, sleep: noopSleep });

    expect(judge.calls).toHaveLength(0);
    expect(result.outcomes[0].status).toBe("rejected");
    expect(result.outcomes[0].reason).toMatch(/not found/i);
  });
});

describe("runSampling — write ordering (records persisted before done-mark)", () => {
  it("awaits onPairComplete (durable record persistence) BEFORE recording the pair as done in progress.json", async () => {
    const item = makeWorkItem();
    const chunksById = makeChunksById([item]);
    const judge = makeAlwaysEntailedJudge();

    await runSampling({
      workItems: [item],
      chunksById,
      config: config(),
      judge,
      progressPath,
      sleep: noopSleep,
      onPairComplete: async (outcome) => {
        // A real crash could land right after this callback resolves, so
        // if progress.json already showed this pair as done DURING the
        // callback, a kill here would mean the pair is "done" on disk with
        // no durable record of its verdict — exactly the data-loss bug
        // this test guards against. Give the event loop a real tick so a
        // same-tick ordering bug can't hide behind synchronous execution.
        await Promise.resolve();
        const onDisk = fs.existsSync(progressPath) ? loadSamplingProgress(progressPath) : { acceptedIds: [] as string[] };
        expect(onDisk.acceptedIds).not.toContain(outcome.pairId);
      },
    });

    // ...and once the run actually completes, the pair IS marked done.
    expect(loadSamplingProgress(progressPath).acceptedIds).toEqual([item.pairId]);
  });
});

describe("runSampling — crash between record-write and done-mark (kill simulation)", () => {
  it("if the process dies right after a record is durably persisted but before progress marks the pair done, resume reprocesses that one pair and the store ends with no duplicates", async () => {
    const item = makeWorkItem();
    const chunksById = makeChunksById([item]);
    const acceptedPath = path.join(tmpDir, "accepted.jsonl");

    const firstJudge = makeAlwaysEntailedJudge();
    await expect(
      runSampling({
        workItems: [item],
        chunksById,
        config: config(),
        judge: firstJudge,
        progressPath,
        sleep: noopSleep,
        onPairComplete: (outcome) => {
          appendAcceptedDurable(acceptedPath, outcome.pairId, outcome.chunk_id, outcome.pair, outcome.reason);
          // Nothing after this line ever runs — standing in for a real
          // process kill the instant after the durable write above
          // returns, so progress.json is never touched for this pair.
          throw new Error("simulated kill right after durable record write");
        },
      }),
    ).rejects.toThrow(/simulated kill/);

    // The record made it to disk before the "kill"...
    expect(readAcceptedRecords(acceptedPath)).toHaveLength(1);
    // ...but the pair was never marked done — a resume must reprocess it
    // (cheap: one extra API call), never silently skip it while its
    // already-paid-for verdict sits unrecorded.
    expect(loadSamplingProgress(progressPath).acceptedIds).toEqual([]);

    const secondJudge = makeAlwaysEntailedJudge();
    await runSampling({
      workItems: [item],
      chunksById,
      config: config(),
      judge: secondJudge,
      progressPath,
      sleep: noopSleep,
      onPairComplete: (outcome) => {
        appendAcceptedDurable(acceptedPath, outcome.pairId, outcome.chunk_id, outcome.pair, outcome.reason);
      },
    });

    expect(secondJudge.calls).toHaveLength(1); // reprocessed, not skipped
    expect(loadSamplingProgress(progressPath).acceptedIds).toEqual([item.pairId]);

    // The store ends up with exactly one (the latest) record for this
    // pairId — the earlier partial write was replaced, never duplicated.
    const finalRecords = readAcceptedRecords(acceptedPath);
    expect(finalRecords).toHaveLength(1);
    expect(finalRecords[0].pairId).toBe(item.pairId);
  });
});

describe("runSampling — resumability (kill + resume)", () => {
  it("resumes a killed run: only pairIds not already accepted/rejected are sent to the judge", async () => {
    const allFour = makeWorkItems(4);
    const chunksById = makeChunksById(allFour);

    // "Complete 2 of 4" — a first run that only ever saw the first two
    // items (standing in for a process that was killed after finishing
    // them).
    const firstJudge = makeAlwaysEntailedJudge();
    await runSampling({ workItems: allFour.slice(0, 2), chunksById, config: config(), judge: firstJudge, progressPath, sleep: noopSleep });
    expect(loadSamplingProgress(progressPath).acceptedIds.sort()).toEqual(
      allFour.slice(0, 2).map((w) => w.pairId).sort(),
    );

    // Resume with the FULL item set and a fresh judge/mock — only the two
    // remaining, unfinished items should be requested.
    const secondJudge = makeAlwaysEntailedJudge();
    const result = await runSampling({ workItems: allFour, chunksById, config: config(), judge: secondJudge, progressPath, sleep: noopSleep });

    expect(secondJudge.calls).toHaveLength(2);
    expect(result.outcomes.map((o) => o.pairId).sort()).toEqual(allFour.slice(2).map((w) => w.pairId).sort());

    const finalProgress = loadSamplingProgress(progressPath);
    expect(finalProgress.acceptedIds.sort()).toEqual(allFour.map((w) => w.pairId).sort());
  });

  it("does not resend a pair that was previously rejected", async () => {
    const item = makeWorkItem();
    const chunksById = makeChunksById([item]);

    await runSampling({
      workItems: [item],
      chunksById,
      config: config(),
      judge: makeMockJudge(() => notEntailedResponse()),
      progressPath,
      sleep: noopSleep,
    });
    expect(loadSamplingProgress(progressPath).rejectedIds).toEqual([item.pairId]);

    const secondJudge = makeMockJudge(() => entailedResponse());
    const result = await runSampling({ workItems: [item], chunksById, config: config(), judge: secondJudge, progressPath, sleep: noopSleep });

    expect(secondJudge.calls).toHaveLength(0);
    expect(result.outcomes).toHaveLength(0);
  });
});

describe("runSampling — cost ceiling", () => {
  it("stops launching new checks once the running cost estimate reaches the ceiling, leaving the rest pending", async () => {
    const items = makeWorkItems(4);
    const chunksById = makeChunksById(items);
    // Each check costs (300/1e6)*2 + (60/1e6)*10 = 0.0006 + 0.0006 = 0.0012.
    const judge = makeAlwaysEntailedJudge();
    const cfg = config({ cost: { inputPricePerMTok: 2, outputPricePerMTok: 10, ceilingUsd: 0.002 } });

    const result = await runSampling({ workItems: items, chunksById, config: cfg, judge, progressPath, sleep: noopSleep });

    expect(result.stoppedEarly).toEqual({ reason: "cost-ceiling" });
    expect(result.outcomes).toHaveLength(2);
    expect(judge.calls).toHaveLength(2);

    const persisted = loadSamplingProgress(progressPath);
    expect(persisted.acceptedIds).toHaveLength(2);
    expect(persisted.acceptedIds).not.toContain(items[2].pairId);
    expect(persisted.acceptedIds).not.toContain(items[3].pairId);
  });

  it("a resumed run with a raised ceiling processes the remaining items", async () => {
    const items = makeWorkItems(4);
    const chunksById = makeChunksById(items);
    const lowCeilingCfg = config({ cost: { inputPricePerMTok: 2, outputPricePerMTok: 10, ceilingUsd: 0.002 } });
    await runSampling({ workItems: items, chunksById, config: lowCeilingCfg, judge: makeAlwaysEntailedJudge(), progressPath, sleep: noopSleep });
    expect(loadSamplingProgress(progressPath).acceptedIds).toHaveLength(2);

    const raisedCeilingCfg = config({ cost: { inputPricePerMTok: 2, outputPricePerMTok: 10, ceilingUsd: 1 } });
    const secondJudge = makeAlwaysEntailedJudge();
    const result = await runSampling({ workItems: items, chunksById, config: raisedCeilingCfg, judge: secondJudge, progressPath, sleep: noopSleep });

    expect(result.stoppedEarly).toBeNull();
    expect(secondJudge.calls).toHaveLength(2);
    expect(loadSamplingProgress(progressPath).acceptedIds).toHaveLength(4);
  });
});

describe("runSampling — cost ceiling with concurrency > 1", () => {
  it("bounds the overshoot: only the pairs already committed (in flight) when the ceiling is crossed complete", async () => {
    // Mirrors the production config's maxConcurrent (4).
    const maxConcurrent = 4;
    const items = makeWorkItems(8);
    const chunksById = makeChunksById(items);
    let inFlight = 0;
    let release: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Every mock call blocks on the same gate, so all maxConcurrent
    // workers are guaranteed to have already started (and therefore be
    // "in flight", already committed) before any of them can complete and
    // trip the ceiling.
    const judge = makeMockJudge(async () => {
      inFlight++;
      await gate;
      return entailedResponse(); // 0.0012 USD per pair, see config()'s cost rates
    });

    const cfg = config({
      batch: { size: 10, maxConcurrent, requestsPerMinute: 0 },
      // Any single completed pair (0.0012) already exceeds this ceiling,
      // so the entire overshoot is exactly "however many were already in
      // flight" — the bound this test exists to prove.
      cost: { inputPricePerMTok: 2, outputPricePerMTok: 10, ceilingUsd: 0.0005 },
    });

    const runPromise = runSampling({ workItems: items, chunksById, config: cfg, judge, progressPath, sleep: noopSleep });

    await vi.waitFor(() => expect(inFlight).toBe(maxConcurrent));
    release!();

    const result = await runPromise;

    expect(result.stoppedEarly).toEqual({ reason: "cost-ceiling" });
    // Bounded by maxConcurrent — never all 8 items, and never fewer than
    // the ones that were already committed when the ceiling was crossed.
    expect(judge.calls).toHaveLength(maxConcurrent);
    expect(result.outcomes).toHaveLength(maxConcurrent);
    expect(result.progress.costUsd).toBeCloseTo(maxConcurrent * 0.0012, 5);
  });
});

describe("runSampling — concurrency control", () => {
  it("never runs more than maxConcurrent judge calls in flight at once", async () => {
    const items = makeWorkItems(6);
    const chunksById = makeChunksById(items);
    let inFlight = 0;
    let maxObservedInFlight = 0;
    const judge = makeMockJudge(async () => {
      inFlight++;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return entailedResponse();
    });

    const result = await runSampling({
      workItems: items,
      chunksById,
      config: config({ batch: { size: 10, maxConcurrent: 2, requestsPerMinute: 0 } }),
      judge,
      progressPath,
      sleep: noopSleep,
    });

    expect(result.outcomes).toHaveLength(6);
    expect(maxObservedInFlight).toBeLessThanOrEqual(2);
    expect(maxObservedInFlight).toBeGreaterThan(1); // actually parallelized, not accidentally serial
  });
});

describe("runSampling — rate limiting", () => {
  it("spaces requests according to requestsPerMinute using the injected clock/sleep", async () => {
    const items = makeWorkItems(3);
    const chunksById = makeChunksById(items);
    let clock = 0;
    const sleepCalls: number[] = [];
    const fakeNow = () => clock;
    const fakeSleep = async (ms: number) => {
      sleepCalls.push(ms);
      clock += ms;
    };
    const judge = makeAlwaysEntailedJudge();

    await runSampling({
      workItems: items,
      chunksById,
      config: config({ batch: { size: 10, maxConcurrent: 1, requestsPerMinute: 60 } }), // 1/sec
      judge,
      progressPath,
      now: fakeNow,
      sleep: fakeSleep,
    });

    // First request needs no wait; the next two are throttled to ~1s apart.
    expect(sleepCalls).toEqual([1000, 1000]);
  });
});
