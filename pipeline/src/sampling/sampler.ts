import fs from "node:fs";
import path from "node:path";
import { withRetry } from "../qa/retry.js";
import { estimateCost } from "../qa/runner.js";
import { buildJudgePrompt } from "./prompt.js";
import { parseJudgeResponse } from "./parse.js";
import type {
  Chunk,
  DryRunPlanEntry,
  JudgeClient,
  JudgeRequest,
  PairSamplingOutcome,
  SamplingConfig,
  SamplingProgressState,
  SamplingRunResult,
  WorkItem,
} from "./types.js";
import type { PairsRecord } from "../qa/pairsStore.js";

const EMPTY_PROGRESS: SamplingProgressState = {
  acceptedIds: [],
  rejectedIds: [],
  costUsd: 0,
  requestCount: 0,
};

/** Flattens APP-011's per-chunk pairs records into individually-addressed
 * work items — see types.ts's WorkItem for the pairId scheme. */
export function buildWorkItems(records: PairsRecord[]): WorkItem[] {
  const items: WorkItem[] = [];
  for (const record of records) {
    record.pairs.forEach((pair, index) => {
      items.push({ pairId: `${record.chunk_id}#${index}`, chunk_id: record.chunk_id, pair });
    });
  }
  return items;
}

/** Loads the on-disk progress file, or a fresh empty state if it doesn't
 * exist yet — a killed run has nothing to resume from, that's fine. */
export function loadSamplingProgress(progressPath: string): SamplingProgressState {
  try {
    const raw = fs.readFileSync(progressPath, "utf8");
    return JSON.parse(raw) as SamplingProgressState;
  } catch {
    return { ...EMPTY_PROGRESS, acceptedIds: [], rejectedIds: [] };
  }
}

/** Persists progress synchronously so it survives a process kill that
 * happens immediately after — this is the resumability contract. */
export function saveSamplingProgress(progressPath: string, state: SamplingProgressState): void {
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  fs.writeFileSync(progressPath, JSON.stringify(state, null, 2) + "\n");
}

export function buildJudgeRequest(
  item: WorkItem,
  chunk: Chunk,
  config: SamplingConfig,
): JudgeRequest {
  const { system, user } = buildJudgePrompt(chunk, item.pair);
  return {
    model: config.judgeModel,
    maxTokens: config.maxTokens,
    temperature: config.temperature ?? undefined,
    system,
    user,
  };
}

export interface RunSamplingOptions {
  workItems: WorkItem[];
  /** Source chunk text for each work item's chunk_id — a work item whose
   * chunk_id has no entry here is rejected outright (source text
   * unavailable to ground the entailment check against), never thrown. */
  chunksById: Map<string, Chunk>;
  config: SamplingConfig;
  judge: JudgeClient;
  /** Where progress is persisted/resumed from. */
  progressPath: string;
  /** No API calls; just report what would be sent (mirrors qa/runner.ts's
   * dry-run contract). */
  dryRun?: boolean;
  /** Injectable clock + sleep for deterministic rate-limit testing. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called (and awaited) after a pair is checked but BEFORE it's recorded
   * as done in progress — this is where a caller durably persists the
   * pair's accepted/rejected record (see store.ts). May return a Promise;
   * runSampling awaits it and lets a thrown/rejected callback propagate
   * out entirely (rather than isolating it like a judge-call failure) — a
   * broken persistence layer is an infrastructure fault, not a normal
   * per-pair check failure, and whatever was already durably saved before
   * the throw stays on disk regardless (dev/data-before-marker-durability
   * house note; mirrors qa/runner.ts's onChunkComplete contract). */
  onPairComplete?: (outcome: PairSamplingOutcome) => void | Promise<void>;
}

/**
 * Resumable, rate/cost-controlled rejection-sampling runner (SPEC-APP.md
 * §7.4). Pairs already recorded as accepted or rejected in the progress
 * file are skipped — resuming a killed run only pays for what's left.
 * Failures on individual pairs (judge API error after retries, or an
 * unparseable/refusal/truncated judge response) are recorded as rejected
 * and skipped, never abort the run (per-entry isolation, fail-closed: an
 * inconclusive check never becomes an acceptance) — and tagged
 * `rejectionKind: "infra-error"` rather than `"not-entailed"`, since they
 * carry no signal about the pair's actual content (see types.ts's
 * RejectionKind and manifest.ts, which reports acceptance rate with and
 * without infra noise). Once the running cost
 * estimate reaches the configured ceiling, the runner stops launching new
 * checks and reports why via `stoppedEarly`.
 */
