/**
 * Abstain-expected scorer (abstention-quality, OOD-rejection suites):
 * the ONLY correct behavior is abstaining — answering at all, right or
 * wrong, is incorrect (SPEC-APP.md §13 invariant 1: "when grounding is
 * insufficient the app must abstain ... never emit a parametric guess";
 * §10.9's OOD fast-path refuses outright). There is no "abstained" verdict
 * bucket distinct from "correct" here — abstaining IS the correct
 * behavior, so it's scored as such; only "correct"/"incorrect" ever come
 * out of this scorer. Pure, no I/O.
 */
import type { EvalItem, ModelAnswer, Verdict } from "../types.js";

export function scoreAbstainExpected(item: EvalItem, answer: ModelAnswer): Verdict {
  if (item.expected.kind !== "abstain") {
    throw new Error(`scoreAbstainExpected called on item "${item.id}" whose expected.kind is "${item.expected.kind}", not "abstain"`);
  }
  return answer.abstained ? "correct" : "incorrect";
}
