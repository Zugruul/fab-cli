/**
 * Builds EvalItems from the assembled dataset's eval split (SPEC-APP.md
 * §7.7-§7.8 dataset, §8.3-§8.4 eval suites). Pure functions over
 * `DatasetExample` — no I/O; the CLI/runner reads pipeline/out/dataset/
 * eval.jsonl and passes the parsed records in.
 *
 * Consumes the PRECOMPUTED `adjudicationCritical` flag on every
 * `DatasetExample` (dataset/types.ts's `DatasetExampleShared`) — per the
 * task brief, never re-derives it from adjudication.ts's
 * `isAdjudicationCritical` itself (that's assemble.ts's job, already done
 * before this module ever sees an example).
 *
 * "Rubric derived from source-chunk claims" (SPEC-APP.md §8.3): the
 * dataset pipeline doesn't separately author a per-claim rubric alongside
 * each QA pair — it has exactly one artifact per grounded example, the
 * teacher-generated (and, when sampling ran, entailment-checked) reference
 * answer (`QAExample.answer`). Using that reference answer as the rubric's
 * single claim is a faithful, non-fabricated reading of "claims derived
 * from the source chunk": the reference answer IS the chunk's claims,
 * restated — it was itself required to be "fully supported by the chunk
 * text" at generation time (config/qa-generation.json's diversity
 * instructions) and, for sampled examples, independently entailment-
 * checked against the chunk (APP-012). A richer multi-claim rubric
 * extractor is future work, not required by this task's AC.
 */
import type { DatasetCategory, DatasetExample } from "../../dataset/types.js";
import type { EvalItem, ExpectedAnswer } from "../types.js";

/** §8.3: "exact-match for canonical items (keyword definitions, numeric
 * card stats)" — every other category is graded by the rubric judge. */
const EXACT_MATCH_CATEGORIES: ReadonlySet<DatasetCategory> = new Set(["keyword-definitions", "card-facts"]);

export function expectedAnswerForCategory(category: DatasetCategory, referenceAnswer: string): ExpectedAnswer {
  return EXACT_MATCH_CATEGORIES.has(category)
    ? { kind: "exact", value: referenceAnswer }
    : { kind: "rubric", claims: [referenceAnswer] };
}

function qaLikeItem(ex: DatasetExample, suite: EvalItem["suite"]): EvalItem | null {
  if (ex.exampleType === "qa") {
    return {
      id: `${suite}__${ex.id}`,
      suite,
      question: ex.payload.question,
      expected: expectedAnswerForCategory(ex.category, ex.payload.answer),
      groundingChunkIds: ex.payload.cited_chunk_ids,
      adjudicationCritical: ex.adjudicationCritical,
    };
  }
  if (ex.exampleType === "distractor") {
    return {
      id: `${suite}__${ex.id}`,
      suite,
      question: ex.payload.question,
      expected: expectedAnswerForCategory(ex.category, ex.payload.target.answer ?? ""),
      // The one chunk the target is actually grounded in — NOT
      // contextChunkIds, which also bundles the distractors on purpose
      // (behavior/types.ts's DistractorExample doc).
      groundingChunkIds: [ex.payload.chunk_id],
      adjudicationCritical: ex.adjudicationCritical,
    };
  }
  return null;
}

/** BUG-186 (§8.4): adjudication-critical is narrower than "every
 * multi-card-interactions example" — only those the precomputed flag
 * marks true. */
export function selectAdjudicationCritical(ex: DatasetExample): EvalItem | null {
  if (ex.exampleType !== "qa" || !ex.adjudicationCritical) return null;
  return qaLikeItem(ex, "adjudication-critical");
}

export function selectInteractions(ex: DatasetExample): EvalItem | null {
  if (ex.exampleType !== "qa" || ex.category !== "multi-card-interactions") return null;
  return qaLikeItem(ex, "interactions");
}

export function selectLore(ex: DatasetExample): EvalItem | null {
  if (ex.exampleType !== "qa" || ex.category !== "lore") return null;
  return qaLikeItem(ex, "lore");
}

/** Citation faithfulness is category-agnostic — every QA example carries a
 * known-correct `cited_chunk_ids` grounding set to check the model's
 * citation against (scorers/citationValidity.ts). */
export function selectCitationValidity(ex: DatasetExample): EvalItem | null {
  if (ex.exampleType !== "qa") return null;
  return qaLikeItem(ex, "citation-validity");
}

export function selectAbstentionQuality(ex: DatasetExample): EvalItem | null {
  if (ex.exampleType !== "abstention") return null;
  return {
    id: `abstention-quality__${ex.id}`,
    suite: "abstention-quality",
    question: ex.payload.question,
    expected: { kind: "abstain" },
    groundingChunkIds: [],
    adjudicationCritical: false,
  };
}

export function selectOodRejection(ex: DatasetExample): EvalItem | null {
  if (ex.exampleType !== "ood") return null;
  return {
    id: `ood-rejection__${ex.id}`,
    suite: "ood-rejection",
    question: ex.payload.question,
    expected: { kind: "abstain" },
    groundingChunkIds: [],
    adjudicationCritical: false,
  };
}

export function selectDistractorRobustness(ex: DatasetExample): EvalItem | null {
  if (ex.exampleType !== "distractor") return null;
  return qaLikeItem(ex, "distractor-robustness");
}
