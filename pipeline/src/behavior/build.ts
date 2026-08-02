import type { Chunk } from "../types.js";
import type { PairsRecord } from "../qa/pairsStore.js";
import { createRng } from "./rng.js";
import { buildDistractorExamples, type DistractorBuildConfig } from "./distractor.js";
import { buildAbstentionExamples, type AbstentionBuildConfig } from "./abstention.js";
import { buildOODExamples, type OODBuildConfig, type OODTemplateBank } from "./ood.js";
import { buildDPOPairs, type DPOBuildConfig } from "./dpo.js";
import { buildManifest, type BehaviorDatasetManifest } from "./manifest.js";
import type { AbstentionExample, DistractorExample, DPOPair, OODExample, SampledRecordLike } from "./types.js";

export interface BehaviorDatasetsConfig {
  seed: number;
  distractor: DistractorBuildConfig;
  abstention: AbstentionBuildConfig;
  ood: OODBuildConfig;
  dpo: DPOBuildConfig;
}

export interface BuildBehaviorDatasetsOptions {
  chunks: Chunk[];
  pairRecords: PairsRecord[];
  oodTemplateBank: OODTemplateBank;
  config: BehaviorDatasetsConfig;
  /** APP-012 artifacts, when present — see dpo.ts for the "when present"
   * gating logic. Absent/empty by default: this whole module runs fully
   * offline against just APP-010/APP-011 output. */
  acceptedRecords?: SampledRecordLike[];
  rejectedRecords?: SampledRecordLike[];
  now?: () => string;
}

export interface BehaviorDatasetsResult {
  distractor: DistractorExample[];
  abstention: AbstentionExample[];
  ood: OODExample[];
  dpo: DPOPair[];
  manifest: BehaviorDatasetManifest;
}

/**
 * Builds all four behavior-training dataset categories (SPEC-APP.md
 * §7.5-§7.6) as one pure, in-memory, single-shot transform: every builder
 * runs to completion (or throws) BEFORE anything is written to disk, so a
 * category that can't meet its configured minimum aborts the whole build
 * rather than leaving a partially-written result — never silently
 * under-produce (task AC). See write.ts for how the result is then
 * persisted atomically.
 */
export function buildBehaviorDatasets(opts: BuildBehaviorDatasetsOptions): BehaviorDatasetsResult {
  const rng = createRng(opts.config.seed);

  const distractorResult = buildDistractorExamples(opts.chunks, opts.pairRecords, opts.config.distractor, rng);
  const abstentionResult = buildAbstentionExamples(opts.chunks, opts.pairRecords, opts.config.abstention, rng);
  const oodResult = buildOODExamples(opts.oodTemplateBank, opts.config.ood);
  const dpoResult = buildDPOPairs(
    opts.chunks,
    opts.pairRecords,
    opts.config.dpo,
    opts.acceptedRecords ?? [],
    opts.rejectedRecords ?? [],
  );

  const timeSensitiveDistractorCount = distractorResult.examples.filter((e) => e.timeSensitive).length;

  const manifest = buildManifest({
    config: opts.config,
    seed: opts.config.seed,
    minimums: {
      distractor: opts.config.distractor.minCount,
      abstention: opts.config.abstention.minCount,
      ood: opts.config.ood.minCount,
      dpo: opts.config.dpo.minCount,
    },
    distractorCount: distractorResult.examples.length,
    abstentionCount: abstentionResult.examples.length,
    oodCount: oodResult.examples.length,
    dpoCount: dpoResult.pairs.length,
    distractorSkipped: distractorResult.skipped.length,
    abstentionSkipped: abstentionResult.skipped.length,
    dpoSkipped: dpoResult.skipped.length,
    timeSensitiveDistractorCount,
    dpoMethodCounts: dpoResult.methodCounts,
    oodDiversity: oodResult.diversity,
    now: opts.now,
  });

  return {
    distractor: distractorResult.examples,
    abstention: abstentionResult.examples,
    ood: oodResult.examples,
    dpo: dpoResult.pairs,
    manifest,
  };
}
