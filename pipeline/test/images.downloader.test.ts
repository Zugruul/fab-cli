import { describe, it, expect, vi } from "vitest";
import { downloadAll } from "../src/images/downloader.js";
import type { DownloadDeps } from "../src/images/downloader.js";
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

/** Sensible no-op defaults for every dep, overridable per test — keeps each
 * test's object literal down to just what it actually cares about, and
 * means adding a new required dep (e.g. `rename`) only touches one place. */
function baseDeps(overrides: Partial<DownloadDeps> = {}): DownloadDeps {
  return {
    fetchFn: vi.fn(async () => okResponse()),
    fileExists: () => false,
    writeFile: vi.fn(),
    rename: vi.fn(),
    ensureDir: vi.fn(),
    sleep: vi.fn(async (_ms: number) => {}),
    ...overrides,
  };
}

describe("downloadAll — cache", () => {
  it("never calls fetch for a printing whose cache file already exists (cache hit)", async () => {
    const fetchFn = vi.fn();
    const outcomes = await downloadAll(
      [ref("p1")],
      opts(),
      baseDeps({ fetchFn, fileExists: (p) => p === "/cache/p1.png" }),
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ printingId: "p1", status: "cached", path: "/cache/p1.png", attempts: 0 }]);
  });

  it("downloads and writes to the cache path when not already cached", async () => {
    const writeFile = vi.fn();
    const rename = vi.fn();
    const fetchFn = vi.fn(async () => okResponse([1, 2, 3]));
    const outcomes = await downloadAll([ref("p1")], opts(), baseDeps({ fetchFn, writeFile, rename }));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith("https://example.com/p1.png");
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenData] = writeFile.mock.calls[0];
    expect(writtenPath).toMatch(/^\/cache\/p1\.png\.tmp-/);
    expect(writtenData).toEqual(Buffer.from([1, 2, 3]));
    expect(rename).toHaveBeenCalledWith(writtenPath, "/cache/p1.png");
    expect(outcomes).toEqual([{ printingId: "p1", status: "downloaded", path: "/cache/p1.png", attempts: 1 }]);
  });

  it("ensures the cache directory exists before doing any work", async () => {
    const ensureDir = vi.fn();
    await downloadAll([ref("p1")], opts(), baseDeps({ ensureDir }));
    expect(ensureDir).toHaveBeenCalledWith("/cache");
  });

  it("resumes correctly across a mix of cached and not-yet-cached printings, only fetching the latter", async () => {
    const fetchFn = vi.fn(async () => okResponse());
    const outcomes = await downloadAll(
      [ref("p1"), ref("p2"), ref("p3")],
      opts(),
      baseDeps({ fetchFn, fileExists: (p) => p === "/cache/p2.png" }),
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const byId = Object.fromEntries(outcomes.map((o) => [o.printingId, o.status]));
    expect(byId).toEqual({ p1: "downloaded", p2: "cached", p3: "downloaded" });
  });
});

describe("downloadAll — atomic cache write", () => {
  it("writes to a temp file then renames it into place, rather than writing directly to the final path", async () => {
    const writeFile = vi.fn();
    const rename = vi.fn();
    const outcomes = await downloadAll(
      [ref("p1")],
      opts(),
      baseDeps({ fetchFn: vi.fn(async () => okResponse([9, 9])), writeFile, rename }),
    );
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [tmpPath] = writeFile.mock.calls[0];
    expect(tmpPath).not.toBe("/cache/p1.png");
    expect(tmpPath).toMatch(/^\/cache\/p1\.png\.tmp-/);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledWith(tmpPath, "/cache/p1.png");
    expect(outcomes[0]).toMatchObject({ status: "downloaded", path: "/cache/p1.png" });
  });

  it("never renames into place — no final file ever appears — when the write itself throws mid-attempt", async () => {
    const rename = vi.fn();
    const writeFile = vi.fn(() => {
      throw new Error("disk full");
    });
    const outcomes = await downloadAll(
      [ref("p1")],
      opts({ maxRetries: 0 }),
      baseDeps({ writeFile, rename }),
    );
    expect(rename).not.toHaveBeenCalled();
    expect(outcomes[0].status).toBe("failed");
    expect(outcomes[0].failureReason).toMatch(/disk full/);
  });

  it("never consults a tmp path for the cache-hit check — only the real final destPath is ever queried", async () => {
    // Simulates a stale `.tmp-*` leftover from a previous crashed run sitting
    // next to (but not at) the real destPath: fileExists must never be asked
    // about anything tmp-shaped, only the final path — a cache-hit check
    // that accidentally queried the tmp name would be a real bug (either a
    // false cache-hit on a half-written leftover, or an unnecessary check).
    const fileExists = vi.fn((p: string) => {
      if (p.includes(".tmp-")) throw new Error("must never check a tmp path for cache-hit existence");
      return false;
    });
    const outcomes = await downloadAll([ref("p1")], opts(), baseDeps({ fileExists }));
    expect(outcomes[0].status).toBe("downloaded");
  });
});

