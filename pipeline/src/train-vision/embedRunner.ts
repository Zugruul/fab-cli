/**
 * Recognition-embedder training run orchestration (APP-028, SPEC-APP.md
 * §8.7d). Mirrors runner.ts's shape for the detector closely (dispatch ->
 * poll -> pull -> manifest, resumable via state.json) — a SEPARATE file
 * rather than a generalization of runner.ts, because the one piece that
 * genuinely differs between the two jobs (buildManifest: which summary
 * file to read, which manifest shape to build) is exactly the part that
 * can't be shared without a bigger, riskier refactor of the already-
 * shipped detector runner. A decision this issue's brief didn't cover —
 * see README.md for the full note.
 *
 * Run dirs live at `${runsDir}/${runId}`, the SAME pipeline/vision-runs/
 * directory the detector's runner uses (embedder and detector runs are
 * just sibling run ids there, distinguished by their own config.json's
 * `architecture` field) — no separate embed-runs/ directory.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildEmbedConfig } from "./embedConfigBuilder.js";
import { EMBEDDER_LICENSES } from "./embedLicenses.js";
import { validateLicenses } from "./licenses.js";
import { DEFAULT_EMBED_ARCHITECTURE } from "./embedTypes.js";
import type {
  EmbedRetrievalMetric,
  EmbedRunManifest,
  EmbedRunResult,
  EmbedRunSpec,
  EmbedRunState,
  EmbedRunnerOptions,
  VisionArtifactFile,
} from "./embedTypes.js";

type EmbedArtifactFile = VisionArtifactFile;

const SCHEMA_VERSION = "0.1.0";
const OUTPUT_SUBDIR = "output";

function nowIso(now?: () => string): string {
  return (now ?? (() => new Date().toISOString()))();
}

function runDirFor(opts: EmbedRunnerOptions, runId: string): string {
  return path.join(opts.runsDir, runId);
}

function outputDirFor(runDir: string): string {
  return path.join(runDir, OUTPUT_SUBDIR);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function readState(runDir: string): EmbedRunState {
  return JSON.parse(fs.readFileSync(path.join(runDir, "state.json"), "utf8")) as EmbedRunState;
}

function readManifestIfPresent(runDir: string): EmbedRunManifest | null {
  const manifestPath = path.join(runDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as EmbedRunManifest;
}

/** train_vision/embed_train.py's real embed-train-summary.json shape.
 * Typed defensively (all fields optional-ish) — a failed/partial run may
 * never have written one at all. */
interface EmbedTrainSummary {
  architecture?: string;
  embedderVersion?: string;
  embeddingDim?: number;
  configHash?: string;
  datasetManifestHash?: string;
  syntheticValRetrieval?: EmbedRetrievalMetric | null;
  syntheticValRetrievalReason?: string | null;
  licenses?: Record<string, string>;
}

function readTrainSummaryIfPresent(outputDir: string): EmbedTrainSummary | null {
  const summaryPath = path.join(outputDir, "embed-train-summary.json");
  if (!fs.existsSync(summaryPath)) return null;
  return JSON.parse(fs.readFileSync(summaryPath, "utf8")) as EmbedTrainSummary;
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function listTfliteFiles(outputDir: string): EmbedArtifactFile[] {
  if (!fs.existsSync(outputDir)) return [];
  return fs
    .readdirSync(outputDir)
    .filter((name) => name.endsWith(".tflite"))
    .sort()
    .map((name) => ({ name, sha256: sha256File(path.join(outputDir, name)) }));
}

function buildManifest(opts: EmbedRunnerOptions, runId: string, spec: EmbedRunSpec, state: EmbedRunState, status: "completed" | "failed"): EmbedRunManifest {
  const runDir = runDirFor(opts, runId);
  const outputDir = outputDirFor(runDir);
  const summary = readTrainSummaryIfPresent(outputDir);

  const architecture = spec.architecture ?? DEFAULT_EMBED_ARCHITECTURE;
  const licenses = summary?.licenses ?? (EMBEDDER_LICENSES as unknown as Record<string, string>);
  validateLicenses(licenses);

  const checkpointPath = path.join(outputDir, "checkpoint.pt");
  const checkpointFile: EmbedArtifactFile | null = fs.existsSync(checkpointPath) ? { name: "checkpoint.pt", sha256: sha256File(checkpointPath) } : null;

  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    architecture: (summary?.architecture as typeof architecture) ?? architecture,
    embedderVersion: summary?.embedderVersion ?? null,
    embeddingDim: summary?.embeddingDim ?? null,
    configHash: summary?.configHash ?? null,
    dataset: { dir: spec.datasetDir, manifestHash: summary?.datasetManifestHash ?? null },
    seed: spec.seed,
    metrics: {
      syntheticValRetrieval: summary?.syntheticValRetrieval ?? null,
      syntheticValRetrievalReason: summary?.syntheticValRetrievalReason ?? null,
      // Real-photo-benchmark top-1 is QA-gated per the issue's scope note
      // (APP-025's real-photo benchmark photo set hasn't been shot yet) —
      // recorded honestly as null with a reason, never fabricated. This
      // is the actual G3 gate metric.
      realPhotoBenchmarkTop1: null,
      realPhotoBenchmarkReason: "QA-gated: APP-025's real-photo benchmark photo set has not been shot yet (issue #140 scope note).",
    },
    licenses: licenses as unknown as EmbedRunManifest["licenses"],
    environment: opts.environment,
    dispatch: { resource: opts.resource, jobId: state.jobId, capabilityJob: opts.capabilityJob },
    artifacts: { checkpointFile, tfliteFiles: listTfliteFiles(outputDir) },
    timestamps: { dispatchedAt: state.timestamps.dispatchedAt, completedAt: state.timestamps.completedAt ?? null },
    status,
  };
}

