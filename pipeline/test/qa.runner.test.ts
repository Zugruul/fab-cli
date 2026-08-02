import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runBatch, loadProgress } from "../src/qa/runner.js";
import { makeChunk, makeChunks, makeMockTeacher, makeAlwaysValidTeacher, validPairsResponse, FakeApiError, noopSleep } from "./qa.helpers.js";
import type { GenerationConfig } from "../src/qa/types.js";

function config(overrides: Partial<GenerationConfig> = {}): GenerationConfig {
  return {
    teacherModel: "claude-sonnet-5",
    maxTokens: 2048,
    pairsPerChunk: 2,
    diversityInstructions: ["Vary phrasing."],
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-qa-runner-test-"));
  progressPath = path.join(tmpDir, "progress.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runBatch — dry run", () => {
  it("makes no teacher calls, emits the exact request that would be sent per chunk, and never touches progress", async () => {
    const chunks = makeChunks(3);
    const teacher = makeMockTeacher(() => {
      throw new Error("dry-run must never call the teacher");
    });

    const result = await runBatch({
      chunks,
      config: config(),
      teacher,
      progressPath,
      dryRun: true,
      sleep: noopSleep,
    });

    expect(teacher.calls).toHaveLength(0);
    expect(result.outcomes).toHaveLength(0);
    expect(result.dryRunPlan).toHaveLength(3);
    const ids = result.dryRunPlan!.map((p) => p.chunk_id);
    expect(ids).toEqual(["chunk-1", "chunk-2", "chunk-3"]);
    for (const entry of result.dryRunPlan!) {
      expect(entry.request.model).toBe("claude-sonnet-5");
      expect(entry.request.user).toContain(`chunk_id: ${entry.chunk_id}`);
    }
    expect(fs.existsSync(progressPath)).toBe(false);
  });
});

describe("runBatch — mock teacher, happy path", () => {
  it("parses valid pairs for every chunk and persists progress", async () => {
    const chunks = makeChunks(2);
    const teacher = makeAlwaysValidTeacher(2);

    const result = await runBatch({ chunks, config: config(), teacher, progressPath, sleep: noopSleep });

    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes.every((o) => o.status === "ok")).toBe(true);
    expect(result.outcomes.every((o) => o.pairs.length === 2)).toBe(true);
    expect(result.stoppedEarly).toBeNull();

    const persisted = loadProgress(progressPath);
    expect(persisted.doneChunkIds.sort()).toEqual(["chunk-1", "chunk-2"]);
    expect(persisted.requestCount).toBe(2);
    expect(persisted.costUsd).toBeGreaterThan(0);
  });
});

describe("runBatch — citation rejection", () => {
  it("keeps validly-cited pairs and rejects the rest, still marking the chunk ok", async () => {
    const chunk = makeChunk({ chunk_id: "chunk-1" });
    const teacher = makeMockTeacher(() => ({
      text: JSON.stringify([
        { question: "Q1?", answer: "A1.", cited_chunk_ids: ["chunk-1"] },
        { question: "Q2?", answer: "A2.", cited_chunk_ids: ["some-other-chunk"] },
      ]),
      usage: { inputTokens: 400, outputTokens: 150 },
    }));

    const result = await runBatch({ chunks: [chunk], config: config(), teacher, progressPath, sleep: noopSleep });

    expect(result.outcomes).toHaveLength(1);
    const [outcome] = result.outcomes;
    expect(outcome.status).toBe("ok");
    expect(outcome.pairs).toHaveLength(1);
    expect(outcome.pairs[0].question).toBe("Q1?");
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0].reason).toMatch(/cite|chunk/i);
  });

  it("marks a chunk failed when every candidate pair is rejected", async () => {
    const chunk = makeChunk({ chunk_id: "chunk-1" });
    const teacher = makeMockTeacher(() => ({
      text: JSON.stringify([{ question: "Q?", answer: "A.", cited_chunk_ids: ["wrong-chunk"] }]),
      usage: { inputTokens: 100, outputTokens: 50 },
    }));

    const result = await runBatch({ chunks: [chunk], config: config(), teacher, progressPath, sleep: noopSleep });

    expect(result.outcomes[0].status).toBe("failed");
    expect(result.outcomes[0].pairs).toHaveLength(0);
    const persisted = loadProgress(progressPath);
    expect(persisted.failed).toHaveLength(1);
    expect(persisted.failed[0].chunk_id).toBe("chunk-1");
  });
});

describe("runBatch — per-entry failure isolation", () => {
  it("isolates a non-retryable failure on one chunk and still completes the rest of the run", async () => {
    const chunks = makeChunks(3);
    const teacher = makeMockTeacher((request, i) => {
      if (i === 1) throw new FakeApiError(400, "malformed request");
      const chunkId = chunks.find((c) => request.user.includes(`chunk_id: ${c.chunk_id}`))!.chunk_id;
      return validPairsResponse(chunkId, 1);
    });

    const result = await runBatch({ chunks, config: config(), teacher, progressPath, sleep: noopSleep });

    expect(result.outcomes).toHaveLength(3);
    const byId = Object.fromEntries(result.outcomes.map((o) => [o.chunk_id, o]));
    expect(byId["chunk-1"].status).toBe("ok");
    expect(byId["chunk-2"].status).toBe("failed");
    expect(byId["chunk-2"].failureReason).toMatch(/malformed request|400/);
    expect(byId["chunk-3"].status).toBe("ok");

    const persisted = loadProgress(progressPath);
    expect(persisted.doneChunkIds.sort()).toEqual(["chunk-1", "chunk-3"]);
    expect(persisted.failed).toHaveLength(1);
    expect(persisted.failed[0].chunk_id).toBe("chunk-2");
  });
});

