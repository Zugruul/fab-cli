import { createHash } from "node:crypto";
import type { DiversityMetric } from "./diversity.js";
import type { DPOConstructionMethod } from "./types.js";

const SCHEMA_VERSION = "0.1.0"; // local/plain for now, matches qa/manifest.ts and sampling/manifest.ts

/** Deterministic JSON stringification: object keys sorted recursively, so
 * two configs with identical content but different key order hash equal. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeysDeep(v)]));
  }
  return value;
}

/** SHA-256 hex digest of a config, stable across key reordering — mirrors
 * qa/manifest.ts's configHash. */
export function configHash(config: unknown): string {
  return createHash("sha256").update(stableStringify(config)).digest("hex");
}

export interface BehaviorDatasetManifest {
  schemaVersion: string;
  buildDate: string;
  seed: number;
  configHash: string;
  counts: { distractor: number; abstention: number; ood: number; dpo: number };
  minimums: { distractor: number; abstention: number; ood: number; dpo: number };
  /** Pairs/questions skipped rather than built, per category — always
   * present (0 when nothing was skipped) so a degraded run is visible
   * rather than silently under-counting. OOD has no skip path (every
   * configured template is always used). */
  skippedCounts: { distractor: number; abstention: number; dpo: number };
  /** §7.9: count of distractor examples grounded in a live-legality/
   * ban-list chunk (marked `timeSensitive` on the example itself). */
  timeSensitiveDistractorCount: number;
  dpoMethodCounts: Record<DPOConstructionMethod, number>;
  oodDiversity: DiversityMetric;
}

export interface BuildManifestOptions {
  config: unknown;
  seed: number;
  minimums: BehaviorDatasetManifest["minimums"];
  distractorCount: number;
  abstentionCount: number;
  oodCount: number;
  dpoCount: number;
  distractorSkipped: number;
  abstentionSkipped: number;
  dpoSkipped: number;
  timeSensitiveDistractorCount: number;
  dpoMethodCounts: Record<DPOConstructionMethod, number>;
  oodDiversity: DiversityMetric;
  now?: () => string;
}

export function buildManifest(opts: BuildManifestOptions): BehaviorDatasetManifest {
  const now = opts.now ?? (() => new Date().toISOString());

  return {
    schemaVersion: SCHEMA_VERSION,
    buildDate: now(),
    seed: opts.seed,
    configHash: configHash(opts.config),
    counts: {
      distractor: opts.distractorCount,
      abstention: opts.abstentionCount,
      ood: opts.oodCount,
      dpo: opts.dpoCount,
    },
    minimums: opts.minimums,
    skippedCounts: {
      distractor: opts.distractorSkipped,
      abstention: opts.abstentionSkipped,
      dpo: opts.dpoSkipped,
    },
    timeSensitiveDistractorCount: opts.timeSensitiveDistractorCount,
    dpoMethodCounts: opts.dpoMethodCounts,
    oodDiversity: opts.oodDiversity,
  };
}
