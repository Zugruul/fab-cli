import fs from "node:fs";
import path from "node:path";
import { buildPrompt } from "./prompt.js";
import { parseTeacherResponse } from "./parse.js";
import { withRetry } from "./retry.js";
import type {
  Chunk,
  ChunkGenerationOutcome,
  CostConfig,
  DryRunPlanEntry,
  GenerationConfig,
  ProgressState,
  RunResult,
  TeacherClient,
  TeacherRequest,
} from "./types.js";

const EMPTY_PROGRESS: ProgressState = { doneChunkIds: [], failed: [], costUsd: 0, requestCount: 0 };

/** Loads the on-disk progress file, or a fresh empty state if it doesn't
 * exist yet — a killed run has nothing to resume from, that's fine. */
export function loadProgress(progressPath: string): ProgressState {
  try {
    const raw = fs.readFileSync(progressPath, "utf8");
    return JSON.parse(raw) as ProgressState;
  } catch {
    return { ...EMPTY_PROGRESS, doneChunkIds: [], failed: [] };
  }
}

/** Persists progress synchronously so it survives a process kill that
 * happens immediately after — this is the resumability contract. */
export function saveProgress(progressPath: string, state: ProgressState): void {
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  fs.writeFileSync(progressPath, JSON.stringify(state, null, 2) + "\n");
}

export function buildTeacherRequest(chunk: Chunk, config: GenerationConfig): TeacherRequest {
  const { system, user } = buildPrompt(chunk, config);
  return {
    model: config.teacherModel,
    maxTokens: config.maxTokens,
    temperature: config.temperature ?? undefined,
    system,
    user,
  };
}

export function estimateCost(
  usage: { inputTokens: number; outputTokens: number },
  cost: CostConfig,
): number {
  return (
    (usage.inputTokens / 1_000_000) * cost.inputPricePerMTok +
    (usage.outputTokens / 1_000_000) * cost.outputPricePerMTok
  );
}

export interface RunOptions {
  chunks: Chunk[];
  config: GenerationConfig;
  teacher: TeacherClient;
  /** Where progress is persisted/resumed from. */
  progressPath: string;
  /** No API calls; just report what would be sent (SPEC-APP.md §7.3 / task
   * AC: "--dry-run (no API calls, emits what WOULD be sent)"). */
  dryRun?: boolean;
  /** Injectable clock + sleep for deterministic rate-limit testing. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called (and awaited) after a chunk is generated but BEFORE it's
   * recorded as done in progress — this is where a caller durably persists
   * the chunk's pairs (see pairsStore.ts). May return a Promise; runBatch
   * awaits it and lets a thrown/rejected callback propagate out of
   * runBatch entirely (rather than isolating it like a teacher failure) —
   * a broken persistence layer is an infrastructure fault, not a normal
   * per-chunk generation failure, and whatever was already durably saved
   * before the throw stays on disk regardless. */
  onChunkComplete?: (outcome: ChunkGenerationOutcome) => void | Promise<void>;
}

/**
 * Resumable, rate/cost-controlled batch runner (SPEC-APP.md §7.3). Chunks
 * already recorded as done or failed in the progress file are skipped —
 * resuming a killed run only pays for what's left. Failures on individual
 * chunks (API error after retries, or a response with zero valid pairs)
 * are recorded and skipped, never abort the run (per-entry isolation).
 * Once the running cost estimate reaches the configured ceiling, the
 * runner stops launching new chunks and reports why via `stoppedEarly`.
 */
export async function runBatch(opts: RunOptions): Promise<RunResult> {
  const { chunks, config, teacher, progressPath } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? (() => Date.now());

  if (opts.dryRun) {
    const dryRunPlan: DryRunPlanEntry[] = chunks.map((chunk) => ({
      chunk_id: chunk.chunk_id,
      request: buildTeacherRequest(chunk, config),
    }));
    return {
      outcomes: [],
      progress: loadProgress(progressPath),
      stoppedEarly: null,
      dryRunPlan,
    };
  }

  const progress = loadProgress(progressPath);
  const alreadyAttempted = new Set([
    ...progress.doneChunkIds,
    ...progress.failed.map((f) => f.chunk_id),
  ]);
  const pending = chunks.filter((c) => !alreadyAttempted.has(c.chunk_id));

  const outcomes: ChunkGenerationOutcome[] = [];
  let stoppedEarly: RunResult["stoppedEarly"] = null;
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
        const chunk = group[i];

        if (minIntervalMs > 0) {
          const wait = lastRequestAt + minIntervalMs - now();
          if (wait > 0) await sleep(wait);
          lastRequestAt = now();
        }

        const outcome = await processChunk(chunk);

        // Persist first, confirm it's durable, THEN mark done — in that
        // order. onChunkComplete is the caller's chance to write the
        // chunk's pairs somewhere durable (see pairsStore.ts's
        // appendPairsDurable, a synchronous file rewrite) and we await it
        // before touching progress.json at all. If the process dies
        // between these two steps, progress.json still shows the chunk as
        // pending: the next run just reprocesses it (one wasted API call),
        // instead of the chunk being marked "done" on disk while its
        // already-paid-for pairs were never durably recorded anywhere.
        await opts.onChunkComplete?.(outcome);

        if (outcome.status === "ok") {
          progress.doneChunkIds.push(outcome.chunk_id);
        } else {
          progress.failed.push({ chunk_id: outcome.chunk_id, reason: outcome.failureReason ?? "unknown" });
        }
        progress.costUsd = costUsd;
        progress.requestCount = requestCount;
        saveProgress(progressPath, progress);

        outcomes.push(outcome);

        if (config.cost.ceilingUsd != null && costUsd >= config.cost.ceilingUsd) {
          stoppedEarly = { reason: "cost-ceiling" };
        }
      }
    }

    async function processChunk(chunk: Chunk): Promise<ChunkGenerationOutcome> {
      const request = buildTeacherRequest(chunk, config);
      try {
        const response = await withRetry(() => teacher.generate(request), {
          maxRetries: config.maxRetries,
          baseDelayMs: config.retryBaseDelayMs,
          sleep,
        });
        requestCount++;
        costUsd += estimateCost(response.usage, config.cost);
        const { pairs, rejected } = parseTeacherResponse(response.text, chunk);
        return {
          chunk_id: chunk.chunk_id,
          status: pairs.length > 0 ? "ok" : "failed",
          pairs,
          rejected,
          attempts: 1,
          usage: response.usage,
          failureReason: pairs.length > 0 ? undefined : "no valid pairs after parsing/citation checks",
        };
      } catch (err) {
        return {
          chunk_id: chunk.chunk_id,
          status: "failed",
          pairs: [],
          rejected: [],
          attempts: config.maxRetries + 1,
          failureReason: errorMessage(err),
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
