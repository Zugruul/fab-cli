/**
 * OBB detector training run orchestration (APP-027, SPEC-APP.md §8.7c).
 * Mirrors pipeline/src/export/runner.ts's shape closely: dispatch -> poll
 * -> pull -> manifest, RESUMABLE (state.json persisted after every status
 * transition), reading the pulled job's OWN summary file
 * (train-summary.json, written by train_vision/train.py) rather than
 * re-deriving config/dataset hashes locally — see train.py's doc comment
 * for why those are computed on the machine that actually has the
 * dataset dir, not assumed re-derivable here.
 *
 * Run dirs live at `${runsDir}/${runId}` and hold config.json + state.json
 * + manifest.json (all committed, per pipeline/vision-runs/.gitignore)
 * plus a gitignored `output/` pulled from the job (checkpoint.pt,
 * train-summary.json, and any *.tflite files an export step placed
 * alongside it).
 *
 * Scope note: this runner handles TRAINING only, matching training/
 * runner.ts's own single-concern scope (export is export/runner.ts's
 * separate job for LLMs) — the OBB tflite EXPORT step
 * (train_vision/export.py) is invoked directly today, not yet through a
 * TS runner of its own; see README.md.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildVisionConfig } from "./configBuilder.js";
import { ARCHITECTURE_LICENSES, validateLicenses } from "./licenses.js";
import { DEFAULT_ARCHITECTURE } from "./types.js";
import type {
  VisionArtifactFile,
  VisionMapMetric,
  VisionRunManifest,
  VisionRunResult,
  VisionRunSpec,
  VisionRunState,
  VisionRunnerOptions,
} from "./types.js";

const SCHEMA_VERSION = "0.1.0";
const OUTPUT_SUBDIR = "output";

function nowIso(now?: () => string): string {
  return (now ?? (() => new Date().toISOString()))();
}

function runDirFor(opts: VisionRunnerOptions, runId: string): string {
  return path.join(opts.runsDir, runId);
}

function outputDirFor(runDir: string): string {
  return path.join(runDir, OUTPUT_SUBDIR);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function readState(runDir: string): VisionRunState {
  return JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8")) as VisionRunState;
}

function readManifestIfPresent(runDir: string): VisionRunManifest | null {
  const manifestPath = path.join(runDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as VisionRunManifest;
}

/** train_vision/train.py's real train-summary.json shape. Typed
 * defensively (all fields optional-ish via `?`) — a failed/partial run
 * may never have written one at all (readTrainSummaryIfPresent returns
 * null in that case), never a crash on a missing field. */
interface TrainSummary {
  architecture?: string;
  configHash?: string;
  datasetManifestHash?: string;
  syntheticValMAP?: VisionMapMetric;
  licenses?: Record<string, string>;
}

function readTrainSummaryIfPresent(outputDir: string): TrainSummary | null {
  const summaryPath = path.join(outputDir, "train-summary.json");
  if (!fs.existsSync(summaryPath)) return null;
  return JSON.parse(fs.readFileSync(summaryPath, "utf8")) as TrainSummary;
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function listTfliteFiles(outputDir: string): VisionArtifactFile[] {
  if (!fs.existsSync(outputDir)) return [];
  return fs
    .readdirSync(outputDir)
    .filter((name) => name.endsWith(".tflite"))
    .sort()
    .map((name) => ({ name, sha256: sha256File(path.join(outputDir, name)) }));
}

function buildManifest(opts: VisionRunnerOptions, runId: string, spec: VisionRunSpec, state: VisionRunState, status: "completed" | "failed"): VisionRunManifest {
  const runDir = runDirFor(opts, runId);
  const outputDir = outputDirFor(runDir);
  const summary = readTrainSummaryIfPresent(outputDir);

  const architecture = spec.architecture ?? DEFAULT_ARCHITECTURE;
  const licenses = summary?.licenses ?? (ARCHITECTURE_LICENSES as unknown as Record<string, string>);
  validateLicenses(licenses);

  const checkpointPath = path.join(outputDir, "checkpoint.pt");
  const checkpointFile: VisionArtifactFile | null = fs.existsSync(checkpointPath) ? { name: "checkpoint.pt", sha256: sha256File(checkpointPath) } : null;

  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    architecture: (summary?.architecture as typeof architecture) ?? architecture,
    configHash: summary?.configHash ?? null,
    dataset: { dir: spec.datasetDir, manifestHash: summary?.datasetManifestHash ?? null },
    seed: spec.seed,
    metrics: {
      syntheticVal: summary?.syntheticValMAP ?? null,
      // Real-photo-benchmark mAP is QA-gated per the issue's scope note
      // (APP-025's real-photo benchmark photo set hasn't been shot yet) —
      // recorded honestly as null with a reason, never fabricated.
      realPhotoBenchmark: null,
      realPhotoBenchmarkReason: "QA-gated: APP-025's real-photo benchmark photo set has not been shot yet (issue #139 scope note).",
    },
    licenses: licenses as unknown as VisionRunManifest["licenses"],
    environment: opts.environment,
    dispatch: { resource: opts.resource, jobId: state.jobId, capabilityJob: opts.capabilityJob },
    artifacts: { checkpointFile, tfliteFiles: listTfliteFiles(outputDir) },
    timestamps: { dispatchedAt: state.timestamps.dispatchedAt, completedAt: state.timestamps.completedAt ?? null },
    status,
  };
}

