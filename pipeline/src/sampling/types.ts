/**
 * Rejection sampling (SPEC-APP.md §7.4): every candidate (question, answer)
 * pair produced by APP-011's teacher generation is entailment-checked
 * against its source chunk before it's allowed into the training set.
 * Reuses APP-011's `Chunk` and `QAPair` shapes (pipeline/src/qa/types.ts,
 * pipeline/src/types.ts) rather than redefining them.
 */
import type { Chunk } from "../types.js";
import type { QAPair } from "../qa/types.js";

/** The judge's verdict on one (chunk, pair) — SPEC-APP.md §7.4's "teacher-
 * as-judge" entailment check. `reason` is required both when entailed
 * (why the answer is supported) and when not (what's missing/fabricated),
 * so every accepted/rejected record carries an explanation. */
export interface EntailmentVerdict {
  entailed: boolean;
  reason: string;
}

export interface JudgeRequest {
  model: string;
  maxTokens: number;
  temperature?: number | null;
  system: string;
  user: string;
}

export interface JudgeResponse {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** Abstraction over "call the judge model" — injectable so the gate never
 * touches the real Anthropic transport (mirrors qa/types.ts's
 * TeacherClient; see judge.ts for the real impl and
 * test/sampling.helpers.ts for the mocks used across the test suite). */
export interface JudgeClient {
  check(request: JudgeRequest): Promise<JudgeResponse>;
}

/** One pair queued for entailment checking, addressed by a stable id
 * derived from its position within its source chunk's pairs array (pairs
 * themselves carry no id — see sampler.ts's buildWorkItems). */
export interface WorkItem {
  /** `${chunk_id}#${index}` — stable as long as qa-pairs.jsonl's per-chunk
   * pair order doesn't change, which holds because each chunk's record is
   * written once by APP-011's runner and never reordered in place. */
  pairId: string;
  chunk_id: string;
  pair: QAPair;
}

export type PairSamplingStatus = "accepted" | "rejected";

/** What happened when checking one pair during a (non-dry-run) sampling
 * run — always present for every pair actually attempted this run.
 * Anything that isn't a confirmed "entailed" verdict is rejected
 * (fail-closed): a judge API failure after retries, an unparseable/
 * refusal/truncated judge response, and an explicit not-entailed verdict
 * all land here as "rejected" with a reason — see sampler.ts. */
export interface PairSamplingOutcome {
  pairId: string;
  chunk_id: string;
  pair: QAPair;
  status: PairSamplingStatus;
  reason: string;
  attempts: number;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface BatchConfig {
  /** Work items processed per outer batch group. */
  size: number;
  /** Max simultaneous in-flight judge requests. */
  maxConcurrent: number;
  /** Requests/minute cap across the whole run; 0 or omitted disables
   * rate limiting. */
  requestsPerMinute: number;
}

export interface CostConfig {
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  /** Once the running cost estimate reaches this many USD, the sampler
   * stops LAUNCHING new checks — not a hard cap on total spend. Up to
   * `batch.maxConcurrent` checks already in flight when the ceiling is
   * crossed are allowed to finish (per-pair calls are isolated, never
   * cancelled mid-request), so actual spend can overshoot the ceiling by
   * up to maxConcurrent pairs' worth of cost. null disables the ceiling. */
  ceilingUsd: number | null;
}

export interface SamplingConfig {
  judgeModel: string;
  maxTokens: number;
  /** Only sent to the API when set — see judge.ts for why. */
  temperature?: number | null;
  batch: BatchConfig;
  cost: CostConfig;
  /** Retries applied on top of the API's own retryable-error backoff (429
   * / 5xx) before a pair is recorded as rejected for infra reasons. */
  maxRetries: number;
  retryBaseDelayMs: number;
}

export interface SamplingProgressState {
  /** pairIds that were confirmed entailed. */
  acceptedIds: string[];
  /** pairIds that were rejected — not entailed, unparseable judge
   * response, or judge call failed after retries. */
  rejectedIds: string[];
  costUsd: number;
  requestCount: number;
}

export interface DryRunPlanEntry {
  pairId: string;
  chunk_id: string;
  request: JudgeRequest;
}

export interface SamplingRunResult {
  /** Outcomes for pairs actually attempted THIS invocation (excludes
   * pairs already accepted/rejected on resume, and is empty for a dry
   * run). */
  outcomes: PairSamplingOutcome[];
  progress: SamplingProgressState;
  stoppedEarly: { reason: "cost-ceiling" } | null;
  /** Present only for dryRun: what would have been sent for every pair. */
  dryRunPlan?: DryRunPlanEntry[];
}

export type { Chunk, QAPair };
