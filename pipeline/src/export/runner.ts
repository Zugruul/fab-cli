/**
 * Export run orchestration (APP-021, SPEC-APP.md §8.2). Drives an
 * ExportDispatcher through dispatch -> poll -> pull -> manifest, and is
 * RESUMABLE: state.json is persisted after every status transition, and
 * resume() reloads it to continue from wherever a killed process stopped.
 * Run dirs live at `${runsDir}/${runId}` and hold config.json + state.json
 * + manifest.json (all committed) plus a gitignored gguf/ pulled from the
 * remote job (see export-runs/.gitignore).
 *
 * Deliberate divergence from training/runner.ts: on a FAILED job, this
 * runner still pulls artifacts once before writing the failed manifest.
 * §8.2's export_gguf.py bundle extension writes each produced GGUF's smoke
 * result into export-summary.json BEFORE exiting nonzero on a smoke
 * failure (a GGUF that loads and quantizes fine but fails its
 * JSON-schema-constrained completion is a real, auditable failure — not a
 * "nothing happened" one). Training's failed path never pulls because a
 * failed training job never produces adapters worth fetching; an export job
 * that fails at the smoke gate can still have real files and diagnostics
 * worth recording. resume()'s already-"failed" branch does NOT re-pull —
 * that already happened once, during the original failure handling below.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildExportConfig, computeBaseModelHash, resolveSmoke, DEFAULT_QUANTIZATIONS } from "./configBuilder.js";
import { buildLicenses } from "./licenses.js";
import { assembleEnvironment } from "../training/environment.js";
import { BASE_MODEL_BY_TIER } from "../training/types.js";
import type {
  ExportAdaptersSource,
  ExportArtifactFile,
  ExportRunManifest,
  ExportRunResult,
  ExportRunSpec,
  ExportRunState,
  ExportRunnerOptions,
  SmokeFileResult,
} from "./types.js";

const SCHEMA_VERSION = "0.1.0";

function nowIso(now?: () => string): string {
  return (now ?? (() => new Date().toISOString()))();
}

function runDirFor(opts: ExportRunnerOptions, runId: string): string {
  return path.join(opts.runsDir, runId);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function readState(runDir: string): ExportRunState {
  return JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8")) as ExportRunState;
}

function readManifestIfPresent(runDir: string): ExportRunManifest | null {
  const manifestPath = path.join(runDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ExportRunManifest;
}

/** export_gguf.py's real export-summary.json shape (post-APP-021 smoke
 * extension). `smoke` is typed optional defensively — our own
 * configBuilder.ts always sends a smoke section, so it should always be
 * present, but a reader should never crash on an older/partial artifact. */
interface ExportSummaryFile {
  baseModel: string;
  adapters: string | null;
  quantizations: string[];
  files: ExportArtifactFile[];
  wallClockSec: number;
  smoke?: { schema: Record<string, unknown>; perFile: SmokeFileResult[] };
}

function readExportSummaryIfPresent(runDir: string): ExportSummaryFile | null {
  const summaryPath = path.join(runDir, "export-summary.json");
  if (!fs.existsSync(summaryPath)) return null;
  return JSON.parse(fs.readFileSync(summaryPath, "utf8")) as ExportSummaryFile;
}

function readTrainingManifestAdapters(trainingRunsDir: string, trainingRunId: string): { adaptersDir: string | null; files: { name: string; sha256: string }[] } {
  const manifestPath = path.join(trainingRunsDir, trainingRunId, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `export run refuses to resolve adaptersRunId "${trainingRunId}": no committed training manifest found at ` +
        `${manifestPath}. Run/resume the APP-020 training run first, or pass adaptersDir directly.`,
    );
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    artifacts?: { adaptersDir?: string | null; files?: { name: string; sha256: string }[] };
  };
  const adaptersDir = manifest.artifacts?.adaptersDir ?? null;
  if (adaptersDir == null) {
    throw new Error(
      `export run refuses to resolve adaptersRunId "${trainingRunId}": its manifest.json records ` +
        `artifacts.adaptersDir is null — that training run has no adapters (it likely failed before ` +
        `producing artifacts, per SPEC-APP.md §8.1's "per run" — including failed — manifest discipline). ` +
        "Point adaptersRunId at a completed training run, or pass adaptersDir directly.",
    );
  }
  return { adaptersDir, files: manifest.artifacts?.files ?? [] };
}

