/**
 * Training runner (APP-020, issue #132, SPEC-APP.md §8.1) — shared types.
 *
 * Dispatch model: this module never touches ssh/rsync itself. Real training
 * runs go through the generic remote-compute `slm-training` capability
 * bundle (development-skills/plugins/spec-workflow/scripts/
 * remote-capabilities/slm-training) via `python3 remote-compute.py run
 * <resource> <capability>:<job> ...` — see realDispatcher.ts. pipeline/'s
 * job is authoring configs/datasets and recording what happened, per the
 * issue's dispatch contract; the bundle itself stays project-agnostic.
 *
 * MLX: §8.1 says "CUDA primary, MLX supported" — this module implements
 * only the CUDA-via-storm590x path. MLX (local Apple-silicon execution) is
 * NOT implemented; a future MLX dispatcher would target the same
 * TrainingBundleConfig/TrainingDispatcher surface defined here, an
 * unimplemented-but-documented gap rather than a silent omission. See
 * src/training/README.md.
 */

import type { EnvironmentInputs } from "./environment.js";

export type { EnvironmentInputs };

export type ModelTier = "1.7B" | "0.6B";
export type TrainingStage = "sft" | "dpo";

/** unsloth model ids, per §8.1 ("Qwen3 1.7B and Qwen3 0.6B via QLoRA/Unsloth"). */
export const BASE_MODEL_BY_TIER: Record<ModelTier, string> = {
  "1.7B": "unsloth/Qwen3-1.7B",
  "0.6B": "unsloth/Qwen3-0.6B",
};

export interface LoraHyperparams {
  r: number;
  alpha: number;
  dropout: number;
  targetModules: string[];
}

/** Resolved (defaults-applied) train hyperparams — echoed verbatim into the
 * manifest. Exactly one of maxSteps/numEpochs is non-null, mirroring the
 * bundle's train.py: max_steps wins when given, else num_epochs. */
export interface ResolvedTrainHyperparams {
  maxSteps: number | null;
  numEpochs: number | null;
  batchSize: number;
  gradAccum: number;
  lr: number;
  warmupSteps: number;
  loggingSteps: number;
  seed: number;
}

export interface ResolvedHyperparams {
  maxSeqLength: number;
  loadIn4bit: boolean;
  lora: LoraHyperparams;
  train: ResolvedTrainHyperparams;
}

/** A caller-authored training run request. Optional fields are overrides
 * onto configBuilder.ts's tier defaults — never required. */
export interface TrainingRunSpec {
  tier: ModelTier;
  stage: TrainingStage;
  /** Local path to the SFT/DPO JSONL dataset (shipped to the remote machine
   * via TrainingDispatcher's inputsDir). */
  datasetPath: string;
  seed: number;
  /** Pinned base-model revision, if any — folds into baseModelHash so a
   * revision bump is a distinct, auditable identity. Never fabricated when
   * absent (baseModelHash then hashes the bare model id). */
  baseModelRevision?: string;
  maxSeqLength?: number;
  loadIn4bit?: boolean;
  lora?: Partial<LoraHyperparams>;
  train?: Partial<Pick<ResolvedTrainHyperparams, "maxSteps" | "numEpochs" | "batchSize" | "gradAccum" | "lr" | "warmupSteps" | "loggingSteps">>;
}

/** The exact JSON shape the slm-training:sft/dpo capability job's
 * train.py config surface expects (capability.yaml's documented keys) —
 * see configBuilder.ts. */
export interface TrainingBundleConfig {
  base_model: string;
  stage: TrainingStage;
  max_seq_length: number;
  load_in_4bit: boolean;
  lora: { r: number; alpha: number; dropout: number; target_modules: string[] };
  dataset: { path: string; chat_template_kwargs: { enable_thinking: false } };
  train: {
    max_steps?: number;
    num_epochs?: number;
    batch_size: number;
    grad_accum: number;
    lr: number;
    warmup_steps: number;
    seed: number;
    logging_steps: number;
  };
}

/** §8.1's "training-environment capture (dependency lockfile hash,
 * CUDA/driver versions)". Assembled by environment.ts from real artifacts —
 * never fabricated; absent facts are null. */
export interface TrainingEnvironment {
  lockfileSha256: string;
  torch: string | null;
  cuda: string | null;
  driver: string | null;
  gpu: string | null;
  unsloth: string | null;
}

export interface ArtifactFile {
  /** Path relative to the run dir, e.g. "adapters/adapter_model.safetensors". */
  name: string;
  sha256: string;
}

/** The committed per-run training manifest (§8.1: "all hyperparameters,
 * seeds, base-model hashes, and a training-environment capture ... recorded
 * in a committed training manifest per run"). Written once a run reaches a
 * terminal state (completed or failed) — see runner.ts. */
export interface TrainingRunManifest {
  schemaVersion: string;
  runId: string;
  tier: ModelTier;
  stage: TrainingStage;
  baseModel: string;
  baseModelHash: string;
  hyperparams: ResolvedHyperparams;
  seed: number;
  dataset: { path: string; sha256: string; rowCount: number };
  environment: TrainingEnvironment;
  dispatch: { resource: string; jobId: string; capabilityJob: string };
  /** null/[] when the run failed before producing artifacts. */
  artifacts: { adaptersDir: string | null; files: ArtifactFile[] };
  timestamps: { dispatchedAt: string; completedAt: string | null };
  status: "completed" | "failed";
}

/** Persisted resumability checkpoint (state.json) — written after every
 * status transition so a killed/resumed process can pick up from exactly
 * where it stopped. See runner.ts's run()/resume(). */
export interface RunState {
  runId: string;
  spec: TrainingRunSpec;
  jobId: string;
  status: "dispatched" | "completed" | "manifested" | "failed";
  timestamps: {
    dispatchedAt: string;
    completedAt?: string;
    manifestedAt?: string;
    failedAt?: string;
  };
}

export type DispatcherStatus = "running" | "completed" | "failed";

/** Injectable dispatch boundary — tests use a fake; realDispatcher.ts wires
 * a real one shelling to remote-compute.py. */
export interface TrainingDispatcher {
  run(configLocalPath: string, inputsDir: string, jobId: string): Promise<{ jobId: string }>;
  status(jobId: string): Promise<DispatcherStatus>;
  pullArtifacts(jobId: string, destDir: string): Promise<void>;
}

export interface RunnerOptions {
  /** pipeline/training-runs — run dirs live at `${runsDir}/${runId}`. */
  runsDir: string;
  dispatcher: TrainingDispatcher;
  /** remote-compute.py resource nickname, e.g. "storm590x". */
  resource: string;
  /** capability:job string, e.g. "slm-training:sft". */
  capabilityJob: string;
  /** Local dir shipped to the remote machine via TrainingDispatcher's
   * inputsDir (dataset + config land here for the real dispatcher). */
  inputsDir: string;
  environment: EnvironmentInputs;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
}

export interface RunResult {
  runId: string;
  state: RunState;
  manifest: TrainingRunManifest | null;
}
