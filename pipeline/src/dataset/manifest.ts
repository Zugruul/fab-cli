import { configHash } from "../qa/manifest.js";
import { DATASET_CATEGORIES } from "./types.js";
import type { DatasetCategory, DatasetExample, DatasetExampleType } from "./types.js";

const SCHEMA_VERSION = "0.1.0"; // local/plain for now, matches qa/behavior/sampling manifest.ts's convention —
// @fab/manifest-schema formalization is out of scope for this task (see PR body / SPEC-APP.md §7.7 note).

export interface CorpusSnapshotRef {
  contentHash: string;
  schemaVersion: string;
  exportDate: string;
}

export type CountBySplit = { train: number; eval: number };

export interface DatasetManifest {
  schemaVersion: string;
  buildDate: string;
  seed: number;
  evalFraction: number;
  /** SHA-256 of the committed dataset-build.json (config/dataset-build.json)
   * — reuses qa/manifest.ts's configHash rather than reinventing hashing,
   * mirroring sampling/manifest.ts and behavior/manifest.ts's own reuse. */
  datasetConfigHash: string;
  /** Pins this dataset build to the corpus snapshot it was built from
   * (SPEC-APP.md §7.7) — null only when no corpus manifest was available
   * at build time, never fabricated. */
  corpusSnapshot: CorpusSnapshotRef | null;
  /** From the qa run manifest (qa/manifest.json's teacherModel) when
   * present; null when unavailable — never guessed. */
  teacherModel: string | null;
  /** Whether QA examples came from APP-012's entailment-checked
   * accepted.jsonl or (sampling not run) the raw qa-pairs.jsonl fallback —
   * see assemble.ts's doc comment. */
  qaSource: "sampling-accepted" | "qa-pairs-fallback";
  counts: {
    total: CountBySplit;
    byCategory: Record<DatasetCategory, CountBySplit>;
    byExampleType: Record<DatasetExampleType, CountBySplit>;
  };
  /** Honest degraded/fallback-input notes carried through from assembly
   * (sampling not run, behavior artifacts absent, skipped records, etc.) —
   * always present, possibly empty. */
  notes: string[];
}

export interface BuildDatasetManifestOptions {
  examples: DatasetExample[];
  /** The full dataset-build config object — hashed as-is via configHash. */
  config: unknown;
  seed: number;
  evalFraction: number;
  corpusSnapshot: CorpusSnapshotRef | null;
  teacherModel: string | null;
  qaSource: DatasetManifest["qaSource"];
  notes: string[];
  now?: () => string;
}

const EMPTY_COUNT: CountBySplit = { train: 0, eval: 0 };

export function buildDatasetManifest(opts: BuildDatasetManifestOptions): DatasetManifest {
  const now = opts.now ?? (() => new Date().toISOString());

  const byCategory = Object.fromEntries(
    DATASET_CATEGORIES.map((c) => [c, { ...EMPTY_COUNT }]),
  ) as Record<DatasetCategory, CountBySplit>;
  const byExampleType: Record<DatasetExampleType, CountBySplit> = {
    qa: { ...EMPTY_COUNT },
    distractor: { ...EMPTY_COUNT },
    dpo: { ...EMPTY_COUNT },
    abstention: { ...EMPTY_COUNT },
    ood: { ...EMPTY_COUNT },
  };

  let train = 0;
  let evalCount = 0;
  for (const ex of opts.examples) {
    byCategory[ex.category][ex.split]++;
    byExampleType[ex.exampleType][ex.split]++;
    if (ex.split === "train") train++;
    else evalCount++;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    buildDate: now(),
    seed: opts.seed,
    evalFraction: opts.evalFraction,
    datasetConfigHash: configHash(opts.config),
    corpusSnapshot: opts.corpusSnapshot,
    teacherModel: opts.teacherModel,
    qaSource: opts.qaSource,
    counts: { total: { train, eval: evalCount }, byCategory, byExampleType },
    notes: opts.notes,
  };
}
