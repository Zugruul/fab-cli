// Model export chain (APP-021, issue #133, SPEC-APP.md §8.2 + §5): merged
// GGUF per tier, quantize (Q4_K_M primary, Q8_0 reference), llama.cpp smoke
// test (load + one JSON-schema-constrained completion) before packaging
// eligibility, checksums + licenses recorded in a committed manifest. Mirrors
// test/training.test.ts's structure and rigor exactly. All dispatch here is a
// fake — no real ssh/rsync or remote-compute.py invocation ever happens in
// this suite; the real-machine 5090 run is exercised separately by the
// orchestrator post-review.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  buildExportConfig,
  resolveSmoke,
  computeBaseModelHash,
  DEFAULT_QUANTIZATIONS,
  DEFAULT_MAX_SEQ_LENGTH,
  DEFAULT_SMOKE_PROMPT,
  DEFAULT_SMOKE_SCHEMA,
  DEFAULT_SMOKE_MAX_TOKENS,
} from "../src/export/configBuilder.js";
import { buildLicenses, BASE_MODEL_LICENSE } from "../src/export/licenses.js";
import { run, resume } from "../src/export/runner.js";
import { buildRunArgv, buildStatusArgv, buildPullArgv } from "../src/export/realDispatcher.js";
import { parseArgs } from "../src/export/cli.js";
import { BASE_MODEL_BY_TIER } from "../src/training/types.js";
import type { ExportRunSpec, ExportDispatcher, ExportRunState, ExportRunnerOptions, DispatcherStatus } from "../src/export/types.js";
import type { TrainingRunManifest } from "../src/training/types.js";

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// configBuilder
// ---------------------------------------------------------------------------

