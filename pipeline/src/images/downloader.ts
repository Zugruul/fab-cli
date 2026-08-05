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

/**
 * Throws loudly, naming EVERY failed printing and its failureReason, if
 * `outcomes` contains any `status: "failed"` entry — never a silent
 * partial-failure pass-through. `downloadAll` itself never throws on a
 * per-printing failure (a permanent 403/404 stays permanent no matter how
 * many refs are in the batch, so one bad printing must never abort the
 * others' downloads) — that design is correct and unchanged; the failure
 * mode this closes is downstream CALLERS discarding `downloadAll`'s
 * return value entirely (composites/zones/cli.ts's real-data run hit
 * exactly this: a genuine S3 403 for one printing was silently swallowed,
 * and the run crashed much later with a confusing raw sharp "Input file
 * is missing" error instead of a clear message naming the actual failed
 * printing — see composites #256's real-data-run report). Every caller
 * that treats "the images I need are now on disk" as a hard precondition
 * for the next step should call this immediately after `downloadAll`.
 */
export function assertDownloadsSucceeded(outcomes: DownloadOutcome[]): void {
  const failed = outcomes.filter((o) => o.status === "failed");
  if (failed.length === 0) return;
  const details = failed.map((o) => `${o.printingId} (${o.failureReason ?? "unknown reason"})`).join("; ");
  throw new Error(`assertDownloadsSucceeded: ${failed.length} printing image download(s) failed: ${details}`);
}

/** One printing whose image download permanently failed — the
 * download-failures manifest's shape (images/cli.ts writes this; a #268
 * coverage run reads it back to exclude these from the eligible pool and
 * report them as "unavailable upstream", distinct from a run's own
 * coverage shortfall — see composites/coverageReport.ts). */
export interface FailedDownloadSummary {
  printingId: string;
  /** Parsed from the failure reason's "HTTP <n>" substring (see
   * HttpStatusError's message format above) — null when the failure
   * wasn't a clean HTTP status (a network-level error surviving retries,
   * e.g. a DNS failure or connection reset). */
  httpStatus: number | null;
  reason: string;
}

/**
 * Extracts a `downloadAll` outcome list's failed entries only, as a
 * flat, JSON-serializable summary — see this module's assertDownloadsSucceeded
 * doc: that function's abort-on-any-failure behavior stays correct and
 * unchanged for a small run; this is the alternative for a caller that
 * needs to TOLERATE and REPORT permanent failures instead (a 16k-printing
 * coverage run, #268), never silently dropping them.
 */
export function summarizeFailedDownloads(outcomes: DownloadOutcome[]): FailedDownloadSummary[] {
  return outcomes
    .filter((o) => o.status === "failed")
    .map((o) => {
      const reason = o.failureReason ?? "unknown reason";
      const match = reason.match(/HTTP (\d+)/);
      return { printingId: o.printingId, httpStatus: match ? Number(match[1]) : null, reason };
    });
}
