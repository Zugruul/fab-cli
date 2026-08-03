/**
 * Rubric-based LLM-judge scorer (SPEC-APP.md §8.3): open answers graded
 * against claims derived from the source chunk. Per the epic design doc
 * (docs/design/app-E2.md) and reviewer lesson `claude-p-headless-
 * programmatic-usage-facts`, the real transport is NOT a new Anthropic SDK
 * call — it reuses qa/engine.ts's TeacherClient abstraction (the same
 * dual-engine — claude-code-subscription / anthropic-api — discipline
 * already built for teacher-QA generation, #223), so this is the harness's
 * injectable judge client, not a fourth bespoke transport alongside
 * qa/teacher.ts, qa/claudeCodeTeacher.ts and sampling/judge.ts.
 */
import type { EngineId, TeacherClient, TeacherRequest, TeacherResponse } from "../../qa/types.js";
import { buildTeacherClient } from "../../qa/engine.js";
import type { EvalItem, ModelAnswer, Verdict } from "../types.js";

/** Same shape as qa/types.ts's TeacherClient — a rubric-judge call IS a
 * "generate text from a prompt" call, so no new interface is invented. */
export type RubricJudgeClient = TeacherClient;
export type RubricJudgeRequest = TeacherRequest;
export type RubricJudgeResponse = TeacherResponse;

export function buildRubricJudgeClient(engineId: EngineId): RubricJudgeClient {
  return buildTeacherClient(engineId);
}

export interface RubricJudgeConfig {
  model: string;
  maxTokens: number;
  temperature?: number | null;
}

const SYSTEM_PROMPT =
  "You are grading a Flesh & Blood rules/lore Q&A answer against a reference answer's claims. " +
  'Respond with ONLY a JSON object: {"verdict": "correct" | "incorrect" | "abstained", "reason": "<one sentence>"}. ' +
  '"correct" means the candidate answer is consistent with every claim and adds no unsupported claim. ' +
  '"incorrect" means the candidate contradicts a claim, invents an unsupported fact, or is a wrong/irrelevant answer. ' +
  '"abstained" means the candidate declined to answer or said the sources don\'t settle it.';

export function buildRubricPrompt(item: EvalItem, answer: ModelAnswer): { system: string; user: string } {
  if (item.expected.kind !== "rubric") {
    throw new Error(`buildRubricPrompt called on item "${item.id}" whose expected.kind is "${item.expected.kind}", not "rubric"`);
  }
  const claims = item.expected.claims.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const user =
    `Question: ${item.question}\n\n` +
    `Reference answer claims (the candidate must be consistent with these, and must not contradict them):\n${claims}\n\n` +
    `Candidate answer: ${answer.text}`;
  return { system: SYSTEM_PROMPT, user };
}

/**
 * Parses the judge's JSON verdict. Fail-closed on anything unparseable or
 * off-enum — mirrors sampling/'s "an inconclusive check is never an
 * acceptance" discipline (sampling/types.ts's RejectionKind doc): a judge
 * response the harness can't confidently read is graded "incorrect", never
 * silently upgraded to "correct".
 */
export function parseRubricVerdict(responseText: string): { verdict: Verdict; reason: string } {
  try {
    const parsed = JSON.parse(responseText) as { verdict?: unknown; reason?: unknown };
    if (parsed.verdict === "correct" || parsed.verdict === "incorrect" || parsed.verdict === "abstained") {
      return { verdict: parsed.verdict, reason: typeof parsed.reason === "string" ? parsed.reason : "" };
    }
    return { verdict: "incorrect", reason: `unparseable verdict field in judge response: ${responseText}` };
  } catch {
    return { verdict: "incorrect", reason: `judge response was not valid JSON: ${responseText}` };
  }
}

export async function scoreWithRubricJudge(
  item: EvalItem,
  answer: ModelAnswer,
  client: RubricJudgeClient,
  config: RubricJudgeConfig,
): Promise<{ verdict: Verdict; reason: string }> {
  if (answer.abstained) return { verdict: "abstained", reason: "model abstained" };

  const { system, user } = buildRubricPrompt(item, answer);
  let response: TeacherResponse;
  try {
    response = await client.generate({
      model: config.model,
      maxTokens: config.maxTokens,
      temperature: config.temperature ?? null,
      system,
      user,
    });
  } catch (err) {
    // Judge call failed after the client's own retry policy — fail-closed,
    // same discipline as above: an infra failure is never a free pass.
    return { verdict: "incorrect", reason: `rubric-judge call failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  return parseRubricVerdict(response.text);
}