export async function runSampling(opts: RunSamplingOptions): Promise<SamplingRunResult> {
  const { workItems, chunksById, config, judge, progressPath } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? (() => Date.now());

  if (opts.dryRun) {
    const dryRunPlan: DryRunPlanEntry[] = workItems
      .filter((item) => chunksById.has(item.chunk_id))
      .map((item) => ({
        pairId: item.pairId,
        chunk_id: item.chunk_id,
        request: buildJudgeRequest(item, chunksById.get(item.chunk_id)!, config),
      }));
    return {
      outcomes: [],
      progress: loadSamplingProgress(progressPath),
      stoppedEarly: null,
      dryRunPlan,
    };
  }

  const progress = loadSamplingProgress(progressPath);
  const alreadyAttempted = new Set([...progress.acceptedIds, ...progress.rejectedIds]);
  const pending = workItems.filter((item) => !alreadyAttempted.has(item.pairId));

  const outcomes: PairSamplingOutcome[] = [];
  let stoppedEarly: SamplingRunResult["stoppedEarly"] = null;
  let costUsd = progress.costUsd;
  let requestCount = progress.requestCount;
  let lastRequestAt = -Infinity;
  const rpm = config.batch.requestsPerMinute;
  const minIntervalMs = rpm > 0 ? 60_000 / rpm : 0;

  const batchSize = config.batch.size > 0 ? config.batch.size : pending.length;

  outer: for (let start = 0; start < pending.length; start += batchSize) {
    const group = pending.slice(start, start + batchSize);
    let cursor = 0;

    async function worker(): Promise<void> {
      for (;;) {
        if (stoppedEarly) return;
        const i = cursor++;
        if (i >= group.length) return;
        const item = group[i];

        if (minIntervalMs > 0) {
          const wait = lastRequestAt + minIntervalMs - now();
          if (wait > 0) await sleep(wait);
          lastRequestAt = now();
        }

        const outcome = await checkPair(item);

        // Persist first, confirm it's durable, THEN mark done — same
        // ordering guarantee as qa/runner.ts's onChunkComplete: if the
        // process dies between these two steps, progress.json still shows
        // the pair as pending, so a resume just reprocesses it (one wasted
        // API call) instead of the pair being marked done while its
        // already-paid-for verdict was never durably recorded.
        await opts.onPairComplete?.(outcome);

        if (outcome.status === "accepted") {
          progress.acceptedIds.push(outcome.pairId);
        } else {
          progress.rejectedIds.push(outcome.pairId);
        }
        progress.costUsd = costUsd;
        progress.requestCount = requestCount;
        saveSamplingProgress(progressPath, progress);

        outcomes.push(outcome);

        if (config.cost.ceilingUsd != null && costUsd >= config.cost.ceilingUsd) {
          stoppedEarly = { reason: "cost-ceiling" };
        }
      }
    }

    async function checkPair(item: WorkItem): Promise<PairSamplingOutcome> {
      const chunk = chunksById.get(item.chunk_id);
      if (!chunk) {
        // Bucketed as "infra-error", not "not-entailed": the check never
        // ran at all for lack of source text — this is a pipeline data-
        // availability failure, not a judgment about the pair's content
        // (see RejectionKind's doc in types.ts).
        return {
          pairId: item.pairId,
          chunk_id: item.chunk_id,
          pair: item.pair,
          status: "rejected",
          rejectionKind: "infra-error",
          reason: `source chunk ${item.chunk_id} not found — cannot ground entailment check`,
          attempts: 0,
        };
      }

      const request = buildJudgeRequest(item, chunk, config);
      try {
        const response = await withRetry(() => judge.check(request), {
          maxRetries: config.maxRetries,
          baseDelayMs: config.retryBaseDelayMs,
          sleep,
        });
        requestCount++;
        costUsd += estimateCost(response.usage, config.cost);

        const parsed = parseJudgeResponse(response.text);
        if ("error" in parsed) {
          // Fail closed: an inconclusive judge response (refusal,
          // truncation, malformed JSON) is never treated as an
          // acceptance. "infra-error", not "not-entailed" — the judge
          // never actually rendered a verdict on the pair's content.
          return {
            pairId: item.pairId,
            chunk_id: item.chunk_id,
            pair: item.pair,
            status: "rejected",
            rejectionKind: "infra-error",
            reason: parsed.error,
            attempts: 1,
            usage: response.usage,
          };
        }

        return {
          pairId: item.pairId,
          chunk_id: item.chunk_id,
          pair: item.pair,
          status: parsed.verdict.entailed ? "accepted" : "rejected",
          rejectionKind: parsed.verdict.entailed ? null : "not-entailed",
          reason: parsed.verdict.reason,
          attempts: 1,
          usage: response.usage,
        };
      } catch (err) {
        // Fail closed here too: a judge call that never succeeded after
        // retries can't confirm entailment, so the pair is rejected rather
        // than silently let through. "infra-error" — an API outage says
        // nothing about the pair's actual entailment.
        return {
          pairId: item.pairId,
          chunk_id: item.chunk_id,
          pair: item.pair,
          status: "rejected",
          rejectionKind: "infra-error",
          reason: `judge check failed: ${errorMessage(err)}`,
          attempts: config.maxRetries + 1,
        };
      }
    }

    const workerCount = Math.max(1, Math.min(config.batch.maxConcurrent, group.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    if (stoppedEarly) break outer;
  }

  return { outcomes, progress, stoppedEarly };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
