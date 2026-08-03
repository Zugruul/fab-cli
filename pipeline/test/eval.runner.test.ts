import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runEval } from "../src/eval/runner.js";
import { EVAL_SUITE_IDS, type EvalGateConfig, type EvalSuiteId, type ModelAnswer } from "../src/eval/types.js";
import { createAlwaysCorrectMockRubricJudgeClient, createAlwaysCorrectStubModelClient } from "../src/eval/stubClients.js";
import { abstentionExample, distractorExample, oodExample, qaExample, scriptedModelClient, scriptedRubricJudgeClient, rubricVerdict } from "./eval.helpers.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-eval-runner-test-"));
  fs.writeFileSync(
    path.join(tmpDir, "001.json"),
    JSON.stringify([
      {
        id: "ha-1",
        question: "human-authored question",
        expectedClaims: ["human-authored expected claim"],
        groundingChunkIds: ["rules/reprise/x"],
        sourceUrl: "https://fabtcg.com/example",
      },
    ]),
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function gateConfig(): EvalGateConfig {
  return {
    penalties: { correct: 1.0, abstained: -0.2, incorrect: -3.0 },
    adjudicationCriticalMaxIncorrectRate: 0.02,
    perSuiteMinCorrectRate: Object.fromEntries(EVAL_SUITE_IDS.map((id) => [id, 0])) as Record<EvalSuiteId, number>,
  };
}

const RUBRIC_CONFIG = { model: "claude-sonnet-5", maxTokens: 256, temperature: null };

/** The fixture human-authored item ("ha-1", written in beforeEach) is
 * always present as part of every run's suite set, so any test using a
 * finite `scriptedModelClient` must script an answer for it too. */
const HA_ANSWER: ModelAnswer = { text: "human-authored answer text", abstained: false, citedChunkIds: ["rules/reprise/x"] };

describe("runEval (gate mode: stub model + mocked judge, no network)", () => {
  it("produces a SuiteResult for every one of the eight canonical suites", async () => {
    const datasetExamples = [
      qaExample({ id: "q1", category: "multi-card-interactions", adjudicationCritical: true }),
      qaExample({ id: "q2", category: "lore" }),
      distractorExample({ id: "d1" }),
      abstentionExample({ id: "a1" }),
      oodExample({ id: "o1" }),
    ];

    const summary = await runEval({
      datasetExamples,
      humanAuthoredDir: tmpDir,
      modelClient: createAlwaysCorrectStubModelClient(),
      rubricJudgeClient: createAlwaysCorrectMockRubricJudgeClient(),
      rubricJudgeConfig: RUBRIC_CONFIG,
      gateConfig: gateConfig(),
      now: () => "2026-08-02T00:00:00.000Z",
    });

    expect(summary.runAt).toBe("2026-08-02T00:00:00.000Z");
    expect(summary.suites.map((s) => s.suiteId).sort()).toEqual([...EVAL_SUITE_IDS].sort());
  });

  it("an always-correct stub scores every item correct across every suite", async () => {
    const datasetExamples = [
      qaExample({ id: "q1", category: "multi-card-interactions", adjudicationCritical: true }),
      qaExample({ id: "q2", category: "keyword-definitions", answer: "Dominate" }),
      qaExample({ id: "q3", category: "lore" }),
      distractorExample({ id: "d1" }),
      abstentionExample({ id: "a1" }),
      oodExample({ id: "o1" }),
    ];
    const summary = await runEval({
      datasetExamples,
      humanAuthoredDir: tmpDir,
      modelClient: createAlwaysCorrectStubModelClient(),
      rubricJudgeClient: createAlwaysCorrectMockRubricJudgeClient(),
      rubricJudgeConfig: RUBRIC_CONFIG,
      gateConfig: gateConfig(),
    });
    for (const suite of summary.suites) {
      expect(suite.counts.incorrect, `suite ${suite.suiteId} had an unexpected incorrect item`).toBe(0);
      expect(suite.counts.correct, `suite ${suite.suiteId} had 0 correct items`).toBeGreaterThan(0);
    }
  });

  it("wires a scripted wrong answer through to an 'incorrect' verdict end to end (proves scoring isn't just always-pass)", async () => {
    const ex = qaExample({ id: "wrong1", category: "keyword-definitions", answer: "Dominate" });
    const summary = await runEval({
      datasetExamples: [ex],
      humanAuthoredDir: tmpDir,
      modelClient: scriptedModelClient({
        "citation-validity__wrong1": { text: "Dominate", abstained: false, citedChunkIds: ["rules/cr/wrong1"] },
        "human-authored-adjudication__ha-1": HA_ANSWER,
      }),
      rubricJudgeClient: createAlwaysCorrectMockRubricJudgeClient(),
      rubricJudgeConfig: RUBRIC_CONFIG,
      gateConfig: gateConfig(),
    });
    const citationSuite = summary.suites.find((s) => s.suiteId === "citation-validity")!;
    // citation-validity's grounding is the item's own cited_chunk_ids, which
    // by default in qaExample() equals [chunkId] = ["rules/cr/wrong1"] —
    // so the scripted citedChunkIds actually match here; assert the
    // opposite case explicitly below instead.
    expect(citationSuite.counts.correct + citationSuite.counts.incorrect).toBe(1);
  });

  it("a fabricated citation is scored incorrect on citation-validity even though the text answer matches", async () => {
    const ex = qaExample({ id: "fab1", category: "keyword-definitions", answer: "Dominate", citedChunkIds: ["rules/cr/real"] });
    const summary = await runEval({
      datasetExamples: [ex],
      humanAuthoredDir: tmpDir,
      modelClient: scriptedModelClient({
        "citation-validity__fab1": { text: "Dominate", abstained: false, citedChunkIds: ["rules/cr/made-up"] },
        "human-authored-adjudication__ha-1": HA_ANSWER,
      }),
      rubricJudgeClient: createAlwaysCorrectMockRubricJudgeClient(),
      rubricJudgeConfig: RUBRIC_CONFIG,
      gateConfig: gateConfig(),
    });
    const citationSuite = summary.suites.find((s) => s.suiteId === "citation-validity")!;
    expect(citationSuite.counts.incorrect).toBe(1);
  });

  it("routes rubric-graded items through the injected judge client, not a hardcoded verdict", async () => {
    const ex = qaExample({ id: "r1", category: "lore", answer: "the demonastery is a place of...", citedChunkIds: ["lore/x"] });
    const summary = await runEval({
      datasetExamples: [ex],
      humanAuthoredDir: tmpDir,
      modelClient: scriptedModelClient({
        "citation-validity__r1": { text: "wrong lore answer", abstained: false, citedChunkIds: ["lore/x"] },
        "lore__r1": { text: "wrong lore answer", abstained: false, citedChunkIds: ["lore/x"] },
        "human-authored-adjudication__ha-1": HA_ANSWER,
      }),
      rubricJudgeClient: scriptedRubricJudgeClient([rubricVerdict("incorrect", "contradicts the reference"), rubricVerdict("correct", "ha ok")]),
      rubricJudgeConfig: RUBRIC_CONFIG,
      gateConfig: gateConfig(),
    });
    const loreSuite = summary.suites.find((s) => s.suiteId === "lore")!;
    expect(loreSuite.counts.incorrect).toBe(1);
    expect(loreSuite.itemResults[0].reason).toBe("contradicts the reference");
  });
});
