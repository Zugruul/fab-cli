// OBB detector training dispatch (APP-027, issue #139): config-driven,
// resumable run orchestration mirroring pipeline/src/training/'s and
// pipeline/src/export/'s conventions. All dispatch in these tests is a
// fake — no real ssh/rsync or remote-compute.py invocation ever happens
// here; the Python train/export chain is exercised separately by the
// pipeline/train-vision/tests/ pytest suite and a manual CPU smoke run
// (see the PR body for numbers), per this issue's "smoke run is separate
// from the test suite" instruction.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { buildVisionConfig, DEFAULT_STRIDE, DEFAULT_TRAIN, DEFAULT_VAL_FRACTION } from "../src/train-vision/configBuilder.js";
import { ARCHITECTURE_LICENSES, validateLicenses } from "../src/train-vision/licenses.js";
import { run, resume } from "../src/train-vision/runner.js";
import { buildRunArgv, buildStatusArgv, buildPullArgv } from "../src/train-vision/realDispatcher.js";
import { parseArgs } from "../src/train-vision/cli.js";
import type { VisionDispatcher, VisionRunSpec, VisionRunState, VisionRunnerOptions, DispatcherStatus } from "../src/train-vision/types.js";

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// configBuilder
// ---------------------------------------------------------------------------

