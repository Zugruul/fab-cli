/**
 * Generic retry-with-exponential-backoff helper, used to wrap teacher API
 * calls (SPEC-APP.md §7.3: "retries with backoff on 429/5xx"). Independent
 * of the Anthropic SDK so it's trivially testable with fake errors/clocks.
 */
export interface RetryOptions {
  /** Number of retries on top of the initial attempt. */
  maxRetries: number;
  baseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
  /** Defaults to: retry on an HTTP-style `status` of 429 or 5xx. */
  isRetryable?: (err: unknown) => boolean;
}

function defaultIsRetryable(err: unknown): boolean {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  return status === 429 || (typeof status === "number" && status >= 500 && status < 600);
}

/**
 * Runs `fn`, retrying on retryable failures with exponential backoff
 * (`baseDelayMs * 2^attempt`). A non-retryable error (per `isRetryable`)
 * throws immediately without sleeping. After `maxRetries` retries are
 * exhausted, the last error is re-thrown.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.maxRetries || !isRetryable(err)) throw err;
      const delay = opts.baseDelayMs * 2 ** attempt;
      await opts.sleep(delay);
      attempt++;
    }
  }
}
