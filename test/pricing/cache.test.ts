import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { cachedFetch, getPricingCacheDir } from "../../src/pricing/cache";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "fab-cli-pricing-cache-"),
  );
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("getPricingCacheDir", () => {
  it("defaults to ~/.config/fabrary-search/cache/pricing", () => {
    const dir = getPricingCacheDir();
    expect(dir).toBe(
      path.join(os.homedir(), ".config", "fabrary-search", "cache", "pricing"),
    );
  });

  it("honors an explicit override", () => {
    expect(getPricingCacheDir("/tmp/custom")).toBe("/tmp/custom");
  });

  it("falls back to FAB_PRICING_CACHE_DIR env var when no override given", () => {
    vi.stubEnv("FAB_PRICING_CACHE_DIR", "/tmp/env-dir");
    expect(getPricingCacheDir()).toBe("/tmp/env-dir");
    vi.unstubAllEnvs();
  });
});

describe("cachedFetch", () => {
  it("creates the cache dir on demand and calls the fetcher on a cold cache", async () => {
    const nestedDir = path.join(tmpDir, "nested", "pricing");
    const fetcher = vi.fn().mockResolvedValue({ hello: "world" });

    const result = await cachedFetch("my-key", fetcher, {
      cacheDir: nestedDir,
    });

    expect(result).toEqual({ hello: "world" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(nestedDir)).toBe(true);
  });

  it("returns cached value without calling fetcher when cache is fresh", async () => {
    const fetcher = vi.fn().mockResolvedValue({ v: 1 });

    await cachedFetch("fresh-key", fetcher, { cacheDir: tmpDir });
    const result = await cachedFetch("fresh-key", fetcher, {
      cacheDir: tmpDir,
    });

    expect(result).toEqual({ v: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("calls fetcher again and rewrites cache when stale (age >= ttl)", async () => {
    const cacheFile = path.join(tmpDir, "stale-key.json");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({ fetchedAt: Date.now() - 1000, value: { v: "old" } }),
    );

    const fetcher = vi.fn().mockResolvedValue({ v: "new" });
    const result = await cachedFetch("stale-key", fetcher, {
      cacheDir: tmpDir,
      ttlMs: 500,
    });

    expect(result).toEqual({ v: "new" });
    expect(fetcher).toHaveBeenCalledTimes(1);

    const onDisk = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    expect(onDisk.value).toEqual({ v: "new" });
  });

  it("does not call fetcher when age is just under the ttl", async () => {
    const cacheFile = path.join(tmpDir, "just-fresh.json");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({ fetchedAt: Date.now() - 100, value: { v: "cached" } }),
    );

    const fetcher = vi.fn().mockResolvedValue({ v: "new" });
    const result = await cachedFetch("just-fresh", fetcher, {
      cacheDir: tmpDir,
      ttlMs: 10_000,
    });

    expect(result).toEqual({ v: "cached" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("defaults TTL to 24h when not specified", async () => {
    const cacheFile = path.join(tmpDir, "default-ttl.json");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({
        fetchedAt: Date.now() - (23 * 60 * 60 * 1000), // 23h ago: still fresh
        value: { v: "cached" },
      }),
    );

    const fetcher = vi.fn().mockResolvedValue({ v: "new" });
    const result = await cachedFetch("default-ttl", fetcher, {
      cacheDir: tmpDir,
    });

    expect(result).toEqual({ v: "cached" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refresh: true always re-fetches and rewrites even when cache is fresh", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockResolvedValueOnce({ v: 2 });

    await cachedFetch("refresh-key", fetcher, { cacheDir: tmpDir });
    const result = await cachedFetch("refresh-key", fetcher, {
      cacheDir: tmpDir,
      refresh: true,
    });

    expect(result).toEqual({ v: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("self-heals from a corrupted/unparseable cache file by re-fetching", async () => {
    const cacheFile = path.join(tmpDir, "corrupt-key.json");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(cacheFile, "{ this is not valid json ][");

    const fetcher = vi.fn().mockResolvedValue({ v: "healed" });
    const result = await cachedFetch("corrupt-key", fetcher, {
      cacheDir: tmpDir,
    });

    expect(result).toEqual({ v: "healed" });
    expect(fetcher).toHaveBeenCalledTimes(1);

    const onDisk = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    expect(onDisk.value).toEqual({ v: "healed" });
  });

  it("treats a cache file missing expected shape as missing (self-heals)", async () => {
    const cacheFile = path.join(tmpDir, "wrong-shape.json");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ notWhatWeExpect: true }));

    const fetcher = vi.fn().mockResolvedValue({ v: "fixed" });
    const result = await cachedFetch("wrong-shape", fetcher, {
      cacheDir: tmpDir,
    });

    expect(result).toEqual({ v: "fixed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("propagates the fetcher error when stale cache exists (no silent stale serving)", async () => {
    const cacheFile = path.join(tmpDir, "error-key.json");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({ fetchedAt: Date.now() - 1000, value: { v: "old" } }),
    );

    const fetcher = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(
      cachedFetch("error-key", fetcher, { cacheDir: tmpDir, ttlMs: 500 }),
    ).rejects.toThrow("network down");

    // stale value must still be on disk, untouched
    const onDisk = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    expect(onDisk.value).toEqual({ v: "old" });
  });

  it("propagates the fetcher error on a cold cache too", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(
      cachedFetch("cold-error-key", fetcher, { cacheDir: tmpDir }),
    ).rejects.toThrow("boom");
  });

  it("sanitizes keys with unsafe filename characters", async () => {
    const fetcher = vi.fn().mockResolvedValue({ v: "ok" });
    await cachedFetch("group/123:prices?x=y", fetcher, { cacheDir: tmpDir });

    const files = fs.readdirSync(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toMatch(/[/:?]/);
  });

  it("different keys use different cache entries", async () => {
    const fetcherA = vi.fn().mockResolvedValue({ v: "a" });
    const fetcherB = vi.fn().mockResolvedValue({ v: "b" });

    const a = await cachedFetch("key-a", fetcherA, { cacheDir: tmpDir });
    const b = await cachedFetch("key-b", fetcherB, { cacheDir: tmpDir });

    expect(a).toEqual({ v: "a" });
    expect(b).toEqual({ v: "b" });
  });
});
