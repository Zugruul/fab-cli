import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/qa/retry.js";
import { FakeApiError } from "./qa.helpers.js";

describe("withRetry", () => {
  it("retries retryable failures (429/5xx) with exponential backoff, then returns the eventual success", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts <= 2) throw new FakeApiError(429);
      return "ok";
    });

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 100, sleep });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0][0]).toBe(100);
    expect(sleep.mock.calls[1][0]).toBe(200);
  });

  it("retries on 5xx the same as 429", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new FakeApiError(503);
      return "recovered";
    });

    const result = await withRetry(fn, { maxRetries: 2, baseDelayMs: 50, sleep });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-retryable error (e.g. 400) and throws immediately", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const err = new FakeApiError(400, "bad request");
    const fn = vi.fn(async () => {
      throw err;
    });

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 100, sleep })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("throws the last error once retries are exhausted", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi.fn(async () => {
      throw new FakeApiError(429);
    });

    await expect(withRetry(fn, { maxRetries: 1, baseDelayMs: 10, sleep })).rejects.toThrow(
      /429/,
    );
    expect(fn).toHaveBeenCalledTimes(2); // initial attempt + 1 retry
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("supports a custom isRetryable predicate", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new Error("transient-marker");
      return "done";
    });

    const result = await withRetry(fn, {
      maxRetries: 2,
      baseDelayMs: 5,
      sleep,
      isRetryable: (err) => err instanceof Error && err.message === "transient-marker",
    });
    expect(result).toBe("done");
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
