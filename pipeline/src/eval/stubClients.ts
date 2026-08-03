/**
 * Deterministic stub ModelClient + mock RubricJudgeClient (SPEC-APP.md
 * §13 invariant 10 / docs/design/app-E2.md's Gate contract): "the whole
 * harness runs against stub model + mocked judge with network disabled".
 * Used both by the gate's `npm run eval` smoke path (cli.ts's default
 * `--stub` mode) and importable by tests that don't need finer-grained
 * scripted control than "the stub always gets it right" (tests that DO
 * need to exercise incorrect/abstained paths build their own small
 * fixture clients — see test/eval.helpers.ts).
 *
 * This stub is intentionally NOT a model — it reads the item's own
 * `expected` field and answers accordingly, so a harness run against it
 * proves the wiring (suite building -> scoring -> aggregation -> gate
 * signals -> manifest integration) end to end without needing a real
 * on-device model (deferred — docs/design/app-E2.md's Out of scope: "The
 * Q&A experience consuming calibrated floors at runtime (E4)" and
 * real-model runs on remote compute).
 */
import type { EvalItem, ModelAnswer, ModelClient } from "./types.js";
import type { RubricJudgeClient, RubricJudgeRequest, RubricJudgeResponse } from "./scorers/rubricJudge.js";

export function createAlwaysCorrectStubModelClient(): ModelClient {
  return {
    async answer(item: EvalItem): Promise<ModelAnswer> {
      if (item.expected.kind === "abstain") {
        return { text: "I don't have enough information to answer that.", abstained: true, citedChunkIds: [] };
      }
      if (item.expected.kind === "exact") {
        return { text: item.expected.value, abstained: false, citedChunkIds: item.groundingChunkIds };
      }
      return { text: item.expected.claims.join(" "), abstained: false, citedChunkIds: item.groundingChunkIds };
    },
  };
}

/** Mocked judge — never calls a real transport. Always renders "correct"
 * with a fixed reason, since it's paired with the always-correct stub
 * model above; a rubric-judge item only reaches this client at all when
 * the stub answered non-abstained (scorers/rubricJudge.ts short-circuits
 * abstained answers before ever building a request). */
export function createAlwaysCorrectMockRubricJudgeClient(): RubricJudgeClient {
  return {
    async generate(_request: RubricJudgeRequest): Promise<RubricJudgeResponse> {
      return {
        text: JSON.stringify({ verdict: "correct", reason: "stub judge: matches reference claims" }),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}
