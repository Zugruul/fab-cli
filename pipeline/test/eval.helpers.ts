/**
 * Shared fixtures for pipeline/src/eval tests — DatasetExample builders
 * (matching dataset/types.ts's discriminated union exactly) and scripted
 * ModelClient/RubricJudgeClient test doubles, mirroring the repo's
 * existing `*.helpers.ts` convention (qa.helpers.ts, sampling.helpers.ts,
 * behavior.helpers.ts).
 */
import type { DatasetExample } from "../src/dataset/types.js";
import type { EvalItem, ModelAnswer, ModelClient } from "../src/eval/types.js";
import type { RubricJudgeClient, RubricJudgeRequest, RubricJudgeResponse } from "../src/eval/scorers/rubricJudge.js";

export function qaExample(overrides: {
  id: string;
  category?: DatasetExample["category"];
  adjudicationCritical?: boolean;
  chunkId?: string;
  question?: string;
  answer?: string;
  citedChunkIds?: string[];
  split?: "train" | "eval";
}): DatasetExample {
  const chunkId = overrides.chunkId ?? `rules/cr/${overrides.id}`;
  return {
    id: overrides.id,
    category: overrides.category ?? "multi-card-interactions",
    adjudicationCritical: overrides.adjudicationCritical ?? false,
    exampleType: "qa",
    chunkId,
    payload: {
      id: overrides.id,
      chunk_id: chunkId,
      question: overrides.question ?? `question for ${overrides.id}`,
      answer: overrides.answer ?? `answer for ${overrides.id}`,
      cited_chunk_ids: overrides.citedChunkIds ?? [chunkId],
      entailmentChecked: true,
    },
    split: overrides.split ?? "eval",
  };
}

export function distractorExample(overrides: {
  id: string;
  category?: DatasetExample["category"];
  adjudicationCritical?: boolean;
  chunkId?: string;
  question?: string;
  answer?: string;
  distractorChunkIds?: string[];
  split?: "train" | "eval";
}): DatasetExample {
  const chunkId = overrides.chunkId ?? `rules/cr/${overrides.id}`;
  return {
    id: overrides.id,
    category: overrides.category ?? "multi-card-interactions",
    adjudicationCritical: overrides.adjudicationCritical ?? false,
    exampleType: "distractor",
    chunkId,
    payload: {
      id: overrides.id,
      category: "distractor",
      chunk_id: chunkId,
      question: overrides.question ?? `distractor question for ${overrides.id}`,
      contextChunkIds: [chunkId, ...(overrides.distractorChunkIds ?? [`rules/cr/distractor-${overrides.id}`])],
      target: { answer: overrides.answer ?? `answer for ${overrides.id}`, citation_ids: [chunkId], confidence: "high" },
      timeSensitive: false,
    },
    split: overrides.split ?? "eval",
  };
}

export function abstentionExample(overrides: { id: string; question?: string; sourceChunkId?: string; split?: "train" | "eval" }): DatasetExample {
  return {
    id: overrides.id,
    category: "abstention",
    adjudicationCritical: false,
    exampleType: "abstention",
    chunkId: overrides.sourceChunkId ?? `rules/cr/${overrides.id}`,
    payload: {
      id: overrides.id,
      category: "abstention",
      sourceChunkId: overrides.sourceChunkId ?? `rules/cr/${overrides.id}`,
      question: overrides.question ?? `abstention question for ${overrides.id}`,
      contextChunkIds: [`rules/cr/unrelated-${overrides.id}`],
      target: {
        answer: "The retrieved sources don't clearly settle this — I don't want to guess.",
        citation_ids: [],
        confidence: "abstain",
        abstained: true,
        escalation: "ask a judge in #ask-a-judge",
      },
    },
    split: overrides.split ?? "eval",
  };
}

export function oodExample(overrides: { id: string; question?: string; style?: string; split?: "train" | "eval" }): DatasetExample {
  return {
    id: overrides.id,
    category: "ood",
    adjudicationCritical: false,
    exampleType: "ood",
    chunkId: null,
    payload: {
      id: overrides.id,
      category: "ood",
      style: overrides.style ?? "direct",
      question: overrides.question ?? `ood question for ${overrides.id}`,
      target: {
        answer: "I'm built to answer Flesh & Blood questions only.",
        citation_ids: [],
        confidence: "abstain",
      },
    },
    split: overrides.split ?? "eval",
  };
}

// --- Test doubles ------------------------------------------------------

/** A ModelClient scripted per item id — throws on an unscripted id so a
 * test never silently falls through to an unintended default answer. */
export function scriptedModelClient(byItemId: Record<string, ModelAnswer>): ModelClient {
  return {
    async answer(item: EvalItem): Promise<ModelAnswer> {
      const scripted = byItemId[item.id];
      if (!scripted) throw new Error(`scriptedModelClient: no scripted answer for item id "${item.id}"`);
      return scripted;
    },
  };
}

/** A RubricJudgeClient scripted per call, in order — throws once
 * exhausted so an unexpected extra call is never silently mis-scored. */
export function scriptedRubricJudgeClient(responses: RubricJudgeResponse[]): RubricJudgeClient {
  let i = 0;
  return {
    async generate(_request: RubricJudgeRequest): Promise<RubricJudgeResponse> {
      if (i >= responses.length) throw new Error("scriptedRubricJudgeClient: exhausted scripted responses");
      return responses[i++];
    },
  };
}

export function rubricVerdict(verdict: "correct" | "incorrect" | "abstained", reason = "stub"): RubricJudgeResponse {
  return { text: JSON.stringify({ verdict, reason }), usage: { inputTokens: 1, outputTokens: 1 } };
}
