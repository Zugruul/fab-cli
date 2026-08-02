// Training runner (APP-020, issue #132): config-driven QLoRA SFT/DPO
// dispatch onto the remote-compute `slm-training` capability bundle
// (development-skills/plugins/spec-workflow/scripts/remote-capabilities/
// slm-training), with a committed per-run manifest (SPEC-APP.md §8.1) and
// resume support. All dispatch in these tests is a fake — no real ssh/rsync
// or remote-compute.py invocation ever happens here; the real-machine 5090
// run is exercised separately by the orchestrator post-review.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { buildTrainingConfig, resolveHyperparams, computeBaseModelHash, DEFAULT_TARGET_MODULES } from "../src/training/configBuilder.js";
import { assembleEnvironment, sha256File } from "../src/training/environment.js";
import { run, resume } from "../src/training/runner.js";
import { buildRunArgv, buildStatusArgv, buildPullArgv } from "../src/training/realDispatcher.js";
import { parseArgs } from "../src/training/cli.js";
import { BASE_MODEL_BY_TIER } from "../src/training/types.js";
import type { TrainingRunSpec, TrainingDispatcher, RunState, RunnerOptions, DispatcherStatus } from "../src/training/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures", "training");
const TINY_SFT = path.join(FIXTURES, "tiny-sft.jsonl");
const TINY_DPO = path.join(FIXTURES, "tiny-dpo.jsonl");

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// configBuilder
// ---------------------------------------------------------------------------

describe("buildTrainingConfig", () => {
  it("builds the exact bundle config for 1.7B sft with default hyperparams", () => {
    const spec: TrainingRunSpec = {
      tier: "1.7B",
      stage: "sft",
      datasetPath: TINY_SFT,
      seed: 3407,
    };
    expect(buildTrainingConfig(spec)).toEqual({
      base_model: "unsloth/Qwen3-1.7B",
      stage: "sft",
      max_seq_length: 2048,
      load_in_4bit: true,
      lora: { r: 16, alpha: 16, dropout: 0, target_modules: DEFAULT_TARGET_MODULES },
      dataset: { path: TINY_SFT, chat_template_kwargs: { enable_thinking: false } },
      train: { num_epochs: 1, batch_size: 2, grad_accum: 4, lr: 0.0002, warmup_steps: 5, seed: 3407, logging_steps: 1 },
    });
  });

  it("builds the exact bundle config for 0.6B dpo with a max_steps override", () => {
    const spec: TrainingRunSpec = {
      tier: "0.6B",
      stage: "dpo",
      datasetPath: TINY_DPO,
      seed: 42,
      train: { maxSteps: 20 },
    };
    expect(buildTrainingConfig(spec)).toEqual({
      base_model: "unsloth/Qwen3-0.6B",
      stage: "dpo",
      max_seq_length: 2048,
      load_in_4bit: true,
      lora: { r: 16, alpha: 16, dropout: 0, target_modules: DEFAULT_TARGET_MODULES },
      dataset: { path: TINY_DPO, chat_template_kwargs: { enable_thinking: false } },
      train: { max_steps: 20, batch_size: 2, grad_accum: 4, lr: 0.0002, warmup_steps: 5, seed: 42, logging_steps: 1 },
    });
  });

  it("sets enable_thinking: false for both tiers regardless of stage (§8.1 thinking-disabled requirement)", () => {
    for (const tier of ["1.7B", "0.6B"] as const) {
      for (const stage of ["sft", "dpo"] as const) {
        const cfg = buildTrainingConfig({ tier, stage, datasetPath: TINY_SFT, seed: 1 });
        expect(cfg.dataset.chat_template_kwargs).toEqual({ enable_thinking: false });
        expect(cfg.base_model).toBe(BASE_MODEL_BY_TIER[tier]);
      }
    }
  });

  it("merges partial lora/train overrides onto tier defaults rather than replacing them wholesale", () => {
    const spec: TrainingRunSpec = {
      tier: "1.7B",
      stage: "sft",
      datasetPath: TINY_SFT,
      seed: 7,
      lora: { r: 8 },
      train: { batchSize: 4, lr: 0.0001 },
    };
    const cfg = buildTrainingConfig(spec);
    expect(cfg.lora).toEqual({ r: 8, alpha: 16, dropout: 0, target_modules: DEFAULT_TARGET_MODULES });
    expect(cfg.train).toEqual({ num_epochs: 1, batch_size: 4, grad_accum: 4, lr: 0.0001, warmup_steps: 5, seed: 7, logging_steps: 1 });
  });
});

