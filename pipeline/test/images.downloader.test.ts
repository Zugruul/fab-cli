import { describe, it, expect, vi } from "vitest";
import { downloadAll } from "../src/images/downloader.js";
import type { DownloadOptions, PrintingImageRef } from "../src/images/types.js";

function ref(id: string, url = `https://example.com/${id}.png`): PrintingImageRef {
  return { printingId: id, printCode: id, cardName: "X", setId: "S", imageUrl: url };
}

function opts(overrides: Partial<DownloadOptions> = {}): DownloadOptions {
  return {
    requestsPerSecond: 0,
    concurrency: 1,
    maxRetries: 2,
    retryBaseDelayMs: 10,
    cacheDir: "/cache",
    ...overrides,
  };
}

function okResponse(bytes: number[] = [1]) {
  return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(bytes).buffer };
}

function errResponse(status: number) {
  return { ok: false, status, arrayBuffer: async () => new ArrayBuffer(0) };
}

describe("downloadAll — cache", () => {
  it("never calls fetch for a printing whose cache file already exists (cache hit)", async () => {
    const fetchFn = vi.fn();
    const outcomes = await downloadAll([ref("p1")], opts(), {
      fetchFn,
      fileExists: (p) => p === "/cache/p1.png",
      writeFile: vi.fn(),
      ensureDir: vi.fn(),
      sleep: vi.fn(async () => {}),
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ printingId: "p1", status: "cached", path: "/cache/p1.png", attempts: 0 }]);
  });

  it("downloads and writes to the cache path when not already cached", async () => {
    const writeFile = vi.fn();
    const fetchFn = vi.fn(async () => okResponse([1, 2, 3]));
    const outcomes = await downloadAll([ref("p1")], opts(), {
      fetchFn,
      fileExists: () => false,
      writeFile,
      ensureDir: vi.fn(),
      sleep: vi.fn(async () => {}),
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith("https://example.com/p1.png");
    expect(writeFile).toHaveBeenCalledWith("/cache/p1.png", Buffer.from([1, 2, 3]));
    expect(outcomes).toEqual([{ printingId: "p1", status: "downloaded", path: "/cache/p1.png", attempts: 1 }]);
  });

  it("ensures the cache directory exists before doing any work", async () => {
    const ensureDir = vi.fn();
    await downloadAll([ref("p1")], opts(), {
      fetchFn: vi.fn(async () => okResponse()),
      fileExists: () => false,
      writeFile: vi.fn(),
      ensureDir,
      sleep: vi.fn(async () => {}),
    });
    expect(ensureDir).toHaveBeenCalledWith("/cache");
  });

  it("resumes correctly across a mix of cached and not-yet-cached printings, only fetching the latter", async () => {
    const fetchFn = vi.fn(async () => okResponse());
    const outcomes = await downloadAll([ref("p1"), ref("p2"), ref("p3")], opts(), {
      fetchFn,
      fileExists: (p) => p === "/cache/p2.png",
      writeFile: vi.fn(),
      ensureDir: vi.fn(),
      sleep: vi.fn(async () => {}),
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const byId = Object.fromEntries(outcomes.map((o) => [o.printingId, o.status]));
    expect(byId).toEqual({ p1: "downloaded", p2: "cached", p3: "downloaded" });
  });
});

describe("downloadAll — retry with backoff", () => {
  it("retries a transient (5xx) failure with exponential backoff, then succeeds", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls++;
      return calls < 3 ? errResponse(503) : okResponse();
    });
    const sleep = vi.fn(async () => {});
    const outcomes = await downloadAll([ref("p1")], opts({ maxRetries: 3, retryBaseDelayMs: 100 }), {
      fetchFn,
      fileExists: () => false,
      writeFile: vi.fn(),
      ensureDir: vi.fn(),
      sleep,
    });
    expect(outcomes[0]).toMatchObject({ status: "downloaded", attempts: 3 });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0][0]).toBe(100);
    expect(sleep.mock.calls[1][0]).toBe(200);
  });

  it("retries a 429 the same as a 5xx", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls++;
      return calls === 1 ? errResponse(429) : okResponse();
    });
    const outcomes = await downloadAll([ref("p1")], opts(), {
      fetchFn,
      fileExists: () => false,
      writeFile: vi.fn(),
      ensureDir: vi.fn(),
      sleep: vi.fn(async () => {}),
    });
    expect(outcomes[0]).toMatchObject({ status: "downloaded", attempts: 2 });
  });

  it("retries a plain network-level throw (no status — e.g. DNS/connection failure) as transient", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return okResponse();
    });
    const outcomes = await downloadAll([ref("p1")], opts(), {
      fetchFn,
      fileExists: () => false,
      writeFile: vi.fn(),
      ensureDir: vi.fn(),
      sleep: vi.fn(async () => {}),
    });
    expect(outcomes[0]).toMatchObject({ status: "downloaded", attempts: 2 });
  });

  it("does not retry a non-retryable client error (404) — fails immediately, no sleep", async () => {
    const fetchFn = vi.fn(async () => errResponse(404));
    const sleep = vi.fn(async () => {});
    const outcomes = await downloadAll([ref("p1")], opts({ maxRetries: 3 }), {
      fetchFn,
      fileExists: () => false,
      writeFile: vi.fn(),
      ensureDir: vi.fn(),
      sleep,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(outcomes[0].status).toBe("failed");
    expect(outcomes[0].failureReason).toMatch(/404/);
  });

  it("records failed (not thrown) after retries are exhausted against a persistent 5xx", async () => {
    const fetchFn = vi.fn(async () => errResponse(500));
    const outcomes = await downloadAll([ref("p1")], opts({ maxRetries: 2, retryBaseDelayMs: 5 }), {
      fetchFn,
      fileExists: () => false,
      writeFile: vi.fn(),
      ensureDir: vi.fn(),
      sleep: vi.fn(async () => {}),
    });
    expect(fetchFn).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
    expect(outcomes[0].status).toBe("failed");
    expect(outcomes[0].path).toBe("/cache/p1.png");
  });

  it("never writes to the cache path when every attempt fails", async () => {
    const writeFile = vi.fn();
    await downloadAll([ref("p1")], opts({ maxRetries: 1 }), {
      fetchFn: vi.fn(async () => errResponse(500)),
      fileExists: () => false,
      writeFile,
      ensureDir: vi.fn(),
      sleep: vi.fn(async () => {}),
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("isolates one printing's total failure from the rest of the batch", async () => {
    const fetchFn = vi.fn(async (url: string) => (url.includes("bad") ? errResponse(500) : okResponse()));
    const outcomes = await downloadAll(
      [ref("good1"), ref("bad", "https://example.com/bad.png"), ref("good2")],
      opts({ maxRetries: 0 }),
      { fetchFn, fileExists: () => false, writeFile: vi.fn(), ensureDir: vi.fn(), sleep: vi.fn(async () => {}) },
    );
    const byId = Object.fromEntries(outcomes.map((o) => [o.printingId, o.status]));
    expect(byId).toEqual({ good1: "downloaded", bad: "failed", good2: "downloaded" });
  });
});

describe("downloadAll — rate limiting", () => {
  it("spaces request starts to respect requestsPerSecond, via the injected clock", async () => {
    let simulatedNow = 0;
    const sleep = vi.fn(async (ms: number) => {
      simulatedNow += ms;
    });
    const fetchFn = vi.fn(async () => okResponse());
    await downloadAll([ref("p1"), ref("p2"), ref("p3")], opts({ requestsPerSecond: 2, concurrency: 1 }), {
      fetchFn,
      fileExists: () => false,
      writeFile: vi.fn(),
      ensureDir: vi.fn(),
      sleep,
      now: () => simulatedNow,
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    // concurrency 1 => strictly sequential; 2 rps => >= 500ms between starts.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0][0]).toBe(500);
    expect(sleep.mock.calls[1][0]).toBe(500);
  });

  it("does not gate cache hits behind the rate limiter — a cached printing never waits", async () => {
    let simulatedNow = 0;
    const sleep = vi.fn(async (ms: number) => {
      simulatedNow += ms;
    });
    const outcomes = await downloadAll([ref("p1"), ref("p2")], opts({ requestsPerSecond: 1, concurrency: 1 }), {
      fetchFn: vi.fn(async () => okResponse()),
      fileExists: (p) => p === "/cache/p1.png" || p === "/cache/p2.png",
      writeFile: vi.fn(),
      ensureDir: vi.fn(),
      sleep,
      now: () => simulatedNow,
    });
    expect(outcomes.every((o) => o.status === "cached")).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("applies no rate limiting at all when requestsPerSecond is 0", async () => {
    const sleep = vi.fn(async () => {});
    await downloadAll([ref("p1"), ref("p2")], opts({ requestsPerSecond: 0, concurrency: 1 }), {
      fetchFn: vi.fn(async () => okResponse()),
      fileExists: () => false,
      writeFile: vi.fn(),
      ensureDir: vi.fn(),
      sleep,
    });
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("downloadAll — concurrency", () => {
  it("never runs more than `concurrency` fetches at once, but does use all of it", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchFn = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return okResponse();
    });
    const outcomes = await downloadAll(
      [ref("p1"), ref("p2"), ref("p3"), ref("p4")],
      opts({ requestsPerSecond: 0, concurrency: 2 }),
      { fetchFn, fileExists: () => false, writeFile: vi.fn(), ensureDir: vi.fn(), sleep: vi.fn(async () => {}) },
    );
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(outcomes).toHaveLength(4);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(1); // proves real overlap happened, not accidental serialization
  });

  it("caps concurrency at the number of printings when concurrency exceeds the batch size", async () => {
    const fetchFn = vi.fn(async () => okResponse());
    const outcomes = await downloadAll([ref("p1")], opts({ concurrency: 10 }), {
      fetchFn,
      fileExists: () => false,
      writeFile: vi.fn(),
      ensureDir: vi.fn(),
      sleep: vi.fn(async () => {}),
    });
    expect(outcomes).toHaveLength(1);
  });

  it("returns an empty array for an empty ref list without touching any dep", async () => {
    const fetchFn = vi.fn();
    const ensureDir = vi.fn();
    const outcomes = await downloadAll([], opts(), {
      fetchFn,
      fileExists: () => false,
      writeFile: vi.fn(),
      ensureDir,
      sleep: vi.fn(async () => {}),
    });
    expect(outcomes).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
