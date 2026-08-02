/**
 * Pure TrainingRunSpec -> slm-training capability bundle config builder
 * (APP-020, SPEC-APP.md §8.1). The bundle's train.py config surface
 * (capability.yaml's `sft` job doc, verified against train.py itself) is:
 * base_model, stage, max_seq_length, load_in_4bit, lora{r,alpha,dropout,
 * target_modules}, dataset{path, chat_template_kwargs}, train{max_steps|
 * num_epochs, batch_size, grad_accum, lr, warmup_steps, seed,
 * logging_steps}. Nothing here talks to a filesystem or a process — this
 * module only decides what JSON to write.
 */
import { createHash } from "node:crypto";
import { BASE_MODEL_BY_TIER } from "./types.js";
import type { ResolvedHyperparams, TrainingBundleConfig, TrainingRunSpec } from "./types.js";

/** train.py's own DEFAULT_TARGET_MODULES, verbatim — the sane tier default
 * when a spec doesn't override lora.targetModules. */
export const DEFAULT_TARGET_MODULES = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"];

/** Sane, documented tier defaults (both Qwen3 tiers use the same QLoRA
 * shape — the tiers differ in base_model, not in these knobs). Mirrors
 * train.py's own fallback values so an unconfigured run behaves the same
 * locally-documented way the bundle would if the config omitted these
 * keys entirely. */
export const TIER_DEFAULTS = {
  maxSeqLength: 2048,
  loadIn4bit: true,
  lora: { r: 16, alpha: 16, dropout: 0, targetModules: DEFAULT_TARGET_MODULES },
  train: { batchSize: 2, gradAccum: 4, lr: 2e-4, warmupSteps: 5, loggingSteps: 1, numEpochs: 1 },
} as const;

export function resolveHyperparams(spec: TrainingRunSpec): ResolvedHyperparams {
  const lora = { ...TIER_DEFAULTS.lora, ...spec.lora };
  const overrides = spec.train ?? {};
  const maxSteps = overrides.maxSteps ?? null;
  const numEpochs = maxSteps == null ? overrides.numEpochs ?? TIER_DEFAULTS.train.numEpochs : null;

  return {
    maxSeqLength: spec.maxSeqLength ?? TIER_DEFAULTS.maxSeqLength,
    loadIn4bit: spec.loadIn4bit ?? TIER_DEFAULTS.loadIn4bit,
    lora,
    train: {
      maxSteps,
      numEpochs,
      batchSize: overrides.batchSize ?? TIER_DEFAULTS.train.batchSize,
      gradAccum: overrides.gradAccum ?? TIER_DEFAULTS.train.gradAccum,
      lr: overrides.lr ?? TIER_DEFAULTS.train.lr,
      warmupSteps: overrides.warmupSteps ?? TIER_DEFAULTS.train.warmupSteps,
      loggingSteps: overrides.loggingSteps ?? TIER_DEFAULTS.train.loggingSteps,
      seed: spec.seed,
    },
  };
}

export function buildTrainingConfig(spec: TrainingRunSpec): TrainingBundleConfig {
  const resolved = resolveHyperparams(spec);

  const train: TrainingBundleConfig["train"] = {
    batch_size: resolved.train.batchSize,
    grad_accum: resolved.train.gradAccum,
    lr: resolved.train.lr,
    warmup_steps: resolved.train.warmupSteps,
    seed: resolved.train.seed,
    logging_steps: resolved.train.loggingSteps,
  };
  if (resolved.train.maxSteps != null) {
    train.max_steps = resolved.train.maxSteps;
  } else {
    train.num_epochs = resolved.train.numEpochs ?? 1;
  }

  return {
    base_model: BASE_MODEL_BY_TIER[spec.tier],
    stage: spec.stage,
    max_seq_length: resolved.maxSeqLength,
    load_in_4bit: resolved.loadIn4bit,
    lora: {
      r: resolved.lora.r,
      alpha: resolved.lora.alpha,
      dropout: resolved.lora.dropout,
      target_modules: resolved.lora.targetModules,
    },
    dataset: {
      path: spec.datasetPath,
      // §8.1: thinking mode disabled. Set unconditionally for both tiers
      // and both stages — the bundle's sft path passes this straight
      // through to apply_chat_template for "messages" rows; the dpo path
      // doesn't currently read it, but carrying it is harmless and keeps
      // the config forward-compatible if dpo ever gains a templated path.
      chat_template_kwargs: { enable_thinking: false },
    },
    train,
  };
}

/**
 * sha256 of the resolved base-model id string (plus `@revision` when
 * pinned). This is an identity hash over the STRING that names the base
 * model, not a content hash of its weights — a real weights hash only
 * exists once the bundle actually downloads/runs the model remotely, and
 * would have to land in the manifest from a real artifact (e.g. a future
 * export-summary.json sha256), never fabricated locally.
 */
export function computeBaseModelHash(spec: TrainingRunSpec): string {
  const id = BASE_MODEL_BY_TIER[spec.tier];
  const key = spec.baseModelRevision ? `${id}@${spec.baseModelRevision}` : id;
  return createHash("sha256").update(key).digest("hex");
}