describe("resolveHyperparams", () => {
  it("resolves numEpochs to null when maxSteps is given", () => {
    const resolved = resolveHyperparams({ tier: "1.7B", stage: "sft", datasetPath: TINY_SFT, seed: 1, train: { maxSteps: 5 } });
    expect(resolved.train.maxSteps).toBe(5);
    expect(resolved.train.numEpochs).toBeNull();
  });
});

describe("computeBaseModelHash", () => {
  it("hashes the resolved base-model id string alone when unpinned", () => {
    const spec: TrainingRunSpec = { tier: "1.7B", stage: "sft", datasetPath: TINY_SFT, seed: 1 };
    expect(computeBaseModelHash(spec)).toBe(sha256Hex("unsloth/Qwen3-1.7B"));
  });

  it("hashes id@revision when a revision is pinned, differing from the unpinned hash", () => {
    const spec: TrainingRunSpec = { tier: "0.6B", stage: "sft", datasetPath: TINY_SFT, seed: 1, baseModelRevision: "abc123" };
    expect(computeBaseModelHash(spec)).toBe(sha256Hex("unsloth/Qwen3-0.6B@abc123"));
    expect(computeBaseModelHash(spec)).not.toBe(sha256Hex("unsloth/Qwen3-0.6B"));
  });
});

// ---------------------------------------------------------------------------
// environment
// ---------------------------------------------------------------------------

describe("assembleEnvironment", () => {
  let tmpDir: string;
  let lockfilePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-training-env-test-"));
    lockfilePath = path.join(tmpDir, "pnpm-lock.yaml");
    fs.writeFileSync(lockfilePath, "lockfileVersion: '9.0'\npackages: {}\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("assembles the exact environment block from a real-shaped gpu-check.json object + a structured cuda/driver input + the lockfile's real sha256", () => {
    const gpuCheck = {
      torch: "2.11.0+cu128",
      cudaAvailable: true,
      device: "NVIDIA GeForce RTX 5090",
      archList: ["sm_120"],
      vramTotalMB: 32607,
      vramFreeMB: 31000,
      matmulMs: 12.34,
      matmulChecksum: 987654.5,
      unsloth: "2026.7.6",
    };
    const cudaDriver = { cuda: "12.8", driver: "580.65.06" };

    const env = assembleEnvironment({ lockfilePath, gpuCheck, cudaDriver });

    const expectedLockfileSha = createHash("sha256").update(fs.readFileSync(lockfilePath)).digest("hex");
    expect(env).toEqual({
      lockfileSha256: expectedLockfileSha,
      torch: "2.11.0+cu128",
      cuda: "12.8",
      driver: "580.65.06",
      gpu: "NVIDIA GeForce RTX 5090",
      unsloth: "2026.7.6",
    });
  });

  it("reports unsloth: null when gpu-check.json recorded an unslothError instead (not fatal to gpu-check per its own doc comment)", () => {
    const gpuCheck = { torch: "2.11.0+cu128", cudaAvailable: true, device: "NVIDIA GeForce RTX 5090", unslothError: "No module named 'unsloth'" };
    const env = assembleEnvironment({ lockfilePath, gpuCheck, cudaDriver: { cuda: null, driver: null } });
    expect(env.unsloth).toBeNull();
    expect(env.cuda).toBeNull();
    expect(env.driver).toBeNull();
  });

  it("sha256File matches node crypto's own hash of the same file", () => {
    expect(sha256File(lockfilePath)).toBe(createHash("sha256").update(fs.readFileSync(lockfilePath)).digest("hex"));
  });
});

// ---------------------------------------------------------------------------
// runner — happy path + failure path with a fake dispatcher
// ---------------------------------------------------------------------------

class FakeDispatcher implements TrainingDispatcher {
  calls: string[] = [];
  private statusIndex = 0;

  constructor(
    private readonly statusSequence: DispatcherStatus[],
    private readonly returnedJobId: string,
    private readonly pullFiles: Record<string, string> = {},
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
    const adaptersDir = path.join(destDir, "adapters");
    fs.mkdirSync(adaptersDir, { recursive: true });
    for (const [name, content] of Object.entries(this.pullFiles)) {
      fs.writeFileSync(path.join(adaptersDir, name), content);
    }
  }
}

function makeCounterNow(prefix = "2026-08-02T12:00:0"): () => string {
  let n = 0;
  return () => `${prefix}${n++}.000Z`;
}

