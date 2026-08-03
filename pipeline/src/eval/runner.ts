/**
 * Eval run orchestration (SPEC-APP.md §8.3-§8.5): loads/builds every
 * suite's items, calls the injectable model client for each, dispatches
 * each item to the right scorer, and aggregates into an EvalRunSummary.
 * The gate exercises this against a deterministic stub ModelClient and a
 * mocked RubricJudgeClient (see test/eval.helpers.ts) with network
 * disabled — a real model/judge run is an explicit non-gate command
 * (cli.ts).
 */
import type { DatasetExample } from "../dataset/types.js";
import { buildSuiteResult } from "./scoring.js";
import { scoreAbstainExpected } from "./scorers/abstainExpected.js";
import { scoreCitationValidity } from "./scorers/citationValidity.js";
import { scoreExactMatch } from "./scorers/exactMatch.js";
import { scoreWithRubricJudge, type RubricJudgeClient, type RubricJudgeConfig } from "./scorers/rubricJudge.js";
import { buildDatasetSuiteItems, SUITE_REGISTRY, type SuiteScorerKind } from "./suites/registry.js";
import { loadHumanAuthoredItems } from "./suites/humanAuthored.js";
import type { EvalGateConfig, EvalItem, EvalRunSummary, ItemResult, ModelAnswer, ModelClient } from "./types.js";

export interface RunEvalOptions {
  datasetExamples: readonly DatasetExample[];
  humanAuthoredDir: string;
  modelClient: ModelClient;
  rubricJudgeClient: RubricJudgeClient;
  rubricJudgeConfig: RubricJudgeConfig;
  gateConfig: EvalGateConfig;
  now?: () => string;
}

async function scoreItem(
  item: EvalItem,
  answer: ModelAnswer,
  scorerKind: SuiteScorerKind,
  rubricJudgeClient: RubricJudgeClient,
  rubricJudgeConfig: RubricJudgeConfig,
): Promise<ItemResult> {
  if (scorerKind === "citation") {
    return { itemId: item.id, verdict: scoreCitationValidity(item, answer) };
  }
  if (scorerKind === "abstain") {
    return { itemId: item.id, verdict: scoreAbstainExpected(item, answer) };
  }

  // scorerKind === "expected": dispatch on the item's own expected.kind.
  if (item.expected.kind === "exact") {
    return { itemId: item.id, verdict: scoreExactMatch(item, answer) };
  }
  if (item.expected.kind === "rubric") {
    const { verdict, reason } = await scoreWithRubricJudge(item, answer, rubricJudgeClient, rubricJudgeConfig);
    return { itemId: item.id, verdict, reason };
  }
  // Unreachable given suites/registry.ts's wiring (an "expected"-scored
  // suite never emits an expected.kind: "abstain" item) — loud fail rather
  // than silently guessing a verdict if that invariant is ever violated.
  throw new Error(`item "${item.id}" has expected.kind "${item.expected.kind}" but suite scorer is "expected" (exact/rubric only)`);
}

/** Merges the dataset-sourced suites with the human-authored suite's
 * committed items into one Record keyed by suite id, in SUITE_REGISTRY
 * order. */
export function buildAllSuiteItems(
  datasetExamples: readonly DatasetExample[],
  humanAuthoredDir: string,
): Record<string, EvalItem[]> {
  const bySuite = buildDatasetSuiteItems(datasetExamples);
  bySuite["human-authored-adjudication"] = loadHumanAuthoredItems(humanAuthoredDir);
  return bySuite;
}

export async function runEval(options: RunEvalOptions): Promise<EvalRunSummary> {
  const now = options.now ?? (() => new Date().toISOString());
  const bySuite = buildAllSuiteItems(options.datasetExamples, options.humanAuthoredDir);

  const suites = [];
  for (const def of SUITE_REGISTRY) {
    const items = bySuite[def.id] ?? [];
    const itemResults: ItemResult[] = [];
    for (const item of items) {
      const answer = await options.modelClient.answer(item);
      itemResults.push(await scoreItem(item, answer, def.scorer, options.rubricJudgeClient, options.rubricJudgeConfig));
    }
    suites.push(buildSuiteResult(def.id, itemResults, options.gateConfig.penalties));
  }

  return { runAt: now(), suites };
}