describe("downloadAll — retry with backoff", () => {
  it("retries a transient (5xx) failure with exponential backoff, then succeeds", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls++;
      return calls < 3 ? errResponse(503) : okResponse();
    });
    const sleep = vi.fn(async (_ms: number) => {});
    const outcomes = await downloadAll(
      [ref("p1")],
      opts({ maxRetries: 3, retryBaseDelayMs: 100 }),
      baseDeps({ fetchFn, sleep }),
    );
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
    const outcomes = await downloadAll([ref("p1")], opts(), baseDeps({ fetchFn }));
    expect(outcomes[0]).toMatchObject({ status: "downloaded", attempts: 2 });
  });

  it("retries a plain network-level throw (no status — e.g. DNS/connection failure) as transient", async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return okResponse();
    });
    const outcomes = await downloadAll([ref("p1")], opts(), baseDeps({ fetchFn }));
    expect(outcomes[0]).toMatchObject({ status: "downloaded", attempts: 2 });
  });

  it("does not retry a non-retryable client error (404) — fails immediately, no sleep", async () => {
    const fetchFn = vi.fn(async () => errResponse(404));
    const sleep = vi.fn(async (_ms: number) => {});
    const outcomes = await downloadAll([ref("p1")], opts({ maxRetries: 3 }), baseDeps({ fetchFn, sleep }));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(outcomes[0].status).toBe("failed");
    expect(outcomes[0].failureReason).toMatch(/404/);
  });

  it("records failed (not thrown) after retries are exhausted against a persistent 5xx", async () => {
    const fetchFn = vi.fn(async () => errResponse(500));
    const outcomes = await downloadAll(
      [ref("p1")],
      opts({ maxRetries: 2, retryBaseDelayMs: 5 }),
      baseDeps({ fetchFn }),
    );
    expect(fetchFn).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
    expect(outcomes[0].status).toBe("failed");
    expect(outcomes[0].path).toBe("/cache/p1.png");
  });

  it("never writes to the cache path when every attempt fails", async () => {
    const writeFile = vi.fn();
    await downloadAll(
      [ref("p1")],
      opts({ maxRetries: 1 }),
      baseDeps({ fetchFn: vi.fn(async () => errResponse(500)), writeFile }),
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("isolates one printing's total failure from the rest of the batch", async () => {
    const fetchFn = vi.fn(async (url: string) => (url.includes("bad") ? errResponse(500) : okResponse()));
    const outcomes = await downloadAll(
      [ref("good1"), ref("bad", "https://example.com/bad.png"), ref("good2")],
      opts({ maxRetries: 0 }),
      baseDeps({ fetchFn }),
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
    await downloadAll(
      [ref("p1"), ref("p2"), ref("p3")],
      opts({ requestsPerSecond: 2, concurrency: 1 }),
      baseDeps({ fetchFn, sleep, now: () => simulatedNow }),
    );
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
    const outcomes = await downloadAll(
      [ref("p1"), ref("p2")],
      opts({ requestsPerSecond: 1, concurrency: 1 }),
      baseDeps({
        fileExists: (p) => p === "/cache/p1.png" || p === "/cache/p2.png",
        sleep,
        now: () => simulatedNow,
      }),
    );
    expect(outcomes.every((o) => o.status === "cached")).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("applies no rate limiting at all when requestsPerSecond is 0", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    await downloadAll([ref("p1"), ref("p2")], opts({ requestsPerSecond: 0, concurrency: 1 }), baseDeps({ sleep }));
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gates EVERY retry attempt, not just the first — a retry storm still respects requestsPerSecond", async () => {
    // Regression test (PR #235 review round 1, item 1): the rate-limit gate
    // used to run once before entering withRetry, so only a printing's
    // FIRST attempt was spaced by requestsPerSecond — retry attempts were
    // paced only by exponential backoff, exceeding the rps cap exactly
    // during a transient-outage retry storm. concurrency:1 is deliberate
    // here (not a limitation of the fix) — it's what makes the exact sleep
    // call sequence below fully deterministic to assert against; see the
    // "concurrency" describe block for concurrent-worker coverage.
    let simulatedNow = 0;
    const sleep = vi.fn(async (ms: number) => {
      simulatedNow += ms;
    });
    let ref2Calls = 0;
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("ref2")) {
        ref2Calls++;
        return ref2Calls < 2 ? errResponse(503) : okResponse();
      }
      return okResponse();
    });

    const outcomes = await downloadAll(
      [ref("ref1"), ref("ref2")],
      opts({ requestsPerSecond: 2, concurrency: 1, maxRetries: 1, retryBaseDelayMs: 50 }),
      baseDeps({ fetchFn, sleep, now: () => simulatedNow }),
    );

    expect(fetchFn).toHaveBeenCalledTimes(3); // ref1: 1 attempt, ref2: fails once then succeeds
    expect(outcomes).toEqual([
      { printingId: "ref1", status: "downloaded", path: "/cache/ref1.png", attempts: 1 },
      { printingId: "ref2", status: "downloaded", path: "/cache/ref2.png", attempts: 2 },
    ]);
    // ref1's first (only) attempt isn't gated (nothing came before it).
    // ref2's first attempt IS gated by the 2rps cap (500ms since ref1).
    // ref2's failed attempt backs off 50ms (retryBaseDelayMs * 2^0).
    // ref2's RETRY attempt is ALSO gated by the rate limiter (450ms more,
    // to reach a full 500ms since ref2's own first attempt) — this third
    // sleep call is exactly what the pre-fix code never produced.
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 50, 450]);
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
      baseDeps({ fetchFn }),
    );
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(outcomes).toHaveLength(4);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(1); // proves real overlap happened, not accidental serialization
  });

  it("caps concurrency at the number of printings when concurrency exceeds the batch size", async () => {
    const fetchFn = vi.fn(async () => okResponse());
    const outcomes = await downloadAll([ref("p1")], opts({ concurrency: 10 }), baseDeps({ fetchFn }));
    expect(outcomes).toHaveLength(1);
  });

  it("returns an empty array for an empty ref list without touching any dep", async () => {
    const fetchFn = vi.fn();
    const ensureDir = vi.fn();
    const outcomes = await downloadAll([], opts(), baseDeps({ fetchFn, ensureDir }));
    expect(outcomes).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

// #256 real-data-run bug: a real broadcast-mode run hit a genuine S3 403
// for one printing (Helm of the Arknight, AVS003 — downloadAll correctly
// returns status:"failed" for it, isRetryableDownloadError treats a 403 as
// permanent), but the CALLER (zones/cli.ts's shared ensureImagesDownloaded)
// discarded downloadAll's return value entirely — the failure was silently
// swallowed, and the run crashed much later and more confusingly with a
// raw sharp "Input file is missing" error instead of a clear message
// naming the actual failed printing. assertDownloadsSucceeded closes that
// gap: a loud, actionable error at the download step itself, never a
// silent partial-failure pass-through.
describe("assertDownloadsSucceeded", () => {
  it("does not throw when every outcome succeeded (cached or downloaded)", async () => {
    const { assertDownloadsSucceeded } = await import("../src/images/downloader.js");
    expect(() =>
      assertDownloadsSucceeded([
        { printingId: "p1", status: "cached", path: "/cache/p1.png", attempts: 0 },
        { printingId: "p2", status: "downloaded", path: "/cache/p2.png", attempts: 1 },
      ]),
    ).not.toThrow();
  });

  it("throws, naming every failed printingId and its failureReason, when any outcome failed", async () => {
    const { assertDownloadsSucceeded } = await import("../src/images/downloader.js");
    expect(() =>
      assertDownloadsSucceeded([
        { printingId: "p1", status: "cached", path: "/cache/p1.png", attempts: 0 },
        { printingId: "p2", status: "failed", path: "/cache/p2.png", attempts: 3, failureReason: "HTTP 403" },
      ]),
    ).toThrow(/p2.*HTTP 403/s);
  });

  it("reports EVERY failed printing, not just the first, when multiple fail", async () => {
    const { assertDownloadsSucceeded } = await import("../src/images/downloader.js");
    let thrown: Error | undefined;
    try {
      assertDownloadsSucceeded([
        { printingId: "p1", status: "failed", path: "/cache/p1.png", attempts: 3, failureReason: "HTTP 404" },
        { printingId: "p2", status: "failed", path: "/cache/p2.png", attempts: 3, failureReason: "HTTP 403" },
      ]);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toMatch(/p1/);
    expect(thrown?.message).toMatch(/p2/);
  });

  it("is a no-op (never throws) for an empty outcomes array", async () => {
    const { assertDownloadsSucceeded } = await import("../src/images/downloader.js");
    expect(() => assertDownloadsSucceeded([])).not.toThrow();
  });
});

// #268: composites generate --coverage over the full 16k-printing catalog
// cannot use assertDownloadsSucceeded's abort-on-any-failure behavior (that
// remains correct and unchanged for small runs) — some printings genuinely
// 403/404 from the LSS S3 bucket, and a coverage run needs those EXCLUDED
// from the eligible pool and REPORTED (with HTTP status), never silently
// dropped and never conflated with "eligible but the budget was too
// small." summarizeFailedDownloads is the pure extraction step images/
// cli.ts persists to a download-failures manifest for composites/cli.ts's
// coverage report to read later.
describe("summarizeFailedDownloads", () => {
  it("extracts only the failed outcomes, with HTTP status parsed from the failure reason", async () => {
    const { summarizeFailedDownloads } = await import("../src/images/downloader.js");
    const result = summarizeFailedDownloads([
      { printingId: "p1", status: "cached", path: "/cache/p1.png", attempts: 0 },
      { printingId: "p2", status: "downloaded", path: "/cache/p2.png", attempts: 1 },
      { printingId: "p3", status: "failed", path: "/cache/p3.png", attempts: 3, failureReason: "fetch failed: HTTP 403 for https://example.com/p3.webp" },
      { printingId: "p4", status: "failed", path: "/cache/p4.png", attempts: 3, failureReason: "fetch failed: HTTP 404 for https://example.com/p4.webp" },
    ]);
    expect(result).toEqual([
      { printingId: "p3", httpStatus: 403, reason: "fetch failed: HTTP 403 for https://example.com/p3.webp" },
      { printingId: "p4", httpStatus: 404, reason: "fetch failed: HTTP 404 for https://example.com/p4.webp" },
    ]);
  });

  it("reports httpStatus null when the failure reason has no parseable HTTP status (network-level failure after retries)", async () => {
    const { summarizeFailedDownloads } = await import("../src/images/downloader.js");
    const result = summarizeFailedDownloads([
      { printingId: "p1", status: "failed", path: "/cache/p1.png", attempts: 3, failureReason: "ECONNRESET" },
    ]);
    expect(result).toEqual([{ printingId: "p1", httpStatus: null, reason: "ECONNRESET" }]);
  });

  it("reports httpStatus/reason defensively even when failureReason is missing", async () => {
    const { summarizeFailedDownloads } = await import("../src/images/downloader.js");
    const result = summarizeFailedDownloads([{ printingId: "p1", status: "failed", path: "/cache/p1.png", attempts: 3 }]);
    expect(result).toEqual([{ printingId: "p1", httpStatus: null, reason: "unknown reason" }]);
  });

  it("returns an empty array when nothing failed", async () => {
    const { summarizeFailedDownloads } = await import("../src/images/downloader.js");
    expect(
      summarizeFailedDownloads([{ printingId: "p1", status: "cached", path: "/cache/p1.png", attempts: 0 }]),
    ).toEqual([]);
  });
});
