/**
 * Pure EmbedRunSpec -> train_vision/embed_config.py bundle config builder
 * (APP-028). Mirrors configBuilder.ts's role for the detector exactly:
 * nothing here touches a filesystem or a process. Key names in the output
 * MUST match train_vision/embed_config.py's validate_embed_config exactly
 * (architecture, seed, datasetDir, valFraction, cropSize, embeddingDim,
 * arcface.{margin,scale}, train.{epochs,batchSize,lr}, outputDir) — this
 * is literally the config.json the Python side reads.
 */
import { DEFAULT_EMBED_ARCHITECTURE } from "./embedTypes.js";
import type { EmbedArcfaceParams, EmbedBundleConfig, EmbedRunSpec, EmbedTrainHyperparams } from "./embedTypes.js";

/** Sane, documented defaults — mirrors embedConfigBuilder.ts's detector
 * counterpart (configBuilder.ts)'s TIER_DEFAULTS pattern. margin=0.5/
 * scale=64.0 are the standard ArcFace paper defaults; a real full
 * training run overrides these via spec.arcface, same as any other knob
 * here. */
export const DEFAULT_VAL_FRACTION = 0.1;
export const DEFAULT_CROP_SIZE = 64;
export const DEFAULT_EMBEDDING_DIM = 256;
export const DEFAULT_ARCFACE: EmbedArcfaceParams = { margin: 0.5, scale: 64.0 };
export const DEFAULT_TRAIN: EmbedTrainHyperparams = { epochs: 2, batchSize: 8, lr: 0.001 };

export function buildEmbedConfig(spec: EmbedRunSpec, outputDir: string): EmbedBundleConfig {
  return {
    architecture: spec.architecture ?? DEFAULT_EMBED_ARCHITECTURE,
    seed: spec.seed,
    datasetDir: spec.datasetDir,
    valFraction: spec.valFraction ?? DEFAULT_VAL_FRACTION,
    cropSize: spec.cropSize ?? DEFAULT_CROP_SIZE,
    embeddingDim: spec.embeddingDim ?? DEFAULT_EMBEDDING_DIM,
    arcface: { ...DEFAULT_ARCFACE, ...spec.arcface },
    train: { ...DEFAULT_TRAIN, ...spec.train },
    outputDir,
  };
}
