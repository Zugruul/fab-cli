// SPEC-APP.md §9.8: "IF the device has < 6 GB RAM or the 1.7B pack fails to
// load THEN THE SYSTEM SHALL run the 0.6B tier automatically and record the
// active tier in settings/diagnostics."

import { TierSelector } from "../tierSelector";
import { FakeDiagnosticsStore, FakeTierFallbackStore } from "./testDoubles";

const GB = 1024 ** 3;

function makeSelector() {
  const fallbackStore = new FakeTierFallbackStore();
  const diagnostics = new FakeDiagnosticsStore();
  const selector = new TierSelector(fallbackStore, diagnostics);
  return { fallbackStore, diagnostics, selector };
}

describe("TierSelector.selectTier — RAM/load-failure truth table", () => {
  it("4 GB RAM selects 0.6B without attempting a 1.7B load", async () => {
    const { diagnostics, selector } = makeSelector();
    const canLoad17B = jest.fn();

    const tier = await selector.selectTier({ totalRamBytes: 4 * GB, canLoad17B });

    expect(tier).toBe("0.6B");
    expect(canLoad17B).not.toHaveBeenCalled();
    expect(diagnostics.tierRecords).toEqual([{ tier: "0.6B", reason: "ram-below-floor" }]);
  });

  it("6 GB RAM (the 1.7B floor) selects 1.7B when the load succeeds", async () => {
    const { diagnostics, selector } = makeSelector();
    const canLoad17B = jest.fn().mockResolvedValue(true);

    const tier = await selector.selectTier({ totalRamBytes: 6 * GB, canLoad17B });

    expect(tier).toBe("1.7B");
    expect(canLoad17B).toHaveBeenCalledTimes(1);
    expect(diagnostics.tierRecords).toEqual([{ tier: "1.7B", reason: "ok" }]);
  });

  it("8 GB RAM selects 1.7B when the load succeeds", async () => {
    const { selector } = makeSelector();
    const canLoad17B = jest.fn().mockResolvedValue(true);

    const tier = await selector.selectTier({ totalRamBytes: 8 * GB, canLoad17B });

    expect(tier).toBe("1.7B");
  });

  it("just under the 6 GB floor selects 0.6B", async () => {
    const { selector } = makeSelector();
    const canLoad17B = jest.fn();

    const tier = await selector.selectTier({ totalRamBytes: 6 * GB - 1, canLoad17B });

    expect(tier).toBe("0.6B");
    expect(canLoad17B).not.toHaveBeenCalled();
  });

  it("a 1.7B load failure (throw) falls back to 0.6B and records the failure", async () => {
    const { diagnostics, fallbackStore, selector } = makeSelector();
    const canLoad17B = jest.fn().mockRejectedValue(new Error("OOM during model load"));

    const tier = await selector.selectTier({ totalRamBytes: 8 * GB, canLoad17B });

    expect(tier).toBe("0.6B");
    expect(fallbackStore.forced).toBe(true);
    expect(fallbackStore.reason).toBe("OOM during model load");
    expect(diagnostics.tierRecords).toEqual([{ tier: "0.6B", reason: "load-failure" }]);
  });

  it("a 1.7B load failure (resolves false) also falls back to 0.6B", async () => {
    const { fallbackStore, selector } = makeSelector();
    const canLoad17B = jest.fn().mockResolvedValue(false);

    const tier = await selector.selectTier({ totalRamBytes: 8 * GB, canLoad17B });

    expect(tier).toBe("0.6B");
    expect(fallbackStore.forced).toBe(true);
  });

  it("persists the load-failure fallback across calls, on a device that would otherwise qualify for 1.7B", async () => {
    const { diagnostics, selector } = makeSelector();
    const failingLoad = jest.fn().mockRejectedValue(new Error("OOM"));

    const first = await selector.selectTier({ totalRamBytes: 8 * GB, canLoad17B: failingLoad });
    expect(first).toBe("0.6B");

    // Second call: even though this canLoad17B WOULD succeed, the persisted
    // fallback from the first failure must win — and must not even attempt
    // another load.
    const wouldSucceedLoad = jest.fn().mockResolvedValue(true);
    const second = await selector.selectTier({ totalRamBytes: 8 * GB, canLoad17B: wouldSucceedLoad });

    expect(second).toBe("0.6B");
    expect(wouldSucceedLoad).not.toHaveBeenCalled();
    expect(diagnostics.tierRecords[1]).toEqual({ tier: "0.6B", reason: "load-failure-persisted" });
  });

  it("clearing the fallback (new artifacts installed) allows 1.7B to be attempted again", async () => {
    const { fallbackStore, selector } = makeSelector();
    await selector.selectTier({ totalRamBytes: 8 * GB, canLoad17B: jest.fn().mockRejectedValue(new Error("OOM")) });
    expect(fallbackStore.forced).toBe(true);

    await fallbackStore.clearFallback();
    const canLoad17B = jest.fn().mockResolvedValue(true);
    const tier = await selector.selectTier({ totalRamBytes: 8 * GB, canLoad17B });

    expect(tier).toBe("1.7B");
    expect(canLoad17B).toHaveBeenCalledTimes(1);
  });
});
