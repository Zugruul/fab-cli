import { withRetry } from "../qa/retry.js";
import { cachePathFor } from "./cache.js";
import type { DownloadOptions, DownloadOutcome, PrintingImageRef } from "./types.js";

/** Minimal shape of a fetch Response this module actually needs — lets
 * tests inject a fake without depending on the real global fetch/Response
 * types (mirrors qa/types.ts's TeacherClient injection pattern). */
export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface DownloadDeps {
  fetchFn: (url: string) => Promise<FetchLikeResponse>;
  fileExists: (path: string) => boolean;
  writeFile: (path: string, data: Buffer) => void;
  /** Same-filesystem atomic rename (`from` -> `to`) — see the doc comment
   * on the write inside `downloadAll` for why every write goes through
   * write-to-tmp-then-rename rather than writing `to` directly. */
  rename: (from: string, to: string) => void;
  ensureDir: (dir: string) => void;
  /** Injectable clock + sleep for deterministic rate-limit/backoff testing
   * — same contract as qa/runner.ts's RunOptions. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** A 429/5xx is retryable, same as qa/retry.ts's default. A thrown error
 * with no numeric `status` (DNS failure, connection reset, timeout — a
 * plain fetch() rejection) is also treated as transient, since those are
 * exactly the network-level hiccups §8.7a's "retry with backoff on
 * transient failures" is meant to cover. Any other status (404, 403, etc.)
 * is a permanent, semantic failure — retrying won't fetch a different
 * image, so it fails immediately. */
function isRetryableDownloadError(err: unknown): boolean {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  if (typeof status === "number") return status === 429 || (status >= 500 && status < 600);
  return true;
}

class HttpStatusError extends Error {
  status: number;
  constructor(status: number, url: string) {
    super(`fetch failed: HTTP ${status} for ${url}`);
    this.status = status;
  }
}

let tmpSuffixCounter = 0;

/** A same-process-unique temp filename suffix — pid + a monotonic counter
 * is enough (no two writes for the same destPath ever run concurrently,
 * since each printing has its own destPath and a worker only ever has one
 * write in flight at a time), no need for Date.now()/crypto randomness. */
function tmpPathFor(destPath: string): string {
  return `${destPath}.tmp-${process.pid}-${tmpSuffixCounter++}`;
}

/**
 * Downloads every ref not already cached, respecting `concurrency` and
 * `requestsPerSecond` (0 disables rate limiting), retrying transient
 * failures with exponential backoff (reusing qa/retry.ts's withRetry
 * unmodified) before recording a printing as failed. A cache hit
 * (`fileExists` true for the ref's cache path) short-circuits before any
 * fetch call or rate-limit wait — this is what makes re-running the
 * downloader over an already-populated cache dir free and resume-safe.
 *
 * Mirrors qa/runner.ts's worker-pool shape (shared cursor + lastRequestAt
 * across a fixed pool of async workers) rather than introducing a new
 * generic scheduler abstraction.
 *
 * The rate-limit gate runs inside withRetry's callback — i.e. on EVERY
 * attempt, not just the first — so a retry storm during a transient
 * outage still respects `requestsPerSecond` instead of being paced by
 * backoff alone (PR #235 review round 1, item 1).
 *
 * Each successful fetch is written to a `.tmp-*` sibling of destPath first,
 * then atomically renamed into place (mirrors dataset/write.ts's
 * write-tmp-then-rename pattern) — so a kill/OOM/disk-full mid-write can
 * never leave a truncated file at destPath for a later run's `fileExists`
 * cache-hit check to mistake for a complete, valid image (PR #235 review
 * round 1, item 2).
 */
export async function downloadAll(
  refs: PrintingImageRef[],
  options: DownloadOptions,
  deps: DownloadDeps,
): Promise<DownloadOutcome[]> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => Date.now());

  deps.ensureDir(options.cacheDir);

  const outcomes: DownloadOutcome[] = [];
  let cursor = 0;
  let lastRequestAt = -Infinity;
  const minIntervalMs = options.requestsPerSecond > 0 ? 1000 / options.requestsPerSecond : 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= refs.length) return;
      const ref = refs[i];
      const destPath = cachePathFor(options.cacheDir, ref);

      if (deps.fileExists(destPath)) {
        outcomes.push({ printingId: ref.printingId, status: "cached", path: destPath, attempts: 0 });
        continue;
      }

      let attempts = 0;
      try {
        await withRetry(
          async () => {
            if (minIntervalMs > 0) {
              const wait = lastRequestAt + minIntervalMs - now();
              if (wait > 0) await sleep(wait);
              lastRequestAt = now();
            }

            attempts++;
            const res = await deps.fetchFn(ref.imageUrl);
            if (!res.ok) throw new HttpStatusError(res.status, ref.imageUrl);
            const buf = Buffer.from(await res.arrayBuffer());

            const tmpPath = tmpPathFor(destPath);
            deps.writeFile(tmpPath, buf);
            deps.rename(tmpPath, destPath);
          },
          {
            maxRetries: options.maxRetries,
            baseDelayMs: options.retryBaseDelayMs,
            sleep,
            isRetryable: isRetryableDownloadError,
          },
        );
        outcomes.push({ printingId: ref.printingId, status: "downloaded", path: destPath, attempts });
      } catch (err) {
        outcomes.push({
          printingId: ref.printingId,
          status: "failed",
          path: destPath,
          attempts,
          failureReason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const workerCount = Math.max(1, Math.min(options.concurrency, refs.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return outcomes;
}
