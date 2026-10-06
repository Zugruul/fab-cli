import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThrottle, type ThrottleOptions } from "../src/throttle";

class HttpErr extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

const base: ThrottleOptions = {
  concurrency: 4,
  minIntervalMs: 250,
  maxRetries: 5,
  baseBackoffMs: 2000,
  maxBackoffMs: 30000,
  shouldRetry: (e) =>
    e instanceof HttpErr && (e.status === 403 || e.status === 429),
};

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("createThrottle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never exceeds the concurrency cap and completes every task", async () => {
    const run = createThrottle({ ...base, minIntervalMs: 0 });
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, (_, i) =>
      run(async () => {
        active++;
        peak = Math.max(peak, active);
        await delay(100);
        active--;
        return i;
      }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(peak).toBe(4);
  });

  it("spaces request starts by minIntervalMs even when slots are free", async () => {
    const run = createThrottle(base);
    const starts: number[] = [];
    const tasks = Array.from({ length: 4 }, () =>
      run(async () => {
        starts.push(Date.now());
      }),
    );
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all(tasks);
    const t0 = starts[0];
    expect(starts.map((s) => s - t0)).toEqual([0, 250, 500, 750]);
  });

  it("retries a 403 with exponential backoff and reports each delay", async () => {
    const onRetry = vi.fn();
    const run = createThrottle({ ...base, minIntervalMs: 0, onRetry });
    let calls = 0;
    let okAt = -1;
    const t0 = Date.now();
    const p = run(async () => {
      calls++;
      if (calls <= 2) throw new HttpErr(403);
      okAt = Date.now() - t0;
      return "ok";
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await p).toBe("ok");
    expect(calls).toBe(3);
    expect(onRetry.mock.calls.map((c) => c[0].delayMs)).toEqual([2000, 4000]);
    expect(okAt).toBe(6000);
  });

  it("does not retry a non-retryable error", async () => {
    const run = createThrottle({ ...base, minIntervalMs: 0 });
    let calls = 0;
    const p = run(async () => {
      calls++;
      throw new HttpErr(500);
    });
    await expect(p).rejects.toThrow("HTTP 500");
    expect(calls).toBe(1);
  });

  it("gives up after maxRetries and rethrows the last error", async () => {
    const run = createThrottle({ ...base, minIntervalMs: 0, maxRetries: 2 });
    let calls = 0;
    const p = run(async () => {
      calls++;
      throw new HttpErr(403);
    });
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(20000);
    await expect(p).rejects.toThrow("HTTP 403");
    expect(calls).toBe(3);
  });

  it("caps backoff at maxBackoffMs", async () => {
    const onRetry = vi.fn();
    const run = createThrottle({
      ...base,
      minIntervalMs: 0,
      maxRetries: 4,
      maxBackoffMs: 5000,
      onRetry,
    });
    let calls = 0;
    const p = run(async () => {
      calls++;
      if (calls <= 4) throw new HttpErr(429);
      return 1;
    });
    await vi.advanceTimersByTimeAsync(60000);
    await p;
    expect(onRetry.mock.calls.map((c) => c[0].delayMs)).toEqual([
      2000, 4000, 5000, 5000,
    ]);
  });

  it("pauses other waiting workers during a backoff instead of letting them burst", async () => {
    const run = createThrottle({ ...base, concurrency: 1, minIntervalMs: 0 });
    const t0 = Date.now();
    let aCalls = 0;
    const a = run(async () => {
      aCalls++;
      if (aCalls === 1) throw new HttpErr(403);
      return "a";
    });
    let bStart = -1;
    const b = run(async () => {
      bStart = Date.now() - t0;
      return "b";
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await a).toBe("a");
    expect(await b).toBe("b");
    // A failed at t=0 and backed off 2000ms; B must not start before that cooldown ends.
    expect(bStart).toBeGreaterThanOrEqual(2000);
  });
});