describe("runner.run — happy path", () => {
  let runsDir: string;
  let inputsDir: string;
  let lockfilePath: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-training-runner-test-"));
    runsDir = path.join(tmpDir, "training-runs");
    inputsDir = path.join(tmpDir, "inputs");
    lockfilePath = path.join(tmpDir, "pnpm-lock.yaml");
    fs.writeFileSync(lockfilePath, "lockfileVersion: '9.0'\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function baseOpts(dispatcher: TrainingDispatcher, now: () => string, sleepCalls: number[]): RunnerOptions {
    return {
      runsDir,
      dispatcher,
      resource: "storm590x",
      capabilityJob: "slm-training:sft",
      inputsDir,
      environment: {
        lockfilePath,
        gpuCheck: { torch: "2.11.0+cu128", cudaAvailable: true, device: "NVIDIA GeForce RTX 5090", unsloth: "2026.7.6" },
        cudaDriver: { cuda: "12.8", driver: "580.65.06" },
      },
      now,
      pollIntervalMs: 0,
      sleep: async (ms: number) => {
        sleepCalls.push(ms);
      },
    };
  }

  it("dispatches, polls through a running tick, pulls artifacts, hashes them, and writes an exact manifest.json + state.json", async () => {
    const pullFiles = { "adapter_config.json": '{"r":16}', "adapter_model.bin": "ADAPTER-BYTES-1" };
    const dispatcher = new FakeDispatcher(["running", "completed"], "remote-test-run-001", pullFiles);
    const sleepCalls: number[] = [];
    const now = makeCounterNow();
    const opts = baseOpts(dispatcher, now, sleepCalls);

    const spec: TrainingRunSpec = { tier: "0.6B", stage: "sft", datasetPath: TINY_SFT, seed: 3407 };
    const result = await run(spec, "test-run-001", opts);

    // call order: dispatch, then poll (running, completed), then pull — using
    // the jobId the dispatcher RETURNED, not the one it was given.
    expect(dispatcher.calls).toEqual([
      "run:test-run-001",
      "status:remote-test-run-001",
      "status:remote-test-run-001",
      `pull:remote-test-run-001:${path.join(runsDir, "test-run-001")}`,
    ]);
    expect(sleepCalls).toEqual([0]);

    const runDir = path.join(runsDir, "test-run-001");
    const state = JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8")) as RunState;
    expect(state).toEqual({
      runId: "test-run-001",
      spec,
      jobId: "remote-test-run-001",
      status: "manifested",
      timestamps: {
        dispatchedAt: "2026-08-02T12:00:00.000Z",
        completedAt: "2026-08-02T12:00:01.000Z",
        manifestedAt: "2026-08-02T12:00:02.000Z",
      },
    });

    const config = JSON.parse(fs.readFileSync(path.join(runDir, "config.json"), "utf8"));
    expect(config).toEqual(buildTrainingConfig(spec));

    const datasetBytes = fs.readFileSync(TINY_SFT);
    const expectedDatasetSha = sha256Hex(datasetBytes);
    const expectedConfigSha = sha256Hex('{"r":16}');
    const expectedModelSha = sha256Hex("ADAPTER-BYTES-1");
    const expectedLockfileSha = sha256Hex(fs.readFileSync(lockfilePath));

    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"));
    expect(manifest).toEqual({
      schemaVersion: "0.1.0",
      runId: "test-run-001",
      tier: "0.6B",
      stage: "sft",
      baseModel: "unsloth/Qwen3-0.6B",
      baseModelHash: sha256Hex("unsloth/Qwen3-0.6B"),
      hyperparams: {
        maxSeqLength: 2048,
        loadIn4bit: true,
        lora: { r: 16, alpha: 16, dropout: 0, targetModules: DEFAULT_TARGET_MODULES },
        train: { maxSteps: null, numEpochs: 1, batchSize: 2, gradAccum: 4, lr: 0.0002, warmupSteps: 5, loggingSteps: 1, seed: 3407 },
      },
      seed: 3407,
      dataset: { path: TINY_SFT, sha256: expectedDatasetSha, rowCount: 8 },
      environment: {
        lockfileSha256: expectedLockfileSha,
        torch: "2.11.0+cu128",
        cuda: "12.8",
        driver: "580.65.06",
        gpu: "NVIDIA GeForce RTX 5090",
        unsloth: "2026.7.6",
      },
      dispatch: { resource: "storm590x", jobId: "remote-test-run-001", capabilityJob: "slm-training:sft" },
      artifacts: {
        adaptersDir: path.join(runDir, "adapters"),
        files: [
          { name: "adapters/adapter_config.json", sha256: expectedConfigSha },
          { name: "adapters/adapter_model.bin", sha256: expectedModelSha },
        ],
      },
      timestamps: { dispatchedAt: "2026-08-02T12:00:00.000Z", completedAt: "2026-08-02T12:00:01.000Z" },
      status: "completed",
    });

    expect(result.manifest).toEqual(manifest);
    expect(result.state).toEqual(state);
  });

  it("counts DPO fixture rows correctly (4 rows)", async () => {
    const dispatcher = new FakeDispatcher(["completed"], "remote-dpo-run", { "adapter_model.bin": "X" });
    const sleepCalls: number[] = [];
    const opts = baseOpts(dispatcher, makeCounterNow(), sleepCalls);
    const spec: TrainingRunSpec = { tier: "1.7B", stage: "dpo", datasetPath: TINY_DPO, seed: 1 };
    const result = await run(spec, "dpo-run", opts);
    expect(result.manifest?.dataset.rowCount).toBe(4);
  });

  it("on a failed remote job: writes status:failed, never calls pullArtifacts, and still writes a manifest with null artifacts", async () => {
    const dispatcher = new FakeDispatcher(["failed"], "remote-fail-run");
    const sleepCalls: number[] = [];
    const now = makeCounterNow();
    const opts = baseOpts(dispatcher, now, sleepCalls);
    const spec: TrainingRunSpec = { tier: "1.7B", stage: "sft", datasetPath: TINY_SFT, seed: 9 };

    const result = await run(spec, "fail-run", opts);

    expect(dispatcher.calls).toEqual(["run:fail-run", "status:remote-fail-run"]);
    expect(result.state.status).toBe("failed");
    expect(result.state.timestamps).toEqual({
      dispatchedAt: "2026-08-02T12:00:00.000Z",
      failedAt: "2026-08-02T12:00:01.000Z",
    });
    expect(result.manifest).toMatchObject({
      status: "failed",
      artifacts: { adaptersDir: null, files: [] },
      timestamps: { dispatchedAt: "2026-08-02T12:00:00.000Z", completedAt: null },
    });

    const runDir = path.join(runsDir, "fail-run");
    expect(fs.existsSync(path.join(runDir, "manifest.json"))).toBe(true);
  });

  it("persists the dispatched state.json BEFORE polling resolves (crash-recoverability: this write is the whole mechanism resume() depends on)", async () => {
    let resolveStatus!: (value: DispatcherStatus) => void;
    const statusPromise = new Promise<DispatcherStatus>((resolve) => {
      resolveStatus = resolve;
    });
    const calls: string[] = [];
    const dispatcher: TrainingDispatcher = {
      async run(_configLocalPath, _inputsDir, jobId) {
        calls.push(`run:${jobId}`);
        return { jobId: "remote-dispatched-coverage" };
      },
      async status(jobId) {
        calls.push(`status:${jobId}`);
        return statusPromise; // stays pending until the test resolves it below
      },
      async pullArtifacts(jobId, destDir) {
        calls.push(`pull:${jobId}:${destDir}`);
        fs.mkdirSync(path.join(destDir, "adapters"), { recursive: true });
        fs.writeFileSync(path.join(destDir, "adapters", "adapter_model.bin"), "X");
      },
    };
    const now = makeCounterNow();
    const opts = baseOpts(dispatcher, now, []);
    const spec: TrainingRunSpec = { tier: "1.7B", stage: "sft", datasetPath: TINY_SFT, seed: 5 };

    const runPromise = run(spec, "dispatched-coverage", opts);

    // Flush pending microtasks (dispatch -> state write -> the first,
    // still-pending status() call) without ever resolving status().
    await new Promise((resolve) => setTimeout(resolve, 0));

    const runDir = path.join(runsDir, "dispatched-coverage");
    expect(fs.existsSync(path.join(runDir, "state.json"))).toBe(true);
    const midFlightState = JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8"));
    expect(midFlightState).toEqual({
      runId: "dispatched-coverage",
      spec,
      jobId: "remote-dispatched-coverage",
      status: "dispatched",
      timestamps: { dispatchedAt: "2026-08-02T12:00:00.000Z" },
    });
    expect(calls).toEqual(["run:dispatched-coverage", "status:remote-dispatched-coverage"]);

    resolveStatus("completed");
    const result = await runPromise;
    expect(result.state.status).toBe("manifested");
  });
});