function ensureManifest(opts: EmbedRunnerOptions, runId: string, state: EmbedRunState, status: "completed" | "failed"): EmbedRunManifest {
  const runDir = runDirFor(opts, runId);
  const existing = readManifestIfPresent(runDir);
  if (existing) return existing;
  const manifest = buildManifest(opts, runId, state.spec, state, status);
  writeJson(path.join(runDir, "manifest.json"), manifest);
  return manifest;
}

async function finishCompleted(opts: EmbedRunnerOptions, runId: string, state: EmbedRunState): Promise<EmbedRunResult> {
  const runDir = runDirFor(opts, runId);
  await opts.dispatcher.pullArtifacts(state.jobId, runDir);

  const manifest = buildManifest(opts, runId, state.spec, state, "completed");
  writeJson(path.join(runDir, "manifest.json"), manifest);

  const finalState: EmbedRunState = { ...state, status: "manifested", timestamps: { ...state.timestamps, manifestedAt: nowIso(opts.now) } };
  writeJson(path.join(runDir, "state.json"), finalState);

  return { runId, state: finalState, manifest };
}

async function pollAndFinish(opts: EmbedRunnerOptions, runId: string, initialState: EmbedRunState): Promise<EmbedRunResult> {
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
    // failed — no auto-retrain; record honestly and still write a manifest.
    state = { ...state, status: "failed", timestamps: { ...state.timestamps, failedAt: nowIso(opts.now) } };
    writeJson(path.join(runDir, "state.json"), state);
    await opts.dispatcher.pullArtifacts(state.jobId, runDir).catch(() => undefined);
    const manifest = buildManifest(opts, runId, state.spec, state, "failed");
    writeJson(path.join(runDir, "manifest.json"), manifest);
    return { runId, state, manifest };
  }
}

/**
 * Writes config.json (train_vision/embed_config.py's exact schema),
 * dispatches via opts.dispatcher, persists state.json, then polls to a
 * terminal state and (on success) pulls + manifests. If the process dies
 * anywhere after the first state.json write, call resume(runId, opts)
 * later.
 */
export async function run(spec: EmbedRunSpec, runId: string, opts: EmbedRunnerOptions): Promise<EmbedRunResult> {
  const runDir = runDirFor(opts, runId);
  const config = buildEmbedConfig(spec, OUTPUT_SUBDIR);
  writeJson(path.join(runDir, "config.json"), config);

  const dispatchResult = await opts.dispatcher.run(path.join(runDir, "config.json"), opts.inputsDir, runId);

  const state: EmbedRunState = { runId, spec, jobId: dispatchResult.jobId, status: "dispatched", timestamps: { dispatchedAt: nowIso(opts.now) } };
  writeJson(path.join(runDir, "state.json"), state);

  return pollAndFinish(opts, runId, state);
}

/**
 * Reloads state.json for an existing run and continues from wherever it
 * stopped — identical transition semantics to runner.ts's resume().
 */
export async function resume(runId: string, opts: EmbedRunnerOptions): Promise<EmbedRunResult> {
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
