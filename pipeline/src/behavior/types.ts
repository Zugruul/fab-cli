/**
 * Behavior-training dataset builders (SPEC-APP.md §7.5-§7.6): pure offline
 * transforms over APP-010's exported chunks (types.ts's `Chunk`) and
 * APP-011's accepted Q&A pairs (qa/pairsStore.ts's `PairsRecord` — read-only
 * import, see pairsStore.ts's own docs) that produce retrieval-robustness,
 * abstention, out-of-domain-refusal, and DPO preference training examples.
 * No network calls anywhere under pipeline/src/behavior/ — see cli.ts.
 */
import type { Chunk } from "../types.js";
import type { QAPair } from "../qa/types.js";

export type { Chunk, QAPair };

/** Categorical confidence label for the `{answer, citation_ids, confidence}`
 * generation contract (SPEC-APP.md §10.2). The spec doesn't pin an exact
 * scale (numeric vs categorical), so this module uses a small closed set;
 * "abstain" is reserved for the structured-abstention target (§7.5b) and
 * never appears on an answered example. */
export type Confidence = "high" | "medium" | "low" | "abstain";

/** The `{answer, citation_ids, confidence}` shape every builder's target
 * conforms to (SPEC-APP.md §10.2's generation contract). */
export interface AnswerTarget {
  answer: string | null;
  citation_ids: string[];
  confidence: Confidence;
}

/** §7.5b's structured abstention target: an AnswerTarget with `confidence:
 * "abstain"`, empty `citation_ids`, a config-templated abstention message
 * as `answer`, plus a judge-escalation pointer — the same "not clearly
 * settled" + #ask-a-judge contract §10.4 and `rules ask` use. */
export interface AbstentionTarget extends AnswerTarget {
  confidence: "abstain";
  abstained: true;
  escalation: string;
}

export interface DistractorExample {
  id: string;
  category: "distractor";
  /** The one chunk the target answer is actually grounded in. */
  chunk_id: string;
  question: string;
  /** Every chunk_id bundled into the prompt (the relevant chunk plus K
   * distractors), shuffled — position carries no meaning. */
  contextChunkIds: string[];
  target: AnswerTarget;
  /** SPEC-APP.md §7.9: true when `chunk_id` is a live-legality/ban-list
   * chunk — the one category those chunks are allowed to appear as the
   * grounding source in, and only marked this way (never plain SFT fact
   * training). See legality.ts. */
  timeSensitive: boolean;
}

export interface AbstentionExample {
  id: string;
  category: "abstention";
  /** The chunk the question was drawn from — kept for audit only,
   * deliberately NOT a member of `contextChunkIds` (that's the point). */
  sourceChunkId: string;
  question: string;
  /** Chunks bundled into the prompt, none of which answer the question. */
  contextChunkIds: string[];
  target: AbstentionTarget;
}

export interface OODExample {
  id: string;
  category: "ood";
  style: string;
  question: string;
  target: AnswerTarget;
}

export type DPOConstructionMethod =
  | "rejection-sample"
  | "synthetic-citation-stripped"
  | "synthetic-confident-wrong";

export interface DPOPair {
  id: string;
  category: "dpo";
  chunk_id: string;
  question: string;
  chosen: AnswerTarget;
  rejected: AnswerTarget;
  method: DPOConstructionMethod;
}

/** Mirrors APP-012's `SampledRecord` shape (pipeline/src/sampling/store.ts)
 * field-for-field. APP-012 is a parallel, unmerged lane this task must not
 * import code from (constraint: don't touch src/sampling/**) — so this is a
 * structural duplicate, not an import, and deliberately so: it decouples
 * dpo.ts from APP-012's merge status. When a real accepted.jsonl/
 * rejected.jsonl exists at the configured path with this shape, dpo.ts uses
 * it; otherwise it falls back to APP-011's qa-pairs.jsonl (chosen) and
 * rule-based synthetic degradation (rejected) — see dpo.ts. */
export interface SampledRecordLike {
  pairId: string;
  chunk_id: string;
  question: string;
  answer: string;
  cited_chunk_ids: string[];
  reason: string;
}
