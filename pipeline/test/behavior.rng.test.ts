import { describe, it, expect } from "vitest";
import { createRng, shuffle, sampleWithoutReplacement } from "../src/behavior/rng.js";

describe("createRng", () => {
  it("produces numbers in [0, 1)", () => {
    const rng = createRng(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic: the same seed produces the same sequence", () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds produce different sequences", () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });
});

describe("shuffle", () => {
  it("does not mutate the input array", () => {
    const input = [1, 2, 3, 4, 5];
    const rng = createRng(7);
    shuffle(input, rng);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns a permutation with the same elements", () => {
    const input = [1, 2, 3, 4, 5];
    const rng = createRng(7);
    const out = shuffle(input, rng);
    expect(out.slice().sort()).toEqual(input.slice().sort());
    expect(out).toHaveLength(input.length);
  });

  it("is deterministic given the same seed", () => {
    const input = ["a", "b", "c", "d", "e", "f"];
    const out1 = shuffle(input, createRng(99));
    const out2 = shuffle(input, createRng(99));
    expect(out1).toEqual(out2);
  });
});

describe("sampleWithoutReplacement", () => {
  it("returns n distinct elements from the input", () => {
    const input = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    const rng = createRng(5);
    const out = sampleWithoutReplacement(input, 4, rng);
    expect(out).toHaveLength(4);
    expect(new Set(out).size).toBe(4);
    for (const item of out) expect(input).toContain(item);
  });

  it("clamps n to the input length", () => {
    const input = ["a", "b", "c"];
    const out = sampleWithoutReplacement(input, 10, createRng(1));
    expect(out).toHaveLength(3);
    expect(out.slice().sort()).toEqual(["a", "b", "c"]);
  });

  it("is deterministic given the same seed", () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    const out1 = sampleWithoutReplacement(input, 5, createRng(2026));
    const out2 = sampleWithoutReplacement(input, 5, createRng(2026));
    expect(out1).toEqual(out2);
  });

  it("different seeds usually produce a different sample", () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const out1 = sampleWithoutReplacement(input, 5, createRng(1));
    const out2 = sampleWithoutReplacement(input, 5, createRng(2));
    expect(out1).not.toEqual(out2);
  });
});
