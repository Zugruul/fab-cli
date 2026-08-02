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
 * themselves carry no id — see sampler.ts's buildWorkItems).
 *
 * ⚠️ STALENESS GUARD (BUG-180): `pairId` is derived from a chunk's pair
 * *array position*, not from pair content. If a chunk_id's pairs are
 * regenerated (re-running `qa:generate` for that chunk after an edit to
 * its source text, a re-tuned prompt, etc.), the new pairs at the same
 * indices reuse the SAME pairIds as before — a plain pairId-keyed resume
 * would treat those new pairs as "already checked" and silently apply the
 * OLD verdict to the NEW content. `pairContentHash` (below) is the
 * automatic guard against exactly that: `runSampling` compares each
 * already-recorded pairId's stored hash (progress.json's
 * `contentHashes`) against the current work item's hash on every run — a
 * mismatch means the content changed underneath that pairId, so the pair
 * is treated as NOT done and reprocessed rather than silently honored
 * (see sampler.ts's staleness-reconciliation pass and its
 * `staleReprocessedCount`/`legacyUnverifiedCount` result fields for how
 * this is surfaced). Progress files written before this guard existed
 * carry no hash at all; those pairIds are honored as done-as-recorded
 * ONCE (there's no baseline to compare against yet) and their hash is
 * backfilled so a later resume can actually guard them. */
export interface WorkItem {
  /** `${chunk_id}#${index}` — stable ONLY as long as qa-pairs.jsonl's
   * per-chunk pair content at that index doesn't change; see the
   * STALENESS GUARD note on this interface for how a change is detected
   * via `pairContentHash` instead of silently ignored. */
  pairId: string;
  chunk_id: string;
  pair: QAPair;
  /** SHA-256 hex digest (first 16 chars) of `pair.question` +
   * `pair.answer`, computed by sampler.ts's `computePairContentHash` —
   * the fingerprint the STALENESS GUARD compares against progress.json's
   * `contentHashes` to detect a regenerated pair reusing an existing
   * pairId. */
  pairContentHash: string;
}

export type PairSamplingStatus = "accepted" | "rejected";

/** Why a pair was rejected, distinguished so a run's reported entailment
 * quality isn't polluted by unrelated infrastructure noise (SPEC-APP.md
 * §7.4 review round):
 *  - "not-entailed": the judge examined the pair against its source chunk
 *    and rendered a genuine, conclusive not-entailed verdict — this is
 *    real signal about the *training pair's* quality.
 *  - "infra-error": the check itself never reached a conclusive verdict —
 *    the judge API failed after retries, its response was unparseable/a
 *    refusal/truncated, OR the pair's source chunk was missing from
 *    chunksById. All three are still rejected (fail-closed: an
 *    inconclusive check is never an acceptance), but they say nothing
 *    about whether the pair is actually entailed — see manifest.ts, which
 *    reports acceptance rate with and without this bucket. The missing-
 *    source-chunk case is bucketed here rather than under "not-entailed"
 *    because it's a pipeline data-availability failure (the check never
 *    ran at all), not a judgment the judge model made about the pair's
 *    content — exactly like an API outage, not like a real verdict. */
export type RejectionKind = "not-entailed" | "infra-error";

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
  /** null when status is "accepted"; always set to one of RejectionKind's
   * values when status is "rejected" — see RejectionKind's doc for the
   * bucketing rule. */
  rejectionKind: RejectionKind | null;
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
  /** BUG-180 guard: pairId -> pairContentHash recorded the last time that
   * pairId was actually checked (or, for a legacy record honored once
   * without reprocessing, backfilled from its current content — see
   * sampler.ts's staleness-reconciliation pass in runSampling). Optional/
   * absent for progress files written before this guard existed — those
   * pairIds are "legacy": honored as done-as-recorded once, with no
   * baseline to detect staleness against, until this backfill gives them
   * one. */
  contentHashes?: Record<string, string>;
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
  /** BUG-180 guard: count of pairIds whose progress-recorded content hash
   * didn't match this run's work-item content — reprocessed rather than
   * silently honored with the stale verdict (see WorkItem's STALENESS
   * GUARD doc). 0 for dry runs, which never touch progress. */
  staleReprocessedCount: number;
  /** BUG-180 guard: count of pairIds honored as done-as-recorded because
   * their progress entry predates this guard (no hash to compare
   * against). Each is backfilled with its current content hash this run,
   * so it won't be counted here again on a later resume — surfaced so
   * this one-time backward-compat pass-through is visible, never silent.
   * 0 for dry runs. */
  legacyUnverifiedCount: number;
}

export type { Chunk, QAPair };
