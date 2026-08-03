/**
 * Printing-image dataset builder (SPEC-APP.md §8.7a, APP-025): rate-limited,
 * cached downloader for catalog printing images — training-host tooling
 * only, images are never committed to git (see pipeline/out/.gitignore's
 * parent, the repo-root .gitignore's `pipeline/out/` rule, and
 * test/noCommitGuard.test.ts).
 */

/** One printing worth downloading, extracted from the-fab-cube's vendored
 * card.json (see catalog.ts for why `printingId` is the printing's own
 * `unique_id`, not the human-readable set+number `id`). */
export interface PrintingImageRef {
  printingId: string;
  printCode: string;
  cardName: string;
  setId: string;
  imageUrl: string;
}

export interface DownloadOptions {
  /** 0 disables rate limiting entirely. */
  requestsPerSecond: number;
  concurrency: number;
  /** Retries applied on top of the initial attempt, per printing. */
  maxRetries: number;
  retryBaseDelayMs: number;
  cacheDir: string;
}

/** Conservative by design (§8.7a: "rate limiting and caching") — this hits a
 * public image host during dataset building, not an API with a published
 * quota, so err on the side of being a polite, slow client. */
export const DEFAULT_DOWNLOAD_OPTIONS: DownloadOptions = {
  requestsPerSecond: 2,
  concurrency: 2,
  maxRetries: 3,
  retryBaseDelayMs: 500,
  cacheDir: "out/images",
};

export type DownloadStatus = "cached" | "downloaded" | "failed";

export interface DownloadOutcome {
  printingId: string;
  status: DownloadStatus;
  path: string;
  /** 0 for a cache hit (no network call at all); otherwise the number of
   * fetch attempts actually made (1 = succeeded first try). */
  attempts: number;
  /** Present only when status is "failed". */
  failureReason?: string;
}
