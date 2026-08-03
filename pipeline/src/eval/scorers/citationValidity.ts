/**
 * Citation-validity scorer (SPEC-APP.md §8.4: "cited chunk actually
 * supports the answer"). Structural, not semantic: `item.groundingChunkIds`
 * is the known-correct grounding set for the item's true answer (derived
 * from the dataset's `cited_chunk_ids` — see suites/fromDataset.ts), so a
 * faithful citation is one drawn from that set. This is distinct from both
 * exact-match (compares answer TEXT) and rubric-judge (grades answer
 * CONTENT) — it grades WHICH source the model claims to be citing, so it's
 * its own small pure function rather than a variant of either. Pure, no
 * I/O.
 */
import type { EvalItem, ModelAnswer, Verdict } from "../types.js";

export function scoreCitationValidity(item: EvalItem, answer: ModelAnswer): Verdict {
  if (answer.abstained) return "abstained";

  if (answer.citedChunkIds.length === 0) {
    // Answered without citing anything — an uncited factual claim is
    // exactly the failure mode this suite exists to catch (§13 invariant
    // 1: "every game-fact answer must derive from retrieved corpus
    // chunks; emitted citations must be validated").
    return "incorrect";
  }

  const groundingSet = new Set(item.groundingChunkIds);
  const allCitationsValid = answer.citedChunkIds.every((id) => groundingSet.has(id));
  return allCitationsValid ? "correct" : "incorrect";
}