describe("runner.run — refuses to dispatch without CUDA/driver (§8.1 environment capture)", () => {
  let runsDir: string;
  let inputsDir: string;
  let lockfilePath: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-training-cudaguard-test-"));
    runsDir = path.join(tmpDir, "training-runs");
    inputsDir = path.join(tmpDir, "inputs");
    lockfilePath = path.join(tmpDir, "pnpm-lock.yaml");
    fs.writeFileSync(lockfilePath, "lockfileVersion: '9.0'\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function optsWith(dispatcher: FakeDispatcher, cudaDriver: { cuda: string | null; driver: string | null }): RunnerOptions {
    return {
      runsDir,
      dispatcher,
      resource: "storm590x",
      capabilityJob: "slm-training:sft",
      inputsDir,
      environment: { lockfilePath, gpuCheck: { torch: "2.11.0+cu128" }, cudaDriver },
    };
  }

  it("rejects before ever calling the dispatcher when cuda is missing", async () => {
    const dispatcher = new FakeDispatcher(["completed"], "remote-x", { "adapter_model.bin": "X" });
    const spec: TrainingRunSpec = { tier: "1.7B", stage: "sft", datasetPath: TINY_SFT, seed: 1 };

    await expect(run(spec, "no-cuda-run", optsWith(dispatcher, { cuda: null, driver: "580.65.06" }))).rejects.toThrow(
      /refuses to dispatch without real CUDA\/driver/,
    );
    expect(dispatcher.calls).toEqual([]);
    expect(fs.existsSync(path.join(runsDir, "no-cuda-run"))).toBe(false);
  });

  it("rejects before ever calling the dispatcher when driver is missing", async () => {
    const dispatcher = new FakeDispatcher(["completed"], "remote-y", { "adapter_model.bin": "X" });
    const spec: TrainingRunSpec = { tier: "1.7B", stage: "sft", datasetPath: TINY_SFT, seed: 1 };

    await expect(run(spec, "no-driver-run", optsWith(dispatcher, { cuda: "12.8", driver: null }))).rejects.toThrow(
      /refuses to dispatch without real CUDA\/driver/,
    );
    expect(dispatcher.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resume — the three interruption points
// ---------------------------------------------------------------------------

describe("resume", () => {
  let runsDir: string;
  let inputsDir: string;
  let lockfilePath: string;
  let tmpDir: string;
  const spec: TrainingRunSpec = { tier: "0.6B", stage: "sft", datasetPath: TINY_SFT, seed: 3407 };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-training-resume-test-"));
    runsDir = path.join(tmpDir, "training-runs");
    inputsDir = path.join(tmpDir, "inputs");
    lockfilePath = path.join(tmpDir, "pnpm-lock.yaml");
    fs.writeFileSync(lockfilePath, "lockfileVersion: '9.0'\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function baseOpts(dispatcher: TrainingDispatcher, now: () => string): RunnerOptions {
    return {
      runsDir,
      dispatcher,
      resource: "storm590x",
      capabilityJob: "slm-training:sft",
      inputsDir,
      environment: {
        lockfilePath,
        gpuCheck: { torch: "2.11.0+cu128", cudaAvailable: true, device: "NVIDIA GeForce RTX 5090", unsloth: "2026.7.6" },
        cudaDriver: { cuda: "12.8", driver: "580.65.06" },
      },
      now,
      pollIntervalMs: 0,
      sleep: async () => {},
    };
  }

  function writeRunDir(runId: string, state: RunState): string {
    const runDir = path.join(runsDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "config.json"), JSON.stringify(buildTrainingConfig(state.spec), null, 2) + "\n");
    fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify(state, null, 2) + "\n");
    return runDir;
  }

  it("dispatched-then-killed: resume() reloads state.json and keeps polling to completion without re-dispatching", async () => {
    const state: RunState = {
      runId: "resume-running",
      spec,
      jobId: "job-resume-running",
      status: "dispatched",
      timestamps: { dispatchedAt: "2026-08-02T10:00:00.000Z" },
    };
    const runDir = writeRunDir("resume-running", state);

    const dispatcher = new FakeDispatcher(["completed"], "job-resume-running", { "adapter_model.bin": "Y" });
    const result = await resume("resume-running", baseOpts(dispatcher, makeCounterNow("2026-08-02T11:00:0")));

    expect(dispatcher.calls).toEqual(["status:job-resume-running", `pull:job-resume-running:${runDir}`]);
    expect(result.state.status).toBe("manifested");
    expect(result.state.timestamps.dispatchedAt).toBe("2026-08-02T10:00:00.000Z");
    expect(result.state.timestamps.completedAt).toBe("2026-08-02T11:00:00.000Z");
    expect(result.manifest?.status).toBe("completed");
  });

  it("completed-but-not-pulled: resume() pulls artifacts and writes the manifest, without ever calling dispatcher.status again", async () => {
    const state: RunState = {
      runId: "resume-completed",
      spec,
      jobId: "job-resume-completed",
      status: "completed",
      timestamps: { dispatchedAt: "2026-08-02T10:00:00.000Z", completedAt: "2026-08-02T10:05:00.000Z" },
    };
    const runDir = writeRunDir("resume-completed", state);

    const dispatcher = new FakeDispatcher(["running"], "job-resume-completed", { "adapter_model.bin": "Z" });
    const result = await resume("resume-completed", baseOpts(dispatcher, makeCounterNow("2026-08-02T11:00:0")));

    expect(dispatcher.calls).toEqual([`pull:job-resume-completed:${runDir}`]);
    expect(result.state.status).toBe("manifested");
    expect(result.state.timestamps).toEqual({
      dispatchedAt: "2026-08-02T10:00:00.000Z",
      completedAt: "2026-08-02T10:05:00.000Z",
      manifestedAt: "2026-08-02T11:00:00.000Z",
    });
    expect(fs.existsSync(path.join(runDir, "manifest.json"))).toBe(true);
  });

  it("failed: resume() surfaces the failure and never calls the dispatcher again (no auto-retrain)", async () => {
    const state: RunState = {
      runId: "resume-failed",
      spec,
      jobId: "job-resume-failed",
      status: "failed",
      timestamps: { dispatchedAt: "2026-08-02T10:00:00.000Z", failedAt: "2026-08-02T10:01:00.000Z" },
    };
    const runDir = writeRunDir("resume-failed", state);
    const failedManifest = {
      schemaVersion: "0.1.0",
      runId: "resume-failed",
      tier: "0.6B",
      stage: "sft",
      baseModel: "unsloth/Qwen3-0.6B",
      baseModelHash: sha256Hex("unsloth/Qwen3-0.6B"),
      hyperparams: {
        maxSeqLength: 2048,
        loadIn4bit: true,
        lora: { r: 16, alpha: 16, dropout: 0, targetModules: DEFAULT_TARGET_MODULES },
        train: { maxSteps: null, numEpochs: 1, batchSize: 2, gradAccum: 4, lr: 0.0002, warmupSteps: 5, loggingSteps: 1, seed: 3407 },
      },
      seed: 3407,
      dataset: { path: TINY_SFT, sha256: sha256Hex(fs.readFileSync(TINY_SFT)), rowCount: 8 },
      environment: {
        lockfileSha256: sha256Hex(fs.readFileSync(lockfilePath)),
        torch: "2.11.0+cu128",
        cuda: "12.8",
        driver: "580.65.06",
        gpu: "NVIDIA GeForce RTX 5090",
        unsloth: "2026.7.6",
      },
      dispatch: { resource: "storm590x", jobId: "job-resume-failed", capabilityJob: "slm-training:sft" },
      artifacts: { adaptersDir: null, files: [] },
      timestamps: { dispatchedAt: "2026-08-02T10:00:00.000Z", completedAt: null },
      status: "failed",
    };
    fs.writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify(failedManifest, null, 2) + "\n");

    const dispatcher = new FakeDispatcher(["running"], "job-resume-failed");
    const result = await resume("resume-failed", baseOpts(dispatcher, makeCounterNow("2026-08-02T12:00:0")));

    expect(dispatcher.calls).toEqual([]);
    expect(result.state).toEqual(state);
    expect(result.manifest).toEqual(failedManifest);
  });

  it("failed with a MISSING manifest.json (crash between the failed state.json write and the failed manifest write): resume() rebuilds it exactly, still without ever calling the dispatcher", async () => {
    const state: RunState = {
      runId: "resume-failed-no-manifest",
      spec,
      jobId: "job-resume-failed-no-manifest",
      status: "failed",
      timestamps: { dispatchedAt: "2026-08-02T10:00:00.000Z", failedAt: "2026-08-02T10:01:00.000Z" },
    };
    const runDir = writeRunDir("resume-failed-no-manifest", state);
    // deliberately no manifest.json written here — simulates the crash window.
    expect(fs.existsSync(path.join(runDir, "manifest.json"))).toBe(false);

    const dispatcher = new FakeDispatcher(["running"], "job-resume-failed-no-manifest");
    const result = await resume("resume-failed-no-manifest", baseOpts(dispatcher, makeCounterNow("2026-08-02T12:00:0")));

    expect(dispatcher.calls).toEqual([]);
    expect(result.state).toEqual(state);
    expect(result.manifest).toEqual({
      schemaVersion: "0.1.0",
      runId: "resume-failed-no-manifest",
      tier: "0.6B",
      stage: "sft",
      baseModel: "unsloth/Qwen3-0.6B",
      baseModelHash: sha256Hex("unsloth/Qwen3-0.6B"),
      hyperparams: {
        maxSeqLength: 2048,
        loadIn4bit: true,
        lora: { r: 16, alpha: 16, dropout: 0, targetModules: DEFAULT_TARGET_MODULES },
        train: { maxSteps: null, numEpochs: 1, batchSize: 2, gradAccum: 4, lr: 0.0002, warmupSteps: 5, loggingSteps: 1, seed: 3407 },
      },
      seed: 3407,
      dataset: { path: TINY_SFT, sha256: sha256Hex(fs.readFileSync(TINY_SFT)), rowCount: 8 },
      environment: {
        lockfileSha256: sha256Hex(fs.readFileSync(lockfilePath)),
        torch: "2.11.0+cu128",
        cuda: "12.8",
        driver: "580.65.06",
        gpu: "NVIDIA GeForce RTX 5090",
        unsloth: "2026.7.6",
      },
      dispatch: { resource: "storm590x", jobId: "job-resume-failed-no-manifest", capabilityJob: "slm-training:sft" },
      artifacts: { adaptersDir: null, files: [] },
      timestamps: { dispatchedAt: "2026-08-02T10:00:00.000Z", completedAt: null },
      status: "failed",
    });

    // and it's genuinely on disk now, not just returned in-memory
    const onDisk = JSON.parse(fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"));
    expect(onDisk).toEqual(result.manifest);
  });

  it("manifested (already fully done): resume() returns the cached manifest and never touches the dispatcher", async () => {
    const state: RunState = {
      runId: "resume-done",
      spec,
      jobId: "job-resume-done",
      status: "manifested",
      timestamps: { dispatchedAt: "2026-08-02T10:00:00.000Z", completedAt: "2026-08-02T10:05:00.000Z", manifestedAt: "2026-08-02T10:06:00.000Z" },
    };
    const runDir = writeRunDir("resume-done", state);
    const manifest = { runId: "resume-done", status: "completed", note: "already done" };
    fs.writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

    const dispatcher = new FakeDispatcher(["running"], "job-resume-done");
    const result = await resume("resume-done", baseOpts(dispatcher, makeCounterNow()));

    expect(dispatcher.calls).toEqual([]);
    expect(result.state).toEqual(state);
    expect(result.manifest).toEqual(manifest);
  });
});

// ---------------------------------------------------------------------------
// realDispatcher — argv construction only, never executed
// ---------------------------------------------------------------------------

describe("buildRunArgv / buildStatusArgv / buildPullArgv", () => {
  const REMOTE_COMPUTE_PY = "/Users/leona/Development/development-skills/plugins/spec-workflow/scripts/remote-compute.py";

  it("builds the exact `run` argv for the slm-training:sft capability job", () => {
    expect(
      buildRunArgv({
        pythonBin: "python3",
        remoteComputePyPath: REMOTE_COMPUTE_PY,
        resource: "storm590x",
        capabilityJob: "slm-training:sft",
        configName: "config.json",
        inputsDir: "/tmp/fab-training-inputs",
        jobId: "app020-run-1",
      }),
    ).toEqual([
      "python3",
      REMOTE_COMPUTE_PY,
      "run",
      "storm590x",
      "slm-training:sft",
      "--param",
      "config=config.json",
      "--inputs",
      "/tmp/fab-training-inputs",
      "--job-id",
      "app020-run-1",
    ]);
  });

  it("builds the exact `job-status` argv", () => {
    expect(buildStatusArgv({ pythonBin: "python3", remoteComputePyPath: REMOTE_COMPUTE_PY, jobId: "app020-run-1" })).toEqual([
      "python3",
      REMOTE_COMPUTE_PY,
      "job-status",
      "app020-run-1",
    ]);
  });

  it("builds the exact `job-pull` argv", () => {
    expect(
      buildPullArgv({ pythonBin: "python3", remoteComputePyPath: REMOTE_COMPUTE_PY, jobId: "app020-run-1", destDir: "/tmp/dest" }),
    ).toEqual(["python3", REMOTE_COMPUTE_PY, "job-pull", "app020-run-1", "--dest", "/tmp/dest"]);
  });
});

// ---------------------------------------------------------------------------
// cli parseArgs
// ---------------------------------------------------------------------------

describe("training/cli.ts parseArgs", () => {
  it("parses `run` with all required flags plus overrides", () => {
    expect(
      parseArgs([
        "run",
        "--run-id", "run-1",
        "--tier", "1.7B",
        "--stage", "sft",
        "--dataset", TINY_SFT,
        "--seed", "3407",
        "--inputs", "/tmp/inputs",
        "--lockfile", "/repo/pnpm-lock.yaml",
        "--gpu-check", "/tmp/gpu-check.json",
        "--cuda", "12.8",
        "--driver", "580.65.06",
        "--max-steps", "100",
        "--lora-r", "8",
      ]),
    ).toEqual({
      command: "run",
      runId: "run-1",
      tier: "1.7B",
      stage: "sft",
      datasetPath: TINY_SFT,
      seed: 3407,
      resource: "storm590x",
      capabilityJob: "slm-training:sft",
      inputsDir: "/tmp/inputs",
      lockfilePath: "/repo/pnpm-lock.yaml",
      gpuCheckPath: "/tmp/gpu-check.json",
      cuda: "12.8",
      driver: "580.65.06",
      runsDir: "training-runs",
      maxSteps: 100,
      loraR: 8,
    });
  });

  it("defaults --capability-job from --stage and --resource to storm590x", () => {
    const args = parseArgs([
      "run",
      "--run-id", "run-2",
      "--tier", "0.6B",
      "--stage", "dpo",
      "--dataset", TINY_DPO,
      "--seed", "1",
      "--inputs", "/tmp/inputs",
      "--lockfile", "/repo/pnpm-lock.yaml",
      "--gpu-check", "/tmp/gpu-check.json",
      "--cuda", "12.8",
      "--driver", "580.65.06",
    ]);
    expect(args.command).toBe("run");
    if (args.command !== "run") throw new Error("unreachable");
    expect(args.capabilityJob).toBe("slm-training:dpo");
    expect(args.resource).toBe("storm590x");
    expect(args.cuda).toBe("12.8");
    expect(args.driver).toBe("580.65.06");
  });

  it("rejects `run` missing --cuda (§8.1: CUDA/driver must never ship silently null)", () => {
    expect(() =>
      parseArgs([
        "run", "--run-id", "run-3", "--tier", "1.7B", "--stage", "sft", "--dataset", TINY_SFT, "--seed", "1",
        "--inputs", "/tmp/inputs", "--lockfile", "/repo/pnpm-lock.yaml", "--gpu-check", "/tmp/gpu-check.json",
        "--driver", "580.65.06",
      ]),
    ).toThrow(/--cuda and --driver are both required for `run`/);
  });

  it("rejects `run` missing --driver too", () => {
    expect(() =>
      parseArgs([
        "run", "--run-id", "run-4", "--tier", "1.7B", "--stage", "sft", "--dataset", TINY_SFT, "--seed", "1",
        "--inputs", "/tmp/inputs", "--lockfile", "/repo/pnpm-lock.yaml", "--gpu-check", "/tmp/gpu-check.json",
        "--cuda", "12.8",
      ]),
    ).toThrow(/--cuda and --driver are both required for `run`/);
  });

  it("does NOT require --cuda/--driver for `resume` (it stays tolerant — inherits the original run's values)", () => {
    expect(() =>
      parseArgs([
        "resume", "--run-id", "run-1", "--capability-job", "slm-training:sft",
        "--inputs", "/tmp/inputs", "--lockfile", "/repo/pnpm-lock.yaml", "--gpu-check", "/tmp/gpu-check.json",
      ]),
    ).not.toThrow();
  });

  it("parses `resume` with its required flags", () => {
    expect(
      parseArgs([
        "resume",
        "--run-id", "run-1",
        "--capability-job", "slm-training:sft",
        "--inputs", "/tmp/inputs",
        "--lockfile", "/repo/pnpm-lock.yaml",
        "--gpu-check", "/tmp/gpu-check.json",
      ]),
    ).toEqual({
      command: "resume",
      runId: "run-1",
      resource: "storm590x",
      capabilityJob: "slm-training:sft",
      inputsDir: "/tmp/inputs",
      lockfilePath: "/repo/pnpm-lock.yaml",
      gpuCheckPath: "/tmp/gpu-check.json",
      cuda: null,
      driver: null,
      runsDir: "training-runs",
    });
  });

  it("parses `status` with just --run-id", () => {
    expect(parseArgs(["status", "--run-id", "run-1"])).toEqual({
      command: "status",
      runId: "run-1",
      runsDir: "training-runs",
    });
  });

  it("rejects an unknown command", () => {
    expect(() => parseArgs(["bogus"])).toThrow(/unknown training command/);
  });

  it("rejects `run` missing --run-id", () => {
    expect(() =>
      parseArgs(["run", "--tier", "1.7B", "--stage", "sft", "--dataset", TINY_SFT, "--seed", "1", "--inputs", "/tmp", "--lockfile", "/l", "--gpu-check", "/g"]),
    ).toThrow(/--run-id is required/);
  });

  it("rejects `run` with an invalid --tier", () => {
    expect(() =>
      parseArgs([
        "run", "--run-id", "r", "--tier", "bogus", "--stage", "sft", "--dataset", TINY_SFT, "--seed", "1",
        "--inputs", "/tmp", "--lockfile", "/l", "--gpu-check", "/g",
      ]),
    ).toThrow(/--tier must be/);
  });
});