describe("buildVisionConfig", () => {
  it("builds the exact config for a minimal spec using documented defaults", () => {
    const spec: VisionRunSpec = { datasetDir: "/data/composites-run", seed: 42 };
    expect(buildVisionConfig(spec, "output")).toEqual({
      architecture: "obb-centernet-tiny",
      seed: 42,
      datasetDir: "/data/composites-run",
      valFraction: DEFAULT_VAL_FRACTION,
      stride: DEFAULT_STRIDE,
      train: DEFAULT_TRAIN,
      outputDir: "output",
    });
  });

  it("merges partial train overrides onto defaults rather than replacing them wholesale", () => {
    const spec: VisionRunSpec = { datasetDir: "/data/x", seed: 1, train: { epochs: 10 } };
    const config = buildVisionConfig(spec, "output");
    expect(config.train).toEqual({ ...DEFAULT_TRAIN, epochs: 10 });
  });

  it("respects an explicit architecture/valFraction/stride override", () => {
    const spec: VisionRunSpec = { datasetDir: "/data/x", seed: 1, architecture: "obb-centernet-tiny", valFraction: 0.2, stride: 16 };
    const config = buildVisionConfig(spec, "output");
    expect(config.valFraction).toBe(0.2);
    expect(config.stride).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// licenses
// ---------------------------------------------------------------------------

describe("validateLicenses", () => {
  it("accepts the real ARCHITECTURE_LICENSES table this package ships", () => {
    expect(() => validateLicenses(ARCHITECTURE_LICENSES as unknown as Record<string, string>)).not.toThrow();
  });

  it("rejects an empty license string", () => {
    expect(() => validateLicenses({ foo: "" })).toThrow(/empty/);
  });

  it("rejects a copyleft identifier even if it's not a bare allowlist miss", () => {
    expect(() => validateLicenses({ foo: "Ultralytics-YOLO-AGPL" })).toThrow(/copyleft/);
    expect(() => validateLicenses({ foo: "GPL-3.0" })).toThrow(/copyleft/);
  });

  it("rejects an unrecognized (but non-copyleft) identifier", () => {
    expect(() => validateLicenses({ foo: "Proprietary" })).toThrow(/not on the allowlist/);
  });

  it("accepts every allowlisted identifier", () => {
    for (const license of ["MIT", "Apache-2.0", "BSD-3-Clause", "BSD-2-Clause"]) {
      expect(() => validateLicenses({ foo: license })).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// runner — happy path + failure path with a fake dispatcher
// ---------------------------------------------------------------------------

class FakeDispatcher implements VisionDispatcher {
  calls: string[] = [];
  private statusIndex = 0;

  constructor(
    private readonly statusSequence: DispatcherStatus[],
    private readonly returnedJobId: string,
    private readonly outputFiles: Record<string, string | Buffer> = {},
  ) {}

  async run(_configLocalPath: string, _inputsDir: string, jobId: string): Promise<{ jobId: string }> {
    this.calls.push(`run:${jobId}`);
    return { jobId: this.returnedJobId };
  }

  async status(jobId: string): Promise<DispatcherStatus> {
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

const REAL_TRAIN_SUMMARY = JSON.stringify({
  architecture: "obb-centernet-tiny",
  configHash: "a".repeat(64),
  datasetManifestHash: "b".repeat(64),
  trainLosses: [10.0, 5.0],
  syntheticValMAP: { mAP: 0.4, perThreshold: { "0.5": 0.6, "0.75": 0.2 } },
  sampleCounts: { train: 18, val: 6 },
  licenses: ARCHITECTURE_LICENSES,
  wallClockSec: 1.2,
});

describe("runner.run — happy path", () => {
  let runsDir: string;
  let inputsDir: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-vision-runner-test-"));
    runsDir = path.join(tmpDir, "vision-runs");
    inputsDir = path.join(tmpDir, "inputs");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function baseOpts(dispatcher: VisionDispatcher, now: () => string, sleepCalls: number[]): VisionRunnerOptions {
    return {
      runsDir,
      dispatcher,
      resource: "storm590x",
      capabilityJob: "vision-training:obb-train",
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
    const outputFiles = { "train-summary.json": REAL_TRAIN_SUMMARY, "checkpoint.pt": "CHECKPOINT-BYTES", "model.tflite": "TFLITE-BYTES" };
    const dispatcher = new FakeDispatcher(["running", "completed"], "remote-vision-run-001", outputFiles);
    const sleepCalls: number[] = [];
    const now = makeCounterNow();
    const opts = baseOpts(dispatcher, now, sleepCalls);

    const spec: VisionRunSpec = { datasetDir: "/data/composites-run", seed: 42 };
    const result = await run(spec, "test-run-001", opts);

    expect(dispatcher.calls).toEqual([
      "run:test-run-001",
      "status:remote-vision-run-001",
      "status:remote-vision-run-001",
      `pull:remote-vision-run-001:${path.join(runsDir, "test-run-001")}`,
    ]);
    expect(sleepCalls).toEqual([0]);

    const runDir = path.join(runsDir, "test-run-001");
    const config = JSON.parse(fs.readFileSync(path.join(runDir, "config.json"), "utf8"));
    expect(config).toEqual(buildVisionConfig(spec, "output"));

    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"));
    expect(manifest).toEqual({
      schemaVersion: "0.1.0",
      runId: "test-run-001",
      architecture: "obb-centernet-tiny",
      configHash: "a".repeat(64),
      dataset: { dir: "/data/composites-run", manifestHash: "b".repeat(64) },
      seed: 42,
      metrics: {
        syntheticVal: { mAP: 0.4, perThreshold: { "0.5": 0.6, "0.75": 0.2 } },
        realPhotoBenchmark: null,
        realPhotoBenchmarkReason:
          "the real-photo eval set now exists (pipeline/src/train-vision/realPhotoEvalSet.ts, issue #139) — mAP against it is computed by a separate eval run, not by this training run itself, so this field stays null here until that eval run's summary is read.",
      },
      licenses: ARCHITECTURE_LICENSES,
      environment: { torch: "2.13.0", cuda: null, driver: null, gpu: null },
      dispatch: { resource: "storm590x", jobId: "remote-vision-run-001", capabilityJob: "vision-training:obb-train" },
      artifacts: {
        checkpointFile: { name: "checkpoint.pt", sha256: sha256Hex("CHECKPOINT-BYTES") },
        tfliteFiles: [{ name: "model.tflite", sha256: sha256Hex("TFLITE-BYTES") }],
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
    const spec: VisionRunSpec = { datasetDir: "/data/x", seed: 9 };

    const result = await run(spec, "fail-run", opts);

    expect(result.state.status).toBe("failed");
    expect(result.manifest).toMatchObject({
      status: "failed",
      configHash: null,
      dataset: { manifestHash: null },
      artifacts: { checkpointFile: null, tfliteFiles: [] },
    });
    const runDir = path.join(runsDir, "fail-run");
    expect(fs.existsSync(path.join(runDir, "manifest.json"))).toBe(true);
  });

  it("refuses to build a manifest when the pulled summary's licenses contain a copyleft identifier", async () => {
    const badSummary = JSON.stringify({ ...JSON.parse(REAL_TRAIN_SUMMARY), licenses: { trainingCode: "AGPL-3.0" } });
    const dispatcher = new FakeDispatcher(["completed"], "remote-bad-license", { "train-summary.json": badSummary, "checkpoint.pt": "X" });
    const opts = baseOpts(dispatcher, makeCounterNow(), []);
    const spec: VisionRunSpec = { datasetDir: "/data/x", seed: 1 };

    await expect(run(spec, "bad-license-run", opts)).rejects.toThrow(/copyleft/);
  });
});

// ---------------------------------------------------------------------------
// resume — the three interruption points
// ---------------------------------------------------------------------------

describe("resume", () => {
  let runsDir: string;
  let inputsDir: string;
  let tmpDir: string;
  const spec: VisionRunSpec = { datasetDir: "/data/x", seed: 42 };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-vision-resume-test-"));
    runsDir = path.join(tmpDir, "vision-runs");
    inputsDir = path.join(tmpDir, "inputs");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function baseOpts(dispatcher: VisionDispatcher, now: () => string): VisionRunnerOptions {
    return {
      runsDir,
      dispatcher,
      resource: "storm590x",
      capabilityJob: "vision-training:obb-train",
      inputsDir,
      environment: { torch: "2.13.0", cuda: null, driver: null, gpu: null },
      now,
      pollIntervalMs: 0,
      sleep: async () => {},
    };
  }

  function writeRunDir(runId: string, state: VisionRunState): string {
    const runDir = path.join(runsDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "config.json"), JSON.stringify(buildVisionConfig(state.spec, "output"), null, 2) + "\n");
    fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify(state, null, 2) + "\n");
    return runDir;
  }

  it("dispatched-then-killed: resume() reloads state.json and keeps polling to completion without re-dispatching", async () => {
    const state: VisionRunState = { runId: "resume-running", spec, jobId: "job-resume-running", status: "dispatched", timestamps: { dispatchedAt: "2026-08-03T10:00:00.000Z" } };
    const runDir = writeRunDir("resume-running", state);

    const dispatcher = new FakeDispatcher(["completed"], "job-resume-running", { "train-summary.json": REAL_TRAIN_SUMMARY, "checkpoint.pt": "Y" });
    const result = await resume("resume-running", baseOpts(dispatcher, makeCounterNow("2026-08-03T11:00:0")));

    expect(dispatcher.calls).toEqual(["status:job-resume-running", `pull:job-resume-running:${runDir}`]);
    expect(result.state.status).toBe("manifested");
    expect(result.manifest?.status).toBe("completed");
  });

  it("completed-but-not-manifested: resume() pulls artifacts and writes the manifest, without ever calling dispatcher.status again", async () => {
    const state: VisionRunState = {
      runId: "resume-completed",
      spec,
      jobId: "job-resume-completed",
      status: "completed",
      timestamps: { dispatchedAt: "2026-08-03T10:00:00.000Z", completedAt: "2026-08-03T10:05:00.000Z" },
    };
    const runDir = writeRunDir("resume-completed", state);

    const dispatcher = new FakeDispatcher(["running"], "job-resume-completed", { "train-summary.json": REAL_TRAIN_SUMMARY, "checkpoint.pt": "Z" });
    const result = await resume("resume-completed", baseOpts(dispatcher, makeCounterNow("2026-08-03T11:00:0")));

    expect(dispatcher.calls).toEqual([`pull:job-resume-completed:${runDir}`]);
    expect(result.state.status).toBe("manifested");
    expect(fs.existsSync(path.join(runDir, "manifest.json"))).toBe(true);
  });

  it("manifested (already fully done): resume() returns the cached manifest and never touches the dispatcher", async () => {
    const state: VisionRunState = {
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
// realDispatcher — re-exported argv builders, targeting vision-training:obb-train
// ---------------------------------------------------------------------------

describe("train-vision/realDispatcher.ts — reused argv builders", () => {
  const REMOTE_COMPUTE_PY = "/Users/leona/Development/development-skills/plugins/spec-workflow/scripts/remote-compute.py";

  it("builds the exact `run` argv for a vision-training capability job", () => {
    expect(
      buildRunArgv({
        pythonBin: "python3",
        remoteComputePyPath: REMOTE_COMPUTE_PY,
        resource: "storm590x",
        capabilityJob: "vision-training:obb-train",
        configName: "config.json",
        inputsDir: "/tmp/fab-vision-inputs",
        jobId: "app027-run-1",
      }),
    ).toEqual([
      "python3",
      REMOTE_COMPUTE_PY,
      "run",
      "storm590x",
      "vision-training:obb-train",
      "--param",
      "config=config.json",
      "--inputs",
      "/tmp/fab-vision-inputs",
      "--job-id",
      "app027-run-1",
    ]);
  });

  it("builds the exact `job-status`/`job-pull` argv", () => {
    expect(buildStatusArgv({ pythonBin: "python3", remoteComputePyPath: REMOTE_COMPUTE_PY, jobId: "app027-run-1" })).toEqual([
      "python3",
      REMOTE_COMPUTE_PY,
      "job-status",
      "app027-run-1",
    ]);
    expect(buildPullArgv({ pythonBin: "python3", remoteComputePyPath: REMOTE_COMPUTE_PY, jobId: "app027-run-1", destDir: "/tmp/dest" })).toEqual([
      "python3",
      REMOTE_COMPUTE_PY,
      "job-pull",
      "app027-run-1",
      "--dest",
      "/tmp/dest",
    ]);
  });
});

// ---------------------------------------------------------------------------
// cli parseArgs
// ---------------------------------------------------------------------------

describe("train-vision/cli.ts parseArgs", () => {
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
        "--stride", "16",
        "--val-fraction", "0.2",
      ]),
    ).toEqual({
      command: "run",
      runId: "run-1",
      datasetDir: "/data/composites-run",
      seed: 42,
      resource: "storm590x",
      capabilityJob: "vision-training:obb-train",
      inputsDir: "/tmp/inputs",
      cuda: null,
      driver: null,
      gpu: null,
      torch: null,
      runsDir: "vision-runs",
      epochs: 10,
      batchSize: 16,
      lr: 0.0005,
      stride: 16,
      valFraction: 0.2,
    });
  });

  it("parses `resume` with its required flags", () => {
    expect(parseArgs(["resume", "--run-id", "run-1", "--inputs", "/tmp/inputs"])).toEqual({
      command: "resume",
      runId: "run-1",
      resource: "storm590x",
      capabilityJob: "vision-training:obb-train",
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
    expect(() => parseArgs(["bogus"])).toThrow(/unknown train-vision command/);
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