/** Recursively hashes every file directly under a local adapters dir,
 * returning bare-relative-name entries sorted for determinism. Used only
 * for the adaptersDir-given-directly path — a training-run-resolved
 * adapters dir instead reuses that run's own already-hashed
 * artifacts.files verbatim (never re-hashed; see resolveAdapters below). */
function hashFilesUnder(dir: string): { name: string; sha256: string }[] {
  if (!fs.existsSync(dir)) return [];
  const files: { name: string; sha256: string }[] = [];
  const walk = (d: string, relPrefix: string): void => {
    const entries = [...fs.readdirSync(d, { withFileTypes: true })].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else {
        files.push({ name: rel, sha256: createHash("sha256").update(fs.readFileSync(full)).digest("hex") });
      }
    }
  };
  walk(dir, "");
  return files;
}

/**
 * Resolves the export's adapters source (exactly one of spec.adaptersRunId /
 * spec.adaptersDir / neither) into the concrete local path the remote job
 * config should carry, plus the manifest's `source` block. Pure with
 * respect to opts (read-only filesystem access), called identically from
 * run() (to build config.json) and buildManifest() (to build the manifest's
 * `source` field) so the two are guaranteed consistent.
 */
function resolveAdapters(spec: ExportRunSpec, opts: ExportRunnerOptions): { adaptersDir: string | null; source: ExportAdaptersSource } {
  if (spec.adaptersRunId != null && spec.adaptersDir != null) {
    throw new Error(
      `export spec is ambiguous: both adaptersRunId ("${spec.adaptersRunId}") and adaptersDir ` +
        `("${spec.adaptersDir}") are set — pass exactly one, or neither to export the base model as-is.`,
    );
  }
  if (spec.adaptersRunId != null) {
    const { adaptersDir, files } = readTrainingManifestAdapters(opts.trainingRunsDir, spec.adaptersRunId);
    return { adaptersDir, source: { trainingRunId: spec.adaptersRunId, adaptersDir, adaptersSha256s: files } };
  }
  if (spec.adaptersDir != null) {
    const files = hashFilesUnder(spec.adaptersDir);
    return { adaptersDir: spec.adaptersDir, source: { trainingRunId: null, adaptersDir: spec.adaptersDir, adaptersSha256s: files } };
  }
  return { adaptersDir: null, source: { trainingRunId: null, adaptersDir: null, adaptersSha256s: [] } };
}

/** §8.1 requires CUDA/driver versions in the environment capture — never
 * silently null; that rule applies unchanged to every committed manifest,
 * export's included (the issue's brief: "env capture is §8.1's, still
 * applies to committed manifests"). Enforced here, the single dispatch
 * entry point, before opts.dispatcher is ever touched — mirrors
 * training/runner.ts's requireCudaDriver exactly. resume() deliberately
 * does NOT call this, for the same recoverability reason training's
 * doesn't: a resumed run's environment was already captured (or will be
 * honestly recorded as whatever opts.environment carries) at pull/manifest
 * time. */
function requireCudaDriver(opts: ExportRunnerOptions): void {
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

function buildManifest(opts: ExportRunnerOptions, runId: string, spec: ExportRunSpec, state: ExportRunState, status: "completed" | "failed"): ExportRunManifest {
  const runDir = runDirFor(opts, runId);
  const { source } = resolveAdapters(spec, opts);
  const environment = assembleEnvironment(opts.environment);
  const resolvedSmoke = resolveSmoke(spec);
  // Read whatever export-summary.json actually landed, regardless of the
  // job's overall terminal status — a smoke failure still leaves real,
  // auditable files + per-file smoke results behind (see this module's top
  // doc comment). Never fabricated: absent means empty, not guessed.
  const summary = readExportSummaryIfPresent(runDir);
  const files = summary?.files ?? [];
  const smokePerFile = summary?.smoke?.perFile ?? [];
  const smokeSchema = summary?.smoke?.schema ?? resolvedSmoke.jsonSchema;

  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    tier: spec.tier,
    baseModel: BASE_MODEL_BY_TIER[spec.tier],
    baseModelHash: computeBaseModelHash(spec.tier),
    source,
    quantizations: spec.quantizations ?? DEFAULT_QUANTIZATIONS,
    artifacts: { files },
    smoke: { schema: smokeSchema, perFile: smokePerFile },
    licenses: buildLicenses(spec.tier),
    environment,
    dispatch: { resource: opts.resource, jobId: state.jobId, capabilityJob: opts.capabilityJob },
    timestamps: { dispatchedAt: state.timestamps.dispatchedAt, completedAt: state.timestamps.completedAt ?? null },
    status,
  };
}

