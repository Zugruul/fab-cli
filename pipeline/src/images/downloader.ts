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

      if (minIntervalMs > 0) {
        const wait = lastRequestAt + minIntervalMs - now();
        if (wait > 0) await sleep(wait);
        lastRequestAt = now();
      }

      let attempts = 0;
      try {
        await withRetry(
          async () => {
            attempts++;
            const res = await deps.fetchFn(ref.imageUrl);
            if (!res.ok) throw new HttpStatusError(res.status, ref.imageUrl);
            const buf = Buffer.from(await res.arrayBuffer());
            deps.writeFile(destPath, buf);
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
