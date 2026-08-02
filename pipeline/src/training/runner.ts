/**
 * Training run orchestration (APP-020, SPEC-APP.md §8.1). Drives a
 * TrainingDispatcher through dispatch -> poll -> pull -> manifest, and is
 * RESUMABLE: state.json is persisted after every status transition, and
 * resume() reloads it to continue from wherever a killed process stopped.
 * Run dirs live at `${runsDir}/${runId}` and hold config.json + state.json
 * + manifest.json (all committed) plus a gitignored adapters/ pulled from
 * the remote job.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildTrainingConfig, computeBaseModelHash, resolveHyperparams } from "./configBuilder.js";
import { assembleEnvironment } from "./environment.js";
import { BASE_MODEL_BY_TIER } from "./types.js";
import type { ArtifactFile, RunResult, RunState, RunnerOptions, TrainingRunManifest, TrainingRunSpec } from "./types.js";

const SCHEMA_VERSION = "0.1.0";

function nowIso(now?: () => string): string {
  return (now ?? (() => new Date().toISOString()))();
}

function runDirFor(opts: RunnerOptions, runId: string): string {
  return path.join(opts.runsDir, runId);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function readState(runDir: string): RunState {
  return JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8")) as RunState;
}

function readManifestIfPresent(runDir: string): TrainingRunManifest | null {
  const manifestPath = path.join(runDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as TrainingRunManifest;
}

function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function hashDatasetFile(datasetPath: string): { sha256: string; rowCount: number } {
  const raw = fs.readFileSync(datasetPath);
  const rowCount = raw
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
  return { sha256: sha256Buffer(raw), rowCount };
}

/** Recursively hashes every file under adaptersDir, returning
 * `adapters/<relative path>`-named entries sorted for determinism. Returns
 * [] when the directory doesn't exist (a failed run never pulled anything). */
