/**
 * ArcFace recognition-embedder training/export dispatch — shared types
 * (APP-028, issue #140, SPEC-APP.md §8.7d). A SEPARATE file from
 * types.ts (the OBB detector's own shapes, APP-027) rather than an
 * extension of it — the two jobs' config/manifest shapes share nothing
 * (cropSize/embeddingDim/arcface vs stride/canvasSize) beyond the generic
 * dispatch boundary they both reuse (VisionDispatcher, imported as-is
 * below), so folding them into one file would only create false coupling.
 * Mirrors the Python side's own embed_*.py-vs-*.py isolation decision —
 * see pipeline/train-vision/src/train_vision/embed_model.py's doc comment
 * for the same reasoning applied to the model architecture.
 */
import type { VisionDispatcher, VisionArtifactFile, VisionEnvironment } from "./types.js";

export type { VisionArtifactFile, VisionEnvironment };

/** The only architecture this package's embedder implements — see
 * pipeline/train-vision/src/train_vision/embed_model.py's doc comment
 * (from-scratch backbone, zero pretrained weights, zero third-party
 * model-definition dependencies beyond torch itself). */
export type EmbedArchitecture = "arcface-embedder-tiny";
export const DEFAULT_EMBED_ARCHITECTURE: EmbedArchitecture = "arcface-embedder-tiny";

export interface EmbedTrainHyperparams {
  epochs: number;
  batchSize: number;
  lr: number;
}

export interface EmbedArcfaceParams {
  margin: number;
  scale: number;
}

/** A caller-authored run request. Optional fields are overrides onto
 * embedConfigBuilder.ts's documented defaults — never required. */
export interface EmbedRunSpec {
  architecture?: EmbedArchitecture;
  /** Local (or, for a future real dispatch, remote-host) path to an
   * APP-026 composites-generator run dir — the SAME dir the OBB
   * detector's VisionRunSpec.datasetDir points at (embed_dataset.py reads
   * the identical manifest.json + per-composite PNG/JSON layout, just
   * keyed per-card instead of per-composite). */
  datasetDir: string;
  seed: number;
  valFraction?: number;
  cropSize?: number;
  embeddingDim?: number;
  arcface?: Partial<EmbedArcfaceParams>;
  train?: Partial<EmbedTrainHyperparams>;
}

/** The exact JSON shape train_vision/embed_config.py's
 * validate_embed_config expects. */
export interface EmbedBundleConfig {
  architecture: EmbedArchitecture;
  seed: number;
  datasetDir: string;
  valFraction: number;
  cropSize: number;
  embeddingDim: number;
  arcface: EmbedArcfaceParams;
  train: EmbedTrainHyperparams;
  outputDir: string;
}

/** The generic remote-compute dispatch boundary has no job-specific shape
 * — reused verbatim from types.ts (identical to that module's own
 * VisionDispatcher alias of training/types.ts's TrainingDispatcher). */
export type EmbedDispatcher = VisionDispatcher;
export type EmbedDispatcherStatus = "running" | "completed" | "failed";

export interface EmbedLicenses {
  trainingCode: string;
  torch: string;
  litertTorch: string;
  aiEdgeLitert: string;
  litertConverter: string;
  aiEdgeQuantizer: string;
}

/** train_vision/retrieval.py's topk_accuracy(..., k_values=(1, 5)) return
 * shape, as embed_train.py's RETRIEVAL_K_VALUES fixes it. */
export interface EmbedRetrievalMetric {
  top1: number;
  top5: number;
  queryCount: number;
}

/** The committed per-run manifest (SPEC-APP.md §8.7d AC: "embedding
 * dim/version in manifest"). Built by reading the pulled job's
 * embed-train-summary.json (embed_train.py's own output) and wrapping it
 * with dispatch/environment facts only this TS layer knows — mirrors
 * runner.ts's buildManifest for the detector's train-summary.json. */
export interface EmbedRunManifest {
  schemaVersion: string;
  runId: string;
  architecture: EmbedArchitecture;
  /** Bumped whenever a change to the embedder's architecture/training
   * recipe/crop convention would invalidate previously computed
   * embeddings — APP-085's knowledge-pack builder refuses a delta pack
   * across a version change (SPEC-APP.md §8.8). Read verbatim from the
   * pulled summary, never guessed here. */
  embedderVersion: string | null;
  embeddingDim: number | null;
  configHash: string | null;
  dataset: { dir: string; manifestHash: string | null };
  seed: number;
  metrics: {
    syntheticValRetrieval: EmbedRetrievalMetric | null;
    syntheticValRetrievalReason: string | null;
    /** QA-gated (APP-025's real-photo benchmark photo set) — null with a
     * reason until that human-gated leg lands (this is G3's actual gate
     * metric), never fabricated. */
    realPhotoBenchmarkTop1: number | null;
    realPhotoBenchmarkReason: string | null;
  };
  licenses: EmbedLicenses;
  environment: VisionEnvironment;
  dispatch: { resource: string; jobId: string; capabilityJob: string };
  artifacts: { checkpointFile: VisionArtifactFile | null; tfliteFiles: VisionArtifactFile[] };
  timestamps: { dispatchedAt: string; completedAt: string | null };
  status: "completed" | "failed";
}

export interface EmbedRunState {
  runId: string;
  spec: EmbedRunSpec;
  jobId: string;
  status: "dispatched" | "completed" | "manifested" | "failed";
  timestamps: {
    dispatchedAt: string;
    completedAt?: string;
    manifestedAt?: string;
    failedAt?: string;
  };
}

export interface EmbedRunnerOptions {
  /** pipeline/vision-runs — the SAME runs dir the detector's runner uses;
   * embedder and detector runs coexist there as sibling run ids (no
   * separate embed-runs/ dir — see README.md). */
  runsDir: string;
  dispatcher: EmbedDispatcher;
  resource: string;
  capabilityJob: string;
  inputsDir: string;
  environment: VisionEnvironment;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
}

export interface EmbedRunResult {
  runId: string;
  state: EmbedRunState;
  manifest: EmbedRunManifest | null;
}