/** Idempotent manifest write: reuses an existing manifest.json if one is
 * already on disk (a prior run/resume already built it), otherwise builds
 * and writes one now. Mirrors training/runner.ts's ensureManifest — never
 * touches opts.dispatcher (a resumed already-terminal run must stay usable
 * for recovery without re-contacting the remote machine). */
function ensureManifest(opts: ExportRunnerOptions, runId: string, state: ExportRunState, status: "completed" | "failed"): ExportRunManifest {
  const runDir = runDirFor(opts, runId);
  const existing = readManifestIfPresent(runDir);
  if (existing) return existing;
  const manifest = buildManifest(opts, runId, state.spec, state, status);
  writeJson(path.join(runDir, "manifest.json"), manifest);
  return manifest;
}

async function finishCompleted(opts: ExportRunnerOptions, runId: string, state: ExportRunState): Promise<ExportRunResult> {
  const runDir = runDirFor(opts, runId);
  await opts.dispatcher.pullArtifacts(state.jobId, runDir);

  const manifest = buildManifest(opts, runId, state.spec, state, "completed");
  writeJson(path.join(runDir, "manifest.json"), manifest);

  const finalState: ExportRunState = {
    ...state,
    status: "manifested",
    timestamps: { ...state.timestamps, manifestedAt: nowIso(opts.now) },
  };
  writeJson(path.join(runDir, "state.json"), finalState);

  return { runId, state: finalState, manifest };
}

async function pollAndFinish(opts: ExportRunnerOptions, runId: string, initialState: ExportRunState): Promise<ExportRunResult> {
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
    // failed — no auto-retrain; still pull whatever landed in the job dir
    // (see this module's top doc comment: export_gguf.py writes
    // export-summary.json's per-file smoke results BEFORE exiting nonzero
    // on a smoke failure, so a "failed" export can still carry real,
    // auditable diagnostics). This pull happens exactly once, right here —
    // resume()'s own "failed" branch below never re-touches the dispatcher.
    state = { ...state, status: "failed", timestamps: { ...state.timestamps, failedAt: nowIso(opts.now) } };
    writeJson(path.join(runDir, "state.json"), state);
    await opts.dispatcher.pullArtifacts(state.jobId, runDir);
    const manifest = buildManifest(opts, runId, state.spec, state, "failed");
    writeJson(path.join(runDir, "manifest.json"), manifest);
    return { runId, state, manifest };
  }
}

/**
 * Resolves the export's adapters source, writes config.json, dispatches via
 * opts.dispatcher, persists state.json, then polls to a terminal state and
 * pulls + manifests. If the process dies anywhere after the first state.json
 * write, call resume(runId, opts) later to continue.
 */
export async function run(spec: ExportRunSpec, runId: string, opts: ExportRunnerOptions): Promise<ExportRunResult> {
  requireCudaDriver(opts);
  const { adaptersDir } = resolveAdapters(spec, opts);

  const runDir = runDirFor(opts, runId);
  const config = buildExportConfig(spec, adaptersDir);
  writeJson(path.join(runDir, "config.json"), config);

  const dispatchResult = await opts.dispatcher.run(path.join(runDir, "config.json"), opts.inputsDir, runId);

  const state: ExportRunState = {
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
 *  - status "dispatched": resume polling (the job may have kept running, or
 *    finished/failed, while this process was down).
 *  - status "completed": pull + manifest now, without polling again.
 *  - status "failed": report the existing failure; never re-dispatches and
 *    never re-pulls (that already happened once, in pollAndFinish above).
 *  - status "manifested": already fully done; returns the cached manifest.
 * Never calls dispatcher.run() again — resume never re-dispatches a run
 * that was already sent to the remote machine.
 */
export async function resume(runId: string, opts: ExportRunnerOptions): Promise<ExportRunResult> {
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