describe("runBatch — resumability (kill + resume)", () => {
  it("resumes a killed run: only chunk_ids not already recorded as done/failed are sent to the teacher", async () => {
    const allFour = makeChunks(4);

    // "Complete 2 of 4" — a first run that only ever saw the first two chunks
    // (standing in for a process that was killed after finishing them).
    const firstTeacher = makeAlwaysValidTeacher(1);
    await runBatch({
      chunks: allFour.slice(0, 2),
      config: config(),
      teacher: firstTeacher,
      progressPath,
      sleep: noopSleep,
    });
    expect(loadProgress(progressPath).doneChunkIds.sort()).toEqual(["chunk-1", "chunk-2"]);

    // Resume with the FULL chunk set and a fresh teacher/mock — only the two
    // remaining, unfinished chunks should be requested.
    const secondTeacher = makeAlwaysValidTeacher(1);
    const result = await runBatch({
      chunks: allFour,
      config: config(),
      teacher: secondTeacher,
      progressPath,
      sleep: noopSleep,
    });

    expect(secondTeacher.calls).toHaveLength(2);
    expect(result.outcomes.map((o) => o.chunk_id).sort()).toEqual(["chunk-3", "chunk-4"]);

    const finalProgress = loadProgress(progressPath);
    expect(finalProgress.doneChunkIds.sort()).toEqual(["chunk-1", "chunk-2", "chunk-3", "chunk-4"]);
  });
});

describe("runBatch — cost ceiling", () => {
  it("stops launching new chunks once the running cost estimate reaches the ceiling, leaving the rest pending", async () => {
    const chunks = makeChunks(4);
    // Each chunk costs (500/1e6)*2 + (200/1e6)*10 = 0.001 + 0.002 = 0.003.
    // A ceiling of 0.005 is crossed after the second chunk.
    const teacher = makeAlwaysValidTeacher(1);
    const cfg = config({ cost: { inputPricePerMTok: 2, outputPricePerMTok: 10, ceilingUsd: 0.005 } });

    const result = await runBatch({ chunks, config: cfg, teacher, progressPath, sleep: noopSleep });

    expect(result.stoppedEarly).toEqual({ reason: "cost-ceiling" });
    expect(result.outcomes).toHaveLength(2);
    expect(teacher.calls).toHaveLength(2);

    const persisted = loadProgress(progressPath);
    expect(persisted.doneChunkIds).toHaveLength(2);
    expect(persisted.doneChunkIds).not.toContain("chunk-3");
    expect(persisted.doneChunkIds).not.toContain("chunk-4");
    expect(persisted.failed).toHaveLength(0); // stopped, not failed
  });

  it("a resumed run with a raised ceiling processes the remaining chunks", async () => {
    const chunks = makeChunks(4);
    const lowCeilingCfg = config({ cost: { inputPricePerMTok: 2, outputPricePerMTok: 10, ceilingUsd: 0.005 } });
    await runBatch({ chunks, config: lowCeilingCfg, teacher: makeAlwaysValidTeacher(1), progressPath, sleep: noopSleep });
    expect(loadProgress(progressPath).doneChunkIds).toHaveLength(2);

    const raisedCeilingCfg = config({ cost: { inputPricePerMTok: 2, outputPricePerMTok: 10, ceilingUsd: 1 } });
    const secondTeacher = makeAlwaysValidTeacher(1);
    const result = await runBatch({ chunks, config: raisedCeilingCfg, teacher: secondTeacher, progressPath, sleep: noopSleep });

    expect(result.stoppedEarly).toBeNull();
    expect(secondTeacher.calls).toHaveLength(2);
    expect(loadProgress(progressPath).doneChunkIds).toHaveLength(4);
  });
});

describe("runBatch — concurrency control", () => {
  it("never runs more than maxConcurrent teacher calls in flight at once", async () => {
    const chunks = makeChunks(6);
    let inFlight = 0;
    let maxObservedInFlight = 0;
    const teacher = makeMockTeacher(async (request) => {
      inFlight++;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      const chunkId = chunks.find((c) => request.user.includes(`chunk_id: ${c.chunk_id}`))!.chunk_id;
      return validPairsResponse(chunkId, 1);
    });

    const result = await runBatch({
      chunks,
      config: config({ batch: { size: 10, maxConcurrent: 2, requestsPerMinute: 0 } }),
      teacher,
      progressPath,
      sleep: noopSleep,
    });

    expect(result.outcomes).toHaveLength(6);
    expect(maxObservedInFlight).toBeLessThanOrEqual(2);
    expect(maxObservedInFlight).toBeGreaterThan(1); // actually parallelized, not accidentally serial
  });
});

describe("runBatch — rate limiting", () => {
  it("spaces requests according to requestsPerMinute using the injected clock/sleep", async () => {
    const chunks = makeChunks(3);
    let clock = 0;
    const sleepCalls: number[] = [];
    const fakeNow = () => clock;
    const fakeSleep = async (ms: number) => {
      sleepCalls.push(ms);
      clock += ms;
    };
    const teacher = makeAlwaysValidTeacher(1);

    await runBatch({
      chunks,
      config: config({ batch: { size: 10, maxConcurrent: 1, requestsPerMinute: 60 } }), // 1/sec
      teacher,
      progressPath,
      now: fakeNow,
      sleep: fakeSleep,
    });

    // First request needs no wait; the next two are throttled to ~1s apart.
    expect(sleepCalls).toEqual([1000, 1000]);
  });
});
