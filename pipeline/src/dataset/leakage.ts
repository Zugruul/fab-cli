import { DISJOINT_CATEGORIES } from "./types.js";
import type { DatasetCategory, DatasetSplit } from "./types.js";

export interface LeakageOverlap {
  category: DatasetCategory;
  chunkId: string;
}

export interface LeakageResult {
  ok: boolean;
  overlaps: LeakageOverlap[];
}

export interface LeakageCheckable {
  category: DatasetCategory;
  chunkId: string | null;
  split: DatasetSplit;
}

/**
 * SPEC-APP.md §7.8's headline AC: proves no train/eval overlap of source
 * chunks, for every category where disjointness is required (see
 * types.ts's DISJOINT_CATEGORIES). Independent of how the split was
 * produced — split.ts's assignSplits is built to satisfy this by
 * construction, but this function re-derives the answer from scratch by
 * scanning the actual (category, chunkId, split) triples, so it also
 * catches a leak introduced by a future change to the splitter, a hand-
 * edited dataset, or (per the task's injected-leak test) a deliberately
 * corrupted split fed in directly.
 *
 * Examples in a non-disjointness-required category (abstention, ood), or
 * with a null chunkId, are excluded from the scan entirely — sharing a
 * chunkId across train/eval there is expected and not a leak (see
 * types.ts's DISJOINT_CATEGORIES doc).
 */
export function checkLeakage(examples: LeakageCheckable[]): LeakageResult {
  const byCategory = new Map<DatasetCategory, { train: Set<string>; evalSet: Set<string> }>();

  for (const ex of examples) {
    if (ex.chunkId == null || !DISJOINT_CATEGORIES.has(ex.category)) continue;
    const bucket = byCategory.get(ex.category) ?? { train: new Set<string>(), evalSet: new Set<string>() };
    (ex.split === "train" ? bucket.train : bucket.evalSet).add(ex.chunkId);
    byCategory.set(ex.category, bucket);
  }

  const overlaps: LeakageOverlap[] = [];
  for (const [category, { train, evalSet }] of byCategory) {
    for (const chunkId of evalSet) {
      if (train.has(chunkId)) overlaps.push({ category, chunkId });
    }
  }
  overlaps.sort((a, b) =>
    a.category === b.category ? (a.chunkId < b.chunkId ? -1 : 1) : a.category < b.category ? -1 : 1,
  );

  return { ok: overlaps.length === 0, overlaps };
}
