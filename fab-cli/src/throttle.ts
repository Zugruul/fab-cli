/**
 * Shared request throttle: caps concurrency, spaces request starts, and on a
 * retryable failure (e.g. AWS WAF 403) backs off exponentially while pausing
 * every other worker, so one tripped limit never turns into a sustained burst.
 *
 * Pure and injectable (sleep/now) so it is unit-testable with fake timers.
 */

export interface ThrottleOptions {
  /** Max requests in flight at once. */
  concurrency: number;
  /** Minimum gap between consecutive request starts, in ms. */
  minIntervalMs: number;
  /** Retries after the first attempt before giving up. */
  maxRetries: number;
  /** First backoff delay; doubles per retry, capped at maxBackoffMs. */
  baseBackoffMs: number;
  maxBackoffMs: number;
  /** Decide whether an error is a rate-limit worth retrying. */
  shouldRetry: (err: unknown) => boolean;
  /** Observer hook for logging. */
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export type Throttle = <T>(fn: () => Promise<T>) => Promise<T>;

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

export function createThrottle(opts: ThrottleOptions): Throttle {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const concurrency = Math.max(1, opts.concurrency);

  let active = 0;
  const waiters: Array<() => void> = [];
  let lastStart = -Infinity;
  // Global cooldown: no worker starts a request before this timestamp.
  let pausedUntil = -Infinity;

  async function acquire(): Promise<void> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    active++;
  }

  function release(): void {
    active--;
    const next = waiters.shift();
    if (next) next();
  }

  async function waitForSlot(): Promise<void> {
    for (;;) {
      const t = now();
      const wait = Math.max(
        lastStart + opts.minIntervalMs - t,
        pausedUntil - t,
      );
      if (wait <= 0) break;
      await sleep(wait);
    }
    // No await between the check above and this assignment, so concurrent
    // workers observe each other's start times and stay spaced.
    lastStart = now();
  }

  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      for (let attempt = 0; ; attempt++) {
        await waitForSlot();
        try {
          return await fn();
        } catch (err) {
          if (attempt >= opts.maxRetries || !opts.shouldRetry(err)) throw err;
          const delayMs = Math.min(
            opts.baseBackoffMs * 2 ** attempt,
            opts.maxBackoffMs,
          );
          pausedUntil = Math.max(pausedUntil, now() + delayMs);
          opts.onRetry?.({ attempt: attempt + 1, delayMs, error: err });
          await sleep(delayMs);
        }
      }
    } finally {
      release();
    }
  };
}

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Defaults tuned for Fabrary's AppSync WAF (bursts of ~40 trip it; 4/s with backoff does not). */
export function throttleDefaultsFromEnv(): Omit<
  ThrottleOptions,
  "shouldRetry" | "onRetry"
> {
  return {
    concurrency: envInt("FAB_GQL_CONCURRENCY", 4),
    minIntervalMs: envInt("FAB_GQL_MIN_INTERVAL_MS", 250),
    maxRetries: envInt("FAB_GQL_MAX_RETRIES", 5),
    baseBackoffMs: envInt("FAB_GQL_BACKOFF_MS", 2000),
    maxBackoffMs: envInt("FAB_GQL_MAX_BACKOFF_MS", 30000),
  };
}
