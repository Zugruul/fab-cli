import { describe, it, expect } from "vitest";
import { LruCache } from "../src/composites/lruCache.js";

describe("LruCache", () => {
  it("throws on a non-positive or non-integer capacity", () => {
    expect(() => new LruCache(0)).toThrow(/capacity/);
    expect(() => new LruCache(-1)).toThrow(/capacity/);
    expect(() => new LruCache(1.5)).toThrow(/capacity/);
  });

  it("returns undefined for a key that was never set", () => {
    const cache = new LruCache<string, number>(2);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("returns a stored value for a present key", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("evicts the least-recently-used entry once capacity is exceeded (#272: bounds the decoded source-image cache)", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // capacity 2 -> "a" (oldest, never touched since) is evicted

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("a get() promotes a key to most-recently-used, changing which key the next eviction picks", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // "a" is now MRU, "b" is now LRU
    cache.set("c", 3); // must evict "b", not "a"

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("setting an already-present key updates its value without growing size or evicting anything", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 100); // update, not a new entry

    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(100);
    expect(cache.get("b")).toBe(2);
  });

  it("never grows past capacity across many sets, however many distinct keys are inserted", () => {
    const cache = new LruCache<number, number>(8);
    for (let i = 0; i < 5000; i++) cache.set(i, i * 2);
    expect(cache.size).toBe(8);
  });
});
