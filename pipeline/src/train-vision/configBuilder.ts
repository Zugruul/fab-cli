/**
 * Pure VisionRunSpec -> train_vision/config.py bundle config builder
 * (APP-027). Mirrors pipeline/src/training/configBuilder.ts's role:
 * nothing here touches a filesystem or a process — this module only
 * decides what JSON to write for the training job. Key names in the
 * output MUST match train_vision/config.py's validate_config exactly
 * (architecture, seed, datasetDir, valFraction, stride, train.{epochs,
 * batchSize,lr}, outputDir) — this is literally the config.json the
 * Python side reads.
 */
import { DEFAULT_ARCHITECTURE } from "./types.js";
import type { VisionBundleConfig, VisionRunSpec, VisionTrainHyperparams } from "./types.js";

/** Sane, documented defaults — mirrors training/configBuilder.ts's
 * TIER_DEFAULTS pattern. epochs=2/batchSize=8/lr=1e-3 are a reasonable
 * starting point for the tiny custom backbone (model.py's doc comment);
 * a real full training run overrides these via spec.train, same as any
 * other knob here. */
export const DEFAULT_VAL_FRACTION = 0.1;
export const DEFAULT_STRIDE = 8;
export const DEFAULT_TRAIN: VisionTrainHyperparams = { epochs: 2, batchSize: 8, lr: 0.001 };

export function buildVisionConfig(spec: VisionRunSpec, outputDir: string): VisionBundleConfig {
  return {
    architecture: spec.architecture ?? DEFAULT_ARCHITECTURE,
    seed: spec.seed,
    datasetDir: spec.datasetDir,
    valFraction: spec.valFraction ?? DEFAULT_VAL_FRACTION,
    stride: spec.stride ?? DEFAULT_STRIDE,
    train: { ...DEFAULT_TRAIN, ...spec.train },
    outputDir,
  };
}
