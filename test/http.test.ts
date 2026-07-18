import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  httpFetch,
  cachedFetch,
  getHttpCacheDir,
  createLimiter,
  FABTCG_HEADERS,
  FABTCG_JSON_HEADERS,
  FABRARY_HEADERS,
  APPSYNC_MAX_CONCURRENCY,
  FABTCG_MAX_CONCURRENCY,
} from "../src/http";
import {
  installHttpMock,
  restoreHttpMock,
  mockPool,
  type MockAgentHandle,
} from "./helpers/http-mock";

describe("httpFetch — retry/backoff", () => {
  let mock: MockAgentHandle;
  let sleeps: number[];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };

  beforeEach(() => {
    mock = installHttpMock();
    sleeps = [];
  });

  afterEach(() => restoreHttpMock(mock));

  it("retries on 429/5xx/403 and eventually succeeds", async () => {
    const pool = mockPool(mock, "https://example.com");
    pool
      .intercept({ path: "/thing", method: "GET" })
      .reply(429, "rate limited");
    pool.intercept({ path: "/thing", method: "GET" }).reply(503, "unavailable");
    pool.intercept({ path: "/thing", method: "GET" }).reply(403, "forbidden");
    pool.intercept({ path: "/thing", method: "GET" }).reply(200, "ok");

    const res = await httpFetch("https://example.com/thing", {
      retries: 3,
      sleep,
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(sleeps.length).toBe(3);
  });

  it("fails fast on a non-retryable status (404), without retrying", async () => {
    const pool = mockPool(mock, "https://example.com");
    pool.intercept({ path: "/missing", method: "GET" }).reply(404, "not found");

    const res = await httpFetch("https://example.com/missing", {
      retries: 3,
      sleep,
    });

    expect(res.status).toBe(404);
    expect(sleeps.length).toBe(0);
  });

  it("gives up after exhausting retries and returns the last failed response", async () => {
    const pool = mockPool(mock, "https://example.com");
    pool
      .intercept({ path: "/always-403", method: "GET" })
      .reply(403, "no")
      .times(3);

    const res = await httpFetch("https://example.com/always-403", {
      retries: 2,
      sleep,
    });

    expect(res.status).toBe(403);
    expect(sleeps.length).toBe(2);
  });

  it("attaches the correct preset headers per host", async () => {
    let capturedFabtcg: Record<string, string | string[]> = {};
    let capturedJson: Record<string, string | string[]> = {};
    let capturedFabrary: Record<string, string | string[]> = {};

    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/html", method: "GET" })
      .reply((opts) => {
        capturedFabtcg = opts.headers as Record<string, string | string[]>;
        return { statusCode: 200, data: "ok" };
      });
    mockPool(mock, "https://fabtcg.com")
      .intercept({ path: "/json", method: "GET" })
      .reply((opts) => {
        capturedJson = opts.headers as Record<string, string | string[]>;
        return { statusCode: 200, data: "{}" };
      });
    mockPool(mock, "https://fabrary.net")
      .intercept({ path: "/meta", method: "GET" })
      .reply((opts) => {
        capturedFabrary = opts.headers as Record<string, string | string[]>;
        return { statusCode: 200, data: "{}" };
      });

    await httpFetch("https://fabtcg.com/html", { preset: "fabtcg" });
    await httpFetch("https://fabtcg.com/json", { preset: "fabtcgJson" });
    await httpFetch("https://fabrary.net/meta", { preset: "fabrary" });

    const flat = (h: Record<string, string | string[]>) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(h))
        out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
      return out;
    };

    expect(flat(capturedFabtcg)["referer"]).toBe(FABTCG_HEADERS.Referer);
    expect(flat(capturedFabtcg)["user-agent"]).toBe(
      FABTCG_HEADERS["User-Agent"],
    );
    expect(flat(capturedJson)["accept"]).toBe(FABTCG_JSON_HEADERS.Accept);
    expect(flat(capturedFabrary)["origin"]).toBe(FABRARY_HEADERS.Origin);
  });
});

describe("getHttpCacheDir", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to ~/.cache/fab-cli", () => {
    expect(getHttpCacheDir()).toBe(
      path.join(os.homedir(), ".cache", "fab-cli"),
    );
  });

  it("honors an explicit override", () => {
    expect(getHttpCacheDir("/tmp/custom-http-cache")).toBe(
      "/tmp/custom-http-cache",
    );
  });

  it("falls back to FAB_HTTP_CACHE_DIR env var when no override given", () => {
    vi.stubEnv("FAB_HTTP_CACHE_DIR", "/tmp/env-http-cache");
    expect(getHttpCacheDir()).toBe("/tmp/env-http-cache");
  });
});

describe("cachedFetch — opt-in TTL disk cache", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "fab-cli-http-cache-"),
    );
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("cache hit skips the network entirely (fetcher not called)", async () => {
    const fetcher = vi.fn().mockResolvedValue({ v: "fresh" });
    await cachedFetch("warm-key", fetcher, { cacheDir: tmpDir });

    const fetcher2 = vi.fn().mockResolvedValue({ v: "should-not-be-used" });
    const result = await cachedFetch("warm-key", fetcher2, {
      cacheDir: tmpDir,
    });

    expect(result).toEqual({ v: "fresh" });
    expect(fetcher2).not.toHaveBeenCalled();
  });

  it("cache miss calls through to the fetcher and writes the cache", async () => {
    const fetcher = vi.fn().mockResolvedValue({ v: "written" });
    const result = await cachedFetch("cold-key", fetcher, { cacheDir: tmpDir });

    expect(result).toEqual({ v: "written" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "cold-key.json"), "utf8"),
    );
    expect(onDisk.value).toEqual({ v: "written" });
  });

  it("stale cache (age >= ttl) calls through again and rewrites", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "stale-key.json"),
      JSON.stringify({ fetchedAt: Date.now() - 10_000, value: { v: "old" } }),
    );
    const fetcher = vi.fn().mockResolvedValue({ v: "new" });
    const result = await cachedFetch("stale-key", fetcher, {
      cacheDir: tmpDir,
      ttlMs: 500,
    });

    expect(result).toEqual({ v: "new" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("createLimiter — bounded concurrency", () => {
  it("never runs more than max concurrent tasks", async () => {
    const max = 3;
    const limit = createLimiter(max);
    let active = 0;
    let peak = 0;

    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    };

    await Promise.all(Array.from({ length: 10 }, () => limit(task)));

    expect(peak).toBeLessThanOrEqual(max);
  });

  it("exposes the known upstream concurrency constants", () => {
    expect(APPSYNC_MAX_CONCURRENCY).toBe(4);
    expect(FABTCG_MAX_CONCURRENCY).toBe(5);
  });
});
