/**
 * OBB detector training/export dispatch — shared types (APP-027, issue
 * #139, SPEC-APP.md §8.7c). Mirrors pipeline/src/training/types.ts's
 * shape (a caller-authored spec, a pure bundle config, an injectable
 * dispatcher, a resumable RunState, a committed per-run manifest) and
 * reuses its dispatch boundary verbatim — see realDispatcher.ts's doc
 * comment for why.
 *
 * Dispatch model (a deliberate divergence from training/'s doc comment,
 * see README.md for the full decision): there is no `vision-training`
 * remote-compute CAPABILITY installed on any resource yet (unlike LLM
 * training's `slm-training` bundle, development-skills/plugins/
 * spec-workflow/scripts/remote-capabilities/slm-training/, which already
 * exists). This module's dispatch boundary is capability-agnostic on
 * purpose (identical to training/'s TrainingDispatcher) so it's ready the
 * moment such a capability (or remote-compute.py's generic `dispatch`
 * verb — see README.md) is wired up; today only the LOCAL path
 * (train_from_config run directly on a CPU/GPU host, no TS dispatch at
 * all) is exercised for real, per this issue's smoke.
 */
import type { TrainingDispatcher } from "../training/types.js";

/** Deliberately smaller than training/types.ts's full TrainingEnvironment
 * (no lockfileSha256/unsloth — those are LLM-training-specific facts):
 * just the GPU/torch facts train_vision/train.py's manifest.py already
 * records. Never fabricated; absent facts are null (same honesty rule as
 * training/environment.ts). */
export interface VisionEnvironment {
  torch: string | null;
  cuda: string | null;
  driver: string | null;
  gpu: string | null;
}

/** The only architecture this package implements — see pipeline/
 * train-vision/src/train_vision/model.py's doc comment for the full
 * grounding (from-scratch CenterNet-style head, no pretrained weights,
 * zero third-party model-definition dependencies). */
export type VisionArchitecture = "obb-centernet-tiny";
export const DEFAULT_ARCHITECTURE: VisionArchitecture = "obb-centernet-tiny";

export interface VisionTrainHyperparams {
  epochs: number;
  batchSize: number;
  lr: number;
}

/** A caller-authored run request. Optional fields are overrides onto
 * configBuilder.ts's documented defaults — never required. */
export interface VisionRunSpec {
  architecture?: VisionArchitecture;
  /** Local (or, for a future real dispatch, remote-host) path to an
   * APP-026 composites-generator run dir (manifest.json + per-composite
   * PNG/JSON — pipeline/src/composites/write.ts's layout). */
  datasetDir: string;
  seed: number;
  valFraction?: number;
  stride?: number;
  train?: Partial<VisionTrainHyperparams>;
}

/** The exact JSON shape train_vision/config.py's validate_config expects
 * (pipeline/train-vision/src/train_vision/config.py) — see
 * configBuilder.ts. Key names are NOT camelCase-vs-snake_case translated
 * (unlike training/'s TrainingBundleConfig): the Python config schema
 * itself already uses these exact camelCase keys. */
export interface VisionBundleConfig {
  architecture: VisionArchitecture;
  seed: number;
  datasetDir: string;
  valFraction: number;
  stride: number;
  train: VisionTrainHyperparams;
  outputDir: string;
}

/** The generic remote-compute dispatch boundary has no vision-specific
 * shape — identical to training/types.ts's TrainingDispatcher. Aliased so
 * this package's code never has to name "Training" to describe its own
 * dispatch boundary (mirrors export/types.ts's ExportDispatcher). */
export type VisionDispatcher = TrainingDispatcher;
export type DispatcherStatus = "running" | "completed" | "failed";

export interface VisionArtifactFile {
  name: string;
  sha256: string;
}

export interface VisionLicenses {
  trainingCode: string;
  torch: string;
  torchvision: string;
  litertTorch: string;
  aiEdgeLitert: string;
  litertConverter: string;
}

export interface VisionMapMetric {
  mAP: number;
  perThreshold: Record<string, number>;
}

/** The committed per-run manifest (SPEC-APP.md §8.7c AC: "license of
 * architecture + training code recorded in manifest; mAP on synthetic val
 * + real-photo benchmark subset reported"). Built by reading the pulled
 * job's train-summary.json (train_vision/train.py's own output — see that
 * script's doc comment for why configHash/datasetManifestHash are
 * computed THERE, not re-derived here) and wrapping it with dispatch/
 * environment facts only this TS layer knows — mirrors export/types.ts's
 * ExportRunManifest reading export_gguf.py's export-summary.json. */
export interface VisionRunManifest {
  schemaVersion: string;
  runId: string;
  architecture: VisionArchitecture;
  /** Read verbatim from the pulled job's train-summary.json — null only
   * when the job never got far enough to write one (e.g. failed before
   * training started). Never recomputed/guessed here. */
  configHash: string | null;
  dataset: { dir: string; manifestHash: string | null };
  seed: number;
  metrics: {
    syntheticVal: VisionMapMetric | null;
    /** The real-photo eval set exists (realPhotoEvalSet.ts, issue #139),
     * but mAP against it is computed by a separate eval run from this
     * training run (see runner.ts's realPhotoBenchmarkReason for the
     * current, accurate reason) — null with a reason until that eval
     * run's own summary is read, never fabricated. */
    realPhotoBenchmark: VisionMapMetric | null;
    realPhotoBenchmarkReason: string | null;
  };
  licenses: VisionLicenses;
  environment: VisionEnvironment;
  dispatch: { resource: string; jobId: string; capabilityJob: string };
  artifacts: { checkpointFile: VisionArtifactFile | null; tfliteFiles: VisionArtifactFile[] };
  timestamps: { dispatchedAt: string; completedAt: string | null };
  status: "completed" | "failed";
}

export interface VisionRunState {
  runId: string;
  spec: VisionRunSpec;
  jobId: string;
  status: "dispatched" | "completed" | "manifested" | "failed";
  timestamps: {
    dispatchedAt: string;
    completedAt?: string;
    manifestedAt?: string;
    failedAt?: string;
  };
}

export interface VisionRunnerOptions {
  /** pipeline/vision-runs — run dirs live at `${runsDir}/${runId}`. */
  runsDir: string;
  dispatcher: VisionDispatcher;
  resource: string;
  /** capability:job string (see README.md — no `vision-training`
   * capability exists yet; this is carried through unchanged so the
   * runner is ready the day one does, per this module's top doc
   * comment). */
  capabilityJob: string;
  inputsDir: string;
  /** Caller-captured dispatch-host facts (mirrors training/'s
   * EnvironmentInputs.cudaDriver convention) — passed through as given,
   * honest by construction. Unlike LLM training (§8.1 requires real
   * CUDA/driver), a vision run legitimately running on CPU (this issue's
   * own smoke) is not blocked: cuda/driver/gpu being null is a real,
   * allowed fact here, not a guard failure. */
  environment: VisionEnvironment;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
}

export interface VisionRunResult {
  runId: string;
  state: VisionRunState;
  manifest: VisionRunManifest | null;
}
