import { createRng, shuffle } from "../behavior/rng.js";
import { DISJOINT_CATEGORIES } from "./types.js";
import type { DatasetCategory, UnsplitDatasetExample, DatasetSplit } from "./types.js";

export type { UnsplitDatasetExample };

export interface SplitConfig {
  seed: number;
  /** Target held-out fraction — applied per distinct chunk_id within a
   * DISJOINT_CATEGORIES category, or per example within abstention/ood. */
  evalFraction: number;
  /** Floor on how many distinct chunks a DISJOINT_CATEGORIES category holds
   * out, so a small category still gets *some* eval coverage rather than
   * evalFraction rounding it to zero — but never more than n-1 (train must
   * never go empty) and never applied to a single-chunk category (nothing
   * to hold out without leaking or emptying train — see evalCountFor). */
  minEvalChunksPerCategory: number;
}

function evalCountFor(n: number, config: SplitConfig): number {
  if (n < 2) return 0; // 0 or 1 items: nothing splittable without leaking/emptying train
  const byFraction = Math.round(n * config.evalFraction);
  const byFloor = Math.min(config.minEvalChunksPerCategory, n - 1);
  return Math.min(Math.max(byFraction, byFloor), n - 1);
}

/**
 * Assigns train/eval to every example (SPEC-APP.md §7.8).
 *
 * For categories in DISJOINT_CATEGORIES, the split happens PER CHUNK: every
 * distinct chunk_id in that category is deterministically shuffled and
 * assigned wholesale to train or eval, so every example grounded in that
 * chunk — a QA pair, a distractor example bundling it, a DPO pair built
 * from it — always lands on the same side. This is what makes the split
 * leakage-free BY CONSTRUCTION (see leakage.ts's checkLeakage for the
 * independent proof), not just something checked after the fact.
 *
 * "abstention" and "ood" split PER EXAMPLE instead, ignoring chunkId
 * entirely — see types.ts's DISJOINT_CATEGORIES doc for why chunk-level
 * disjointness isn't a meaningful constraint for either.
 *
 * Both passes sort their keys (chunk_ids, then example ids) before
 * shuffling, so the result depends only on (examples, config) — never on
 * input array order — matching the determinism discipline established in
 * behavior/distractor.ts and behavior/abstention.ts.
 *
 * Returns a Record from example.id -> split (every id used here must be
 * unique across the whole assembled dataset — see assemble.ts's id
 * schemes: `qa-…`, `distractor-…`, `abstention-…`, `ood-…`, `dpo-…`).
 */
export function assignSplits(examples: UnsplitDatasetExample[], config: SplitConfig): Record<string, DatasetSplit> {
  const rng = createRng(config.seed);
  const result: Record<string, DatasetSplit> = {};

  // Pass 1: chunk-grouped categories.
  const chunkIdsByCategory = new Map<DatasetCategory, Set<string>>();
  for (const ex of examples) {
    if (ex.chunkId == null || !DISJOINT_CATEGORIES.has(ex.category)) continue;
    const set = chunkIdsByCategory.get(ex.category) ?? new Set<string>();
    set.add(ex.chunkId);
    chunkIdsByCategory.set(ex.category, set);
  }

  const evalChunkIds = new Set<string>();
  for (const category of [...chunkIdsByCategory.keys()].sort()) {
    const chunkIds = [...chunkIdsByCategory.get(category)!].sort();
    const shuffled = shuffle(chunkIds, rng);
    const evalCount = evalCountFor(shuffled.length, config);
    for (const id of shuffled.slice(0, evalCount)) evalChunkIds.add(id);
  }

  for (const ex of examples) {
    if (ex.chunkId != null && DISJOINT_CATEGORIES.has(ex.category)) {
      result[ex.id] = evalChunkIds.has(ex.chunkId) ? "eval" : "train";
    }
  }

  // Pass 2: per-example categories (abstention, ood).
  const perExampleCategories = [...new Set(examples.map((e) => e.category))]
    .filter((c) => !DISJOINT_CATEGORIES.has(c))
    .sort();
  for (const category of perExampleCategories) {
    const ids = examples
      .filter((e) => e.category === category)
      .map((e) => e.id)
      .sort();
    const shuffled = shuffle(ids, rng);
    const evalCount = evalCountFor(shuffled.length, config);
    const evalIds = new Set(shuffled.slice(0, evalCount));
    for (const id of ids) result[id] = evalIds.has(id) ? "eval" : "train";
  }

  return result;
}
