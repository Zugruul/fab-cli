// Pacing + resume integration tests for ClaudeCodeTeacherClient (issue
// #223, AC4): proves the subscription engine plugs into runner.ts's
// EXISTING resumable-batch/backoff-retry machinery unmodified — this
// suite adds no new pacing logic, it demonstrates the existing one
// working end to end with the new transport. Always against scripted fake
// `claude` binaries (pipeline/test/fixtures/), never the real CLI/subscription.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ClaudeCodeTeacherClient } from "../src/qa/claudeCodeTeacher.js";
import { withRetry } from "../src/qa/retry.js";
import { runBatch, loadProgress } from "../src/qa/runner.js";
import { fixtureSpawnFn, makeChunks, noopSleep } from "./qa.helpers.js";
import type { GenerationConfig } from "../src/qa/types.js";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const FLAKY = path.join(FIXTURES_DIR, "fake-claude-flaky.mjs");
const ALWAYS_FAIL = path.join(FIXTURES_DIR, "fake-claude-always-fail.mjs");

function config(overrides: Partial<GenerationConfig> = {}): GenerationConfig {
  return {
    teacherModel: "claude-sonnet-5",
    maxTokens: 2048,
    pairsPerChunk: 2,
    diversityInstructions: ["Vary phrasing."],
    batch: { size: 10, maxConcurrent: 1, requestsPerMinute: 0 },
    cost: { inputPricePerMTok: 2, outputPricePerMTok: 10, ceilingUsd: null },
    maxRetries: 1,
    retryBaseDelayMs: 1,
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-qa-claudeCodeTeacher-pacing-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ClaudeCodeTeacherClient — bounded backoff retry (via retry.ts, unmodified)", () => {
  it("retries a rate-limited subscription failure with bounded exponential backoff, then succeeds once the limit clears", async () => {
    const stateFile = path.join(tmpDir, "flaky-calls.txt");
    const client = new ClaudeCodeTeacherClient({
      spawn: fixtureSpawnFn(FLAKY, { FAKE_CLAUDE_STATE_FILE: stateFile, FAKE_CLAUDE_FAIL_COUNT: "2" }),
    });
    const sleep = vi.fn(async (_ms: number) => noopSleep());

    const response = await withRetry(
      () =>
        client.generate({
          model: "claude-sonnet-5",
          maxTokens: 1024,
          system: "system",
          user: "chunk_id: chunk-1",
        }),
      { maxRetries: 3, baseDelayMs: 5, sleep },
    );

    expect(response.text).toBe("FAKE_CLAUDE_FLAKY_RECOVERED");
    // 2 rate-limited attempts + 1 successful attempt = 3 CLI invocations.
    expect(Number(fs.readFileSync(stateFile, "utf8"))).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0][0]).toBe(5);
    expect(sleep.mock.calls[1][0]).toBe(10);
  });
});

describe("ClaudeCodeTeacherClient — resumable batch runs (via runner.ts, unmodified)", () => {
  it("a chunk that exhausts retries against a persistently rate-limited subscription is recorded failed in progress.json, and a second runBatch call for the same progressPath never invokes the CLI again for it", async () => {
    const progressPath = path.join(tmpDir, "progress.json");
    const stateFile = path.join(tmpDir, "always-fail-calls.txt");
    const chunks = makeChunks(1);
    const client = new ClaudeCodeTeacherClient({
      spawn: fixtureSpawnFn(ALWAYS_FAIL, { FAKE_CLAUDE_STATE_FILE: stateFile }),
    });

    const first = await runBatch({
      chunks,
      config: config({ maxRetries: 1 }),
      teacher: client,
      progressPath,
      sleep: noopSleep,
    });

    expect(first.outcomes).toHaveLength(1);
    expect(first.outcomes[0].status).toBe("failed");
    expect(first.outcomes[0].failureReason).toMatch(/usage limit/i);
    const progress = loadProgress(progressPath);
    expect(progress.failed).toEqual([{ chunk_id: "chunk-1", reason: expect.stringMatching(/usage limit/i) }]);

    // initial attempt + 1 retry (maxRetries: 1) = 2 CLI invocations this run.
    const callsAfterFirstRun = Number(fs.readFileSync(stateFile, "utf8"));
    expect(callsAfterFirstRun).toBe(2);

    const second = await runBatch({
      chunks,
      config: config({ maxRetries: 1 }),
      teacher: client,
      progressPath,
      sleep: noopSleep,
    });

    // Resumed: the already-failed chunk is skipped entirely, not retried.
    expect(second.outcomes).toHaveLength(0);
    expect(Number(fs.readFileSync(stateFile, "utf8"))).toBe(callsAfterFirstRun);
  });
});
