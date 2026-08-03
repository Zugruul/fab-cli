/**
 * Exact-match scorer (SPEC-APP.md §8.3): canonical items — keyword
 * definitions, numeric card stats — where there is one right answer and no
 * judgment call needed. Pure, deterministic, no I/O.
 */
import type { EvalItem, ModelAnswer, Verdict } from "../types.js";

/** Case/whitespace-insensitive normalization — the same "don't fail a
 * correct answer over cosmetic phrasing" bar used elsewhere in the repo
 * (e.g. behavior/'s comparison helpers), but no closer: exact-match items
 * are canonical precisely because they don't need semantic judgment. */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function scoreExactMatch(item: EvalItem, answer: ModelAnswer): Verdict {
  if (item.expected.kind !== "exact") {
    throw new Error(`scoreExactMatch called on item "${item.id}" whose expected.kind is "${item.expected.kind}", not "exact"`);
  }
  if (answer.abstained) return "abstained";
  return normalize(answer.text) === normalize(item.expected.value) ? "correct" : "incorrect";
}