function hashArtifactFiles(adaptersDir: string): ArtifactFile[] {
  if (!fs.existsSync(adaptersDir)) return [];
  const files: ArtifactFile[] = [];
  const walk = (dir: string, relPrefix: string): void => {
    const entries = [...fs.readdirSync(dir, { withFileTypes: true })].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = `${relPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else {
        files.push({ name: rel, sha256: sha256Buffer(fs.readFileSync(full)) });
      }
    }
  };
  walk(adaptersDir, "adapters");
  return files;
}

/** §8.1 requires CUDA/driver versions in the environment capture — never
 * silently null. Enforced here (the single dispatch entry point) rather
 * than only at the CLI layer, so any caller of run() — not just the CLI —
 * is stopped before opts.dispatcher is ever touched. resume() deliberately
 * does NOT call this: a resumed run's environment was already captured (or
 * will be honestly recorded as whatever opts.environment carries) at pull/
 * manifest time, and resume must stay usable for recovery even when a
 * fresh cuda/driver probe isn't at hand. */
function requireCudaDriver(opts: RunnerOptions): void {
  const { cuda, driver } = opts.environment.cudaDriver;
  if (cuda == null || driver == null) {
    throw new Error(
      "run() refuses to dispatch without real CUDA/driver versions (SPEC-APP.md §8.1: " +
        "the training-environment capture must record CUDA/driver, never silently null) — " +
        `got cuda=${cuda ?? "null"} driver=${driver ?? "null"}. Get real values from ` +
        "remote-compute.py's registry probe for the resource (capabilities.gpu.{cuda,driver}) " +
        "or `nvidia-smi --query-gpu=driver_version,name --format=csv,noheader` run on the resource itself, " +
        "then pass them as opts.environment.cudaDriver (the CLI's --cuda/--driver flags).",
    );
  }
}

/** Idempotent manifest write: reuses an existing manifest.json if one is
 * already on disk (a prior run/resume already built it), otherwise builds
 * and writes one now. Mirrors finishCompleted's pull-then-manifest pattern
 * for the failed path too, so a crash between the failed state.json write
 * and the failed manifest.json write is recoverable via resume() instead
 * of leaving that run permanently manifest-less (§13 Invariant 7: every
 * run — including failed ones — ships its manifest). */
function ensureManifest(opts: RunnerOptions, runId: string, state: RunState, status: "completed" | "failed"): TrainingRunManifest {
  const runDir = runDirFor(opts, runId);
  const existing = readManifestIfPresent(runDir);
  if (existing) return existing;
  const manifest = buildManifest(opts, runId, state.spec, state, status);
  writeJson(path.join(runDir, "manifest.json"), manifest);
  return manifest;
}

function buildManifest(opts: RunnerOptions, runId: string, spec: TrainingRunSpec, state: RunState, status: "completed" | "failed"): TrainingRunManifest {
  const runDir = runDirFor(opts, runId);
  const resolved = resolveHyperparams(spec);
  const dataset = hashDatasetFile(spec.datasetPath);
  const environment = assembleEnvironment(opts.environment);
  const adaptersDir = path.join(runDir, "adapters");
  const files = status === "completed" ? hashArtifactFiles(adaptersDir) : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    tier: spec.tier,
    stage: spec.stage,
    baseModel: BASE_MODEL_BY_TIER[spec.tier],
    baseModelHash: computeBaseModelHash(spec),
    hyperparams: resolved,
    seed: spec.seed,
    dataset: { path: spec.datasetPath, sha256: dataset.sha256, rowCount: dataset.rowCount },
    environment,
    dispatch: { resource: opts.resource, jobId: state.jobId, capabilityJob: opts.capabilityJob },
    artifacts: { adaptersDir: status === "completed" ? adaptersDir : null, files },
    timestamps: { dispatchedAt: state.timestamps.dispatchedAt, completedAt: state.timestamps.completedAt ?? null },
    status,
  };
}

async function finishCompleted(opts: RunnerOptions, runId: string, state: RunState): Promise<RunResult> {
  const runDir = runDirFor(opts, runId);
  await opts.dispatcher.pullArtifacts(state.jobId, runDir);

  const manifest = buildManifest(opts, runId, state.spec, state, "completed");
  writeJson(path.join(runDir, "manifest.json"), manifest);

  const finalState: RunState = {
    ...state,
    status: "manifested",
    timestamps: { ...state.timestamps, manifestedAt: nowIso(opts.now) },
  };
  writeJson(path.join(runDir, "state.json"), finalState);

  return { runId, state: finalState, manifest };
}

async function pollAndFinish(opts: RunnerOptions, runId: string, initialState: RunState): Promise<RunResult> {
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
    // (with null artifacts) so a failed run's hyperparams/env stay
    // auditable, per §8.1's "per run" (not "per successful run") wording.
    state = { ...state, status: "failed", timestamps: { ...state.timestamps, failedAt: nowIso(opts.now) } };
    writeJson(path.join(runDir, "state.json"), state);
    const manifest = buildManifest(opts, runId, state.spec, state, "failed");
    writeJson(path.join(runDir, "manifest.json"), manifest);
    return { runId, state, manifest };
  }
}

/**
 * Writes config.json, dispatches via opts.dispatcher, persists state.json,
 * then polls to a terminal state and (on success) pulls + hashes artifacts
 * and writes manifest.json. If the process dies anywhere after the first
 * state.json write, call resume(runId, opts) later to continue.
 */
export async function run(spec: TrainingRunSpec, runId: string, opts: RunnerOptions): Promise<RunResult> {
  requireCudaDriver(opts);

  const runDir = runDirFor(opts, runId);
  const config = buildTrainingConfig(spec);
  writeJson(path.join(runDir, "config.json"), config);

  const dispatchResult = await opts.dispatcher.run(path.join(runDir, "config.json"), opts.inputsDir, runId);

  const state: RunState = {
    runId,
    spec,
    jobId: dispatchResult.jobId,
    status: "dispatched",
    timestamps: { dispatchedAt: nowIso(opts.now) },
  };
  writeJson(path.join(runDir, "state.json"), state);

  return pollAndFinish(opts, runId, state);
}

/**
 * Reloads state.json for an existing run and continues from wherever it
 * stopped:
 *  - status "dispatched": the job may have kept running (or finished/failed)
 *    on the remote machine while this process was down — resume polling.
 *  - status "completed": the remote job finished but pull/manifest never
 *    ran (process died between the two writes) — pull + manifest now,
 *    without polling status again.
 *  - status "failed": report the existing failure; never re-dispatches.
 *  - status "manifested": already fully done; returns the cached manifest.
 * Never calls dispatcher.run() again — resume never re-dispatches a run
 * that was already sent to the remote machine.
 */
export async function resume(runId: string, opts: RunnerOptions): Promise<RunResult> {
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
  // "dispatched"
  return pollAndFinish(opts, runId, state);
}