describe("buildExportConfig", () => {
  it("builds the exact bundle config for a 1.7B export with no adapters (base-as-is) and default quantizations/smoke", () => {
    const spec: ExportRunSpec = { tier: "1.7B" };
    expect(buildExportConfig(spec, null)).toEqual({
      base_model: "unsloth/Qwen3-1.7B",
      quantizations: DEFAULT_QUANTIZATIONS,
      max_seq_length: DEFAULT_MAX_SEQ_LENGTH,
      smoke: {
        prompt: DEFAULT_SMOKE_PROMPT,
        json_schema: DEFAULT_SMOKE_SCHEMA,
        max_tokens: DEFAULT_SMOKE_MAX_TOKENS,
      },
    });
  });

  it("sets `adapters` when an adaptersDir is resolved", () => {
    const spec: ExportRunSpec = { tier: "0.6B" };
    const cfg = buildExportConfig(spec, "/tmp/some-adapters-dir");
    expect(cfg.adapters).toBe("/tmp/some-adapters-dir");
    expect(cfg.base_model).toBe("unsloth/Qwen3-0.6B");
  });

  it("overrides quantizations, max_seq_length, and every smoke field", () => {
    const spec: ExportRunSpec = {
      tier: "1.7B",
      quantizations: ["q5_k_m"],
      maxSeqLength: 4096,
      smoke: {
        prompt: "custom prompt",
        jsonSchema: { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
        maxTokens: 64,
        llamaCli: "/opt/llama.cpp/build/bin/llama-cli",
      },
    };
    expect(buildExportConfig(spec, null)).toEqual({
      base_model: "unsloth/Qwen3-1.7B",
      quantizations: ["q5_k_m"],
      max_seq_length: 4096,
      smoke: {
        prompt: "custom prompt",
        json_schema: { type: "object", properties: { x: { type: "number" } }, required: ["x"] },
        max_tokens: 64,
        llama_cli: "/opt/llama.cpp/build/bin/llama-cli",
      },
    });
  });

  it("§8.2 default quantizations are exactly Q4_K_M primary, Q8_0 reference", () => {
    expect(DEFAULT_QUANTIZATIONS).toEqual(["q4_k_m", "q8_0"]);
  });
});

describe("resolveSmoke", () => {
  it("merges partial overrides onto defaults rather than replacing wholesale", () => {
    const spec: ExportRunSpec = { tier: "1.7B", smoke: { maxTokens: 32 } };
    expect(resolveSmoke(spec)).toEqual({
      prompt: DEFAULT_SMOKE_PROMPT,
      jsonSchema: DEFAULT_SMOKE_SCHEMA,
      maxTokens: 32,
    });
  });

  it("omits llamaCli entirely when not overridden (export_gguf.py's own fallback discovery applies)", () => {
    const spec: ExportRunSpec = { tier: "1.7B" };
    expect(resolveSmoke(spec)).not.toHaveProperty("llamaCli");
  });
});

describe("computeBaseModelHash", () => {
  it("hashes the bare base-model id string for each tier, matching training's own identity-hash convention", () => {
    expect(computeBaseModelHash("1.7B")).toBe(sha256Hex("unsloth/Qwen3-1.7B"));
    expect(computeBaseModelHash("0.6B")).toBe(sha256Hex("unsloth/Qwen3-0.6B"));
    expect(computeBaseModelHash("1.7B")).not.toBe(computeBaseModelHash("0.6B"));
  });
});

// ---------------------------------------------------------------------------
// licenses
// ---------------------------------------------------------------------------

describe("buildLicenses", () => {
  it("records Apache-2.0 for the base model (Qwen3 HF license, SPEC-APP.md §5's deciding reason)", () => {
    expect(BASE_MODEL_LICENSE).toBe("Apache-2.0");
    const licenses = buildLicenses("1.7B");
    expect(licenses.baseModel).toBe("Apache-2.0");
  });

  it("records exact license notes for adapters and ggufs, identical across tiers", () => {
    const l17 = buildLicenses("1.7B");
    const l06 = buildLicenses("0.6B");
    expect(l17).toEqual(l06);
    expect(l17.adapters).toMatch(/Apache-2\.0/);
    expect(l17.adapters).toMatch(/NOT shipped/);
    expect(l17.ggufs).toMatch(/Apache-2\.0/);
    expect(l17.ggufs).toMatch(/derived/i);
  });
});

// ---------------------------------------------------------------------------
// runner — happy path (adaptersDir given directly)
// ---------------------------------------------------------------------------

class FakeDispatcher implements ExportDispatcher {
  calls: string[] = [];
  private statusIndex = 0;

  constructor(
    private readonly statusSequence: DispatcherStatus[],
    private readonly returnedJobId: string,
    private readonly onPull?: (destDir: string) => void,
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
    this.onPull?.(destDir);
  }
}

function makeCounterNow(prefix = "2026-08-02T12:00:0"): () => string {
  let n = 0;
  return () => `${prefix}${n++}.000Z`;
}

function writeExportSummary(
  destDir: string,
  opts: { baseModel: string; adapters: string | null; quantizations: string[]; files: Array<{ file: string; quantization: string; content: string }>; smokePerFile: Array<{ file: string; loaded: boolean; constrainedOutputRaw: string; parsedOk: boolean }>; schema: Record<string, unknown> },
): void {
  const ggufDir = path.join(destDir, "gguf");
  fs.mkdirSync(ggufDir, { recursive: true });
  const files = opts.files.map((f) => {
    fs.writeFileSync(path.join(ggufDir, f.file), f.content);
    return { file: f.file, quantization: f.quantization, sizeBytes: Buffer.byteLength(f.content), sha256: sha256Hex(f.content) };
  });
  const summary = {
    baseModel: opts.baseModel,
    adapters: opts.adapters,
    quantizations: opts.quantizations,
    files,
    wallClockSec: 12.3,
    smoke: { schema: opts.schema, perFile: opts.smokePerFile },
  };
  fs.writeFileSync(path.join(destDir, "export-summary.json"), JSON.stringify(summary, null, 2) + "\n");
}

describe("runner.run — happy path (adaptersDir given directly)", () => {
  let runsDir: string;
  let trainingRunsDir: string;
  let inputsDir: string;
  let lockfilePath: string;
  let adaptersDir: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-export-runner-test-"));
    runsDir = path.join(tmpDir, "export-runs");
    trainingRunsDir = path.join(tmpDir, "training-runs");
    inputsDir = path.join(tmpDir, "inputs");
    lockfilePath = path.join(tmpDir, "pnpm-lock.yaml");
    fs.writeFileSync(lockfilePath, "lockfileVersion: '9.0'\n");
    adaptersDir = path.join(tmpDir, "local-adapters");
    fs.mkdirSync(adaptersDir, { recursive: true });
    fs.writeFileSync(path.join(adaptersDir, "adapter_config.json"), '{"r":16}');
    fs.writeFileSync(path.join(adaptersDir, "adapter_model.safetensors"), "ADAPTER-BYTES-1");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function baseOpts(dispatcher: ExportDispatcher, now: () => string, sleepCalls: number[]): ExportRunnerOptions {
    return {
      runsDir,
      trainingRunsDir,
      dispatcher,
      resource: "storm590x",
      capabilityJob: "slm-training:export-gguf",
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

  it("dispatches, polls through a running tick, pulls gguf+summary, and writes an exact manifest.json + state.json", async () => {
    const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
    const dispatcher = new FakeDispatcher(["running", "completed"], "remote-export-001", (destDir) => {
      writeExportSummary(destDir, {
        baseModel: "unsloth/Qwen3-0.6B",
        adapters: adaptersDir,
        quantizations: ["q4_k_m", "q8_0"],
        files: [
          { file: "model-q4_k_m.gguf", quantization: "q4_k_m", content: "GGUF-Q4-BYTES" },
          { file: "model-q8_0.gguf", quantization: "q8_0", content: "GGUF-Q8-BYTES" },
        ],
        smokePerFile: [
          { file: "model-q4_k_m.gguf", loaded: true, constrainedOutputRaw: '{"ok":true}', parsedOk: true },
          { file: "model-q8_0.gguf", loaded: true, constrainedOutputRaw: '{"ok":true}', parsedOk: true },
        ],
        schema,
      });
    });
    const sleepCalls: number[] = [];
    const now = makeCounterNow();
    const opts = baseOpts(dispatcher, now, sleepCalls);

    const spec: ExportRunSpec = { tier: "0.6B", adaptersDir, quantizations: ["q4_k_m", "q8_0"] };
    const result = await run(spec, "test-export-001", opts);

    const runDir = path.join(runsDir, "test-export-001");
    expect(dispatcher.calls).toEqual([
      "run:test-export-001",
      "status:remote-export-001",
      "status:remote-export-001",
      `pull:remote-export-001:${runDir}`,
    ]);
    expect(sleepCalls).toEqual([0]);

    const config = JSON.parse(fs.readFileSync(path.join(runDir, "config.json"), "utf8"));
    expect(config).toEqual(buildExportConfig(spec, adaptersDir));

    const state = JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8")) as ExportRunState;
    expect(state).toEqual({
      runId: "test-export-001",
      spec,
      jobId: "remote-export-001",
      status: "manifested",
      timestamps: {
        dispatchedAt: "2026-08-02T12:00:00.000Z",
        completedAt: "2026-08-02T12:00:01.000Z",
        manifestedAt: "2026-08-02T12:00:02.000Z",
      },
    });

    const expectedConfigSha = sha256Hex('{"r":16}');
    const expectedModelSha = sha256Hex("ADAPTER-BYTES-1");
    const expectedLockfileSha = sha256Hex(fs.readFileSync(lockfilePath));
    const expectedQ4Sha = sha256Hex("GGUF-Q4-BYTES");
    const expectedQ8Sha = sha256Hex("GGUF-Q8-BYTES");

    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"));
    expect(manifest).toEqual({
      schemaVersion: "0.1.0",
      runId: "test-export-001",
      tier: "0.6B",
      baseModel: "unsloth/Qwen3-0.6B",
      baseModelHash: sha256Hex("unsloth/Qwen3-0.6B"),
      source: {
        trainingRunId: null,
        adaptersDir,
        adaptersSha256s: [
          { name: "adapter_config.json", sha256: expectedConfigSha },
          { name: "adapter_model.safetensors", sha256: expectedModelSha },
        ],
      },
      quantizations: ["q4_k_m", "q8_0"],
      artifacts: {
        files: [
          { file: "model-q4_k_m.gguf", quantization: "q4_k_m", sizeBytes: Buffer.byteLength("GGUF-Q4-BYTES"), sha256: expectedQ4Sha },
          { file: "model-q8_0.gguf", quantization: "q8_0", sizeBytes: Buffer.byteLength("GGUF-Q8-BYTES"), sha256: expectedQ8Sha },
        ],
      },
      smoke: {
        schema,
        perFile: [
          { file: "model-q4_k_m.gguf", loaded: true, constrainedOutputRaw: '{"ok":true}', parsedOk: true },
          { file: "model-q8_0.gguf", loaded: true, constrainedOutputRaw: '{"ok":true}', parsedOk: true },
        ],
      },
      licenses: buildLicenses("0.6B"),
      environment: {
        lockfileSha256: expectedLockfileSha,
        torch: "2.11.0+cu128",
        cuda: "12.8",
        driver: "580.65.06",
        gpu: "NVIDIA GeForce RTX 5090",
        unsloth: "2026.7.6",
      },
      dispatch: { resource: "storm590x", jobId: "remote-export-001", capabilityJob: "slm-training:export-gguf" },
      timestamps: { dispatchedAt: "2026-08-02T12:00:00.000Z", completedAt: "2026-08-02T12:00:01.000Z" },
      status: "completed",
    });

    expect(result.manifest).toEqual(manifest);
    expect(result.state).toEqual(state);
  });

  it("exports the base model as-is when neither adaptersRunId nor adaptersDir is given: config has no `adapters` key, manifest.source is all-null", async () => {
    const dispatcher = new FakeDispatcher(["completed"], "remote-base-export", (destDir) => {
      writeExportSummary(destDir, {
        baseModel: "unsloth/Qwen3-1.7B",
        adapters: null,
        quantizations: DEFAULT_QUANTIZATIONS,
        files: [{ file: "model-q4_k_m.gguf", quantization: "q4_k_m", content: "X" }],
        smokePerFile: [{ file: "model-q4_k_m.gguf", loaded: true, constrainedOutputRaw: "{}", parsedOk: true }],
        schema: DEFAULT_SMOKE_SCHEMA,
      });
    });
    const sleepCalls: number[] = [];
    const opts = baseOpts(dispatcher, makeCounterNow(), sleepCalls);
    const spec: ExportRunSpec = { tier: "1.7B" };

    const result = await run(spec, "base-export", opts);

    const runDir = path.join(runsDir, "base-export");
    const config = JSON.parse(fs.readFileSync(path.join(runDir, "config.json"), "utf8"));
    expect(config).not.toHaveProperty("adapters");
    expect(result.manifest?.source).toEqual({ trainingRunId: null, adaptersDir: null, adaptersSha256s: [] });
  });

  it("rejects when BOTH adaptersRunId and adaptersDir are given (ambiguous source), before ever calling the dispatcher", async () => {
    const dispatcher = new FakeDispatcher(["completed"], "remote-x");
    const spec: ExportRunSpec = { tier: "1.7B", adaptersRunId: "some-run", adaptersDir: "/tmp/whatever" };

    await expect(run(spec, "ambiguous-source", baseOpts(dispatcher, makeCounterNow(), []))).rejects.toThrow(
      /adaptersRunId.*adaptersDir|adaptersDir.*adaptersRunId/,
    );
    expect(dispatcher.calls).toEqual([]);
    expect(fs.existsSync(path.join(runsDir, "ambiguous-source"))).toBe(false);
  });

  it("resolves adaptersRunId against a real committed training-run manifest.json (trainingRunId, adaptersDir, adaptersSha256s all populated)", async () => {
    const trainingRunId = "ac-tiny-sft-0620-fixture";
    const trainingAdaptersDir = path.join(trainingRunsDir, trainingRunId, "adapters");
    const trainingManifest: Partial<TrainingRunManifest> = {
      artifacts: {
        adaptersDir: trainingAdaptersDir,
        files: [
          { name: "adapters/adapter_config.json", sha256: "aaa111" },
          { name: "adapters/adapter_model.safetensors", sha256: "bbb222" },
        ],
      },
    } as Partial<TrainingRunManifest>;
    fs.mkdirSync(path.join(trainingRunsDir, trainingRunId), { recursive: true });
    fs.writeFileSync(path.join(trainingRunsDir, trainingRunId, "manifest.json"), JSON.stringify(trainingManifest, null, 2));

    const dispatcher = new FakeDispatcher(["completed"], "remote-from-run", (destDir) => {
      writeExportSummary(destDir, {
        baseModel: "unsloth/Qwen3-1.7B",
        adapters: trainingAdaptersDir,
        quantizations: DEFAULT_QUANTIZATIONS,
        files: [{ file: "m.gguf", quantization: "q4_k_m", content: "Y" }],
        smokePerFile: [{ file: "m.gguf", loaded: true, constrainedOutputRaw: "{}", parsedOk: true }],
        schema: DEFAULT_SMOKE_SCHEMA,
      });
    });
    const spec: ExportRunSpec = { tier: "1.7B", adaptersRunId: trainingRunId };
    const result = await run(spec, "from-training-run", baseOpts(dispatcher, makeCounterNow(), []));

    expect(result.manifest?.source).toEqual({
      trainingRunId,
      adaptersDir: trainingAdaptersDir,
      adaptersSha256s: [
        { name: "adapters/adapter_config.json", sha256: "aaa111" },
        { name: "adapters/adapter_model.safetensors", sha256: "bbb222" },
      ],
    });
    const config = JSON.parse(fs.readFileSync(path.join(runsDir, "from-training-run", "config.json"), "utf8"));
    expect(config.adapters).toBe(trainingAdaptersDir);
  });

  it("rejects when adaptersRunId points at a training run with no manifest.json, before ever calling the dispatcher", async () => {
    const dispatcher = new FakeDispatcher(["completed"], "remote-x");
    const spec: ExportRunSpec = { tier: "1.7B", adaptersRunId: "does-not-exist" };

    await expect(run(spec, "missing-training-manifest", baseOpts(dispatcher, makeCounterNow(), []))).rejects.toThrow(
      /does-not-exist/,
    );
    expect(dispatcher.calls).toEqual([]);
  });

  it("rejects when adaptersRunId points at a FAILED training run (manifest.artifacts.adaptersDir is null), before ever calling the dispatcher", async () => {
    const trainingRunId = "failed-training-run";
    fs.mkdirSync(path.join(trainingRunsDir, trainingRunId), { recursive: true });
    fs.writeFileSync(
      path.join(trainingRunsDir, trainingRunId, "manifest.json"),
      JSON.stringify({ artifacts: { adaptersDir: null, files: [] }, status: "failed" }, null, 2),
    );
    const dispatcher = new FakeDispatcher(["completed"], "remote-x");
    const spec: ExportRunSpec = { tier: "1.7B", adaptersRunId: trainingRunId };

    await expect(run(spec, "from-failed-training-run", baseOpts(dispatcher, makeCounterNow(), []))).rejects.toThrow(
      /failed-training-run.*adaptersDir is null|no adapters/i,
    );
    expect(dispatcher.calls).toEqual([]);
  });

  it("on a failed remote job (smoke failure): still pulls artifacts (§8.2 diagnostics), records the real files + failing smoke result, and marks the run failed — never manifested", async () => {
    const schema = DEFAULT_SMOKE_SCHEMA;
    const dispatcher = new FakeDispatcher(["failed"], "remote-smoke-fail", (destDir) => {
      writeExportSummary(destDir, {
        baseModel: "unsloth/Qwen3-0.6B",
        adapters: adaptersDir,
        quantizations: ["q4_k_m"],
        files: [{ file: "model-q4_k_m.gguf", quantization: "q4_k_m", content: "GGUF-BAD" }],
        smokePerFile: [{ file: "model-q4_k_m.gguf", loaded: true, constrainedOutputRaw: "not json at all", parsedOk: false }],
        schema,
      });
    });
    const now = makeCounterNow();
    const opts = baseOpts(dispatcher, now, []);
    const spec: ExportRunSpec = { tier: "0.6B", adaptersDir, quantizations: ["q4_k_m"] };

    const result = await run(spec, "smoke-fail-run", opts);

    const runDir = path.join(runsDir, "smoke-fail-run");
    expect(dispatcher.calls).toEqual(["run:smoke-fail-run", "status:remote-smoke-fail", `pull:remote-smoke-fail:${runDir}`]);
    expect(result.state.status).toBe("failed");
    expect(result.state.timestamps).toEqual({
      dispatchedAt: "2026-08-02T12:00:00.000Z",
      failedAt: "2026-08-02T12:00:01.000Z",
    });
    expect(result.manifest?.status).toBe("failed");
    expect(result.manifest?.artifacts.files).toEqual([
      { file: "model-q4_k_m.gguf", quantization: "q4_k_m", sizeBytes: Buffer.byteLength("GGUF-BAD"), sha256: sha256Hex("GGUF-BAD") },
    ]);
    expect(result.manifest?.smoke).toEqual({
      schema,
      perFile: [{ file: "model-q4_k_m.gguf", loaded: true, constrainedOutputRaw: "not json at all", parsedOk: false }],
    });
    expect(fs.existsSync(path.join(runDir, "manifest.json"))).toBe(true);
  });

  it("on a failed remote job with NO export-summary.json at all (e.g. env not active): still writes a manifest, with empty files/smoke.perFile and the CONFIGURED smoke schema echoed (never fabricated results)", async () => {
    const dispatcher = new FakeDispatcher(["failed"], "remote-early-fail"); // no onPull — pulls nothing
    const opts = baseOpts(dispatcher, makeCounterNow(), []);
    const spec: ExportRunSpec = { tier: "1.7B" };

    const result = await run(spec, "early-fail-run", opts);

    expect(result.state.status).toBe("failed");
    expect(result.manifest?.status).toBe("failed");
    expect(result.manifest?.artifacts.files).toEqual([]);
    expect(result.manifest?.smoke).toEqual({ schema: DEFAULT_SMOKE_SCHEMA, perFile: [] });
  });

  it("persists the dispatched state.json BEFORE polling resolves (crash-recoverability)", async () => {
    let resolveStatus!: (value: DispatcherStatus) => void;
    const statusPromise = new Promise<DispatcherStatus>((resolve) => {
      resolveStatus = resolve;
    });
    const calls: string[] = [];
    const dispatcher: ExportDispatcher = {
      async run(_configLocalPath, _inputsDir, jobId) {
        calls.push(`run:${jobId}`);
        return { jobId: "remote-dispatched-coverage" };
      },
      async status(jobId) {
        calls.push(`status:${jobId}`);
        return statusPromise;
      },
      async pullArtifacts(jobId, destDir) {
        calls.push(`pull:${jobId}:${destDir}`);
        writeExportSummary(destDir, {
          baseModel: "unsloth/Qwen3-1.7B",
          adapters: null,
          quantizations: DEFAULT_QUANTIZATIONS,
          files: [],
          smokePerFile: [],
          schema: DEFAULT_SMOKE_SCHEMA,
        });
      },
    };
    const now = makeCounterNow();
    const opts = baseOpts(dispatcher, now, []);
    const spec: ExportRunSpec = { tier: "1.7B" };

    const runPromise = run(spec, "dispatched-coverage", opts);
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

describe("runner.run — refuses to dispatch without CUDA/driver (§8.1 environment capture, applies to §8.2's committed export manifest too)", () => {
  let runsDir: string;
  let trainingRunsDir: string;
  let inputsDir: string;
  let lockfilePath: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-export-cudaguard-test-"));
    runsDir = path.join(tmpDir, "export-runs");
    trainingRunsDir = path.join(tmpDir, "training-runs");
    inputsDir = path.join(tmpDir, "inputs");
    lockfilePath = path.join(tmpDir, "pnpm-lock.yaml");
    fs.writeFileSync(lockfilePath, "lockfileVersion: '9.0'\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function optsWith(dispatcher: FakeDispatcher, cudaDriver: { cuda: string | null; driver: string | null }): ExportRunnerOptions {
    return {
      runsDir,
      trainingRunsDir,
      dispatcher,
      resource: "storm590x",
      capabilityJob: "slm-training:export-gguf",
      inputsDir,
      environment: { lockfilePath, gpuCheck: { torch: "2.11.0+cu128" }, cudaDriver },
    };
  }

  it("rejects before ever calling the dispatcher when cuda is missing", async () => {
    const dispatcher = new FakeDispatcher(["completed"], "remote-x");
    const spec: ExportRunSpec = { tier: "1.7B" };

    await expect(run(spec, "no-cuda-run", optsWith(dispatcher, { cuda: null, driver: "580.65.06" }))).rejects.toThrow(
      /refuses to dispatch without real CUDA\/driver/,
    );
    expect(dispatcher.calls).toEqual([]);
    expect(fs.existsSync(path.join(runsDir, "no-cuda-run"))).toBe(false);
  });

  it("rejects before ever calling the dispatcher when driver is missing", async () => {
    const dispatcher = new FakeDispatcher(["completed"], "remote-y");
    const spec: ExportRunSpec = { tier: "1.7B" };

    await expect(run(spec, "no-driver-run", optsWith(dispatcher, { cuda: "12.8", driver: null }))).rejects.toThrow(
      /refuses to dispatch without real CUDA\/driver/,
    );
    expect(dispatcher.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resume — the interruption points
// ---------------------------------------------------------------------------

describe("resume", () => {
  let runsDir: string;
  let trainingRunsDir: string;
  let inputsDir: string;
  let lockfilePath: string;
  let tmpDir: string;
  const spec: ExportRunSpec = { tier: "0.6B" };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-export-resume-test-"));
    runsDir = path.join(tmpDir, "export-runs");
    trainingRunsDir = path.join(tmpDir, "training-runs");
    inputsDir = path.join(tmpDir, "inputs");
    lockfilePath = path.join(tmpDir, "pnpm-lock.yaml");
    fs.writeFileSync(lockfilePath, "lockfileVersion: '9.0'\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function baseOpts(dispatcher: ExportDispatcher, now: () => string): ExportRunnerOptions {
    return {
      runsDir,
      trainingRunsDir,
      dispatcher,
      resource: "storm590x",
      capabilityJob: "slm-training:export-gguf",
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

  function writeRunDir(runId: string, state: ExportRunState): string {
    const runDir = path.join(runsDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "config.json"), JSON.stringify(buildExportConfig(state.spec, null), null, 2) + "\n");
    fs.writeFileSync(path.join(runDir, "state.json"), JSON.stringify(state, null, 2) + "\n");
    return runDir;
  }

  it("dispatched-then-killed: resume() reloads state.json and keeps polling to completion without re-dispatching", async () => {
    const state: ExportRunState = {
      runId: "resume-running",
      spec,
      jobId: "job-resume-running",
      status: "dispatched",
      timestamps: { dispatchedAt: "2026-08-02T10:00:00.000Z" },
    };
    const runDir = writeRunDir("resume-running", state);

    const dispatcher = new FakeDispatcher(["completed"], "job-resume-running", (destDir) => {
      writeExportSummary(destDir, { baseModel: "unsloth/Qwen3-0.6B", adapters: null, quantizations: DEFAULT_QUANTIZATIONS, files: [], smokePerFile: [], schema: DEFAULT_SMOKE_SCHEMA });
    });
    const result = await resume("resume-running", baseOpts(dispatcher, makeCounterNow("2026-08-02T11:00:0")));

    expect(dispatcher.calls).toEqual(["status:job-resume-running", `pull:job-resume-running:${runDir}`]);
    expect(result.state.status).toBe("manifested");
    expect(result.state.timestamps.dispatchedAt).toBe("2026-08-02T10:00:00.000Z");
    expect(result.state.timestamps.completedAt).toBe("2026-08-02T11:00:00.000Z");
    expect(result.manifest?.status).toBe("completed");
  });

  it("completed-but-not-pulled: resume() pulls artifacts and writes the manifest, without ever calling dispatcher.status again", async () => {
    const state: ExportRunState = {
      runId: "resume-completed",
      spec,
      jobId: "job-resume-completed",
      status: "completed",
      timestamps: { dispatchedAt: "2026-08-02T10:00:00.000Z", completedAt: "2026-08-02T10:05:00.000Z" },
    };
    const runDir = writeRunDir("resume-completed", state);

    const dispatcher = new FakeDispatcher(["running"], "job-resume-completed", (destDir) => {
      writeExportSummary(destDir, { baseModel: "unsloth/Qwen3-0.6B", adapters: null, quantizations: DEFAULT_QUANTIZATIONS, files: [], smokePerFile: [], schema: DEFAULT_SMOKE_SCHEMA });
    });
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

  it("failed (manifest already on disk from the original failure-handling pull): resume() surfaces the cached failure and never touches the dispatcher again", async () => {
    const state: ExportRunState = {
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
      baseModel: "unsloth/Qwen3-0.6B",
      baseModelHash: sha256Hex("unsloth/Qwen3-0.6B"),
      source: { trainingRunId: null, adaptersDir: null, adaptersSha256s: [] },
      quantizations: DEFAULT_QUANTIZATIONS,
      artifacts: { files: [] },
      smoke: { schema: DEFAULT_SMOKE_SCHEMA, perFile: [] },
      licenses: buildLicenses("0.6B"),
      environment: {
        lockfileSha256: sha256Hex(fs.readFileSync(lockfilePath)),
        torch: "2.11.0+cu128",
        cuda: "12.8",
        driver: "580.65.06",
        gpu: "NVIDIA GeForce RTX 5090",
        unsloth: "2026.7.6",
      },
      dispatch: { resource: "storm590x", jobId: "job-resume-failed", capabilityJob: "slm-training:export-gguf" },
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

  it("failed with a MISSING manifest.json (crash between the failed state.json write and the manifest write, but the pull already ran): resume() rebuilds the manifest from what's already on disk, still without ever calling the dispatcher", async () => {
    const state: ExportRunState = {
      runId: "resume-failed-no-manifest",
      spec,
      jobId: "job-resume-failed-no-manifest",
      status: "failed",
      timestamps: { dispatchedAt: "2026-08-02T10:00:00.000Z", failedAt: "2026-08-02T10:01:00.000Z" },
    };
    const runDir = writeRunDir("resume-failed-no-manifest", state);
    // simulate: the original failure-handling pull already landed a summary
    // on disk before the process crashed, before it could write manifest.json
    writeExportSummary(runDir, {
      baseModel: "unsloth/Qwen3-0.6B",
      adapters: null,
      quantizations: DEFAULT_QUANTIZATIONS,
      files: [{ file: "partial.gguf", quantization: "q4_k_m", content: "PARTIAL" }],
      smokePerFile: [{ file: "partial.gguf", loaded: false, constrainedOutputRaw: "", parsedOk: false }],
      schema: DEFAULT_SMOKE_SCHEMA,
    });
    expect(fs.existsSync(path.join(runDir, "manifest.json"))).toBe(false);

    const dispatcher = new FakeDispatcher(["running"], "job-resume-failed-no-manifest");
    const result = await resume("resume-failed-no-manifest", baseOpts(dispatcher, makeCounterNow("2026-08-02T12:00:0")));

    expect(dispatcher.calls).toEqual([]);
    expect(result.state).toEqual(state);
    expect(result.manifest?.status).toBe("failed");
    expect(result.manifest?.artifacts.files).toEqual([
      { file: "partial.gguf", quantization: "q4_k_m", sizeBytes: Buffer.byteLength("PARTIAL"), sha256: sha256Hex("PARTIAL") },
    ]);
    expect(result.manifest?.smoke.perFile).toEqual([{ file: "partial.gguf", loaded: false, constrainedOutputRaw: "", parsedOk: false }]);

    const onDisk = JSON.parse(fs.readFileSync(path.join(runDir, "manifest.json"), "utf8"));
    expect(onDisk).toEqual(result.manifest);
  });

  it("manifested (already fully done): resume() returns the cached manifest and never touches the dispatcher", async () => {
    const state: ExportRunState = {
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
// realDispatcher — re-exported argv builders, targeting slm-training:export-gguf
// ---------------------------------------------------------------------------

describe("export/realDispatcher.ts — reused argv builders", () => {
  const REMOTE_COMPUTE_PY = "/Users/leona/Development/development-skills/plugins/spec-workflow/scripts/remote-compute.py";

  it("builds the exact `run` argv for the slm-training:export-gguf capability job", () => {
    expect(
      buildRunArgv({
        pythonBin: "python3",
        remoteComputePyPath: REMOTE_COMPUTE_PY,
        resource: "storm590x",
        capabilityJob: "slm-training:export-gguf",
        configName: "config.json",
        inputsDir: "/tmp/fab-export-inputs",
        jobId: "app021-run-1",
      }),
    ).toEqual([
      "python3",
      REMOTE_COMPUTE_PY,
      "run",
      "storm590x",
      "slm-training:export-gguf",
      "--param",
      "config=config.json",
      "--inputs",
      "/tmp/fab-export-inputs",
      "--job-id",
      "app021-run-1",
    ]);
  });

  it("builds the exact `job-status` and `job-pull` argv (identical shape to training's)", () => {
    expect(buildStatusArgv({ pythonBin: "python3", remoteComputePyPath: REMOTE_COMPUTE_PY, jobId: "app021-run-1" })).toEqual([
      "python3",
      REMOTE_COMPUTE_PY,
      "job-status",
      "app021-run-1",
    ]);
    expect(
      buildPullArgv({ pythonBin: "python3", remoteComputePyPath: REMOTE_COMPUTE_PY, jobId: "app021-run-1", destDir: "/tmp/dest" }),
    ).toEqual(["python3", REMOTE_COMPUTE_PY, "job-pull", "app021-run-1", "--dest", "/tmp/dest"]);
  });
});

// ---------------------------------------------------------------------------
// cli parseArgs
// ---------------------------------------------------------------------------

describe("export/cli.ts parseArgs", () => {
  it("parses `run` with all required flags plus adapters-run-id and overrides", () => {
    expect(
      parseArgs([
        "run",
        "--run-id", "run-1",
        "--tier", "1.7B",
        "--adapters-run-id", "training-run-1",
        "--inputs", "/tmp/inputs",
        "--lockfile", "/repo/pnpm-lock.yaml",
        "--gpu-check", "/tmp/gpu-check.json",
        "--cuda", "12.8",
        "--driver", "580.65.06",
        "--quantizations", "q4_k_m,q8_0",
        "--max-seq-length", "4096",
      ]),
    ).toEqual({
      command: "run",
      runId: "run-1",
      tier: "1.7B",
      adaptersRunId: "training-run-1",
      resource: "storm590x",
      capabilityJob: "slm-training:export-gguf",
      inputsDir: "/tmp/inputs",
      lockfilePath: "/repo/pnpm-lock.yaml",
      gpuCheckPath: "/tmp/gpu-check.json",
      cuda: "12.8",
      driver: "580.65.06",
      runsDir: "export-runs",
      trainingRunsDir: "training-runs",
      quantizations: ["q4_k_m", "q8_0"],
      maxSeqLength: 4096,
    });
  });

  it("parses `run` with --adapters-dir instead of --adapters-run-id", () => {
    const args = parseArgs([
      "run", "--run-id", "run-2", "--tier", "0.6B", "--adapters-dir", "/tmp/my-adapters",
      "--inputs", "/tmp/inputs", "--lockfile", "/repo/pnpm-lock.yaml", "--gpu-check", "/tmp/gpu-check.json",
      "--cuda", "12.8", "--driver", "580.65.06",
    ]);
    expect(args.command).toBe("run");
    if (args.command !== "run") throw new Error("unreachable");
    expect(args.adaptersDir).toBe("/tmp/my-adapters");
    expect(args.adaptersRunId).toBeUndefined();
  });

  it("defaults --capability-job to slm-training:export-gguf and --resource to storm590x", () => {
    const args = parseArgs([
      "run", "--run-id", "run-3", "--tier", "0.6B",
      "--inputs", "/tmp/inputs", "--lockfile", "/repo/pnpm-lock.yaml", "--gpu-check", "/tmp/gpu-check.json",
      "--cuda", "12.8", "--driver", "580.65.06",
    ]);
    expect(args.command).toBe("run");
    if (args.command !== "run") throw new Error("unreachable");
    expect(args.capabilityJob).toBe("slm-training:export-gguf");
    expect(args.resource).toBe("storm590x");
  });

  it("rejects `run` missing --cuda (§8.1 guard, still applies)", () => {
    expect(() =>
      parseArgs([
        "run", "--run-id", "run-4", "--tier", "1.7B",
        "--inputs", "/tmp/inputs", "--lockfile", "/repo/pnpm-lock.yaml", "--gpu-check", "/tmp/gpu-check.json",
        "--driver", "580.65.06",
      ]),
    ).toThrow(/--cuda and --driver are both required for `run`/);
  });

  it("does NOT require --cuda/--driver for `resume`", () => {
    expect(() =>
      parseArgs([
        "resume", "--run-id", "run-1", "--capability-job", "slm-training:export-gguf",
        "--inputs", "/tmp/inputs", "--lockfile", "/repo/pnpm-lock.yaml", "--gpu-check", "/tmp/gpu-check.json",
      ]),
    ).not.toThrow();
  });

  it("parses `status` with just --run-id", () => {
    expect(parseArgs(["status", "--run-id", "run-1"])).toEqual({
      command: "status",
      runId: "run-1",
      runsDir: "export-runs",
    });
  });

  it("rejects an unknown command", () => {
    expect(() => parseArgs(["bogus"])).toThrow(/unknown export command/);
  });

  it("rejects `run` with an invalid --tier", () => {
    expect(() =>
      parseArgs([
        "run", "--run-id", "r", "--tier", "bogus",
        "--inputs", "/tmp", "--lockfile", "/l", "--gpu-check", "/g",
        "--cuda", "12.8", "--driver", "580.65.06",
      ]),
    ).toThrow(/--tier must be/);
  });

  it("rejects `run` missing --run-id", () => {
    expect(() =>
      parseArgs(["run", "--tier", "1.7B", "--inputs", "/tmp", "--lockfile", "/l", "--gpu-check", "/g", "--cuda", "12.8", "--driver", "580.65.06"]),
    ).toThrow(/--run-id is required/);
  });
});
