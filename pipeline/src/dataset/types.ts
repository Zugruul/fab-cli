/**
 * Dataset versioning + stratified eval split (SPEC-APP.md §7.7-§7.8): the
 * types the assembler (assemble.ts), splitter (split.ts), and leakage
 * checker (leakage.ts) all share.
 */
import type { DistractorExample, AbstentionExample, OODExample, DPOPair } from "../behavior/types.js";

export type { DistractorExample, AbstentionExample, OODExample, DPOPair };

/**
 * §7.8's seven eval-stratification categories, verbatim. See categorize.ts
 * for how a source chunk (and by extension every example grounded in it)
 * is mapped into one of these — that mapping is a documented judgment
 * call, since no existing taxonomy in the repo defines it.
 */
export const DATASET_CATEGORIES = [
  "keyword-definitions",
  "card-facts",
  "multi-card-interactions",
  "tournament-procedure",
  "lore",
  "abstention",
  "ood",
] as const;
export type DatasetCategory = (typeof DATASET_CATEGORIES)[number];

/**
 * Categories whose examples are grounded in a specific source chunk_id and
 * therefore require train/eval disjointness BY chunk_id (SPEC-APP.md §7.8:
 * "disjoint from training by source chunk where the category allows").
 * "abstention" and "ood" are deliberately excluded:
 *  - abstention's chunkId (AbstentionExample.sourceChunkId) is kept for
 *    audit only and is NEVER a member of the example's contextChunkIds —
 *    the target answer never draws on that chunk's content, so there is no
 *    grounding-content leakage risk to guard against by holding the chunk
 *    out of one split.
 *  - ood examples carry no chunk_id at all (out-of-domain questions have no
 *    FAB source chunk).
 * See split.ts / leakage.ts for how this set is used.
 */
export const DISJOINT_CATEGORIES: ReadonlySet<DatasetCategory> = new Set([
  "keyword-definitions",
  "card-facts",
  "multi-card-interactions",
  "tournament-procedure",
  "lore",
]);

export type DatasetSplit = "train" | "eval";

export type DatasetExampleType = "qa" | "distractor" | "dpo" | "abstention" | "ood";

/** A grounded (question, answer) training example built by the dataset
 * assembler — either from APP-012's entailment-checked accepted.jsonl, or
 * (when sampling hasn't run) directly from APP-011's raw qa-pairs.jsonl.
 * `entailmentChecked` records which, per example, so a mixed-provenance
 * build never implies a guarantee it can't back — see assemble.ts. */
export interface QAExample {
  id: string;
  chunk_id: string;
  question: string;
  answer: string;
  cited_chunk_ids: string[];
  entailmentChecked: boolean;
}

interface DatasetExampleShared {
  id: string;
  category: DatasetCategory;
}

/** The fields that vary per exampleType — factored out so both the
 * pre-split (`UnsplitDatasetExample`, produced by assemble.ts and consumed
 * by split.ts) and post-split (`DatasetExample`) shapes stay in exact sync
 * without duplicating the union. */
type DatasetExampleVariant =
  | { exampleType: "qa"; chunkId: string; payload: QAExample }
  | { exampleType: "distractor"; chunkId: string; payload: DistractorExample }
  | { exampleType: "dpo"; chunkId: string; payload: DPOPair }
  | { exampleType: "abstention"; chunkId: string; payload: AbstentionExample }
  | { exampleType: "ood"; chunkId: null; payload: OODExample };

export type UnsplitDatasetExample = DatasetExampleShared & DatasetExampleVariant;
export type DatasetExample = UnsplitDatasetExample & { split: DatasetSplit };
