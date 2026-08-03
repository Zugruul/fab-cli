// Recognition-embedder training dispatch (APP-028, issue #140): mirrors
// pipeline/test/trainVision.test.ts's structure for the OBB detector. All
// dispatch here is a fake — no real ssh/rsync or remote-compute.py
// invocation ever happens; the Python train/export chain is exercised
// separately by pipeline/train-vision/tests/ pytest suite.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { buildEmbedConfig, DEFAULT_ARCFACE, DEFAULT_CROP_SIZE, DEFAULT_EMBEDDING_DIM, DEFAULT_TRAIN, DEFAULT_VAL_FRACTION } from "../src/train-vision/embedConfigBuilder.js";
import { EMBEDDER_LICENSES } from "../src/train-vision/embedLicenses.js";
import { validateLicenses } from "../src/train-vision/licenses.js";
import { run, resume } from "../src/train-vision/embedRunner.js";
import { parseArgs } from "../src/train-vision/embedCli.js";
import type { EmbedDispatcher, EmbedRunSpec, EmbedRunState, EmbedRunnerOptions, EmbedDispatcherStatus } from "../src/train-vision/embedTypes.js";

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// embedConfigBuilder
// ---------------------------------------------------------------------------

describe("buildEmbedConfig", () => {
  it("builds the exact config for a minimal spec using documented defaults", () => {
    const spec: EmbedRunSpec = { datasetDir: "/data/composites-run", seed: 42 };
    expect(buildEmbedConfig(spec, "output")).toEqual({
      architecture: "arcface-embedder-tiny",
      seed: 42,
      datasetDir: "/data/composites-run",
      valFraction: DEFAULT_VAL_FRACTION,
      cropSize: DEFAULT_CROP_SIZE,
      embeddingDim: DEFAULT_EMBEDDING_DIM,
      arcface: DEFAULT_ARCFACE,
      train: DEFAULT_TRAIN,
      outputDir: "output",
    });
  });

  it("merges partial arcface/train overrides onto defaults rather than replacing them wholesale", () => {
    const spec: EmbedRunSpec = { datasetDir: "/data/x", seed: 1, arcface: { margin: 0.3 }, train: { epochs: 10 } };
    const config = buildEmbedConfig(spec, "output");
    expect(config.arcface).toEqual({ ...DEFAULT_ARCFACE, margin: 0.3 });
    expect(config.train).toEqual({ ...DEFAULT_TRAIN, epochs: 10 });
  });

  it("respects an explicit cropSize/embeddingDim override", () => {
    const spec: EmbedRunSpec = { datasetDir: "/data/x", seed: 1, cropSize: 112, embeddingDim: 128 };
    const config = buildEmbedConfig(spec, "output");
    expect(config.cropSize).toBe(112);
    expect(config.embeddingDim).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// embedLicenses (reusing licenses.ts's generic validator, already fully
// unit-tested by trainVision.test.ts — this only checks the embedder's
// OWN license table content)
// ---------------------------------------------------------------------------

describe("EMBEDDER_LICENSES", () => {
  it("passes the shared validateLicenses gate", () => {
    expect(() => validateLicenses(EMBEDDER_LICENSES as unknown as Record<string, string>)).not.toThrow();
  });

  it("names the expected embedder-specific components", () => {
    expect(EMBEDDER_LICENSES.trainingCode).toBe("MIT");
    expect(EMBEDDER_LICENSES.torch).toBe("BSD-3-Clause");
    expect(EMBEDDER_LICENSES.aiEdgeQuantizer).toBe("Apache-2.0");
  });
});

// ---------------------------------------------------------------------------
// embedRunner — happy path + failure path with a fake dispatcher
// ---------------------------------------------------------------------------

class FakeDispatcher implements EmbedDispatcher {
  calls: string[] = [];
  private statusIndex = 0;

  constructor(
    private readonly statusSequence: EmbedDispatcherStatus[],
    private readonly returnedJobId: string,
    private readonly outputFiles: Record<string, string | Buffer> = {},
  ) {}

  async run(_configLocalPath: string, _inputsDir: string, jobId: string): Promise<{ jobId: string }> {
    this.calls.push(`run:${jobId}`);
    return { jobId: this.returnedJobId };
  }

  async status(jobId: string): Promise<EmbedDispatcherStatus> {
    this.calls.push(`status:${jobId}`);
    const s = this.statusSequence[Math.min(this.statusIndex, this.statusSequence.length - 1)];
    this.statusIndex++;
    return s;
  }

  async pullArtifacts(jobId: string, destDir: string): Promise<void> {
    this.calls.push(`pull:${jobId}:${destDir}`);
    const outputDir = path.join(destDir, "output");
    fs.mkdirSync(outputDir, { recursive: true });
    for (const [name, content] of Object.entries(this.outputFiles)) {
      fs.writeFileSync(path.join(outputDir, name), content);
    }
  }
}

function makeCounterNow(prefix = "2026-08-03T12:00:0"): () => string {
  let n = 0;
  return () => `${prefix}${n++}.000Z`;
}

const REAL_EMBED_TRAIN_SUMMARY = JSON.stringify({
  architecture: "arcface-embedder-tiny",
  embedderVersion: "0.1.0",
  embeddingDim: 256,
  configHash: "a".repeat(64),
  datasetManifestHash: "b".repeat(64),
  trainLosses: [10.0, 5.0],
  syntheticValRetrieval: { top1: 0.75, top5: 1.0, queryCount: 4 },
  syntheticValRetrievalReason: null,
  sampleCounts: { train: 18, val: 6, classes: 12 },
  licenses: EMBEDDER_LICENSES,
  wallClockSec: 1.2,
});

describe("embedRunner.run — happy path", () => {
  let runsDir: string;
  let inputsDir: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-embed-runner-test-"));
    runsDir = path.join(tmpDir, "vision-runs");
    inputsDir = path.join(tmpDir, "inputs");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function baseOpts(dispatcher: EmbedDispatcher, now: () => string, sleepCalls: number[]): EmbedRunnerOptions {
    return {
      runsDir,
      dispatcher,
      resource: "storm590x",
      capabilityJob: "vision-training:arcface-embed-train",
      inputsDir,
      environment: { torch: "2.13.0", cuda: null, driver: null, gpu: null },
      now,
      pollIntervalMs: 0,
      sleep: async (ms: number) => {
        sleepCalls.push(ms);
      },
    };
  }

  it("dispatches, polls through a running tick, pulls artifacts, hashes them, and writes an exact manifest.json + state.json", async () => {
    const outputFiles = { "embed-train-summary.json": REAL_EMBED_TRAIN_SUMMARY, "checkpoint.pt": "CHECKPOINT-BYTES", "embedder.tflite": "TFLITE-BYTES" };
    const dispatcher = new FakeDispatcher(["running", "completed"], "remote-embed-run-001", outputFiles);
    const sleepCalls: number[] = [];
    const now = makeCounterNow();
    const opts = baseOpts(dispatcher, now, sleepCalls);

    const spec: EmbedRunSpec = { datasetDir: "/data/composites-run", seed: 42 };
    const result = await run(spec, "test-embed-run-001", opts);

    expect(dispatcher.calls).toEqual([
      "run:test-embed-run-001",
      "status:remote-embed-run-001",
      "status:remote-embed-run-001",
      `pull:remote-embed-run-001:${path.join(runsDir, "test-embed-run-001")}`,
    ]);
    expect(sleepCalls).toEqual([0]);

    const runDir = path.join(runsDir, "test-embed-run-001");
    const config = JSON.parse(fs.readFileSync(path.join(runDir, "config.json"), "utf8"));
    expect(config).toEqual(buildEmbedConfig(spec, "output"));

    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"));
    expect(manifest).toEqual({
      schemaVersion: "0.1.0",
      runId: "test-embed-run-001",
      architecture: "arcface-embedder-tiny",
      embedderVersion: "0.1.0",
      embeddingDim: 256,
      configHash: "a".repeat(64),
      dataset: { dir: "/data/composites-run", manifestHash: "b".repeat(64) },
      seed: 42,
      metrics: {
        syntheticValRetrieval: { top1: 0.75, top5: 1.0, queryCount: 4 },
        syntheticValRetrievalReason: null,
        realPhotoBenchmarkTop1: null,
        realPhotoBenchmarkReason: "QA-gated: APP-025's real-photo benchmark photo set has not been shot yet (issue #140 scope note).",
      },
      licenses: EMBEDDER_LICENSES,
      environment: { torch: "2.13.0", cuda: null, driver: null, gpu: null },
      dispatch: { resource: "storm590x", jobId: "remote-embed-run-001", capabilityJob: "vision-training:arcface-embed-train" },
      artifacts: {
        checkpointFile: { name: "checkpoint.pt", sha256: sha256Hex("CHECKPOINT-BYTES") },
        tfliteFiles: [{ name: "embedder.tflite", sha256: sha256Hex("TFLITE-BYTES") }],
      },
      timestamps: { dispatchedAt: "2026-08-03T12:00:00.000Z", completedAt: "2026-08-03T12:00:01.000Z" },
      status: "completed",
    });

    expect(result.manifest).toEqual(manifest);
  });

  it("on a failed remote job: writes status:failed, still attempts a pull (best-effort), and writes a manifest with null artifacts when nothing landed", async () => {
    const dispatcher = new FakeDispatcher(["failed"], "remote-fail-run");
    const sleepCalls: number[] = [];
    const opts = baseOpts(dispatcher, makeCounterNow(), sleepCalls);
    const spec: EmbedRunSpec = { datasetDir: "/data/x", seed: 9 };

    const result = await run(spec, "fail-run", opts);

    expect(result.state.status).toBe("failed");
    expect(result.manifest).toMatchObject({
      status: "failed",
      configHash: null,
      embedderVersion: null,
      embeddingDim: null,
      dataset: { manifestHash: null },
      artifacts: { checkpointFile: null, tfliteFiles: [] },
    });
    const runDir = path.join(runsDir, "fail-run");
    expect(fs.existsSync(path.join(runDir, "manifest.json"))).toBe(true);
  });

  it("refuses to build a manifest when the pulled summary's licenses contain a copyleft identifier", async () => {
    const badSummary = JSON.stringify({ ...JSON.parse(REAL_EMBED_TRAIN_SUMMARY), licenses: { trainingCode: "AGPL-3.0" } });
    const dispatcher = new FakeDispatcher(["completed"], "remote-bad-license", { "embed-train-summary.json": badSummary, "checkpoint.pt": "X" });
    const opts = baseOpts(dispatcher, makeCounterNow(), []);
    const spec: EmbedRunSpec = { datasetDir: "/data/x", seed: 1 };

    await expect(run(spec, "bad-license-run", opts)).rejects.toThrow(/copyleft/);
  });
});

// ---------------------------------------------------------------------------
// resume — the three interruption points
// ---------------------------------------------------------------------------

describe("embedRunner resume", () => {
  let runsDir: string;
  let inputsDir: string;
  let tmpDir: string;
  const spec: EmbedRunSpec = { datasetDir: "/data/x", seed: 42 };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-embed-resume-test-"));
    runsDir = path.join(tmpDir, "vision-runs");
    inputsDir = path.join(tmpDir, "inputs");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function baseOpts(dispatcher: EmbedDispatcher, now: () => string): EmbedRunnerOptions {
    return {
      runsDir,
      dispatcher,
      resource: "storm590x",
      capabilityJob: "vision-training:arcface-embed-train",
      inputsDir,
      environment: { torch: "2.13.0", cuda: null, driver: null, gpu: null },
      now,
      pollIntervalMs: 0,
      sleep: async () => {},
    };
  }

  function writeRunDir(runId: string, state: EmbedRunState): string {
    const runDir = path.join(runsDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "config.json"), JSON.stringify(buildEmbedConfig(state.spec, "output"), null, 2) + "\n");
    fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify(state, null, 2) + "\n");
    return runDir;
  }

  it("dispatched-then-killed: resume() reloads state.json and keeps polling to completion without re-dispatching", async () => {
    const state: EmbedRunState = { runId: "resume-running", spec, jobId: "job-resume-running", status: "dispatched", timestamps: { dispatchedAt: "2026-08-03T10:00:00.000Z" } };
    const runDir = writeRunDir("resume-running", state);

    const dispatcher = new FakeDispatcher(["completed"], "job-resume-running", { "embed-train-summary.json": REAL_EMBED_TRAIN_SUMMARY, "checkpoint.pt": "Y" });
    const result = await resume("resume-running", baseOpts(dispatcher, makeCounterNow("2026-08-03T11:00:0")));

    expect(dispatcher.calls).toEqual(["status:job-resume-running", `pull:job-resume-running:${runDir}`]);
    expect(result.state.status).toBe("manifested");
    expect(result.manifest?.status).toBe("completed");
  });

  it("manifested (already fully done): resume() returns the cached manifest and never touches the dispatcher", async () => {
    const state: EmbedRunState = {
      runId: "resume-done",
      spec,
      jobId: "job-resume-done",
      status: "manifested",
      timestamps: { dispatchedAt: "2026-08-03T10:00:00.000Z", completedAt: "2026-08-03T10:05:00.000Z", manifestedAt: "2026-08-03T10:06:00.000Z" },
    };
    const runDir = writeRunDir("resume-done", state);
    const manifest = { runId: "resume-done", status: "completed", note: "already done" };
    fs.writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

    const dispatcher = new FakeDispatcher(["running"], "job-resume-done");
    const result = await resume("resume-done", baseOpts(dispatcher, makeCounterNow()));

    expect(dispatcher.calls).toEqual([]);
    expect(result.manifest).toEqual(manifest);
  });
});

// ---------------------------------------------------------------------------
// embedCli parseArgs
// ---------------------------------------------------------------------------

describe("train-vision/embedCli.ts parseArgs", () => {
  it("parses `run` with all required flags plus overrides", () => {
    expect(
      parseArgs([
        "run",
        "--run-id", "run-1",
        "--dataset-dir", "/data/composites-run",
        "--seed", "42",
        "--inputs", "/tmp/inputs",
        "--epochs", "10",
        "--batch-size", "16",
        "--lr", "0.0005",
        "--crop-size", "112",
        "--embedding-dim", "128",
        "--margin", "0.3",
        "--scale", "32",
        "--val-fraction", "0.2",
      ]),
    ).toEqual({
      command: "run",
      runId: "run-1",
      datasetDir: "/data/composites-run",
      seed: 42,
      resource: "storm590x",
      capabilityJob: "vision-training:arcface-embed-train",
      inputsDir: "/tmp/inputs",
      cuda: null,
      driver: null,
      gpu: null,
      torch: null,
      runsDir: "vision-runs",
      epochs: 10,
      batchSize: 16,
      lr: 0.0005,
      cropSize: 112,
      embeddingDim: 128,
      margin: 0.3,
      scale: 32,
      valFraction: 0.2,
    });
  });

  it("parses `resume` with its required flags", () => {
    expect(parseArgs(["resume", "--run-id", "run-1", "--inputs", "/tmp/inputs"])).toEqual({
      command: "resume",
      runId: "run-1",
      resource: "storm590x",
      capabilityJob: "vision-training:arcface-embed-train",
      inputsDir: "/tmp/inputs",
      cuda: null,
      driver: null,
      gpu: null,
      torch: null,
      runsDir: "vision-runs",
    });
  });

  it("parses `status` with just --run-id", () => {
    expect(parseArgs(["status", "--run-id", "run-1"])).toEqual({ command: "status", runId: "run-1", runsDir: "vision-runs" });
  });

  it("rejects an unknown command", () => {
    expect(() => parseArgs(["bogus"])).toThrow(/unknown embed-vision command/);
  });

  it("rejects `run` missing --run-id", () => {
    expect(() => parseArgs(["run", "--dataset-dir", "/data/x", "--seed", "1", "--inputs", "/tmp"])).toThrow(/--run-id is required/);
  });

  it("rejects `run` missing --dataset-dir", () => {
    expect(() => parseArgs(["run", "--run-id", "r", "--seed", "1", "--inputs", "/tmp"])).toThrow(/--dataset-dir is required/);
  });

  it("rejects `run` missing --inputs", () => {
    expect(() => parseArgs(["run", "--run-id", "r", "--dataset-dir", "/data/x", "--seed", "1"])).toThrow(/--inputs is required/);
  });
});