function ensureManifest(opts: VisionRunnerOptions, runId: string, state: VisionRunState, status: "completed" | "failed"): VisionRunManifest {
  const runDir = runDirFor(opts, runId);
  const existing = readManifestIfPresent(runDir);
  if (existing) return existing;
  const manifest = buildManifest(opts, runId, state.spec, state, status);
  writeJson(path.join(runDir, "manifest.json"), manifest);
  return manifest;
}

async function finishCompleted(opts: VisionRunnerOptions, runId: string, state: VisionRunState): Promise<VisionRunResult> {
  const runDir = runDirFor(opts, runId);
  await opts.dispatcher.pullArtifacts(state.jobId, runDir);

  const manifest = buildManifest(opts, runId, state.spec, state, "completed");
  writeJson(path.join(runDir, "manifest.json"), manifest);

  const finalState: VisionRunState = { ...state, status: "manifested", timestamps: { ...state.timestamps, manifestedAt: nowIso(opts.now) } };
  writeJson(path.join(runDir, "state.json"), finalState);

  return { runId, state: finalState, manifest };
}

async function pollAndFinish(opts: VisionRunnerOptions, runId: string, initialState: VisionRunState): Promise<VisionRunResult> {
  const runDir = runDirFor(opts, runId);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollIntervalMs = opts.pollIntervalMs ?? 5000;
  let state = initialState;

  for (;;) {
    const s = await opts.dispatcher.status(state.jobId);
    if (s === "running") {
      await sleep(pollIntervalMs);
      continue;
    }
    if (s === "completed") {
      state = { ...state, status: "completed", timestamps: { ...state.timestamps, completedAt: nowIso(opts.now) } };
      writeJson(path.join(runDir, "state.json"), state);
      return finishCompleted(opts, runId, state);
    }
    // failed — no auto-retrain; record honestly and still write a manifest
    // (mirrors training/runner.ts: a failed run's hyperparams/env stay
    // auditable, and a failed job may still have written a partial
    // train-summary.json worth reading).
    state = { ...state, status: "failed", timestamps: { ...state.timestamps, failedAt: nowIso(opts.now) } };
    writeJson(path.join(runDir, "state.json"), state);
    await opts.dispatcher.pullArtifacts(state.jobId, runDir).catch(() => undefined);
    const manifest = buildManifest(opts, runId, state.spec, state, "failed");
    writeJson(path.join(runDir, "manifest.json"), manifest);
    return { runId, state, manifest };
  }
}

/**
 * Writes config.json (train_vision/config.py's exact schema), dispatches
 * via opts.dispatcher, persists state.json, then polls to a terminal
 * state and (on success) pulls + manifests. If the process dies anywhere
 * after the first state.json write, call resume(runId, opts) later.
 */
export async function run(spec: VisionRunSpec, runId: string, opts: VisionRunnerOptions): Promise<VisionRunResult> {
  const runDir = runDirFor(opts, runId);
  const config = buildVisionConfig(spec, OUTPUT_SUBDIR);
  writeJson(path.join(runDir, "config.json"), config);

  const dispatchResult = await opts.dispatcher.run(path.join(runDir, "config.json"), opts.inputsDir, runId);

  const state: VisionRunState = { runId, spec, jobId: dispatchResult.jobId, status: "dispatched", timestamps: { dispatchedAt: nowIso(opts.now) } };
  writeJson(path.join(runDir, "state.json"), state);

  return pollAndFinish(opts, runId, state);
}

/**
 * Reloads state.json for an existing run and continues from wherever it
 * stopped — identical transition semantics to training/runner.ts's
 * resume(): dispatched -> keep polling; completed -> pull + manifest
 * without re-polling; failed -> report existing failure, never
 * re-dispatches; manifested -> return the cached manifest.
 */
export async function resume(runId: string, opts: VisionRunnerOptions): Promise<VisionRunResult> {
  const runDir = runDirFor(opts, runId);
  const state = readState(runDir);

  if (state.status === "manifested") {
    return { runId, state, manifest: readManifestIfPresent(runDir) };
  }
  if (state.status === "failed") {
    return { runId, state, manifest: ensureManifest(opts, runId, state, "failed") };
  }
  if (state.status === "completed") {
    return finishCompleted(opts, runId, state);
  }
  return pollAndFinish(opts, runId, state);
}
