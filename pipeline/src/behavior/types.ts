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
import type { Confidence } from "@fab/manifest-schema";
import type { SampledRecord } from "../sampling/store.js";

export type { Chunk, QAPair };

/** Categorical confidence label for the `{answer, citation_ids, confidence}`
 * generation contract (SPEC-APP.md §10.2) — re-exported from
 * @fab/manifest-schema's ConfidenceSchema, the authoritative definition
 * (BUG-182), rather than declared locally. "abstain" is reserved for the
 * structured-abstention target (§7.5b) and never appears on an answered
 * example. */
export type { Confidence };

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

/** APP-012's real `SampledRecord` (pipeline/src/sampling/store.ts),
 * re-exported under behavior/'s original name. Was a hand-written
 * structural duplicate while APP-012 was still an unmerged parallel lane
 * (BUG-183); both are on main now, so this is a type-only import instead —
 * behavior/'s public surface (the `SampledRecordLike` name) is unchanged.
 * When a real accepted.jsonl/rejected.jsonl exists at the configured path
 * with this shape, dpo.ts uses it; otherwise it falls back to APP-011's
 * qa-pairs.jsonl (chosen) and rule-based synthetic degradation (rejected)
 * — see dpo.ts. */
export type { SampledRecord as SampledRecordLike };
